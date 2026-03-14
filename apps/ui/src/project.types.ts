/**
 * Project dashboard contracts used by the Spanda UI.
 * I keep project analytics and surfaced docs separate from the transport layer for reuse across components.
 * @packageDocumentation
 */

import type { Project, ProjectStats } from '@karya/core';

/**
 * Curated document kinds surfaced in the dashboard.
 * @public
 */
export type ProjectDocumentKind = 'readme' | 'architecture' | 'spec' | 'notes';

/**
 * Lightweight document preview for a project.
 * @public
 */
export interface ProjectDocumentSummary {
  /** Stable document kind */
  kind: ProjectDocumentKind;
  /** Human-friendly title */
  title: string;
  /** Path relative to the project root */
  relativePath: string;
  /** Short preview used in the dashboard */
  preview: string;
  /** Last modified timestamp in milliseconds */
  updatedAt: number;
}

/**
 * Dashboard-friendly analytics for a project.
 * @public
 */
export interface ProjectAnalytics {
  /** Non-done high urgency issues */
  urgentCount: number;
  /** Completed work percentage */
  completionRate: number;
  /** Number of surfaced docs */
  docsCount: number;
  /** Number of tracked scanned artifacts */
  artifactCount: number;
  /** Number of scanner-generated issues */
  scannerIssues: number;
  /** Number of manual issues */
  manualIssues: number;
  /** Number of AI-created issues */
  aiIssues: number;
  /** Whether the project exposes a README */
  hasReadme: boolean;
  /** Whether architecture/design documentation exists */
  hasArchitecture: boolean;
  /** Whether a spec/requirements document exists */
  hasSpec: boolean;
}

/**
 * Scanner include/exclude rules for a project.
 * @public
 */
export interface ProjectScanSettings {
  /** Include globs or paths */
  include: string[];
  /** Exclude globs or paths */
  exclude: string[];
}

/**
 * Enriched project model returned to the dashboard.
 * @public
 */
export interface ProjectOverview extends Project {
  /** Aggregated issue stats */
  stats: ProjectStats;
  /** Surfaced docs */
  documents: ProjectDocumentSummary[];
  /** Project analytics */
  analytics: ProjectAnalytics;
  /** Current scanner rules */
  scanSettings: ProjectScanSettings;
}
