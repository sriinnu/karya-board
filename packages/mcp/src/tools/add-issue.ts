/**
 * MCP Tool: add_issue
 * Creates a new issue in the Karya task board.
 * Uses serialized execution to prevent race conditions.
 * @packageDocumentation
 */

import type { Database } from '@karya/core';
import type { IssueStatus, IssuePriority, IssueSource } from '@karya/core';

/**
 * Parameters for adding a new issue.
 * @public
 */
export interface AddIssueParams {
  /** Project ID (preferred for programmatic callers) */
  projectId?: string;
  /** Project name (matches config) */
  project?: string;
  /** Issue title/summary */
  title: string;
  /** Detailed description (optional) */
  description?: string;
  /** Priority level (optional, defaults to medium) */
  priority?: IssuePriority;
  /** Initial status (optional, defaults to open) */
  status?: IssueStatus;
  /** Source type (optional, defaults to claude for MCP calls) */
  source?: IssueSource;
  /** Source file if extracted from code (optional) */
  sourceFile?: string;
}

/**
 * Result of adding an issue.
 * @public
 */
export interface AddIssueResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Created issue ID */
  issueId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Creates the add_issue MCP tool handler.
 * Serializes all writes through the database queue to prevent conflicts.
 *
 * @param db - Database instance
 * @returns Tool handler function
 * @example
 * ```typescript
 * const addIssueTool = createAddIssueTool(db);
 * const result = await addIssueTool({
 *   project: 'my-project',
 *   title: 'Fix memory leak',
 *   priority: 'high',
 * });
 * ```
 * @public
 */
export function createAddIssueTool(db: Database) {
  /**
   * Handler for add_issue tool.
   * All operations are serialized through the database write queue.
   */
  return async function addIssue(
    params: AddIssueParams
  ): Promise<AddIssueResult> {
    // Validate required parameters
    if (!params.projectId && !params.project) {
      return { success: false, error: 'Project ID or project name is required' };
    }

    if (!params.title) {
      return { success: false, error: 'Issue title is required' };
    }

    try {
      const projectName = params.project?.trim();

      const projects = db.getAllProjects();
      const project = params.projectId
        ? db.getProjectById(params.projectId)
        : projectName
          ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase())
          : null;

      if (!project) {
        return {
          success: false,
          error: `Project not found: ${params.projectId ?? projectName}. Available projects: ${projects.map((p) => p.name).join(', ') || 'none'}`,
        };
      }

      // Create the issue through the serialized write queue
      const result = await db.write(async () => {
        return db.createIssue({
          projectId: project.id,
          title: params.title.trim(),
          description: params.description?.trim() || undefined,
          priority: params.priority ?? 'medium',
          status: params.status ?? 'open',
          source: params.source ?? 'claude',
          sourceFile: params.sourceFile,
        });
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        issueId: result.data.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
