/**
 * BOARD.md generator module - creates the Claude-readable task board.
 * Uses a mutex pattern to ensure only one writer runs at a time.
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { Database } from '../db/index.js';
import type { Issue, KaryaConfig, Project } from '../db/models.js';

/**
 * BOARD.md generation options.
 * @public
 */
export interface BoardGenOptions {
  /** Database instance */
  db: Database;
  /** Karya configuration */
  config: KaryaConfig;
}

/**
 * Result of BOARD.md generation.
 * @public
 */
export interface BoardGenResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Path to the generated file */
  filePath: string;
  /** Number of projects included */
  projectCount: number;
  /** Total number of issues */
  issueCount: number;
  /** Error if generation failed */
  error?: Error;
}

/**
 * Emoji mapping for priority levels.
 * @internal
 */
const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

/**
 * BOARD.md generator with single-writer mutex pattern.
 * Prevents race conditions when multiple sources trigger regeneration.
 * @public
 */
export class BoardGenerator {
  /** Database instance */
  private db: Database;

  /** Output file path */
  private outputPath: string;

  /** Whether a write is currently in progress */
  private writeInProgress = false;

  /** Whether a write is queued after current one */
  private writeQueued = false;

  /** Debounce timer for coalescing rapid updates */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounce delay in milliseconds */
  private debounceMs: number;

  /** Active write promise tracked so shutdown can wait for in-flight work */
  private activeWrite: Promise<BoardGenResult> | null = null;

  /** Whether this generator has been disposed */
  private disposed = false;

  /**
   * Creates a new BoardGenerator instance.
   *
   * @param options - Configuration options
   */
  constructor(options: BoardGenOptions) {
    this.db = options.db;
    this.outputPath = path.resolve(options.config.boardOutput);
    this.debounceMs = options.config.scanner?.debounceMs ?? 500;
  }

  /**
   * Regenerates the BOARD.md file.
   * Uses mutex pattern to prevent concurrent writes.
   *
   * @returns Result of generation
   * @example
   * ```typescript
   * const result = await generator.regenerate();
   * if (result.success) {
   *   console.log(`Generated ${result.filePath}`);
   * }
   * ```
   */
  public async regenerate(): Promise<BoardGenResult> {
    if (this.disposed) {
      return this.createDisposedResult();
    }

    return this.executeWrite();
  }

