/**
 * Scanner module - orchestrates file watching, parsing, and database updates.
 * Coordinates the full scan and live file watching with race condition handling.
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { FileWatcher, type FileEvent, type FileEventType } from './watcher.js';
import {
  parseFile,
  shouldScanFile,
} from './parser.js';
import { ScanDeduplicator } from './dedupe.js';
import { Database } from '../db/index.js';
import { createLogger } from '../logger.js';
import type { KaryaConfig, ProjectConfig } from '../db/models.js';

/**
 * Scoped scanner logger.
 * @internal
 */
const logger = createLogger('scanner');

/**
 * Event emitted when the scanner processes changes.
 * @public
 */
export interface ScanEvent {
  /** Type of scan event */
  type: 'full-scan' | 'file-change' | 'db-updated';
  /** Project ID if applicable */
  projectId?: string;
  /** Number of issues found */
  issueCount?: number;
  /** Any errors encountered */
  errors?: Error[];
}

/**
 * Callback for scan events.
 * @public
 */
export type ScanEventCallback = (event: ScanEvent) => void | Promise<void>;

/**
 * Scanner configuration options.
 * @public
 */
export interface ScannerOptions {
  /** Database instance */
  db: Database;
  /** Karya configuration */
  config: KaryaConfig;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Maximum file size to process in MB */
  fileSizeLimitMb?: number;
}

/**
 * Scanner that monitors projects and extracts issues.
 * Handles both full scans at startup and incremental updates via file watching.
 * @public
 */
export class Scanner {
  /** Database instance */
  private db: Database;

  /** Karya configuration */
  private config: KaryaConfig;

  /** Per-project file watchers */
  private watchers = new Map<string, FileWatcher>();

  /** Per-project deduplicators */
  private deduplicators = new Map<string, ScanDeduplicator>();

  /** Event callback */
  private onEvent: ScanEventCallback | null = null;

  /** Whether scanner is running */
  private isRunning = false;

  /**
   * Creates a new Scanner instance.
   *
   * @param options - Scanner configuration
   */
  constructor(options: ScannerOptions) {
    this.db = options.db;
    this.config = options.config;
  }

  /**
   * Sets the event callback for scan events.
   *
   * @param callback - Function to call on scan events
   * @returns This instance for chaining
   */
  onScanEvent(callback: ScanEventCallback): this {
    this.onEvent = callback;
    return this;
  }

  /**
   * Starts the scanner - performs full scan then attaches watchers.
   * Must be called before any file monitoring occurs.
   *
   * @returns Promise that resolves when scanning is complete
   * @example
   * ```typescript
   * const scanner = new Scanner({ db, config });
   * scanner.onScanEvent((e) => console.log(e));
   * await scanner.start();
   * ```
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scanner is already running');
    }

    this.isRunning = true;

    try {
      // Process each configured project
      for (const projectConfig of this.config.projects) {
        await this.scanProject(projectConfig);
      }

      // Attach watchers AFTER full scan completes
      // This prevents race conditions where watcher fires during initial scan
      await this.attachWatchers();

      await this.emitEvent({ type: 'full-scan' });
    } catch (error) {
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stops all file watchers.
   * Should be called when shutting down.
   *
   * @example
   * ```typescript
   * await scanner.stop();
   * ```
   */
  async stop(): Promise<void> {
    // Stop all watchers
    const stopPromises = Array.from(this.watchers.values()).map((w) =>
      w.stop()
    );
    await Promise.all(stopPromises);

    this.watchers.clear();
    this.deduplicators.clear();
    this.isRunning = false;
  }

  /**
   * Checks if scanner is currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Gets the deduplicator for a project, creating if needed.
   * @internal
   */
  private getDeduplicator(projectId: string): ScanDeduplicator {
    let deduper = this.deduplicators.get(projectId);
    if (!deduper) {
      deduper = new ScanDeduplicator();
      this.deduplicators.set(projectId, deduper);
    }
    return deduper;
  }

