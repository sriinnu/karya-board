/**
 * Zustand store for Karya UI state management.
 * Orchestrates API calls, optimistic updates, filter persistence, and bulk actions.
 * @packageDocumentation
 */

import type {
  IssuePriority,
  IssueStatus,
  ProjectStats,
} from '@karya/core';
import { create } from 'zustand';
import {
  createIssue as createIssueRequest,
  deleteIssue as deleteIssueRequest,
  fetchIssues,
  fetchProjects,
  type CreateIssueInput,
  type Issue,
  type ProjectOverview,
  type UpdateIssueInput,
  updateIssue as updateIssueRequest,
} from '../api';

export type {
  CreateIssueInput,
  Issue,
  IssuePriority,
  IssueStatus,
  ProjectOverview,
  ProjectStats,
  UpdateIssueInput,
};

/**
 * UI state for filters, pagination, view modes, and request status.
 * @public
 */
export interface UIState {
  /** Currently selected project ID */
  selectedProjectId: string | null;
  /** Current status filter */
  statusFilter: IssueStatus | 'all';
  /** Current priority filter */
  priorityFilter: IssuePriority | 'all';
  /** Free-text search input */
  search: string;
  /** One-based page number */
  page: number;
  /** Number of rows per page */
  pageSize: number;
  /** Total rows matching the current filters */
  totalCount: number;
  /** Loading state for issue queries */
  isLoading: boolean;
  /** Latest user-visible error */
  error: string | null;
  /** Latest non-fatal backend warning */
  warning?: string | null;
  /** Board view mode: priority lanes or flat list */
  viewMode: 'lanes' | 'list';
  /** Sort order within lanes or list */
  sortOrder: 'newest' | 'oldest' | 'alpha';
  /** Whether focus/zen mode hides secondary panels */
  isFocusMode: boolean;
  /** Currently selected issue IDs for bulk actions */
  selectedIssueIds: string[];
}

/**
 * Full application state.
 * @public
 */
interface AppState {
  /** Known projects */
  projects: ProjectOverview[];
  /** Current page of issues */
  issues: Issue[];
  /** Aggregated stats by project ID */
  stats: Record<string, ProjectStats>;
  /** UI state */
  ui: UIState;
  /** Loads projects and project stats */
  loadProjects: () => Promise<void>;
  /** Loads the current issue page using active filters */
  loadIssues: () => Promise<void>;
  /** Reloads projects and issues together */
  refresh: () => Promise<void>;
  /** Creates a new issue then refreshes board data */
  createIssue: (input: CreateIssueInput) => Promise<void>;
  /** Updates an issue with optimistic local update */
  updateIssue: (issueId: string, updates: UpdateIssueInput) => Promise<void>;
  /** Deletes an issue with optimistic local removal */
  deleteIssue: (issueId: string) => Promise<void>;
  /** Selects the active project filter */
  setSelectedProject: (projectId: string | null) => void;
  /** Selects the active status filter */
  setStatusFilter: (status: IssueStatus | 'all') => void;
  /** Selects the active priority filter */
  setPriorityFilter: (priority: IssuePriority | 'all') => void;
  /** Updates the free-text search filter */
  setSearch: (search: string) => void;
  /** Changes the active page */
  setPage: (page: number) => void;
  /** Changes the page size and resets pagination */
  setPageSize: (pageSize: number) => void;
  /** Clears or sets the latest UI error */
  setError: (error: string | null) => void;
  /** Sets the latest non-fatal backend warning */
  setWarning: (warning: string | null) => void;
  /** Clears the latest non-fatal backend warning */
  clearWarning: () => void;
  /** Switches board view mode */
  setViewMode: (mode: 'lanes' | 'list') => void;
  /** Changes the sort order */
  setSortOrder: (order: 'newest' | 'oldest' | 'alpha') => void;
  /** Toggles focus/zen mode */
  toggleFocusMode: () => void;
  /** Toggles an issue in the multi-selection set */
  toggleIssueSelection: (issueId: string) => void;
  /** Clears all selected issues */
  clearSelection: () => void;
  /** Bulk-updates status on all selected issues */
  bulkUpdateStatus: (status: IssueStatus) => Promise<void>;
}

/**
 * LocalStorage key for persisted filter state.
 * @internal
 */
const STORAGE_KEY = 'spanda-filters';

/**
 * Loads persisted filter preferences from localStorage.
 * @internal
 */
