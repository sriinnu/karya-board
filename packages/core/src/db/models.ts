/**
 * TypeScript type definitions for the Karya database models.
 * These types are used throughout the application to ensure type safety.
 */

/**
 * Issue status representing the current state of a task.
 * @public
 */
export type IssueStatus = 'open' | 'in_progress' | 'done';

/**
 * Priority level for issues, determining their display order and urgency.
 * @public
 */
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Source of the issue, indicating how it was created.
 * @public
 */
export type IssueSource = 'manual' | 'scanner' | 'claude';

/**
 * Project configuration representing a monitored codebase.
 * @public
 */
export interface Project {
  /** Unique identifier for the project */
  id: string;
  /** Display name of the project */
  name: string;
  /** Absolute or relative path to the project directory */
  path: string;
  /** Timestamp when the project was created (Unix epoch in milliseconds) */
  createdAt: number;
}

/**
 * Issue/task extracted from codebase or created manually.
 * @public
 */
export interface Issue {
  /** Unique identifier for the issue */
  id: string;
  /** Foreign key to the parent project */
  projectId: string;
  /** Title/summary of the issue */
  title: string;
  /** Detailed description of the issue */
  description: string | null;
  /** Current status of the issue */
  status: IssueStatus;
  /** Priority level affecting display order */
  priority: IssuePriority;
  /** How the issue was created */
  source: IssueSource;
  /** Source file path if extracted from code */
  sourceFile: string | null;
  /** Timestamp when the issue was created (Unix epoch in milliseconds) */
  createdAt: number;
  /** Timestamp when the issue was last updated (Unix epoch in milliseconds) */
  updatedAt: number;
}

/**
 * Artifact representing a scanned file with its content.
 * @public
 */
export interface Artifact {
  /** Unique identifier for the artifact */
  id: string;
  /** Foreign key to the parent project */
  projectId: string;
  /** Absolute path to the scanned file */
  filePath: string;
  /** Content of the file at last scan */
  content: string | null;
  /** Timestamp when the file was last scanned (Unix epoch in milliseconds) */
  lastScanned: number;
}

/**
 * Database row types for raw SQLite results.
 * @internal
 */
export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
}

/**
 * Database row type for issues.
 * @internal
 */
export interface IssueRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  source: IssueSource;
  source_file: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Database row type for artifacts.
 * @internal
 */
export interface ArtifactRow {
  id: string;
  project_id: string;
  file_path: string;
  content: string | null;
  last_scanned: number;
}

/**
 * Configuration for scanner behavior.
 * @public
 */
export interface ScannerConfig {
  /** Milliseconds to wait after a file change before re-processing */
  debounceMs: number;
  /** Maximum file size in megabytes to process */
  fileSizeLimitMb: number;
}

/**
 * Configuration for database behavior.
 * @public
 */
export interface DatabaseConfig {
  /** Path to the SQLite database file */
  path: string;
}

/**
 * Complete Karya configuration loaded from karya.config.json.
 * @public
 */
export interface KaryaConfig {
  /** List of projects to monitor */
  projects: ProjectConfig[];
  /** Path where BOARD.md will be generated */
  boardOutput: string;
  /** Maximum directory depth for scanning */
  scanDepth: number;
  /** Scanner configuration options */
  scanner: ScannerConfig;
  /** Database configuration options */
  database: DatabaseConfig;
}

/**
 * Project-specific configuration from the config file.
 * @public
 */
export interface ProjectConfig {
  /** Display name for the project */
  name: string;
  /** Absolute or relative path to the project directory */
  path: string;
  /** File patterns to include when scanning */
  include?: string[];
  /** File patterns to exclude when scanning */
  exclude?: string[];
}

/**
 * Statistics for a project's issues.
 * @public
 */
export interface ProjectStats {
  /** Total number of issues */
  total: number;
  /** Number of open issues */
  open: number;
  /** Number of in-progress issues */
  inProgress: number;
  /** Number of completed issues */
  done: number;
  /** Number of critical priority issues */
  critical: number;
  /** Number of high priority issues */
  high: number;
  /** Number of medium priority issues */
  medium: number;
  /** Number of low priority issues */
  low: number;
}
