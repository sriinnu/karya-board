/**
 * HTTP client for the Karya UI.
 * I keep the contract thin and normalize API timestamps into numbers for the store.
 * @packageDocumentation
 */

import type {
  Issue as CoreIssue,
  IssuePriority,
  IssueStatus,
  Project,
  ProjectStats,
} from '@karya/core';

/**
 * Issue shape used by the UI after timestamp normalization.
 * @public
 */
export interface Issue extends Omit<CoreIssue, 'createdAt' | 'updatedAt'> {
  /** Project name joined by the API */
  projectName?: string;
  /** Creation timestamp in milliseconds */
  createdAt: number;
  /** Update timestamp in milliseconds */
  updatedAt: number;
}

/**
 * Project payload returned by the API.
 * @public
 */
export interface ProjectWithStats extends Project {
  /** Aggregated issue stats for the project */
  stats: ProjectStats;
}

/**
 * Filter inputs accepted by the issue listing API.
 * @public
 */
export interface IssueListParams {
  /** Filter by project */
  projectId?: string;
  /** Filter by issue status */
  status?: IssueStatus | 'all';
  /** Filter by issue priority */
  priority?: IssuePriority | 'all';
  /** Free-text search */
  search?: string;
  /** Maximum page size */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Payload for creating an issue.
 * @public
 */
export interface CreateIssueInput {
  /** Target project ID */
  projectId: string;
  /** Issue title */
  title: string;
  /** Optional issue description */
  description?: string;
  /** Issue priority */
  priority: IssuePriority;
  /** Initial issue status */
  status: IssueStatus;
}

/**
 * Payload for updating an issue.
 * @public
 */
export interface UpdateIssueInput {
  /** Updated title */
  title?: string;
  /** Updated description */
  description?: string;
  /** Updated status */
  status?: IssueStatus;
  /** Updated priority */
  priority?: IssuePriority;
}

/**
 * Project list response payload.
 * @internal
 */
interface ProjectsResponse {
  success: boolean;
  projects?: ProjectWithStats[];
  error?: string;
}

/**
 * Issue list response payload.
 * @internal
 */
interface IssuesResponse {
  success: boolean;
  issues?: Array<
    Omit<Issue, 'createdAt' | 'updatedAt'> & {
      createdAt: string;
      updatedAt: string;
    }
  >;
  totalCount?: number;
  limit?: number;
  offset?: number;
  error?: string;
}

/**
 * Mutation response payload.
 * @internal
 */
interface MutationResponse {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * Result returned by mutation endpoints.
 * I propagate non-fatal warnings so the UI can surface operational issues without failing the action.
 * @public
 */
export interface MutationResult {
  /** Optional non-fatal warning emitted by the backend */
  warning: string | null;
}

/**
 * Base URL for the local API.
 * @internal
 */
const API_BASE = (import.meta.env.VITE_KARYA_API_URL ?? '/api').replace(/\/$/, '');

/**
 * Loads the list of configured projects and their stats.
 *
 * @returns Projects plus a stats lookup map
 * @public
 */
export async function fetchProjects(): Promise<{
  projects: Project[];
  stats: Record<string, ProjectStats>;
}> {
  const payload = await request<ProjectsResponse>('/projects');
  if (!payload.success || !payload.projects) {
    throw new Error(payload.error ?? 'Failed to load projects');
  }

  const stats = Object.fromEntries(
    payload.projects.map((project) => [project.id, project.stats])
  );

  return {
    projects: payload.projects.map(({ stats: _stats, ...project }) => project),
    stats,
  };
}

/**
 * Loads a page of issues from the API.
 *
 * @param params - Query filters and pagination
 * @returns Normalized issues plus total count metadata
 * @public
 */
export async function fetchIssues(
  params: IssueListParams
): Promise<{ issues: Issue[]; totalCount: number }> {
  const searchParams = new URLSearchParams();

  if (params.projectId) {
    searchParams.set('projectId', params.projectId);
  }
  if (params.status && params.status !== 'all') {
    searchParams.set('status', params.status);
  }
  if (params.priority && params.priority !== 'all') {
    searchParams.set('priority', params.priority);
  }
  if (params.search?.trim()) {
    searchParams.set('search', params.search.trim());
  }
  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }
  if (params.offset) {
    searchParams.set('offset', String(params.offset));
  }

  const query = searchParams.toString();
  const payload = await request<IssuesResponse>(`/issues${query ? `?${query}` : ''}`);
  if (!payload.success || !payload.issues) {
    throw new Error(payload.error ?? 'Failed to load issues');
  }

  return {
    issues: payload.issues.map(normalizeIssue),
    totalCount: payload.totalCount ?? 0,
  };
}

/**
 * Creates a new issue through the API.
 *
 * @param input - Issue creation payload
 * @public
 */
export async function createIssue(input: CreateIssueInput): Promise<MutationResult> {
  const payload = await request<MutationResponse>('/issues', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to create issue');
  }

  return { warning: payload.warning ?? null };
}

/**
 * Updates an existing issue through the API.
 *
 * @param issueId - Issue identifier
 * @param input - Partial issue update payload
 * @public
 */
export async function updateIssue(
  issueId: string,
  input: UpdateIssueInput
): Promise<MutationResult> {
  const payload = await request<MutationResponse>(`/issues/${encodeURIComponent(issueId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to update issue');
  }

  return { warning: payload.warning ?? null };
}

/**
 * Deletes an issue through the API.
 *
 * @param issueId - Issue identifier
 * @public
 */
export async function deleteIssue(issueId: string): Promise<MutationResult> {
  const payload = await request<MutationResponse>(`/issues/${encodeURIComponent(issueId)}`, {
    method: 'DELETE',
  });

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to delete issue');
  }

  return { warning: payload.warning ?? null };
}

/**
 * Performs a JSON HTTP request against the local API.
 *
 * @param path - API path beginning with `/`
 * @param init - Fetch init overrides
 * @returns Parsed JSON response
 * @internal
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T;
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

/**
 * Converts API issue timestamps into epoch milliseconds for the UI.
 *
 * @param issue - API issue payload
 * @returns Normalized issue
 * @internal
 */
function normalizeIssue(
  issue: Omit<Issue, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  }
): Issue {
  return {
    ...issue,
    createdAt: Date.parse(issue.createdAt),
    updatedAt: Date.parse(issue.updatedAt),
  };
}