function loadPersistedFilters(): Partial<UIState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      selectedProjectId: typeof data.selectedProjectId === 'string' ? data.selectedProjectId : null,
      statusFilter: typeof data.statusFilter === 'string' ? (data.statusFilter as IssueStatus | 'all') : 'all',
      priorityFilter: typeof data.priorityFilter === 'string' ? (data.priorityFilter as IssuePriority | 'all') : 'all',
      viewMode: data.viewMode === 'list' ? 'list' : 'lanes',
      sortOrder: data.sortOrder === 'oldest' ? 'oldest' : data.sortOrder === 'alpha' ? 'alpha' : 'newest',
    };
  } catch {
    return {};
  }
}

/**
 * Persists filter preferences to localStorage.
 * @internal
 */
function persistFilters(ui: UIState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedProjectId: ui.selectedProjectId,
      statusFilter: ui.statusFilter,
      priorityFilter: ui.priorityFilter,
      viewMode: ui.viewMode,
      sortOrder: ui.sortOrder,
    }));
  } catch {
    /* Ignore storage failures */
  }
}

/**
 * Shared initial UI state merged with any persisted preferences.
 * @internal
 */
const persisted = loadPersistedFilters();
const INITIAL_UI_STATE: UIState = {
  selectedProjectId: persisted.selectedProjectId ?? null,
  statusFilter: persisted.statusFilter ?? 'all',
  priorityFilter: persisted.priorityFilter ?? 'all',
  search: '',
  page: 1,
  pageSize: 20,
  totalCount: 0,
  isLoading: false,
  error: null,
  warning: null,
  viewMode: persisted.viewMode ?? 'lanes',
  sortOrder: persisted.sortOrder ?? 'newest',
  isFocusMode: false,
  selectedIssueIds: [],
};

/**
 * Monotonic request token for issue-list loads.
 * Ensures late responses cannot overwrite fresher UI state.
 * @internal
 */
let latestIssueRequestId = 0;

/**
 * Creates the Zustand store for the Karya UI.
 * @public
 */
