/**
 * Zustand store for Karya UI state management.
 * I keep API orchestration here so the components stay mostly declarative.
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
 * UI state for filters, pagination, and request status.
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
  /** Updates an issue then refreshes board data */
  updateIssue: (issueId: string, updates: UpdateIssueInput) => Promise<void>;
  /** Deletes an issue then refreshes board data */
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
}

/**
 * Shared initial UI state.
 * @internal
 */
const INITIAL_UI_STATE: UIState = {
  selectedProjectId: null,
  statusFilter: 'all',
  priorityFilter: 'all',
  search: '',
  page: 1,
  pageSize: 20,
  totalCount: 0,
  isLoading: false,
  error: null,
  warning: null,
};

/**
 * Monotonic request token for issue-list loads.
 * I use it to ensure late responses cannot overwrite fresher UI state.
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
    set((state) => ({
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
      await get().refresh();
    } catch (error) {
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
    set((state) => ({
      ui: {
        ...state.ui,
        error: null,
        warning: null,
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
      const lastItemOnPage = issues.length === 1 && ui.page > 1;
      if (lastItemOnPage) {
        set((state) => ({
          ui: {
            ...state.ui,
            page: state.ui.page - 1,
          },
        }));
      }

      await get().refresh();
    } catch (error) {
      set((state) => ({
        ui: {
          ...state.ui,
          error: error instanceof Error ? error.message : 'Failed to delete issue',
        },
      }));
      throw error;
    }
  },

  setSelectedProject: (projectId) =>
    set((state) => ({
      ui: {
        ...state.ui,
        selectedProjectId: projectId,
        page: 1,
      },
    })),

  setStatusFilter: (status) =>
    set((state) => ({
      ui: {
        ...state.ui,
        statusFilter: status,
        page: 1,
      },
    })),

  setPriorityFilter: (priority) =>
    set((state) => ({
      ui: {
        ...state.ui,
        priorityFilter: priority,
        page: 1,
      },
    })),

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
}));
