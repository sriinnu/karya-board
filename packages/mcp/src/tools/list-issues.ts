/**
 * MCP Tool: list_issues
 * Lists issues from the Karya task board with SQL-backed filtering and pagination.
 * @packageDocumentation
 */

import type { Database } from '@karya/core';
import type { IssuePriority, IssueStatus } from '@karya/core';

/**
 * Maximum limit allowed for list queries.
 * @internal
 */
const MAX_LIST_LIMIT = 200;

/**
 * Parameters for listing issues.
 * @public
 */
export interface ListIssuesParams {
  /** Project name to filter by (optional) */
  project?: string;
  /** Project ID to filter by (optional) */
  projectId?: string;
  /** Filter by status (optional) */
  status?: IssueStatus;
  /** Filter by priority (optional) */
  priority?: IssuePriority;
  /** Free-text search against title, description, and source file (optional) */
  search?: string;
  /** Maximum number of issues to return (optional, default: 50, max: 200) */
  limit?: number;
  /** Number of matching rows to skip (optional, default: 0) */
  offset?: number;
}

/**
 * Issue representation for MCP responses.
 * @public
 */
export interface IssueListItem {
  /** Unique issue identifier */
  id: string;
  /** Unique project identifier */
  projectId: string;
  /** Project name */
  projectName: string;
  /** Issue title */
  title: string;
  /** Issue description */
  description: string | null;
  /** Current status */
  status: IssueStatus;
  /** Priority level */
  priority: IssuePriority;
  /** Source of the issue */
  source: string;
  /** Source file if applicable */
  sourceFile: string | null;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Result of listing issues.
 * @public
 */
export interface ListIssuesResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Array of issues */
  issues?: IssueListItem[];
  /** Total count matching the filter, independent of limit/offset */
  totalCount?: number;
  /** Applied page limit */
  limit?: number;
  /** Applied page offset */
  offset?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Raw row returned by issue list queries.
 * @internal
 */
interface IssueListRow {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  source: string;
  source_file: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Creates the list_issues MCP tool handler.
 *
 * @param db - Database instance
 * @returns Tool handler function
 * @example
 * ```typescript
 * const listIssuesTool = createListIssuesTool(db);
 * const result = await listIssuesTool({ project: 'my-project', limit: 20 });
 * ```
 * @public
 */
export function createListIssuesTool(db: Database) {
  /**
   * Handler for list_issues tool.
   * I run a direct SQL query so large boards don't load every row into memory.
   */
  return async function listIssues(
    params: ListIssuesParams = {}
  ): Promise<ListIssuesResult> {
    try {
      const limit = normalizeLimit(params.limit);
      const offset = normalizeOffset(params.offset);

      if (params.project) {
        const projectExists = db.db
          .prepare('SELECT 1 FROM projects WHERE lower(name) = lower(?) LIMIT 1')
          .get(params.project) as { 1: number } | undefined;
        if (!projectExists) {
          return {
            success: false,
            error: `Project not found: ${params.project}`,
          };
        }
      }

      if (params.projectId) {
        const projectExists = db.db
          .prepare('SELECT 1 FROM projects WHERE id = ? LIMIT 1')
          .get(params.projectId) as { 1: number } | undefined;
        if (!projectExists) {
          return {
            success: false,
            error: `Project not found: ${params.projectId}`,
          };
        }
      }

      const whereClauses: string[] = [];
      const whereArgs: unknown[] = [];

      if (params.project) {
        whereClauses.push('lower(p.name) = lower(?)');
        whereArgs.push(params.project);
      }

      if (params.projectId) {
        whereClauses.push('i.project_id = ?');
        whereArgs.push(params.projectId);
      }

      if (params.status) {
        whereClauses.push('i.status = ?');
        whereArgs.push(params.status);
      }

      if (params.priority) {
        whereClauses.push('i.priority = ?');
        whereArgs.push(params.priority);
      }

      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${params.search.trim()}%`;
        whereClauses.push(
          '(i.title LIKE ? OR COALESCE(i.description, \'\') LIKE ? OR COALESCE(i.source_file, \'\') LIKE ?)'
        );
        whereArgs.push(pattern, pattern, pattern);
      }

      const whereSql =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRow = db.db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM issues i
          INNER JOIN projects p ON p.id = i.project_id
          ${whereSql}
          `
        )
        .get(...whereArgs) as { count: number };

      const rows = db.db
        .prepare(
          `
          SELECT
            i.id,
            i.project_id,
            p.name AS project_name,
            i.title,
            i.description,
            i.status,
            i.priority,
            i.source,
            i.source_file,
            i.created_at,
            i.updated_at
          FROM issues i
          INNER JOIN projects p ON p.id = i.project_id
          ${whereSql}
          ORDER BY
            CASE i.priority
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END,
            i.created_at DESC
          LIMIT ? OFFSET ?
          `
        )
        .all(...whereArgs, limit, offset) as IssueListRow[];

      return {
        success: true,
        issues: rows.map((row) => ({
          id: row.id,
          projectId: row.project_id,
          projectName: row.project_name,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          source: row.source,
          sourceFile: row.source_file,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        })),
        totalCount: countRow.count,
        limit,
        offset,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Normalizes user-provided list limits.
 * @param value - Requested limit
 * @returns Sanitized limit within supported range
 * @internal
 */
function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return 50;
  }

  return Math.min(rounded, MAX_LIST_LIMIT);
}

/**
 * Normalizes user-provided list offsets.
 * @param value - Requested offset
 * @returns Sanitized non-negative integer offset
 * @internal
 */
function normalizeOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  const rounded = Math.floor(value);
  return rounded < 0 ? 0 : rounded;
}