export const useStore = create<AppState>((set, get) => ({
  projects: [],
  issues: [],
  stats: {},
  ui: INITIAL_UI_STATE,

  loadProjects: async () => {
    try {
      const data = await fetchProjects();
      set({
        projects: data.projects,
        stats: data.stats,
      });
    } catch (error) {
      set((state) => ({
        ui: {
          ...state.ui,
          error: error instanceof Error ? error.message : 'Failed to load projects',
        },
      }));
      throw error;
    }
  },

  loadIssues: async () => {
    const { ui } = get();
    const requestId = ++latestIssueRequestId;
    set((state) => ({
      ui: {
        ...state.ui,
        isLoading: true,
        error: null,
      },
    }));

    try {
      const data = await fetchIssues({
        projectId: ui.selectedProjectId ?? undefined,
        status: ui.statusFilter,
        priority: ui.priorityFilter,
        search: ui.search,
        limit: ui.pageSize,
        offset: (ui.page - 1) * ui.pageSize,
      });

      if (requestId !== latestIssueRequestId) {
        return;
      }

      set((state) => ({
        issues: data.issues,
        ui: {
          ...state.ui,
          totalCount: data.totalCount,
          isLoading: false,
        },
      }));
    } catch (error) {
      if (requestId !== latestIssueRequestId) {
        return;
      }

      set((state) => ({
        issues: [],
        ui: {
          ...state.ui,
          totalCount: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load issues',
        },
      }));
      throw error;
    }
  },

  refresh: async () => {
    await get().loadProjects();
    await get().loadIssues();
  },

  createIssue: async (input) => {
    set((state) => ({
      ui: {
        ...state.ui,
        error: null,
        warning: null,
      },
    }));

    try {
      const result = await createIssueRequest(input);
      set((state) => ({
        ui: {
          ...state.ui,
          warning: result.warning ?? null,
        },
      }));
      await get().refresh();
    } catch (error) {
      set((state) => ({
        ui: {
          ...state.ui,
          error: error instanceof Error ? error.message : 'Failed to create issue',
        },
      }));
      throw error;
    }
  },

  updateIssue: async (issueId, updates) => {
    // Optimistic: apply changes locally before the network round-trip
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === issueId ? { ...issue, ...updates, updatedAt: Date.now() } : issue
      ),
      ui: {
        ...state.ui,
        error: null,
        warning: null,
      },
    }));

    try {
      const result = await updateIssueRequest(issueId, updates);
      set((state) => ({
        ui: {
          ...state.ui,
          warning: result.warning ?? null,
        },
      }));
      // Background refresh for full consistency
      void get().refresh().catch(() => undefined);
    } catch (error) {
      // Rollback on failure
      await get().refresh().catch(() => undefined);
      set((state) => ({
        ui: {
          ...state.ui,
          error: error instanceof Error ? error.message : 'Failed to update issue',
        },
      }));
      throw error;
    }
  },

  deleteIssue: async (issueId) => {
    // Optimistic: remove locally before the network round-trip
    set((state) => ({
      issues: state.issues.filter((issue) => issue.id !== issueId),
      ui: {
        ...state.ui,
        error: null,
        warning: null,
        totalCount: Math.max(0, state.ui.totalCount - 1),
        selectedIssueIds: state.ui.selectedIssueIds.filter((id) => id !== issueId),
      },
    }));

    try {
      const result = await deleteIssueRequest(issueId);
      set((state) => ({
        ui: {
          ...state.ui,
          warning: result.warning ?? null,
        },
      }));

      const { issues, ui } = get();
      if (issues.length === 0 && ui.page > 1) {
        set((state) => ({
          ui: { ...state.ui, page: state.ui.page - 1 },
        }));
      }

      void get().refresh().catch(() => undefined);
    } catch (error) {
      await get().refresh().catch(() => undefined);
      set((state) => ({
        ui: {
          ...state.ui,
          error: error instanceof Error ? error.message : 'Failed to delete issue',
        },
      }));
      throw error;
    }
  },

  setSelectedProject: (projectId) => {
    set((state) => {
      const next = { ...state.ui, selectedProjectId: projectId, page: 1 };
      persistFilters(next);
      return { ui: next };
    });
  },

  setStatusFilter: (status) => {
    set((state) => {
      const next = { ...state.ui, statusFilter: status, page: 1 };
      persistFilters(next);
      return { ui: next };
    });
  },

  setPriorityFilter: (priority) => {
    set((state) => {
      const next = { ...state.ui, priorityFilter: priority, page: 1 };
      persistFilters(next);
      return { ui: next };
    });
  },

  setSearch: (search) =>
    set((state) => ({
      ui: {
        ...state.ui,
        search,
        page: 1,
      },
    })),

  setPage: (page) =>
    set((state) => ({
      ui: {
        ...state.ui,
        page: Math.max(1, page),
      },
    })),

  setPageSize: (pageSize) =>
    set((state) => ({
      ui: {
        ...state.ui,
        pageSize,
        page: 1,
      },
    })),

  setError: (error) =>
    set((state) => ({
      ui: {
        ...state.ui,
        error,
      },
    })),

  setWarning: (warning) =>
    set((state) => ({
      ui: {
        ...state.ui,
        warning,
      },
    })),

  clearWarning: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        warning: null,
      },
    })),

  setViewMode: (mode) => {
    set((state) => {
      const next = { ...state.ui, viewMode: mode };
      persistFilters(next);
      return { ui: next };
    });
  },

  setSortOrder: (order) => {
    set((state) => {
      const next = { ...state.ui, sortOrder: order };
      persistFilters(next);
      return { ui: next };
    });
  },

  toggleFocusMode: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        isFocusMode: !state.ui.isFocusMode,
      },
    })),

  toggleIssueSelection: (issueId) =>
    set((state) => {
      const current = state.ui.selectedIssueIds;
      const next = current.includes(issueId)
        ? current.filter((id) => id !== issueId)
        : [...current, issueId];
      return { ui: { ...state.ui, selectedIssueIds: next } };
    }),

  clearSelection: () =>
    set((state) => ({
      ui: { ...state.ui, selectedIssueIds: [] },
    })),

  bulkUpdateStatus: async (status) => {
    const { ui } = get();
    const ids = [...ui.selectedIssueIds];
    if (ids.length === 0) return;

    // Optimistic: update all selected locally
    set((state) => ({
      issues: state.issues.map((issue) =>
        ids.includes(issue.id) ? { ...issue, status, updatedAt: Date.now() } : issue
      ),
      ui: { ...state.ui, selectedIssueIds: [], error: null },
    }));

    try {
      await Promise.all(ids.map((id) => updateIssueRequest(id, { status })));
      void get().refresh().catch(() => undefined);
    } catch {
      await get().refresh().catch(() => undefined);
    }
  },
}));
