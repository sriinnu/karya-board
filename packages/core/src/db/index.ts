/**
 * Database module for Karya - SQLite connection, migrations, and query helpers.
 * Provides thread-safe database operations with proper locking for concurrent access.
 * @packageDocumentation
 */

import BetterSqlite3 from 'better-sqlite3';
import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../logger.js';
import {
  type Issue,
  type IssueRow,
  type Project,
  type ProjectRow,
  type Artifact,
  type ArtifactRow,
  type IssueStatus,
  type IssuePriority,
  type IssueSource,
  type ProjectStats,
  type KaryaConfig,
} from './models.js';
import {
  createWriteQueue,
  type Result,
} from './lock.js';

/**
 * SQL statements for database initialization and migrations.
 * @internal
 */
const SCHEMA_SQL = `
  -- Projects table: stores monitored projects
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Issues table: stores tasks extracted from code or created manually
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open' NOT NULL,
    priority TEXT DEFAULT 'medium' NOT NULL,
    source TEXT DEFAULT 'manual' NOT NULL,
    source_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  -- Artifacts table: stores scanned file content for caching
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT,
    last_scanned INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
  CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_file_path ON artifacts(file_path);
`;

/**
 * Scoped logger for database runtime messages.
 * @internal
 */
const logger = createLogger('db');

/**
 * Generates a unique ID using timestamp and random string.
 * @returns A unique string identifier
 * @internal
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Query options for filtering issue lists.
 * @public
 */
export interface IssueQueryOptions {
  /** Restrict results to a single project ID */
  projectId?: string;
  /** Restrict results by status */
  status?: IssueStatus;
  /** Restrict results by priority */
  priority?: IssuePriority;
  /** Restrict results to a source */
  source?: IssueSource;
  /** Maximum row count to return */
  limit?: number;
  /** Rows to skip before returning results */
  offset?: number;
}

/**
 * Database connection manager with write queue for serialized operations.
 * Handles SQLite connection lifecycle, migrations, and provides type-safe queries.
 * @public
 */
export class Database {
  /** The underlying better-sqlite3 database connection */
  public readonly db: BetterSqlite3.Database;

  /** Serialized write queue to prevent SQLite lock conflicts */
  public readonly write: <T>(operation: () => Promise<T>) => Promise<T>;

  /** Path to the database file */
  public readonly dbPath: string;

