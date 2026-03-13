/**
 * Karya Core - Main entry point for the task board system.
 * Provides DB, scanner, and board generation functionality.
 * @packageDocumentation
 */

// Re-export database types and classes
export {
  Database,
  createDatabase,
  type Result,
} from './db/index.js';
export type {
  Issue,
  Project,
  Artifact,
  IssueStatus,
  IssuePriority,
  IssueSource,
  ProjectStats,
  KaryaConfig,
  ProjectConfig,
} from './db/models.js';

// Re-export scanner
export {
  Scanner,
  createScanner,
  FileWatcher,
  type FileEvent,
  type FileEventType,
  type ScanEvent,
  type ScanEventCallback,
  parseFile,
  shouldScanFile,
  ScanDeduplicator,
} from './scanner/index.js';

// Re-export board generator
export {
  BoardGenerator,
  createBoardGenerator,
  type BoardGenOptions,
  type BoardGenResult,
} from './board-gen/index.js';

// Re-export logging helpers
export {
  createLogger,
  type Logger,
  type LogLevel,
} from './logger.js';
