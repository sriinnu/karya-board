/**
 * MCP Tool: update_issue
 * Updates an existing issue in the Karya task board.
 * Uses serialized execution to prevent race conditions.
 * @packageDocumentation
 */

import type { Database } from '@karya/core';
import type { IssueStatus, IssuePriority } from '@karya/core';

/**
 * Parameters for updating an issue.
 * @public
 */
export interface UpdateIssueParams {
  /** Issue ID to update */
  issueId: string;
  /** New title (optional) */
  title?: string;
  /** New description (optional) */
  description?: string;
  /** New status (optional) */
  status?: IssueStatus;
  /** New priority (optional) */
  priority?: IssuePriority;
}

/**
 * Updated issue representation.
 * @public
 */
export interface UpdatedIssue {
  /** Issue ID */
  id: string;
  /** Updated title */
  title: string;
  /** Updated description */
  description: string | null;
  /** Updated status */
  status: IssueStatus;
  /** Updated priority */
  priority: IssuePriority;
  /** Update timestamp */
  updatedAt: string;
}

/**
 * Result of updating an issue.
 * @public
 */
export interface UpdateIssueResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Updated issue data */
  issue?: UpdatedIssue;
  /** Error message if failed */
  error?: string;
}

/**
 * Creates the update_issue MCP tool handler.
 * Serializes all writes through the database queue to prevent conflicts.
 *
 * @param db - Database instance
 * @returns Tool handler function
 * @example
 * ```typescript
 * const updateIssueTool = createUpdateIssueTool(db);
 * const result = await updateIssueTool({
 *   issueId: 'abc123',
 *   status: 'done',
 * });
 * ```
 * @public
 */
export function createUpdateIssueTool(db: Database) {
  /**
   * Handler for update_issue tool.
   * All operations are serialized through the database write queue.
   */
  return async function updateIssue(
    params: UpdateIssueParams
  ): Promise<UpdateIssueResult> {
    // Validate required parameters
    if (!params.issueId) {
      return { success: false, error: 'Issue ID is required' };
    }

    // Check that at least one update field is provided
    if (
      params.title === undefined &&
      params.description === undefined &&
      params.status === undefined &&
      params.priority === undefined
    ) {
      return {
        success: false,
        error: 'At least one of title, description, status, or priority is required',
      };
    }

    try {
      // Check if issue exists
      const existing = db.getIssueById(params.issueId);
      if (!existing) {
        return {
          success: false,
          error: `Issue not found: ${params.issueId}`,
        };
      }

      // Build update object with only provided fields
      const updates: Parameters<typeof db.updateIssue>[1] = {};

      if (params.title !== undefined) {
        updates.title = params.title;
      }

      if (params.description !== undefined) {
        updates.description = params.description;
      }

      if (params.status !== undefined) {
        updates.status = params.status;
      }

      if (params.priority !== undefined) {
        updates.priority = params.priority;
      }

      const result = await db.write(async () =>
        db.updateIssue(params.issueId, updates)
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        issue: {
          id: result.data.id,
          title: result.data.title,
          description: result.data.description,
          status: result.data.status,
          priority: result.data.priority,
          updatedAt: new Date(result.data.updatedAt).toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
