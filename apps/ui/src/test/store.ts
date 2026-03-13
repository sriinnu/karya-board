import { useStore } from '../store';

/**
 * Resets the shared Zustand store to a clean UI baseline for tests.
 * I intentionally preserve bound action functions by partial-updating state.
 */
export function resetStoreForTest(): void {
  useStore.setState({
    projects: [],
    issues: [],
    stats: {},
    ui: {
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
    },
  });
}
