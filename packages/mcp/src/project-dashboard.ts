/**
 * Project dashboard helpers for the local HTTP API.
 * I keep document discovery and project-level analytics here so the request handler stays lean.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Database, Issue, Project, ProjectStats } from '@karya/core';

/**
 * Supported document kinds surfaced in the UI.
 * @public
 */
export type ApiProjectDocumentKind = 'readme' | 'architecture' | 'spec' | 'notes';

/**
 * Lightweight document summary returned to the dashboard.
 * @public
 */
export interface ApiProjectDocument {
  /** Stable document kind */
  kind: ApiProjectDocumentKind;
  /** Human-friendly title */
  title: string;
  /** Path relative to the project root */
  relativePath: string;
  /** Short preview used in the dashboard */
  preview: string;
  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * Project-level analytics returned to the dashboard.
 * @public
 */
export interface ApiProjectAnalytics {
  /** Non-done high urgency issues */
  urgentCount: number;
  /** Completed work percentage across tracked issues */
  completionRate: number;
  /** Number of surfaced documents */
  docsCount: number;
  /** Number of scanned artifacts stored in SQLite */
  artifactCount: number;
  /** Number of scanner-generated issues */
  scannerIssues: number;
  /** Number of manual issues */
  manualIssues: number;
  /** Number of AI-created issues */
  aiIssues: number;
  /** Whether a README-like document exists */
  hasReadme: boolean;
  /** Whether an architecture/design document exists */
  hasArchitecture: boolean;
  /** Whether a spec/requirements document exists */
  hasSpec: boolean;
}

/**
 * Composite project insights payload for the dashboard.
 * @public
 */
export interface ApiProjectInsights {
  /** Dashboard-friendly project analytics */
  analytics: ApiProjectAnalytics;
  /** Surfaced documentation previews */
  documents: ApiProjectDocument[];
}

/**
 * Candidate markdown document names worth surfacing in the dashboard.
 * I keep the list intentionally small so the UI stays curated instead of dumping every markdown file.
 * @internal
 */
const DOCUMENT_MATCHERS: Array<{
  kind: ApiProjectDocumentKind;
  pattern: RegExp;
}> = [
  { kind: 'readme', pattern: /^readme(?:\.[^.]+)?\.md$/i },
  { kind: 'architecture', pattern: /^(?:architecture|arch|design|overview)(?:\.[^.]+)?\.md$/i },
  { kind: 'spec', pattern: /^(?:project-spec|spec|requirements|prd)(?:\.[^.]+)?\.md$/i },
  { kind: 'notes', pattern: /^(?:roadmap|adr|notes|context)(?:\.[^.]+)?\.md$/i },
];

/**
 * Maximum number of surfaced documents per project.
 * @internal
 */
const MAX_DOCUMENTS = 6;

/**
 * Builds dashboard-friendly insights for a project.
 *
 * @param db - Active database
 * @param project - Project model
 * @param stats - Precomputed project stats
 * @returns Project insights payload
 * @public
 */
export function buildProjectInsights(
  db: Database,
  project: Project,
  stats: ProjectStats
): ApiProjectInsights {
  const issues = db.getIssuesByProject(project.id);
  const artifacts = db.getArtifactsByProject(project.id);
  const documents = discoverProjectDocuments(project.path);

  return {
    analytics: buildProjectAnalytics(issues, artifacts.length, documents, stats),
    documents,
  };
}

/**
 * Creates a stable analytics summary for a project.
 *
 * @param issues - Project issues
 * @param artifactCount - Number of tracked artifacts
 * @param docsCount - Number of surfaced docs
 * @param stats - Precomputed project stats
 * @returns Analytics summary
 * @internal
 */
function buildProjectAnalytics(
  issues: Issue[],
  artifactCount: number,
  documents: ApiProjectDocument[],
  stats: ProjectStats
): ApiProjectAnalytics {
  const urgentCount = issues.filter(
    (issue) =>
      issue.status !== 'done' && (issue.priority === 'critical' || issue.priority === 'high')
  ).length;
  const scannerIssues = issues.filter((issue) => issue.source === 'scanner').length;
  const manualIssues = issues.filter((issue) => issue.source === 'manual').length;
  const aiIssues = issues.filter((issue) => issue.source === 'claude').length;
  const kinds = new Set(documents.map((document) => document.kind));

  return {
    urgentCount,
    completionRate: stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100),
    docsCount: documents.length,
    artifactCount,
    scannerIssues,
    manualIssues,
    aiIssues,
    hasReadme: kinds.has('readme'),
    hasArchitecture: kinds.has('architecture'),
    hasSpec: kinds.has('spec'),
  };
}

