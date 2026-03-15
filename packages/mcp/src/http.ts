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
import {
  AiIssueSuggester,
} from './ai.js';
import { AI_PROVIDERS, type AIProvider, type SuggestIssuesParams } from './ai.types.js';
import {
  addProjectToConfig,
  readConfigFileRaw,
  readProjectFile,
  removeProjectFromConfig,
  resolveProjectScanSettings,
  updateProjectInConfig,
  updateProjectScanSettings,
  writeConfigFileRaw,
  type ProjectScanSettings,
} from './config-store.js';
import { isMainModule, loadKaryaConfig } from './config.js';
import {
  ScannerController,
  type ScannerRuntimeStatus,
} from './scanner-controller.js';
import {
  buildProjectInsights,
  type ApiProjectAnalytics,
  type ApiProjectDocument,
} from './project-dashboard.js';
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
  /** Project dashboard analytics */
  analytics: ApiProjectAnalytics;
  /** Curated docs surfaced for the dashboard */
  documents: ApiProjectDocument[];
  /** Scanner include/exclude rules */
  scanSettings: ProjectScanSettings;
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
  /** Optional config path used for persistence routes */
  configPath?: string;
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
 * Scanner-control API payload.
 * @internal
 */
interface ApiScannerPayload {
  /** Whether the request succeeded */
  success: boolean;
  /** Embedded scanner status */
  status?: ScannerRuntimeStatus;
  /** Error message when the request failed */
  error?: string;
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
  private aiSuggester: AiIssueSuggester | null = null;
  private scannerController: ScannerController | null = null;

  /** Resolved host binding */
  private readonly host: string;

  /** Resolved port binding */
  private readonly port: number;

  /** Optional config file path for settings persistence */
  private readonly configPath?: string;

  /** In-memory normalized config */
  private config: KaryaConfig | null = null;

  /**
   * Creates a new API server instance.
   *
   * @param options - Host and port overrides
   */
  constructor(options: ApiServerOptions = {}) {
    this.host = options.host ?? DEFAULT_API_HOST;
    this.port = normalizePort(options.port ?? Number(process.env.KARYA_API_PORT));
    this.configPath = options.configPath;
  }

