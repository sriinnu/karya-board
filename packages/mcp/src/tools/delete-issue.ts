/**
 * MCP Tool: delete_issue
 * Deletes an existing issue from the Karya task board.
 * @packageDocumentation
 */

import type { Database } from '@karya/core';

/**
 * Parameters for deleting an issue.
 * @public
 */
export interface DeleteIssueParams {
  /** Issue ID to delete */
  issueId: string;
}

/**
 * Result of deleting an issue.
 * @public
 */
export interface DeleteIssueResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Deleted issue ID */
  issueId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Creates the delete_issue MCP tool handler.
 *
 * @param db - Database instance
 * @returns Tool handler function
 * @example
 * ```typescript
 * const deleteIssueTool = createDeleteIssueTool(db);
 * const result = await deleteIssueTool({ issueId: 'abc123' });
 * ```
 * @public
 */
export function createDeleteIssueTool(db: Database) {
  /**
   * Handler for delete_issue tool.
   */
  return async function deleteIssue(
    params: DeleteIssueParams
  ): Promise<DeleteIssueResult> {
    if (!params.issueId) {
      return { success: false, error: 'Issue ID is required' };
    }

    try {
      const existing = db.getIssueById(params.issueId);
      if (!existing) {
        return {
          success: false,
          error: `Issue not found: ${params.issueId}`,
        };
      }

      const result = await db.write(async () => db.deleteIssue(params.issueId));
      if (!result.success) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        issueId: params.issueId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
