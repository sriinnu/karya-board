/**
 * Project logo detection utility.
 * Automatically finds logos from local files or GitHub.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Common logo file names to search for in project directories.
 * @internal
 */
const LOGO_FILE_NAMES = [
  'logo',
  'icon',
  'favicon',
  'brand',
  'avatar',
  'app-icon',
  'project-logo',
];

/**
 * Common logo file extensions.
 * @internal
 */
const LOGO_EXTENSIONS = ['.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Directories to search for logos.
 * @internal
 */
const LOGO_DIRECTORIES = [
  '', // root
  'assets',
  'public',
  'static',
  'images',
  'img',
  'icons',
  'brand',
  'docs',
  '.github',
];

/**
 * Result of logo detection.
 * @public
 */
export interface ProjectLogoResult {
  /** URL to the logo image */
  url: string;
  /** Type of logo source */
  source: 'local' | 'github' | 'placeholder';
}

/**
 * Detects a project logo from local files or GitHub.
 *
 * @param projectPath - Absolute path to the project directory
 * @param projectName - Display name of the project
 * @returns Logo result with URL and source type
 * @public
 */
export function detectProjectLogo(
  projectPath: string,
  projectName: string
): ProjectLogoResult {
  // 1. Try to find a local logo file
  const localLogo = findLocalLogo(projectPath);
  if (localLogo) {
    return {
      url: `file://${localLogo}`,
      source: 'local',
    };
  }

  // 2. Try to detect GitHub repo and use avatar
  const githubLogo = detectGitHubLogo(projectPath, projectName);
  if (githubLogo) {
    return githubLogo;
  }

  // 3. Fall back to placeholder based on project name
  return {
    url: generatePlaceholderUrl(projectName),
    source: 'placeholder',
  };
}

/**
 * Searches for a local logo file in common directories.
 * @internal
 */
function findLocalLogo(projectPath: string): string | null {
  for (const dir of LOGO_DIRECTORIES) {
    const searchDir = dir ? path.join(projectPath, dir) : projectPath;

    if (!fs.existsSync(searchDir)) {
      continue;
    }

    // Check for exact matches first
    for (const name of LOGO_FILE_NAMES) {
      for (const ext of LOGO_EXTENSIONS) {
        const filePath = path.join(searchDir, `${name}${ext}`);
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }

    // Check for any image files that might be logos
    try {
      const files = fs.readdirSync(searchDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const baseName = path.basename(file, ext).toLowerCase();

        if (LOGO_EXTENSIONS.includes(ext)) {
          // Check if filename suggests it's a logo
          if (
            baseName.includes('logo') ||
            baseName.includes('icon') ||
            baseName.includes('brand') ||
            baseName.includes('avatar') ||
            baseName === 'favicon'
          ) {
            return path.join(searchDir, file);
          }
        }
      }
    } catch {
      // Ignore errors reading directory
    }
  }

  return null;
}

/**
 * Attempts to detect GitHub repository and return avatar URL.
 * @internal
 */
function detectGitHubLogo(
  projectPath: string,
  projectName: string
): ProjectLogoResult | null {
  // Check for .git directory and GitHub remote
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return null;
  }

  try {
    // Try to read git config to find remote URL
    const gitConfigPath = path.join(gitDir, 'config');
    if (fs.existsSync(gitConfigPath)) {
      const config = fs.readFileSync(gitConfigPath, 'utf-8');
      const githubMatch = config.match(
        /github\.com[\/:]([^\/\s]+)\/([^\/\s\.]+)/i
      );

      if (githubMatch) {
        const owner = githubMatch[1];
        // Use owner avatar for personal repos, or repo might have its own
        return {
          url: `https://github.com/${owner}.png?size=64`,
          source: 'github',
        };
      }
    }
  } catch {
    // Ignore errors reading git config
  }

  return null;
}

/**
 * Generates a placeholder image URL using UI Avatars service.
 * @internal
 */
function generatePlaceholderUrl(projectName: string): string {
  const initial = projectName.trim().charAt(0).toUpperCase() || 'K';
  const colors = [
    '0071e3', // blue
    '34c759', // green
    'ff9500', // orange
    'af52de', // purple
    'ff3b30', // red
    '5ac8fa', // cyan
    'ff2d55', // pink
    '64d2ff', // light blue
  ];

  // Pick a consistent color based on project name
  const colorIndex =
    projectName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    colors.length;
  const bgColor = colors[colorIndex];

  return `https://ui-avatars.com/api/${encodeURIComponent(initial)}?background=${bgColor}&color=fff&size=64&bold=true`;
}

/**
 * Batch detect logos for multiple projects.
 *
 * @param projects - Array of project paths and names
 * @returns Map of project paths to logo URLs
 * @public
 */
export function detectProjectLogos(
  projects: Array<{ path: string; name: string }>
): Map<string, ProjectLogoResult> {
  const results = new Map<string, ProjectLogoResult>();

  for (const project of projects) {
    const logo = detectProjectLogo(project.path, project.name);
    results.set(project.path, logo);
  }

  return results;
}
