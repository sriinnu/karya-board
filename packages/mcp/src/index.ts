/**
 * MCP Server for Karya.
 * Exposes add_issue, list_issues, update_issue, and delete_issue tools.
 * @packageDocumentation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { BoardGenerator, Database, KaryaConfig } from '@karya/core';
import { createBoardGenerator, createDatabase, createLogger } from '@karya/core';
import { isMainModule, loadKaryaConfig } from './config.js';
import { createAddIssueTool, type AddIssueParams } from './tools/add-issue.js';
import {
  createListIssuesTool,
  type ListIssuesParams,
} from './tools/list-issues.js';
import {
  createUpdateIssueTool,
  type UpdateIssueParams,
} from './tools/update-issue.js';
import {
  createDeleteIssueTool,
  type DeleteIssueParams,
} from './tools/delete-issue.js';

/**
 * MCP Server configuration options.
 * @public
 */
export interface MCPServerOptions {
  /** Path to the karya.config.json file */
  configPath?: string;
}

/**
 * Mutation payload that may also include a non-fatal BOARD.md warning.
 * @internal
 */
interface ToolMutationPayload {
  /** Whether the tool mutation succeeded */
  success: boolean;
  /** Non-fatal warning emitted after mutation success */
  warning?: string;
}

/**
 * Scoped MCP runtime logger.
 * @internal
 */
const logger = createLogger('mcp');

/**
 * Karya MCP server exposing task management tools.
 * @public
 */
export class MCPServer {
  /** The MCP server instance */
  private server: Server;

  /** Database instance */
  private db: Database | null = null;

  /** BOARD.md generator */
  private boardGenerator: BoardGenerator | null = null;

  /** Tool handlers */
  private addIssue: ReturnType<typeof createAddIssueTool> | null = null;
  private listIssues: ReturnType<typeof createListIssuesTool> | null = null;
  private updateIssue: ReturnType<typeof createUpdateIssueTool> | null = null;
  private deleteIssue: ReturnType<typeof createDeleteIssueTool> | null = null;