  /**
   * Scans a single project directory.
   * @internal
   */
  private async scanProject(projectConfig: ProjectConfig): Promise<void> {
    // Resolve project path relative to config location
    const projectPath = this.resolvePath(projectConfig.path);

    // Check if path exists
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    // Get or create project in database
    let project = this.db.getProjectByPath(projectPath);
    if (!project) {
      const result = this.db.createProject(projectConfig.name, projectPath);
      if (!result.success) {
        logger.error(
          `Failed to create project ${projectConfig.name}:`,
          result.error
        );
        return;
      }
      project = result.data;
    }

    // Get deduplicator for this project
    const deduper = this.getDeduplicator(project.id);

    // Find and process all relevant files
    const files = this.findFiles(projectPath, projectConfig);

    for (const filePath of files) {
      await this.processFile(project.id, filePath, deduper);
    }
  }

  /**
   * Finds all files matching the project config.
   * @internal
   */
  private findFiles(
    projectPath: string,
    projectConfig: ProjectConfig
  ): string[] {
    const files: string[] = [];
    const maxDepth = this.config.scanDepth ?? 3;

    const walk = (dir: string, depth: number): void => {
      if (depth > maxDepth) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (this.isExcludedPath(fullPath, projectConfig.exclude)) {
              continue;
            }
            walk(fullPath, depth + 1);
          } else if (
            entry.isFile() &&
            shouldScanFile(fullPath, {
              include: projectConfig.include,
              exclude: projectConfig.exclude,
            })
          ) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Skip inaccessible directories
        logger.warn(`Cannot read directory ${dir}:`, error);
      }
    };

    walk(projectPath, 0);
    return files;
  }

  /**
   * Processes a single file - parses and updates database.
   * @internal
   */
  private async processFile(
    projectId: string,
    filePath: string,
    deduper: ScanDeduplicator
  ): Promise<void> {
    // Parse the file
    const parseResult = await parseFile(filePath, {
      fileSizeLimitMb: this.config.scanner?.fileSizeLimitMb ?? 10,
    });

    if (!parseResult.success) {
      logger.warn(`Failed to parse ${filePath}:`, parseResult.error.message);
      await this.clearScannerStateForFile(projectId, filePath, deduper, 'db-updated');
      return;
    }

    // Log any warnings
    for (const warning of parseResult.data.warnings) {
      logger.warn(warning);
    }

    // Check deduplication
    const contentHash = deduper.hashContent(parseResult.data.content);
    const dedupeCheck = deduper.shouldProcess(filePath, contentHash);

    if (!dedupeCheck.isNew) {
      // No new content, skip processing
      return;
    }

    try {
      const issueCount = await this.db.write(async () => {
        const deleteIssuesResult = this.db.deleteScannerIssuesBySourceFile(
          projectId,
          filePath
        );
        if (!deleteIssuesResult.success) {
          throw deleteIssuesResult.error;
        }

        const artifactResult = this.db.upsertArtifact({
          projectId,
          filePath,
          content: parseResult.data.content,
        });
        if (!artifactResult.success) {
          throw artifactResult.error;
        }

        const seenIssueKeys = new Set<string>();
        let createdCount = 0;

        for (const extracted of parseResult.data.issues) {
          const dedupeKey = `${extracted.type}:${extracted.title.toLowerCase()}`;
          if (seenIssueKeys.has(dedupeKey)) {
            continue;
          }
          seenIssueKeys.add(dedupeKey);

          const result = this.db.createIssue({
            projectId,
            title: extracted.title,
            description: extracted.description ?? undefined,
            priority: extracted.priority,
            source: 'scanner',
            sourceFile: extracted.sourceFile,
          });
          if (!result.success) {
            throw result.error;
          }
          createdCount += 1;
        }

        return createdCount;
      });

      // Mark as complete
      deduper.complete(filePath, contentHash);

      // Emit update event
      await this.emitEvent({
        type: 'db-updated',
        projectId,
        issueCount,
      });
    } catch (error) {
      deduper.cancel(filePath);
      throw error;
    }
  }

  /**
   * Attaches file watchers to all configured projects.
   * @internal
   */
  private async attachWatchers(): Promise<void> {
    for (const projectConfig of this.config.projects) {
      const projectPath = this.resolvePath(projectConfig.path);
      const project = this.db.getProjectByPath(projectPath);

      if (!project) {
        logger.warn(`No project found for path: ${projectPath}`);
        continue;
      }

      const watcher = new FileWatcher({
        rootPath: projectPath,
        include: projectConfig.include,
        exclude: projectConfig.exclude,
        debounceMs: this.config.scanner?.debounceMs ?? 500,
        depth: this.config.scanDepth,
      });

      // Handle file events
      await watcher.start(async (event: FileEvent) => {
        await this.handleFileEvent(project.id, event);
      });

      this.watchers.set(project.id, watcher);
    }
  }

  /**
   * Handles a file change event.
   * @internal
   */
  private async handleFileEvent(
    projectId: string,
    event: FileEvent
  ): Promise<void> {
    const deduper = this.getDeduplicator(projectId);

    if (event.type === 'unlink') {
      await this.clearScannerStateForFile(projectId, event.filePath, deduper, 'file-change');
      return;
    }

    // Process the file
    await this.processFile(projectId, event.filePath, deduper);
  }

  /**
   * Clears scanner-owned state for a file when it disappears or becomes unreadable.
   * I remove the cached artifact and scanner issues together so stale findings do not linger.
   *
   * @param projectId - Owning project ID
   * @param filePath - Absolute file path to clear
   * @param deduper - Project-level deduplication helper
   * @param eventType - Follow-up event to emit after cleanup
   * @internal
   */
  private async clearScannerStateForFile(
    projectId: string,
    filePath: string,
    deduper: ScanDeduplicator,
    eventType: 'file-change' | 'db-updated'
  ): Promise<void> {
    try {
      await this.db.write(async () => {
        const deleteArtifactResult = this.db.deleteArtifact(projectId, filePath);
        if (!deleteArtifactResult.success) {
          throw deleteArtifactResult.error;
        }

        const deleteIssuesResult = this.db.deleteScannerIssuesBySourceFile(
          projectId,
          filePath
        );
        if (!deleteIssuesResult.success) {
          throw deleteIssuesResult.error;
        }

        return deleteIssuesResult.data;
      });

      deduper.remove(filePath);
      await this.emitEvent({
        type: eventType,
        projectId,
        issueCount: 0,
      });
    } catch (error) {
      logger.warn(`Failed to clear scanner state for ${filePath}:`, error);
    }
  }

  /**
   * Resolves a path relative to the config file location.
   * @internal
   */
  private resolvePath(p: string): string {
    if (path.isAbsolute(p)) {
      return p;
    }
    // For now, assume config is in cwd
    return path.resolve(process.cwd(), p);
  }

  /**
   * Emits a scan event.
   * @internal
   */
  private async emitEvent(event: ScanEvent): Promise<void> {
    if (this.onEvent) {
      try {
        await this.onEvent(event);
      } catch (error) {
        logger.error('Error in scan event callback:', error);
      }
    }
  }

  /**
   * Checks whether a path should be excluded before recursing into it.
   * I keep directory exclusion separate from file inclusion so nested files are discovered correctly.
   *
   * @param targetPath - Directory or file path to evaluate
   * @param excludePatterns - Project-specific exclude patterns
   * @returns True when the path should be skipped
   * @internal
   */
  private isExcludedPath(
    targetPath: string,
    excludePatterns?: string[]
  ): boolean {
    const exclude = excludePatterns ?? ['node_modules', '.git', 'dist', 'build'];
    const name = path.basename(targetPath);

    for (const pattern of exclude) {
      if (pattern.startsWith('**/')) {
        const globPart = pattern.slice(3).replace(/\/\*\*$/, '');
        if (name === globPart || targetPath.includes(globPart)) {
          return true;
        }
        continue;
      }

      if (name === pattern || targetPath.includes(`/${pattern}/`)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Creates a new Scanner instance with the given configuration.
 *
 * @param options - Scanner options
 * @returns Configured Scanner instance
 * @example
 * ```typescript
 * const scanner = createScanner({
 *   db: new Database('./karya.db'),
 *   config: loadConfig(),
 * });
 * ```
 */
export function createScanner(options: ScannerOptions): Scanner {
  return new Scanner(options);
}

export { FileWatcher, type FileEvent, type FileEventType };
export { parseFile, shouldScanFile } from './parser.js';
export { ScanDeduplicator } from './dedupe.js';