  /**
   * Initializes the API server with a Karya config.
   *
   * @param config - Parsed Karya configuration
   */
  async initialize(config: KaryaConfig): Promise<void> {
    this.config = config;
    this.db = await createDatabase(config);
    this.boardGenerator = createBoardGenerator({ db: this.db, config });
    this.addIssue = createAddIssueTool(this.db);
    this.listIssues = createListIssuesTool(this.db);
    this.updateIssue = createUpdateIssueTool(this.db);
    this.deleteIssue = createDeleteIssueTool(this.db);
    this.aiSuggester = new AiIssueSuggester(this.db);
    this.scannerController = new ScannerController({
      db: this.db,
      config,
      boardGenerator: this.boardGenerator,
    });
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.timeout = 30000;
    this.server.headersTimeout = 10000;
    this.server.requestTimeout = 30000;
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

    if (this.scannerController) {
      await this.scannerController.dispose();
      this.scannerController = null;
    }

    if (this.boardGenerator) {
      await this.boardGenerator.dispose();
      this.boardGenerator = null;
    }

    this.aiSuggester = null;

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
    this.writeCorsHeaders(response, request);

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
      if (request.method === 'GET' && pathname === '/') {
        const uiPort = Number(process.env.KARYA_UI_PORT ?? 9631);
        this.sendJson(response, 200, {
          success: true,
          service: 'karya-api',
          message: 'This is the local Karya HTTP API. Open the Spanda UI separately.',
          uiUrl: `http://127.0.0.1:${uiPort}`,
          healthUrl: '/api/health',
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/health') {
        this.sendJson(response, 200, { success: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/scanner/status') {
        this.sendJson(response, 200, {
          success: true,
          status: this.mustGetScannerController().getStatus(),
        } satisfies ApiScannerPayload);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/scanner/start') {
        this.sendJson(response, 200, {
          success: true,
          status: await this.mustGetScannerController().start(),
        } satisfies ApiScannerPayload);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/scanner/restart') {
        this.sendJson(response, 200, {
          success: true,
          status: await this.mustGetScannerController().restart(),
        } satisfies ApiScannerPayload);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/projects') {
        const db = this.mustGetDb();
        const config = this.mustGetConfig();
        const projects = db
          .getAllProjects()
          .map((project): ApiProject => {
            const stats = db.getProjectStats(project.id);
            const insights = buildProjectInsights(db, project, stats);

            return {
              ...project,
              stats,
              analytics: insights.analytics,
              documents: insights.documents,
              scanSettings: resolveProjectScanSettings(config, project.path, project.name),
            };
          });

        this.sendJson(response, 200, { success: true, projects });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/projects') {
        const payload = await this.readJsonBody<{
          name?: unknown;
          path?: unknown;
          include?: unknown;
          exclude?: unknown;
        }>(request);
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        const projectPath = typeof payload.path === 'string' ? payload.path.trim() : '';
        if (!name || !projectPath) {
          this.sendJson(response, 400, { success: false, error: 'Both "name" and "path" are required.' });
          return;
        }
        const result = addProjectToConfig({
          name,
          path: projectPath,
          include: Array.isArray(payload.include) ? payload.include.filter((v): v is string => typeof v === 'string') : undefined,
          exclude: Array.isArray(payload.exclude) ? payload.exclude.filter((v): v is string => typeof v === 'string') : undefined,
          configPath: this.configPath,
        });
        this.config = result.config;
        this.mustGetScannerController().setConfig(result.config);
        // Auto-create in DB
        const db = this.mustGetDb();
        const normalizedProject = result.config.projects.find((p) => p.name === name);
        if (normalizedProject && !db.getProjectByPath(normalizedProject.path)) {
          db.createProject(normalizedProject.name, normalizedProject.path);
        }
        this.sendJson(response, 201, { success: true, warning: result.warning });
        return;
      }

      const projectIdForCrud = this.getProjectIdFromPath(pathname);

      if (projectIdForCrud && request.method === 'PATCH' && !pathname.includes('/scan-settings')) {
        const db = this.mustGetDb();
        const project = db.getProjectById(projectIdForCrud);
        if (!project) {
          this.sendJson(response, 404, { success: false, error: 'Project not found' });
          return;
        }
        const payload = await this.readJsonBody<{
          name?: unknown;
          path?: unknown;
          include?: unknown;
          exclude?: unknown;
        }>(request);
        const result = updateProjectInConfig({
          projectPath: project.path,
          projectName: project.name,
          name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
          newPath: typeof payload.path === 'string' ? payload.path.trim() : undefined,
          include: Array.isArray(payload.include) ? payload.include.filter((v): v is string => typeof v === 'string') : undefined,
          exclude: Array.isArray(payload.exclude) ? payload.exclude.filter((v): v is string => typeof v === 'string') : undefined,
          configPath: this.configPath,
        });
        this.config = result.config;
        this.mustGetScannerController().setConfig(result.config);
        this.sendJson(response, 200, { success: true, warning: result.warning });
        return;
      }

      if (projectIdForCrud && request.method === 'DELETE') {
        const db = this.mustGetDb();
        const project = db.getProjectById(projectIdForCrud);
        if (!project) {
          this.sendJson(response, 404, { success: false, error: 'Project not found' });
          return;
        }
        const result = removeProjectFromConfig({
          projectPath: project.path,
          projectName: project.name,
          configPath: this.configPath,
        });
        this.config = result.config;
        this.mustGetScannerController().setConfig(result.config);
        this.sendJson(response, 200, { success: true, warning: result.warning });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/config') {
        const raw = readConfigFileRaw(this.configPath);
        this.sendJson(response, 200, { success: true, config: JSON.parse(raw) });
        return;
      }

      if (request.method === 'PUT' && pathname === '/api/config') {
        const payload = await this.readJsonBody<{ content?: unknown }>(request);
        const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload);
        const config = writeConfigFileRaw(content, this.configPath);
        this.config = config;
        this.mustGetScannerController().setConfig(config);
        this.sendJson(response, 200, { success: true, warning: 'Config saved. Restart the scanner to apply.' });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/files/read') {
        const payload = await this.readJsonBody<{ filePath?: unknown }>(request);
        if (typeof payload.filePath !== 'string' || !payload.filePath.trim()) {
          this.sendJson(response, 400, { success: false, error: '"filePath" is required.' });
          return;
        }
        const config = this.mustGetConfig();
        const allowedRoots = config.projects.map((p) => p.path);
        const content = readProjectFile(payload.filePath, allowedRoots);
        this.sendJson(response, 200, { success: true, content });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/ai/status') {
        this.sendJson(response, 200, { success: true, ...this.mustGetAiSuggester().getStatus() });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ai/suggest-issues') {
        const result = await this.mustGetAiSuggester().suggestIssues(
          parseSuggestIssuesParams(await this.readJsonBody<unknown>(request))
        );
        this.sendJson(
          response,
          result.success ? 200 : result.statusCode ?? (result.available ? 400 : 503),
          result
        );
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
      const projectScanSettingsTarget = this.getProjectScanSettingsTarget(pathname);
      if (projectScanSettingsTarget && request.method === 'PATCH') {
        const db = this.mustGetDb();
        const project = db.getProjectById(projectScanSettingsTarget);
        if (!project) {
          this.sendJson(response, 404, { success: false, error: 'Project not found' });
          return;
        }

        const payload = parseScanSettingsPayload(await this.readJsonBody<unknown>(request));
        const result = updateProjectScanSettings({
          configPath: this.configPath,
          projectPath: project.path,
          projectName: project.name,
          include: payload.include,
          exclude: payload.exclude,
        });
        this.config = result.config;
        this.mustGetScannerController().setConfig(result.config);
        this.sendJson(response, 200, {
          success: true,
          settings: result.settings,
          warning: result.warning,
        });
        return;
      }

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
        error: 'Route not found',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof HttpRequestError) {
        this.sendJson(response, error.statusCode, { success: false, error: message });
      } else {
        logger.error(`Unhandled request error: ${message}`);
        this.sendJson(response, 500, { success: false, error: 'Internal server error' });
      }
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
    const MAX_BODY_SIZE = 1 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of request) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalSize += buf.length;
      if (totalSize > MAX_BODY_SIZE) {
        throw new HttpRequestError(413, 'Request body too large');
      }
      chunks.push(buf);
    }

    if (chunks.length === 0) {
      return {} as T;
    }

    const raw = Buffer.concat(chunks).toString('utf-8');
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new HttpRequestError(400, 'Invalid JSON body');
    }
  }

