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
 * Adds a new project to `karya.config.json`.
 *
 * @param input - Project definition
 * @returns Updated normalized config plus a restart warning
 * @public
 */
export function addProjectToConfig(input: {
  name: string;
  path: string;
  include?: string[];
  exclude?: string[];
  configPath?: string;
}): { config: KaryaConfig; warning: string } {
  const loaded = loadConfigFile(input.configPath);
  const duplicate = loaded.rawConfig.projects.find(
    (p) => p.name === input.name || p.path === input.path
  );
  if (duplicate) {
    throw new Error(`A project with name "${input.name}" or path "${input.path}" already exists.`);
  }

  const resolvedProjectPath = path.isAbsolute(input.path.trim())
    ? input.path.trim()
    : path.resolve(path.dirname(loaded.configPath), input.path.trim());
  if (!fs.existsSync(resolvedProjectPath) || !fs.statSync(resolvedProjectPath).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${input.path.trim()}`);
  }

  const entry: KaryaConfig['projects'][number] = {
    name: input.name.trim(),
    path: input.path.trim(),
    ...(input.include?.length ? { include: sanitizePatterns(input.include) } : {}),
    ...(input.exclude?.length ? { exclude: sanitizePatterns(input.exclude) } : {}),
  };
  loaded.rawConfig.projects.push(entry);

  fs.writeFileSync(loaded.configPath, `${JSON.stringify(loaded.rawConfig, null, 2)}\n`, 'utf-8');

  return {
    config: normalizeConfigPaths(loaded.rawConfig, path.dirname(loaded.configPath)),
    warning: 'Project added to karya.config.json. Restart the scanner to pick it up.',
  };
}

/**
 * Updates an existing project in `karya.config.json`.
 *
 * @param input - Fields to update (matched by current path or name)
 * @returns Updated normalized config
 * @public
 */
export function updateProjectInConfig(input: {
  projectPath: string;
  projectName?: string;
  name?: string;
  newPath?: string;
  include?: string[];
  exclude?: string[];
  configPath?: string;
}): { config: KaryaConfig; warning: string } {
  const loaded = loadConfigFile(input.configPath);
  const idx = loaded.normalizedConfig.projects.findIndex(
    (p) => p.path === input.projectPath || p.name === input.projectName
  );
  if (idx === -1) {
    throw new Error('Project not found in karya.config.json');
  }

  const current = loaded.rawConfig.projects[idx];
  loaded.rawConfig.projects[idx] = {
    ...current,
    ...(input.name ? { name: input.name.trim() } : {}),
    ...(input.newPath ? { path: input.newPath.trim() } : {}),
    ...(input.include !== undefined ? { include: sanitizePatterns(input.include) } : {}),
    ...(input.exclude !== undefined ? { exclude: sanitizePatterns(input.exclude) } : {}),
  };

  fs.writeFileSync(loaded.configPath, `${JSON.stringify(loaded.rawConfig, null, 2)}\n`, 'utf-8');

  return {
    config: normalizeConfigPaths(loaded.rawConfig, path.dirname(loaded.configPath)),
    warning: 'Project updated in karya.config.json. Restart the scanner to apply changes.',
  };
}

/**
 * Removes a project from `karya.config.json`.
 *
 * @param input - Project identity
 * @returns Updated normalized config
 * @public
 */
export function removeProjectFromConfig(input: {
  projectPath: string;
  projectName?: string;
  configPath?: string;
}): { config: KaryaConfig; warning: string } {
  const loaded = loadConfigFile(input.configPath);
  const idx = loaded.normalizedConfig.projects.findIndex(
    (p) => p.path === input.projectPath || p.name === input.projectName
  );
  if (idx === -1) {
    throw new Error('Project not found in karya.config.json');
  }

  loaded.rawConfig.projects.splice(idx, 1);
  fs.writeFileSync(loaded.configPath, `${JSON.stringify(loaded.rawConfig, null, 2)}\n`, 'utf-8');

  return {
    config: normalizeConfigPaths(loaded.rawConfig, path.dirname(loaded.configPath)),
    warning: 'Project removed from karya.config.json. Restart the scanner to apply.',
  };
}

/**
 * Reads the raw `karya.config.json` file content.
 *
 * @param configPath - Optional config path override
 * @returns Raw JSON string
 * @public
 */
export function readConfigFileRaw(configPath?: string): string {
  const resolvedPath = resolveKaryaConfigPath(configPath);
  return fs.readFileSync(resolvedPath, 'utf-8');
}

/**
 * Writes raw JSON content to `karya.config.json`.
 *
 * @param content - JSON string to write
 * @param configPath - Optional config path override
 * @returns Normalized config
 * @public
 */
export function writeConfigFileRaw(content: string, configPath?: string): KaryaConfig {
  const resolvedPath = resolveKaryaConfigPath(configPath);
  // Validate it parses as JSON before writing
  const parsed = JSON.parse(content) as KaryaConfig;
  if (!parsed.projects || !Array.isArray(parsed.projects)) {
    throw new Error('Config must have a "projects" array.');
  }
  fs.writeFileSync(resolvedPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  return normalizeConfigPaths(parsed, path.dirname(resolvedPath));
}

/**
 * Reads a file from a project directory with safety restrictions.
 *
 * @param filePath - Absolute or relative file path
 * @param allowedRoots - Directories the read is restricted to
 * @returns File content as string
 * @public
 */
export function readProjectFile(filePath: string, allowedRoots: string[]): string {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error('File not found.');
  }

  // Resolve symlinks to prevent traversal via symlink chains
  const realPath = fs.realpathSync(resolved);
  const isAllowed = allowedRoots.some((root) => {
    const realRoot = fs.existsSync(root) ? fs.realpathSync(path.resolve(root)) : path.resolve(root);
    // Append path.sep to prevent prefix collision (/project matching /project-secrets)
    return realPath.startsWith(realRoot + path.sep) || realPath === realRoot;
  });
  if (!isAllowed) {
    throw new Error('File path is outside configured project directories.');
  }

  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    throw new Error('Path is not a regular file.');
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error('File exceeds 2MB size limit.');
  }

  return fs.readFileSync(realPath, 'utf-8');
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