/**
 * Discovers curated markdown documents for a project.
 *
 * @param projectRoot - Project root path
 * @returns Surfaced documents
 * @internal
 */
function discoverProjectDocuments(projectRoot: string): ApiProjectDocument[] {
  const roots = [projectRoot, path.join(projectRoot, 'docs')];
  const matches = new Map<string, ApiProjectDocument>();

  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }

      const absolutePath = path.join(root, entry.name);
      const kind = classifyDocument(entry.name);
      if (!kind) {
        continue;
      }

      const relativePath = path.relative(projectRoot, absolutePath);
      if (matches.has(relativePath)) {
        continue;
      }

      const raw = safeReadFile(absolutePath);
      const stats = safeStat(absolutePath);
      matches.set(relativePath, {
        kind,
        title: deriveDocumentTitle(entry.name, raw),
        relativePath,
        preview: extractPreview(raw),
        updatedAt: stats?.mtimeMs ?? 0,
      });
    }
  }

  return Array.from(matches.values())
    .sort((left, right) => {
      const kindOrder = documentKindRank(left.kind) - documentKindRank(right.kind);
      return kindOrder !== 0 ? kindOrder : left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, MAX_DOCUMENTS);
}

/**
 * Classifies a markdown document into a dashboard kind.
 *
 * @param fileName - Candidate file name
 * @returns Document kind or null
 * @internal
 */
function classifyDocument(fileName: string): ApiProjectDocumentKind | null {
  return DOCUMENT_MATCHERS.find((matcher) => matcher.pattern.test(fileName))?.kind ?? null;
}

/**
 * Derives a stable title from file content or the file name.
 *
 * @param fileName - File name
 * @param raw - File content
 * @returns Document title
 * @internal
 */
function deriveDocumentTitle(fileName: string, raw: string): string {
  const heading = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('#'));

  if (heading) {
    return heading.replace(/^#+\s*/, '').trim();
  }

  return fileName
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Extracts a readable preview from markdown content.
 *
 * @param raw - File content
 * @returns Preview string
 * @internal
 */
function extractPreview(raw: string): string {
  const preview = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !line.startsWith('```') &&
        !line.startsWith('- [')
    )
    .slice(0, 3)
    .join(' ');

  return preview.length > 220 ? `${preview.slice(0, 217).trimEnd()}...` : preview;
}

/**
 * Reads a file as UTF-8 without throwing.
 *
 * @param absolutePath - File path
 * @returns File content or empty string
 * @internal
 */
function safeReadFile(absolutePath: string): string {
  try {
    return fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Reads file metadata without throwing.
 *
 * @param absolutePath - File path
 * @returns File stats or null
 * @internal
 */
function safeStat(absolutePath: string): fs.Stats | null {
  try {
    return fs.statSync(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Ranks document kinds for UI ordering.
 *
 * @param kind - Document kind
 * @returns Sort rank
 * @internal
 */
function documentKindRank(kind: ApiProjectDocumentKind): number {
  if (kind === 'readme') return 0;
  if (kind === 'architecture') return 1;
  if (kind === 'spec') return 2;
  return 3;
}