  /**
   * Creates a new Database instance with the specified file path.
   * Initializes SQLite with WAL mode for better concurrent read performance.
   *
   * @param dbPath - Path to the SQLite database file
   * @throws Error if database cannot be opened or initialized
   * @example
   * ```typescript
   * const db = new Database('./karya.db');
   * await db.initialize();
   * ```
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database with appropriate settings
    this.db = new BetterSqlite3(dbPath, {
      verbose: process.env.DEBUG_SQL
        ? (message?: unknown) => {
            logger.debug(message);
          }
        : undefined,
    });

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    // Set busy timeout to 5 seconds
    this.db.pragma('busy_timeout = 5000');
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create serialized write queue with concurrency of 1
    const queue = new PQueue({ concurrency: 1 });
    this.write = createWriteQueue(queue);
  }

  /**
   * Initializes the database schema.
   * Runs migrations and creates tables if they don't exist.
   *
   * @returns Result indicating success or failure
   */
  public initialize(): Result<void> {
    try {
      this.db.exec(SCHEMA_SQL);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Checks database integrity and returns health status.
   *
   * @returns Result containing integrity check result
   */
  public async checkIntegrity(): Promise<Result<{ ok: boolean; errors: string[] }>> {
    try {
      const result = await this.write(async () => {
        return this.db
          .prepare('PRAGMA integrity_check')
          .all() as Array<{ integrity_check: string }>;
      });
      const ok = result.every((row) => row.integrity_check === 'ok');
      const errors = ok ? [] : result.map((row) => row.integrity_check);
      return { success: true, data: { ok, errors } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // ==================== Project Operations ====================

  /**
   * Creates a new project in the database.
   *
   * @param name - Display name of the project
   * @param path - File system path to the project
   * @returns Result containing the created project or error
   */
  public createProject(
    name: string,
    projectPath: string
  ): Result<Project> {
    try {
      const id = generateId();
      const createdAt = Date.now();

      this.db
        .prepare(
          'INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(id, name, projectPath, createdAt);

      return {
        success: true,
        data: { id, name, path: projectPath, createdAt },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Retrieves all projects from the database.
   *
   * @returns Array of projects
   */
  public getAllProjects(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY name')
      .all() as ProjectRow[];
    return rows.map(this.rowToProject);
  }

  /**
   * Retrieves a project by its ID.
   *
   * @param id - Project ID
   * @returns The project or null if not found
   */
  public getProjectById(id: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  /**
   * Retrieves a project by its path.
   *
   * @param projectPath - File system path
   * @returns The project or null if not found
   */
  public getProjectByPath(projectPath: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE path = ?')
      .get(projectPath) as ProjectRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  /**
   * Deletes a project and all its associated data.
   *
   * @param id - Project ID to delete
   * @returns Result indicating success or failure
   */
  public deleteProject(id: string): Result<void> {
    try {
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // ==================== Issue Operations ====================

  /**
   * Creates a new issue in the database.
   *
   * @param issue - Issue data to create
   * @returns Result containing the created issue or error
   */
  public createIssue(issue: {
    projectId: string;
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    source?: IssueSource;
    sourceFile?: string;
  }): Result<Issue> {
    try {
      const id = generateId();
      const now = Date.now();

      this.db
        .prepare(
          `INSERT INTO issues
           (id, project_id, title, description, status, priority, source, source_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          issue.projectId,
          issue.title,
          issue.description ?? null,
          issue.status ?? 'open',
          issue.priority ?? 'medium',
          issue.source ?? 'manual',
          issue.sourceFile ?? null,
          now,
          now
        );

      return {
        success: true,
        data: {
          id,
          projectId: issue.projectId,
          title: issue.title,
          description: issue.description ?? null,
          status: issue.status ?? 'open',
          priority: issue.priority ?? 'medium',
          source: issue.source ?? 'manual',
          sourceFile: issue.sourceFile ?? null,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Updates an existing issue.
   *
   * @param id - Issue ID to update
   * @param updates - Fields to update
   * @returns Result containing the updated issue or error
   */
  public updateIssue(
    id: string,
    updates: Partial<Pick<Issue, 'title' | 'description' | 'status' | 'priority'>>
  ): Result<Issue> {
    try {
      const now = Date.now();
      const fields: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (updates.title !== undefined) {
        fields.push('title = ?');
        values.push(updates.title);
      }
      if (updates.description !== undefined) {
        fields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.priority !== undefined) {
        fields.push('priority = ?');
        values.push(updates.priority);
      }

      values.push(id);

      this.db
        .prepare(`UPDATE issues SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values);

      const updated = this.getIssueById(id);
      if (!updated) {
        return { success: false, error: new Error('Issue not found after update') };
      }

      return { success: true, data: updated };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Retrieves all issues for a project.
   *
   * @param projectId - Project ID
   * @returns Array of issues for the project
   */
  public getIssuesByProject(projectId: string): Issue[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM issues
         WHERE project_id = ?
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
           END,
           created_at DESC`
      )
      .all(projectId) as IssueRow[];
    return rows.map(this.rowToIssue);
  }

  /**
   * Retrieves an issue by its ID.
   *
   * @param id - Issue ID
   * @returns The issue or null if not found
   */
  public getIssueById(id: string): Issue | null {
    const row = this.db
      .prepare('SELECT * FROM issues WHERE id = ?')
      .get(id) as IssueRow | undefined;
    return row ? this.rowToIssue(row) : null;
  }

  /**
   * Deletes an issue by its ID.
   *
   * @param id - Issue ID to delete
   * @returns Result indicating success or failure
   */
  public deleteIssue(id: string): Result<void> {
    try {
      this.db.prepare('DELETE FROM issues WHERE id = ?').run(id);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Deletes scanner-generated issues for a specific source file.
   *
   * @param projectId - Project ID owning the issues
   * @param sourceFile - Absolute path to the scanned file
   * @returns Result containing the number of deleted issues
   */
  public deleteScannerIssuesBySourceFile(
    projectId: string,
    sourceFile: string
  ): Result<number> {
    try {
      const outcome = this.db
        .prepare(
          `DELETE FROM issues
           WHERE project_id = ?
             AND source = 'scanner'
             AND source_file = ?`
        )
        .run(projectId, sourceFile);

      return { success: true, data: outcome.changes };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Gets statistics for a project's issues.
   *
   * @param projectId - Project ID
   * @returns Statistics object with counts by status and priority
   */
  public getProjectStats(projectId: string): ProjectStats {
    const rows = this.db
      .prepare(
        `SELECT status, priority, COUNT(*) as count
         FROM issues
         WHERE project_id = ?
         GROUP BY status, priority`
      )
      .all(projectId) as Array<{
      status: IssueStatus;
      priority: IssuePriority;
      count: number;
    }>;

    const stats: ProjectStats = {
      total: 0,
      open: 0,
      inProgress: 0,
      done: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const row of rows) {
      stats.total += row.count;
      if (row.status === 'open') stats.open += row.count;
      else if (row.status === 'in_progress') stats.inProgress += row.count;
      else if (row.status === 'done') stats.done += row.count;

      if (row.priority === 'critical') stats.critical += row.count;
      else if (row.priority === 'high') stats.high += row.count;
      else if (row.priority === 'medium') stats.medium += row.count;
      else if (row.priority === 'low') stats.low += row.count;
    }

    return stats;
  }

  // ==================== Artifact Operations ====================

  /**
   * Creates or updates an artifact (scanned file).
   *
   * @param artifact - Artifact data
   * @returns Result containing the artifact or error
   */
  public upsertArtifact(artifact: {
    projectId: string;
    filePath: string;
    content: string;
  }): Result<Artifact> {
    try {
      const now = Date.now();
      const existing = this.db
        .prepare('SELECT id FROM artifacts WHERE project_id = ? AND file_path = ?')
        .get(artifact.projectId, artifact.filePath) as { id: string } | undefined;

      if (existing) {
        this.db
          .prepare('UPDATE artifacts SET content = ?, last_scanned = ? WHERE id = ?')
          .run(artifact.content, now, existing.id);

        return {
          success: true,
          data: {
            id: existing.id,
            projectId: artifact.projectId,
            filePath: artifact.filePath,
            content: artifact.content,
            lastScanned: now,
          },
        };
      }

      const id = generateId();
      this.db
        .prepare(
          'INSERT INTO artifacts (id, project_id, file_path, content, last_scanned) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, artifact.projectId, artifact.filePath, artifact.content, now);

      return {
        success: true,
        data: {
          id,
          projectId: artifact.projectId,
          filePath: artifact.filePath,
          content: artifact.content,
          lastScanned: now,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Retrieves artifacts for a project.
   *
   * @param projectId - Project ID
   * @returns Array of artifacts
   */
  public getArtifactsByProject(projectId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY file_path')
      .all(projectId) as ArtifactRow[];
    return rows.map(this.rowToArtifact);
  }

  /**
   * Deletes an artifact by file path.
   *
   * @param projectId - Project ID
   * @param filePath - File path to delete
   * @returns Result indicating success or failure
   */
  public deleteArtifact(projectId: string, filePath: string): Result<void> {
    try {
      this.db
        .prepare('DELETE FROM artifacts WHERE project_id = ? AND file_path = ?')
        .run(projectId, filePath);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Converts a database row to a Project object.
   * @internal
   */
  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
    };
  }

  /**
   * Converts a database row to an Issue object.
   * @internal
   */
  private rowToIssue(row: IssueRow): Issue {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      source: row.source,
      sourceFile: row.source_file,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Converts a database row to an Artifact object.
   * @internal
   */
  private rowToArtifact(row: ArtifactRow): Artifact {
    return {
      id: row.id,
      projectId: row.project_id,
      filePath: row.file_path,
      content: row.content,
      lastScanned: row.last_scanned,
    };
  }

  /**
   * Closes the database connection.
   * Should be called when shutting down the application.
   */
  public close(): void {
    this.db.close();
  }
}

/**
 * Creates a new database instance and initializes it.
 *
 * @param configPath - Path to the configuration file
 * @returns Initialized database instance
 * @example
 * ```typescript
 * const db = await createDatabase('./karya.config.json');
 * ```
 */
export async function createDatabase(config: KaryaConfig): Promise<Database> {
  const db = new Database(config.database.path);
  const initResult = db.initialize();

  if (!initResult.success) {
    throw new Error(`Failed to initialize database: ${initResult.error.message}`);
  }

  return db;
}

export type { Database as DatabaseInstance };
export type { Result } from './lock.js';