  /**
   * Schedules a regeneration with debouncing.
   * Multiple rapid calls are coalesced into a single write.
   *
   * @example
   * ```typescript
   * generator.scheduleRegenerate();
   * generator.scheduleRegenerate(); // Only one write
   * ```
   */
  public scheduleRegenerate(): void {
    if (this.disposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.disposed) {
        return;
      }

      void this.executeWrite();
    }, this.debounceMs);
  }

  /**
   * Disposes the generator and waits for any in-flight write to finish.
   * I clear queued timers first so shutdown cannot schedule fresh writes after the database closes.
   *
   * @public
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.writeQueued = false;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.activeWrite) {
      await this.activeWrite;
    }
  }

  /**
   * Executes the write operation with mutex protection.
   * @internal
   */
  private async executeWrite(): Promise<BoardGenResult> {
    if (this.disposed) {
      return this.createDisposedResult();
    }

    // If a write is in progress, queue another one
    if (this.writeInProgress) {
      this.writeQueued = true;
      return {
        success: true,
        filePath: this.outputPath,
        projectCount: 0,
        issueCount: 0,
      };
    }

    this.writeInProgress = true;
    this.activeWrite = (async () => {
      try {
        const result = await this.writeBoardFile();

        // I only honor queued work while the generator is still live.
        if (this.writeQueued && !this.disposed) {
          this.writeQueued = false;
          setImmediate(() => {
            if (!this.disposed) {
              this.scheduleRegenerate();
            }
          });
        }

        return result;
      } finally {
        this.writeInProgress = false;
        this.activeWrite = null;
      }
    })();

    return this.activeWrite;
  }

  /**
   * Writes the BOARD.md file.
   * @internal
   */
  private async writeBoardFile(): Promise<BoardGenResult> {
    try {
      // Get all projects
      const projects = this.db.getAllProjects();

      // Generate content
      const content = this.generateContent(projects);

      // Ensure directory exists
      const dir = path.dirname(this.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file atomically using temp file
      const tempPath = `${this.outputPath}.tmp`;
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, this.outputPath);

      // Count total issues
      let totalIssues = 0;
      for (const project of projects) {
        const issues = this.db.getIssuesByProject(project.id);
        totalIssues += issues.length;
      }

      return {
        success: true,
        filePath: this.outputPath,
        projectCount: projects.length,
        issueCount: totalIssues,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        filePath: this.outputPath,
        projectCount: 0,
        issueCount: 0,
        error: err,
      };
    }
  }

  /**
   * Creates a consistent result for writes attempted after disposal.
   * @internal
   */
  private createDisposedResult(): BoardGenResult {
    return {
      success: false,
      filePath: this.outputPath,
      projectCount: 0,
      issueCount: 0,
      error: new Error('Board generator has been disposed'),
    };
  }

  /**
   * Generates the BOARD.md content from projects and issues.
   * @internal
   */
  private generateContent(projects: Project[]): string {
    const lines: string[] = [];

    // Header
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);
    lines.push('# KARYA BOARD');
    lines.push(`_Last updated: ${timestamp}_`);
    lines.push('');

    // For each project
    for (const project of projects) {
      const issues = this.db.getIssuesByProject(project.id);
      const stats = this.db.getProjectStats(project.id);

      // Project header
      lines.push(`## ${project.name}`);
      lines.push(
        `**Status:** ${stats.open} open | ${stats.inProgress} in_progress | ${stats.critical} critical`
      );
      lines.push('');

      // Group by priority
      const priorityGroups = this.groupByPriority(issues);

      // Critical
      if (priorityGroups.critical.length > 0) {
        lines.push('### 🔴 Critical');
        for (const issue of priorityGroups.critical) {
          lines.push(this.formatIssue(issue));
        }
        lines.push('');
      }

      // High
      if (priorityGroups.high.length > 0) {
        lines.push('### 🟠 High');
        for (const issue of priorityGroups.high) {
          lines.push(this.formatIssue(issue));
        }
        lines.push('');
      }

      // Medium
      if (priorityGroups.medium.length > 0) {
        lines.push('### 🟡 Medium');
        for (const issue of priorityGroups.medium) {
          lines.push(this.formatIssue(issue));
        }
        lines.push('');
      }

      // Low
      if (priorityGroups.low.length > 0) {
        lines.push('### 🟢 Low');
        for (const issue of priorityGroups.low) {
          lines.push(this.formatIssue(issue));
        }
        lines.push('');
      }

      // Done section (collapsible)
      if (stats.done > 0) {
        lines.push('### ✅ Done');
        for (const issue of priorityGroups.done) {
          lines.push(this.formatIssue(issue));
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Formats a single issue as a markdown list item.
   * @internal
   */
  private formatIssue(issue: Issue): string {
    const checkbox = issue.status === 'done' ? '[x]' : '[ ]';
    const emoji = PRIORITY_EMOJI[issue.priority] || '';
    const source = issue.sourceFile ? ` (${path.basename(issue.sourceFile)})` : '';

    return `- ${checkbox} ${emoji} ${issue.title}${source}`;
  }

  /**
   * Groups issues by priority.
   * @internal
   */
  private groupByPriority(
    issues: Issue[]
  ): Record<string, Issue[]> {
    const groups: Record<string, Issue[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      done: [],
    };

    for (const issue of issues) {
      if (issue.status === 'done') {
        groups.done.push(issue);
      } else {
        const priority = issue.priority;
        if (groups[priority]) {
          groups[priority].push(issue);
        } else {
          groups.medium.push(issue);
        }
      }
    }

    return groups;
  }

  /**
   * Gets the current output path.
   */
  get output(): string {
    return this.outputPath;
  }

  /**
   * Gets whether a write is currently in progress.
   */
  get isWriting(): boolean {
    return this.writeInProgress;
  }

  /**
   * Gets whether a write is queued.
   */
  get isQueued(): boolean {
    return this.writeQueued;
  }
}

/**
 * Creates a new BoardGenerator instance.
 *
 * @param options - Configuration options
 * @returns Configured BoardGenerator instance
 * @example
 * ```typescript
 * const generator = createBoardGenerator({
 *   db: new Database('./karya.db'),
 *   config: loadConfig(),
 * });
 * ```
 */
export function createBoardGenerator(options: BoardGenOptions): BoardGenerator {
  return new BoardGenerator(options);
}

export type { BoardGenerator as BoardGen };
