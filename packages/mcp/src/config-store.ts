/**
 * Config persistence helpers for MCP and HTTP routes.
 * I keep config reads and writes here so scan-rule updates stay isolated from request handling.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import type { KaryaConfig } from '@karya/core';
import {
  normalizeConfigPaths,
  resolveKaryaConfigPath,
} from './config.js';

/**
 * Scan settings exposed to the UI.
 * @public
 */
export interface ProjectScanSettings {
  /** Include globs or paths */
  include: string[];
  /** Exclude globs or paths */
  exclude: string[];
}

/**
 * Loaded config file with raw and normalized forms.
 * @internal
 */
interface LoadedConfigFile {
  /** Absolute config file path */
  configPath: string;
  /** Raw parsed JSON used for persistence */
  rawConfig: KaryaConfig;
  /** Path-normalized config used for matching */
  normalizedConfig: KaryaConfig;
}

/**
 * Result from updating project scan settings.
 * @public
 */
export interface PersistedScanSettingsResult {
  /** Updated settings */
  settings: ProjectScanSettings;
  /** Normalized config after the write */
  config: KaryaConfig;
  /** User-facing follow-up warning */
  warning: string;
}

/**
 * Loads the current config file from disk.
 *
 * @param configPath - Optional config path override
 * @returns Raw and normalized config data
 * @internal
 */
function loadConfigFile(configPath?: string): LoadedConfigFile {
  const resolvedPath = resolveKaryaConfigPath(configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Karya config file not found: ${resolvedPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as KaryaConfig;
  return {
    configPath: resolvedPath,
    rawConfig: raw,
    normalizedConfig: normalizeConfigPaths(raw, path.dirname(resolvedPath)),
  };
}

/**
 * Resolves scan settings for a project from normalized config.
 *
 * @param config - Normalized config
 * @param projectPath - Absolute project path
 * @param projectName - Optional project name fallback
 * @returns Scan settings object
 * @public
 */
export function resolveProjectScanSettings(
  config: KaryaConfig,
  projectPath: string,
  projectName?: string
): ProjectScanSettings {
  const match = config.projects.find(
    (project) => project.path === projectPath || project.name === projectName
  );

  return {
    include: [...(match?.include ?? [])],
    exclude: [...(match?.exclude ?? [])],
  };
}

/**
 * Persists include/exclude rules for a project back to `karya.config.json`.
 *
 * @param input - Project identity and settings payload
 * @returns Updated settings plus a restart warning
 * @public
 */
export function updateProjectScanSettings(input: {
  projectPath: string;
  projectName?: string;
  include: string[];
  exclude: string[];
  configPath?: string;
}): PersistedScanSettingsResult {
  const loaded = loadConfigFile(input.configPath);
  const projectIndex = loaded.normalizedConfig.projects.findIndex(
    (project) => project.path === input.projectPath || project.name === input.projectName
  );

  if (projectIndex === -1) {
    throw new Error('Project was not found in karya.config.json');
  }

  const include = sanitizePatterns(input.include);
  const exclude = sanitizePatterns(input.exclude);
  loaded.rawConfig.projects[projectIndex] = {
    ...loaded.rawConfig.projects[projectIndex],
    include,
    exclude,
  };

  fs.writeFileSync(loaded.configPath, `${JSON.stringify(loaded.rawConfig, null, 2)}\n`, 'utf-8');

  return {
    settings: { include, exclude },
    config: normalizeConfigPaths(loaded.rawConfig, path.dirname(loaded.configPath)),
    warning: 'Scan rules were saved to karya.config.json. Restart the scanner to apply them.',
  };
}

/**
 * Removes blanks, trims whitespace, and preserves stable ordering.
 *
 * @param patterns - Raw input patterns
 * @returns Sanitized patterns
 * @internal
 */
function sanitizePatterns(patterns: string[]): string[] {
  return Array.from(
    new Set(
      patterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
    )
  );
}
