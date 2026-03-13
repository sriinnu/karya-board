/**
 * Lightweight HTTP API server for the Karya web UI.
 * I keep it dependency-light and reuse the same tool handlers as MCP.
 * @packageDocumentation
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { BoardGenerator, Database, KaryaConfig, ProjectStats } from '@karya/core';
import { createBoardGenerator, createDatabase, createLogger } from '@karya/core';
import { isMainModule, loadKaryaConfig } from './config.js';
import { createAddIssueTool, type AddIssueParams } from './tools/add-issue.js';
import {
  createDeleteIssueTool,
  type DeleteIssueParams,
} from './tools/delete-issue.js';
import {
  createListIssuesTool,
  type ListIssuesParams,
} from './tools/list-issues.js';
import {
  createUpdateIssueTool,
  type UpdateIssueParams,
} from './tools/update-issue.js';

/**
 * Default TCP port for the local HTTP API.
 * @internal
 */
const DEFAULT_API_PORT = 9630;

/**
 * Default host interface for the local HTTP API.
 * @internal
 */
const DEFAULT_API_HOST = '127.0.0.1';

/**
 * Scoped API server logger.
 * @internal
 */
const logger = createLogger('api');

/**
 * Project payload returned to the UI.
 * @public
 */
export interface ApiProject {
  /** Project ID */
  id: string;
  /** Project name */
  name: string;
  /** Filesystem path */
  path: string;
  /** Creation timestamp */
  createdAt: number;
  /** Aggregated board stats */
  stats: ProjectStats;
}

/**
 * Runtime options for the HTTP API server.
 * @public
 */
export interface ApiServerOptions {
  /** Optional override for the HTTP host */
  host?: string;
  /** Optional override for the HTTP port */
  port?: number;
}

/**
 * Mutation-style API payload that may also include a non-fatal board sync warning.
 * @internal
 */
interface ApiMutationPayload {
  /** Whether the underlying mutation succeeded */
  success: boolean;
  /** Error message when the mutation itself failed */
  error?: string;
  /** Non-fatal warning when BOARD.md could not be regenerated */
  warning?: string;
}

/**
 * Local HTTP API for the Karya UI.
 * @public
 */
export class KaryaApiServer {
  /** Backing database instance */
  private db: Database | null = null;

  /** HTTP server instance */
  private server: HttpServer | null = null;

  /** BOARD.md generator */
  private boardGenerator: BoardGenerator | null = null;

  /** Tool-backed request handlers */
  private addIssue: ReturnType<typeof createAddIssueTool> | null = null;
  private listIssues: ReturnType<typeof createListIssuesTool> | null = null;
  private updateIssue: ReturnType<typeof createUpdateIssueTool> | null = null;
  private deleteIssue: ReturnType<typeof createDeleteIssueTool> | null = null;

  /** Resolved host binding */
  private readonly host: string;

  /** Resolved port binding */
  private readonly port: number;

  /**
   * Creates a new API server instance.
   *
   * @param options - Host and port overrides
   */
  constructor(options: ApiServerOptions = {}) {
    this.host = options.host ?? DEFAULT_API_HOST;
    this.port = normalizePort(options.port ?? Number(process.env.KARYA_API_PORT));
  }

