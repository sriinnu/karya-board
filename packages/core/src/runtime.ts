/**
 * Runtime entrypoint for the Karya scanner service.
 * I load config, start scanning, and keep BOARD.md synchronized with database changes.
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
  type KaryaConfig,
} from './index.js';

/**
 * Scoped runtime logger.
 * @internal
 */
const logger = createLogger('runtime');

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
  const config = loadConfig(configPath);
  const db = await createDatabase(config);
  const boardGenerator = createBoardGenerator({ db, config });
  const scanner = createScanner({ db, config });

  scanner.onScanEvent((event) => {
    if (event.type === 'db-updated' || event.type === 'file-change') {
      boardGenerator.scheduleRegenerate();
    }
  });

  await scanner.start();

  const initialBoard = await boardGenerator.regenerate();
  if (!initialBoard.success) {
    throw initialBoard.error ?? new Error('Failed to generate BOARD.md');
  }

  logger.info(
    `Scanner started. Watching ${config.projects.length} project(s). BOARD: ${initialBoard.filePath}`
  );

  const shutdown = async (): Promise<void> => {
    await scanner.stop();
    await boardGenerator.dispose();
    db.close();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
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
