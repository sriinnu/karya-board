/**
 * Runtime entrypoint for the Karya scanner service.
 * I load config, start scanning, and keep BOARD.md synchronized with database changes.
 * Also wires up the EventBus and AgentRegistry for event-driven operations.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBoardGenerator,
  createDatabase,
  createLogger,
  createScanner,
  createEventBus,
  createAgentRegistry,
  type KaryaConfig,
  type EventBus,
  type AgentRegistry,
} from './index.js';

/**
 * Scoped runtime logger.
 * @internal
 */
const logger = createLogger('runtime');

/**
 * Runtime context containing all initialized services.
 * @public
 */
export interface RuntimeContext {
  /** Database instance */
  db: Awaited<ReturnType<typeof createDatabase>>;
  /** EventBus instance */
  eventBus: EventBus;
  /** Agent Registry instance */
  agentRegistry: AgentRegistry;
  /** Scanner instance */
  scanner: ReturnType<typeof createScanner>;
  /** Board Generator instance */
  boardGenerator: ReturnType<typeof createBoardGenerator>;
  /** Configuration */
  config: KaryaConfig;
}

/**
 * Loads Karya config from disk and normalizes relative paths.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @returns Parsed Karya config
 * @internal
 */
function loadConfig(configPath?: string): KaryaConfig {
  const requestedPath = configPath ?? process.env.KARYA_CONFIG ?? './karya.config.json';
  const searchRoots = [
    process.env.INIT_CWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));
  const resolvedPath = path.isAbsolute(requestedPath)
    ? requestedPath
    : resolveFromRoots(requestedPath, searchRoots);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Karya config file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as KaryaConfig;
  const configDir = path.dirname(resolvedPath);

  return {
    ...parsed,
    boardOutput: resolveConfigPath(parsed.boardOutput, configDir),
    database: {
      ...parsed.database,
      path: resolveConfigPath(parsed.database.path, configDir),
    },
    projects: parsed.projects.map((project) => ({
      ...project,
      path: resolveConfigPath(project.path, configDir),
    })),
  };
}

/**
 * Main scanner runtime.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @public
 */
export async function runScanner(configPath?: string): Promise<void> {
  const context = await initializeRuntime(configPath);

  // Subscribe to events for board regeneration
  context.scanner.onScanEvent((event) => {
    if (event.type === 'db-updated' || event.type === 'file-change') {
      context.boardGenerator.scheduleRegenerate();
    }
  });

  // Also subscribe to database events via EventBus
  context.eventBus.subscribe('db:*', async () => {
    context.boardGenerator.scheduleRegenerate();
  });

  await context.scanner.start();

  const initialBoard = await context.boardGenerator.regenerate();
  if (!initialBoard.success) {
    throw initialBoard.error ?? new Error('Failed to generate BOARD.md');
  }

  logger.info(
    `Scanner started. Watching ${context.config.projects.length} project(s). BOARD: ${initialBoard.filePath}`
  );
  logger.info(
    `EventBus active with ${context.eventBus.subscriptionCount} subscriptions, ` +
    `${context.agentRegistry.agentCount} agents spawned`
  );

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await context.scanner.stop();
    await context.agentRegistry.dispose();
    await context.boardGenerator.dispose();
    context.db.close();
    logger.info('Shutdown complete');
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}

/**
 * Initializes the runtime with all services wired up.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @returns Runtime context with all initialized services
 * @public
 */
export async function initializeRuntime(configPath?: string): Promise<RuntimeContext> {
  const config = loadConfig(configPath);

  // Initialize database
  const db = await createDatabase(config);

  // Initialize EventBus
  const eventBus = createEventBus({
    maxHistorySize: 100,
    defaultHandlerTimeout: 30000,
    catchHandlerErrors: true,
  });

  // Connect EventBus to Database
  db.setEventBus(eventBus);

  // Initialize Agent Registry
  const agentRegistry = createAgentRegistry(db, eventBus);
  await agentRegistry.initialize();

  // Initialize Board Generator
  const boardGenerator = createBoardGenerator({ db, config });

  // Initialize Scanner
  const scanner = createScanner({ db, config });

  return {
    db,
    eventBus,
    agentRegistry,
    scanner,
    boardGenerator,
    config,
  };
}

/**
 * Resolves a config-relative path to an absolute path.
 *
 * @param value - Configured path
 * @param configDir - Directory containing the config file
 * @returns Absolute path
 * @internal
 */
function resolveConfigPath(value: string, configDir: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDir, value);
}

/**
 * Resolves a relative config path against likely caller working directories.
 *
 * @param relativePath - Requested config path
 * @param roots - Candidate working directories
 * @returns First matching absolute path, or the first candidate
 * @internal
 */
function resolveFromRoots(relativePath: string, roots: string[]): string {
  for (const root of roots) {
    const candidate = path.resolve(root, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(roots[0] ?? process.cwd(), relativePath);
}

/**
 * Checks whether the current module is the active Node entrypoint.
 *
 * @param moduleUrl - Current module URL
 * @returns True when executed directly
 * @internal
 */
function isMainModule(moduleUrl: string): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(moduleUrl));
}

if (isMainModule(import.meta.url)) {
  runScanner().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start scanner: ${message}`);
    process.exitCode = 1;
  });
}
