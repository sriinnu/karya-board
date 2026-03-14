/**
 * Runtime config loading utilities for Karya MCP/API servers.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KaryaConfig } from '@karya/core';

/**
 * Loads and parses a Karya config JSON file.
 *
 * @param configPath - Optional path to `karya.config.json`
 * @returns Parsed Karya config
 * @throws Error when the file is missing or invalid JSON
 * @public
 */
export function loadKaryaConfig(configPath?: string): KaryaConfig {
  const requestedPath = configPath ?? process.env.KARYA_CONFIG ?? './karya.config.json';
  const resolvedPath = resolveKaryaConfigPath(requestedPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Karya config file not found: ${resolvedPath}`);
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw) as KaryaConfig;
    return normalizeConfigPaths(parsed, path.dirname(resolvedPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse Karya config at ${resolvedPath}: ${message}`);
  }
}

/**
 * Resolves the config file path used by MCP/API runtime modules.
 *
 * @param requestedPath - Optional config path override
 * @returns Absolute config file path
 * @public
 */
export function resolveKaryaConfigPath(requestedPath?: string): string {
  const targetPath = requestedPath ?? process.env.KARYA_CONFIG ?? './karya.config.json';
  const searchRoots = [
    process.env.INIT_CWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  return path.isAbsolute(targetPath)
    ? targetPath
    : resolveFromRoots(targetPath, searchRoots);
}

/**
 * Checks if a module URL points to the direct entrypoint currently executed by Node.
 *
 * @param moduleUrl - `import.meta.url` from the current module
 * @returns True when the module is executed directly
 * @public
 */
export function isMainModule(moduleUrl: string): boolean {
  if (!process.argv[1]) {
    return false;
  }

  const currentPath = fileURLToPath(moduleUrl);
  return path.resolve(process.argv[1]) === path.resolve(currentPath);
}

/**
 * Resolves a relative config path against a list of candidate roots.
 *
 * @param relativePath - Requested config path
 * @param roots - Candidate working directories
 * @returns First matching absolute path, or the first resolved candidate
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
 * Normalizes relative config paths against the config file directory.
 *
 * @param config - Parsed Karya config
 * @param configDir - Directory containing the config file
 * @returns Config with absolute filesystem paths
 * @internal
 */
export function normalizeConfigPaths(
  config: KaryaConfig,
  configDir: string
): KaryaConfig {
  return {
    ...config,
    boardOutput: resolveConfigPath(config.boardOutput, configDir),
    database: {
      ...config.database,
      path: resolveConfigPath(config.database.path, configDir),
    },
    projects: config.projects.map((project) => ({
      ...project,
      path: resolveConfigPath(project.path, configDir),
    })),
  };
}

/**
 * Resolves a config-relative path to an absolute filesystem path.
 *
 * @param value - Configured path value
 * @param configDir - Directory containing the config file
 * @returns Absolute path
 * @internal
 */
function resolveConfigPath(value: string, configDir: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDir, value);
}
