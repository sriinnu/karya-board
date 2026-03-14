/**
 * Embedded scanner lifecycle for the local HTTP API.
 * I keep scanner start/restart/stop state isolated here so the API server can stay thin.
 * @packageDocumentation
 */

import {
  createLogger,
  createScanner,
  type BoardGenerator,
  type Database,
  type KaryaConfig,
  type Scanner,
} from '@karya/core';

/**
 * Scanner status returned to browser clients.
 * @public
 */
export interface ScannerRuntimeStatus {
  /** Whether the embedded scanner is currently running */
  running: boolean;
  /** Number of configured projects */
  projectCount: number;
  /** Most recent successful start timestamp */
  lastStartedAt: number | null;
  /** Runtime mode for the current scanner */
  mode: 'embedded';
}

/**
 * Construction options for the embedded scanner controller.
 * @public
 */
export interface ScannerControllerOptions {
  /** Shared API database connection */
  db: Database;
  /** Active normalized config */
  config: KaryaConfig;
  /** Shared BOARD.md generator */
  boardGenerator: BoardGenerator;
}

/**
 * Scoped scanner lifecycle logger.
 * @internal
 */
const logger = createLogger('scanner-control');

/**
 * Small lifecycle wrapper around the core scanner.
 * @public
 */
export class ScannerController {
  /** Shared API database */
  private readonly db: Database;

  /** Shared board generator */
  private readonly boardGenerator: BoardGenerator;

  /** Latest normalized config */
  private config: KaryaConfig;

  /** Live embedded scanner instance */
  private scanner: Scanner | null = null;

  /** Most recent successful scanner start */
  private lastStartedAt: number | null = null;

  /**
   * Creates a new scanner lifecycle controller.
   * @param options - Shared runtime dependencies
   */
  constructor(options: ScannerControllerOptions) {
    this.db = options.db;
    this.config = options.config;
    this.boardGenerator = options.boardGenerator;
  }

  /**
   * Replaces the normalized config used for subsequent starts.
   * @param config - Updated normalized config
   */
  setConfig(config: KaryaConfig): void {
    this.config = config;
  }

  /**
   * Returns the current embedded scanner status.
   * @returns Scanner runtime status
   */
  getStatus(): ScannerRuntimeStatus {
    return {
      running: Boolean(this.scanner?.running),
      projectCount: this.config.projects.length,
      lastStartedAt: this.lastStartedAt,
      mode: 'embedded',
    };
  }

  /**
   * Starts the embedded scanner if it is not already running.
   * @returns Updated scanner status
   */
  async start(): Promise<ScannerRuntimeStatus> {
    if (this.scanner?.running) {
      return this.getStatus();
    }

    const scanner = createScanner({
      db: this.db,
      config: this.config,
    });

    // I keep board regeneration attached to scanner-driven DB changes only.
    scanner.onScanEvent((event) => {
      if (event.type === 'db-updated' || event.type === 'file-change') {
        this.boardGenerator.scheduleRegenerate();
      }
    });

    try {
      await scanner.start();

      const initialBoard = await this.boardGenerator.regenerate();
      if (!initialBoard.success) {
        throw initialBoard.error ?? new Error('Failed to generate BOARD.md');
      }

      this.scanner = scanner;
      this.lastStartedAt = Date.now();
      logger.info(`Embedded scanner started for ${this.config.projects.length} project(s).`);
      return this.getStatus();
    } catch (error) {
      await scanner.stop().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Restarts the embedded scanner so it picks up current config.
   * @returns Updated scanner status
   */
  async restart(): Promise<ScannerRuntimeStatus> {
    await this.stop();
    return this.start();
  }

  /**
   * Stops the embedded scanner if it is running.
   * @returns Updated scanner status
   */
  async stop(): Promise<ScannerRuntimeStatus> {
    if (!this.scanner) {
      return this.getStatus();
    }

    await this.scanner.stop();
    this.scanner = null;
    logger.info('Embedded scanner stopped.');
    return this.getStatus();
  }

  /**
   * Disposes the controller during API shutdown.
   */
  async dispose(): Promise<void> {
    await this.stop();
  }
}