  /**
   * Creates a new MCPServer instance.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'karya',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Sets up MCP request handlers.
   * @internal
   */
  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add_issue',
          description:
            'Add a new issue/task to the Karya task board. Use this when you find something that needs to be done.',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: {
                type: 'string',
                description:
                  'Project ID (preferred for programmatic clients like the web UI)',
              },
              project: {
                type: 'string',
                description:
                  'Project name (must match a configured project in karya.config.json)',
              },
              title: {
                type: 'string',
                description: 'Issue title/summary',
              },
              description: {
                type: 'string',
                description: 'Detailed description (optional)',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Priority level (optional, defaults to medium)',
              },
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'done'],
                description: 'Initial status (optional, defaults to open)',
              },
              sourceFile: {
                type: 'string',
                description: 'Source file path if extracted from code (optional)',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'list_issues',
          description:
            'List issues from the Karya task board. Use this to see what tasks exist.',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Project name to filter by (optional)',
              },
              projectId: {
                type: 'string',
                description: 'Project ID to filter by (optional)',
              },
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'done'],
                description: 'Filter by status (optional)',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Filter by priority (optional)',
              },
              search: {
                type: 'string',
                description:
                  'Free-text search against issue title, description, and source file (optional)',
              },
              limit: {
                type: 'number',
                description:
                  'Maximum number of issues to return (optional, defaults to 50, max 200)',
              },
              offset: {
                type: 'number',
                description:
                  'Number of matching issues to skip for pagination (optional, defaults to 0)',
              },
            },
          },
        },
        {
          name: 'update_issue',
          description:
            'Update an existing issue in the Karya task board. Use this to change status, priority, or details.',
          inputSchema: {
            type: 'object',
            properties: {
              issueId: {
                type: 'string',
                description: 'Issue ID to update',
              },
              title: {
                type: 'string',
                description: 'New title (optional)',
              },
              description: {
                type: 'string',
                description: 'New description (optional)',
              },
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'done'],
                description: 'New status (optional)',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'New priority (optional)',
              },
            },
            required: ['issueId'],
          },
        },
        {
          name: 'delete_issue',
          description:
            'Delete an existing issue from the Karya task board by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              issueId: {
                type: 'string',
                description: 'Issue ID to delete',
              },
            },
            required: ['issueId'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'add_issue': {
            const result = await this.mustGet(this.addIssue)(
              args as unknown as AddIssueParams
            );
            return this.respond(await this.attachBoardSyncWarning(result));
          }
          case 'list_issues':
            return this.respond(
              await this.mustGet(this.listIssues)(args as ListIssuesParams)
            );
          case 'update_issue': {
            const result = await this.mustGet(this.updateIssue)(
              args as unknown as UpdateIssueParams
            );
            return this.respond(await this.attachBoardSyncWarning(result));
          }
          case 'delete_issue': {
            const result = await this.mustGet(this.deleteIssue)(
              args as unknown as DeleteIssueParams
            );
            return this.respond(await this.attachBoardSyncWarning(result));
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    });
  }

  /**
   * Initializes the server with a database connection.
   *
   * @param config - Karya configuration
   */
  async initialize(config: KaryaConfig): Promise<void> {
    this.db = await createDatabase(config);
    this.boardGenerator = createBoardGenerator({ db: this.db, config });
    this.addIssue = createAddIssueTool(this.db);
    this.listIssues = createListIssuesTool(this.db);
    this.updateIssue = createUpdateIssueTool(this.db);
    this.deleteIssue = createDeleteIssueTool(this.db);
  }

  /**
   * Starts the MCP server using stdio transport.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Karya MCP server started');
  }

  /**
   * Stops the MCP server and closes database resources.
   */
  async stop(): Promise<void> {
    if (this.boardGenerator) {
      await this.boardGenerator.dispose();
      this.boardGenerator = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Formats a tool result as MCP text content.
   * @param payload - Serializable result object
   * @returns MCP text response
   * @internal
   */
  private respond(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    };
  }

  /**
   * Ensures a tool handler exists before invocation.
   * @param handler - Tool handler that may be null before initialize()
   * @returns Handler when initialized
   * @throws Error when server is not initialized
   * @internal
   */
  private mustGet<T>(handler: T | null): T {
    if (!handler) {
      throw new Error('Server not initialized');
    }
    return handler;
  }

  /**
   * Regenerates BOARD.md after successful mutations.
   *
   * @param payload - Tool result payload
   * @internal
   */
  private async attachBoardSyncWarning<T extends ToolMutationPayload>(payload: T): Promise<T> {
    if (!payload.success || !this.boardGenerator) {
      return payload;
    }

    const result = await this.boardGenerator.regenerate();
    if (!result.success) {
      const message = result.error?.message ?? 'Failed to regenerate BOARD.md';
      logger.error(`Mutation succeeded but BOARD.md sync failed: ${message}`);
      return {
        ...payload,
        warning: `The mutation succeeded, but I could not update BOARD.md: ${message}`,
      };
    }

    return payload;
  }
}

/**
 * Creates and starts the MCP server with an explicit config.
 *
 * @param config - Karya configuration
 * @returns The running server instance
 * @public
 */
export async function runServer(config: KaryaConfig): Promise<MCPServer> {
  const server = new MCPServer();
  await server.initialize(config);
  await server.start();
  return server;
}

/**
 * Creates and starts the MCP server from a config path.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @returns The running server instance
 * @public
 */
export async function runServerFromConfig(configPath?: string): Promise<MCPServer> {
  const config = loadKaryaConfig(configPath);
  return runServer(config);
}

if (isMainModule(import.meta.url)) {
  runServerFromConfig().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start Karya MCP server: ${message}`);
    process.exitCode = 1;
  });
}