  /**
   * Writes shared CORS headers for browser clients.
   *
   * @param response - HTTP response writer
   * @internal
   */
  private writeCorsHeaders(response: ServerResponse, request?: IncomingMessage): void {
    const uiPort = Number(process.env.KARYA_UI_PORT ?? 9631);
    const allowedOrigin = `http://127.0.0.1:${uiPort}`;
    const requestOrigin = request?.headers.origin;
    const origin = requestOrigin === allowedOrigin || requestOrigin === `http://localhost:${uiPort}`
      ? requestOrigin
      : allowedOrigin;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,PATCH,DELETE,OPTIONS'
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
   * Extracts a project ID from `/api/projects/:id` paths (excluding sub-routes).
   *
   * @param pathname - Request path
   * @returns Project ID when present
   * @internal
   */
  private getProjectIdFromPath(pathname: string): string | null {
    const match = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Extracts a project ID from `/api/projects/:id/scan-settings` paths.
   *
   * @param pathname - Request path
   * @returns Project ID when present
   * @internal
   */
  private getProjectScanSettingsTarget(pathname: string): string | null {
    const match = /^\/api\/projects\/([^/]+)\/scan-settings$/.exec(pathname);
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
   * Ensures the normalized config is initialized.
   *
   * @returns Active config
   * @internal
   */
  private mustGetConfig(): KaryaConfig {
    if (!this.config) {
      throw new Error('API server not initialized');
    }

    return this.config;
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
   * Ensures the AI suggester is initialized.
   * @returns Initialized AI suggester
   * @internal
   */
  private mustGetAiSuggester(): AiIssueSuggester {
    if (!this.aiSuggester) {
      throw new Error('API server not initialized');
    }
    return this.aiSuggester;
  }

  /**
   * Ensures the embedded scanner controller is initialized.
   * @returns Initialized scanner controller
   * @internal
   */
  private mustGetScannerController(): ScannerController {
    if (!this.scannerController) {
      throw new Error('API server not initialized');
    }

    return this.scannerController;
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
  return runApiServer(config, {
    ...options,
    configPath: options.configPath ?? configPath,
  });
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
 * Lightweight request error with an attached HTTP status.
 * @internal
 */
class HttpRequestError extends Error {
  /** HTTP status to return */
  public readonly statusCode: number;

  /**
   * Creates a new request error.
   * @param statusCode - HTTP status code
   * @param message - User-facing error message
   */
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpRequestError';
    this.statusCode = statusCode;
  }
}

/**
 * Validates the AI suggestion payload before dispatching it to a provider.
 * @param payload - Parsed JSON body
 * @returns Validated suggestion params
 * @internal
 */
function parseSuggestIssuesParams(payload: unknown): SuggestIssuesParams {
  if (!isRecord(payload)) {
    throw new HttpRequestError(400, 'AI suggestion payload must be a JSON object.');
  }

  assertAllowedKeys(payload, ['projectId', 'provider', 'model', 'prompt', 'maxSuggestions']);

  return {
    projectId: readRequiredString(payload.projectId, 'projectId'),
    provider: readOptionalProvider(payload.provider),
    model: readOptionalString(payload.model, 'model'),
    prompt: readOptionalString(payload.prompt, 'prompt'),
    maxSuggestions: readOptionalSuggestionCount(payload.maxSuggestions),
  };
}

/**
 * Validates the scan-settings payload used for config updates.
 * @param payload - Parsed JSON body
 * @returns Sanitized scan settings
 * @internal
 */
function parseScanSettingsPayload(payload: unknown): ProjectScanSettings {
  if (!isRecord(payload)) {
    throw new HttpRequestError(400, 'Scan settings payload must be a JSON object.');
  }

  assertAllowedKeys(payload, ['include', 'exclude']);

  return {
    include: readRequiredStringArray(payload.include, 'include'),
    exclude: readRequiredStringArray(payload.exclude, 'exclude'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(payload: Record<string, unknown>, allowedKeys: string[]): void {
  const allowed = new Set(allowedKeys);
  const invalidKey = Object.keys(payload).find((key) => !allowed.has(key));
  if (invalidKey) {
    throw new HttpRequestError(400, `Unsupported AI suggestion field: ${invalidKey}`);
  }
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value, field);
  if (!parsed) {
    throw new HttpRequestError(400, `AI suggestion field "${field}" is required.`);
  }
  return parsed;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpRequestError(400, `AI suggestion field "${field}" must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalSuggestionCount(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 8) {
    throw new HttpRequestError(
      400,
      'AI suggestion field "maxSuggestions" must be an integer between 1 and 8.'
    );
  }

  return value;
}

function readRequiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpRequestError(400, `Scan settings field "${field}" must be an array of strings.`);
  }

  const entries = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new HttpRequestError(
        400,
        `Scan settings field "${field}" must contain only strings.`
      );
    }

    return entry.trim();
  });

  return entries.filter((entry) => entry.length > 0);
}

function readOptionalProvider(value: unknown): AIProvider | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !AI_PROVIDERS.includes(value as AIProvider)) {
    throw new HttpRequestError(
      400,
      `AI suggestion field "provider" must be one of: ${AI_PROVIDERS.join(', ')}.`
    );
  }

  return value as AIProvider;
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