  /**
   * Initializes the API server with a Karya config.
   *
   * @param config - Parsed Karya configuration
   */
  async initialize(config: KaryaConfig): Promise<void> {
    this.db = await createDatabase(config);
    this.boardGenerator = createBoardGenerator({ db: this.db, config });
    this.addIssue = createAddIssueTool(this.db);
    this.listIssues = createListIssuesTool(this.db);
    this.updateIssue = createUpdateIssueTool(this.db);
    this.deleteIssue = createDeleteIssueTool(this.db);
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  /**
   * Starts listening for HTTP requests.
   */
  async start(): Promise<void> {
    const server = this.mustGetServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    logger.info(`Karya API server listening on http://${this.host}:${this.port}`);
  }

  /**
   * Stops the HTTP server and releases the database connection.
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.server = null;
    }

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
   * Routes and handles a single HTTP request.
   *
   * @param request - Incoming HTTP request
   * @param response - HTTP response writer
   * @internal
   */
  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    this.writeCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? `${this.host}:${this.port}`}`
    );
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        this.sendJson(response, 200, { success: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/projects') {
        const db = this.mustGetDb();
        const projects = db
          .getAllProjects()
          .map((project): ApiProject => ({
            ...project,
            stats: db.getProjectStats(project.id),
          }));

        this.sendJson(response, 200, { success: true, projects });
        return;
      }

      if (pathname === '/api/issues' && request.method === 'GET') {
        const result = await this.mustGetHandler(this.listIssues)(
          this.parseListIssuesParams(url)
        );
        this.sendJson(response, result.success ? 200 : 400, result);
        return;
      }

      if (pathname === '/api/issues' && request.method === 'POST') {
        const payload = await this.readJsonBody<AddIssueParams>(request);
        const result = await this.mustGetHandler(this.addIssue)(payload);
        const apiPayload = await this.attachBoardSyncWarning(
          result,
          'reflect the change in BOARD.md'
        );
        this.sendJson(response, result.success ? 201 : 400, apiPayload);
        return;
      }

      const issueId = this.getIssueIdFromPath(pathname);
      if (issueId && request.method === 'PATCH') {
        const payload = await this.readJsonBody<Omit<UpdateIssueParams, 'issueId'>>(
          request
        );
        const result = await this.mustGetHandler(this.updateIssue)({
          issueId,
          ...payload,
        });
        const apiPayload = await this.attachBoardSyncWarning(
          result,
          'reflect the change in BOARD.md'
        );
        this.sendJson(response, result.success ? 200 : 400, apiPayload);
        return;
      }

      if (issueId && request.method === 'DELETE') {
        const result = await this.mustGetHandler(this.deleteIssue)({
          issueId,
        } satisfies DeleteIssueParams);
        const apiPayload = await this.attachBoardSyncWarning(
          result,
          'reflect the change in BOARD.md'
        );
        this.sendJson(response, result.success ? 200 : 400, apiPayload);
        return;
      }

      this.sendJson(response, 404, {
        success: false,
        error: `Route not found: ${request.method ?? 'GET'} ${pathname}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, 500, { success: false, error: message });
    }
  }

  /**
   * Parses query parameters for the issue listing route.
   *
   * @param url - Parsed request URL
   * @returns Tool-compatible issue list params
   * @internal
   */
  private parseListIssuesParams(url: URL): ListIssuesParams {
    return {
      project: valueOrUndefined(url.searchParams.get('project')),
      projectId: valueOrUndefined(url.searchParams.get('projectId')),
      status: normalizeEnum(url.searchParams.get('status')),
      priority: normalizeEnum(url.searchParams.get('priority')),
      search: valueOrUndefined(url.searchParams.get('search')),
      limit: parseNumber(url.searchParams.get('limit')),
      offset: parseNumber(url.searchParams.get('offset')),
    };
  }

  /**
   * Reads and parses a JSON request body.
   *
   * @param request - Incoming HTTP request
   * @returns Parsed JSON payload
   * @throws Error when the body is invalid JSON
   * @internal
   */
  private async readJsonBody<T>(request: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return {} as T;
    }

    const raw = Buffer.concat(chunks).toString('utf-8');
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON body: ${message}`);
    }
  }

  /**
   * Writes shared CORS headers for browser clients.
   *
   * @param response - HTTP response writer
   * @internal
   */
  private writeCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PATCH,DELETE,OPTIONS'
    );
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  /**
   * Sends a JSON response with the provided HTTP status.
   *
   * @param response - HTTP response writer
   * @param statusCode - HTTP status code
   * @param payload - JSON payload
   * @internal
   */
  private sendJson(
    response: ServerResponse,
    statusCode: number,
    payload: unknown
  ): void {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }

  /**
   * Extracts an issue ID from `/api/issues/:id` paths.
   *
   * @param pathname - Request path
   * @returns Issue ID when present
   * @internal
   */
  private getIssueIdFromPath(pathname: string): string | null {
    const match = /^\/api\/issues\/([^/]+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Ensures the database is initialized.
   *
   * @returns Active database instance
   * @internal
   */
  private mustGetDb(): Database {
    if (!this.db) {
      throw new Error('API server not initialized');
    }
    return this.db;
  }

  /**
   * Ensures the HTTP server is initialized.
   *
   * @returns Active HTTP server instance
   * @internal
   */
  private mustGetServer(): HttpServer {
    if (!this.server) {
      throw new Error('API server not initialized');
    }
    return this.server;
  }

  /**
   * Ensures a tool-backed handler is available.
   *
   * @param handler - Possibly null handler
   * @returns Initialized handler
   * @internal
   */
  private mustGetHandler<T>(handler: T | null): T {
    if (!handler) {
      throw new Error('API server not initialized');
    }
    return handler;
  }

  /**
   * Attempts to regenerate BOARD.md after successful mutations.
   * I preserve mutation success and surface board sync failures as warnings.
   *
   * @param payload - Mutation result payload
   * @param action - User-facing action description for warning text
   * @returns Payload with an optional warning
   * @internal
   */
  private async attachBoardSyncWarning<T extends ApiMutationPayload>(
    payload: T,
    action: string
  ): Promise<T> {
    if (!payload.success || !this.boardGenerator) {
      return payload;
    }

    const result = await this.boardGenerator.regenerate();
    if (!result.success) {
      const message = result.error?.message ?? 'Failed to regenerate BOARD.md';
      logger.error(`Mutation succeeded but BOARD.md sync failed: ${message}`);
      return {
        ...payload,
        warning: `The mutation succeeded, but I could not ${action}: ${message}`,
      };
    }

    return payload;
  }
}

/**
 * Creates and starts the HTTP API server using an explicit config object.
 *
 * @param config - Parsed Karya configuration
 * @param options - Host and port overrides
 * @returns Running API server instance
 * @public
 */
export async function runApiServer(
  config: KaryaConfig,
  options: ApiServerOptions = {}
): Promise<KaryaApiServer> {
  const server = new KaryaApiServer(options);
  await server.initialize(config);
  await server.start();
  return server;
}

/**
 * Creates and starts the HTTP API server from a config path.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @param options - Host and port overrides
 * @returns Running API server instance
 * @public
 */
export async function runApiServerFromConfig(
  configPath?: string,
  options: ApiServerOptions = {}
): Promise<KaryaApiServer> {
  const config = loadKaryaConfig(configPath);
  return runApiServer(config, options);
}

/**
 * Normalizes optional string values from request inputs.
 *
 * @param value - Raw request value
 * @returns Trimmed string or undefined
 * @internal
 */
function valueOrUndefined(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes optional numeric query parameters.
 *
 * @param value - Raw query string
 * @returns Parsed number or undefined
 * @internal
 */
function parseNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normalizes enum-like query parameters by trimming empty values.
 *
 * @param value - Raw query string
 * @returns Trimmed value or undefined
 * @internal
 */
function normalizeEnum<T extends string>(value: string | null): T | undefined {
  return valueOrUndefined(value) as T | undefined;
}

/**
 * Normalizes the configured TCP port.
 *
 * @param value - Requested port
 * @returns Supported port number
 * @internal
 */
function normalizePort(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 65535) {
    return DEFAULT_API_PORT;
  }

  return Math.floor(value);
}

if (isMainModule(import.meta.url)) {
  runApiServerFromConfig().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start Karya API server: ${message}`);
    process.exitCode = 1;
  });
}
