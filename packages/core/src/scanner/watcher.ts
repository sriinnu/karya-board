/**
 * File watcher module using chokidar with per-file debouncing.
 * Handles file change events with proper deduplication and race condition prevention.
 * @packageDocumentation
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import { shouldScanFile } from './parser.js';
import { createLogger } from '../logger.js';

/**
 * Scoped watcher logger.
 * @internal
 */
const logger = createLogger('watcher');

/**
 * Event type emitted by the file watcher.
 * @public
 */
export type FileEventType = 'add' | 'change' | 'unlink';

/**
 * File event data emitted when a file changes.
 * @public
 */
export interface FileEvent {
  /** Type of file event */
  type: FileEventType;
  /** Absolute path to the file */
  filePath: string;
  /** Relative path from the watched root */
  relativePath: string;
}

/**
 * Callback type for file events.
 * @public
 */
export type FileEventCallback = (event: FileEvent) => void | Promise<void>;

/**
 * Watcher configuration options.
 * @public
 */
export interface WatcherConfig {
  /** Root directory to watch */
  rootPath: string;
  /** Glob patterns to include */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Maximum depth for recursive watching */
  depth?: number;
  /** Whether to watch hidden files */
  ignoreHidden?: boolean;
}

/**
 * Per-file debounce state.
 * @internal
 */
interface PendingFile {
  /** Timer ID for the debounce */
  timer: ReturnType<typeof setTimeout>;
  /** Type of event to emit */
  eventType: FileEventType;
}

/**
 * File watcher with per-file debouncing.
 * Prevents race conditions by ensuring each file has its own debounce timer.
 * @public
 */
export class FileWatcher {
  /** The underlying chokidar watcher */
  private watcher: FSWatcher | null = null;

  /** Root path being watched */
  private rootPath: string;

  /** Include patterns */
  private include: string[];

  /** Exclude patterns */
  private exclude: string[];

  /** Debounce delay in milliseconds */
  private debounceMs: number;

  /** Pending file processing timers */
  private pendingFiles = new Map<string, PendingFile>();

  /** Maximum depth for watching */
  private depth: number;

  /** Callback for file events */
  private onEvent: FileEventCallback | null = null;

  /** Whether the watcher is currently active */
  private isActive = false;

  /**
   * Creates a new FileWatcher instance.
   *
   * @param config - Watcher configuration
   */
  constructor(config: WatcherConfig) {
    this.rootPath = config.rootPath;
    this.include = config.include ?? ['**/*.md', '**/*.ts', '**/*.js'];
    this.exclude = config.exclude ?? [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/*.log',
    ];
    this.debounceMs = config.debounceMs ?? 500;
    this.depth = config.depth ?? 10;
  }

  /**
   * Starts watching the file system.
   * Must be called before any events will be emitted.
   *
   * @param callback - Function to call when files change
   * @returns Promise that resolves when watching starts
   * @example
   * ```typescript
   * const watcher = new FileWatcher({ rootPath: './src' });
   * await watcher.start((event) => {
   *   console.log(`File ${event.type}: ${event.relativePath}`);
   * });
   * ```
   */
  async start(callback: FileEventCallback): Promise<void> {
    if (this.isActive) {
      throw new Error('Watcher is already active');
    }

    this.onEvent = callback;

    // Build ignore pattern to always exclude BOARD.md (self-referential)
    const watchExclude = [...this.exclude, '**/BOARD.md'];

    this.watcher = chokidar.watch(this.rootPath, {
      ignored: watchExclude,
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: this.depth,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    // Set up event handlers
    this.watcher.on('add', (filePath) => this.handleEvent('add', filePath));
    this.watcher.on('change', (filePath) => this.handleEvent('change', filePath));
    this.watcher.on('unlink', (filePath) => this.handleEvent('unlink', filePath));

    // Handle errors
    this.watcher.on('error', (error) => {
      logger.error('Watcher error:', error);
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve, reject) => {
      if (!this.watcher) {
        reject(new Error('Watcher not initialized'));
        return;
      }

      this.watcher.on('ready', () => {
        this.isActive = true;
        resolve();
      });

      this.watcher.on('error', (error) => {
        reject(error);
      });
    });

    logger.info(`Watching: ${this.rootPath}`);
  }

  /**
   * Stops watching the file system.
   * Cancels any pending debounced events.
   *
   * @example
   * ```typescript
   * await watcher.stop();
   * ```
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Clear all pending timers
    this.cancelAllPending();

    await this.watcher.close();
    this.watcher = null;
    this.isActive = false;
    this.onEvent = null;
  }

  /**
   * Gets the current watching status.
   */
  get isWatching(): boolean {
    return this.isActive;
  }

  /**
   * Gets the root path being watched.
   */
  get watchedPath(): string {
    return this.rootPath;
  }

  /**
   * Handles a file event with per-file debouncing.
   * @internal
   */
  private handleEvent(type: FileEventType, filePath: string): void {
    if (
      !shouldScanFile(filePath, {
        include: this.include,
        exclude: this.exclude,
      })
    ) {
      return;
    }

    // Get relative path
    const relativePath = path.relative(this.rootPath, filePath);

    // Check if this file already has a pending operation
    const existing = this.pendingFiles.get(filePath);
    if (existing) {
      // Clear existing timer and update event type
      clearTimeout(existing.timer);

      // For unlink, always prefer that (file deletion)
      const newEventType = type === 'unlink' ? 'unlink' : existing.eventType;

      const timer = setTimeout(() => {
        this.pendingFiles.delete(filePath);
        this.emitEvent(newEventType, filePath, relativePath);
      }, this.debounceMs);

      this.pendingFiles.set(filePath, {
        timer,
        eventType: newEventType,
      });
    } else {
      // New file - set up debounce
      const timer = setTimeout(() => {
        this.pendingFiles.delete(filePath);
        this.emitEvent(type, filePath, relativePath);
      }, this.debounceMs);

      this.pendingFiles.set(filePath, {
        timer,
        eventType: type,
      });
    }
  }

  /**
   * Emits a file event to the callback.
   * @internal
   */
  private async emitEvent(
    type: FileEventType,
    filePath: string,
    relativePath: string
  ): Promise<void> {
    if (!this.onEvent) {
      return;
    }

    const event: FileEvent = {
      type,
      filePath,
      relativePath,
    };

    try {
      await this.onEvent(event);
    } catch (error) {
      logger.error('Error in file event callback:', error);
    }
  }

  /**
   * Cancels all pending file operations.
   * @internal
   */
  private cancelAllPending(): void {
    for (const pending of this.pendingFiles.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingFiles.clear();
  }

  /**
   * Gets the number of files currently pending debounce.
   */
  get pendingCount(): number {
    return this.pendingFiles.size;
  }
}

/**
 * Creates a FileWatcher instance with common defaults.
 *
 * @param rootPath - Root directory to watch
 * @param options - Additional options
 * @returns Configured FileWatcher instance
 * @example
 * ```typescript
 * const watcher = createWatcher('./my-project', {
 *   debounceMs: 300,
 *   exclude: ['node_modules'],
 * });
 * ```
 */
export function createWatcher(
  rootPath: string,
  options?: Partial<WatcherConfig>
): FileWatcher {
  return new FileWatcher({
    rootPath,
    ...options,
  });
}
