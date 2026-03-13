import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../api';
import { useStore } from './index';
import { resetStoreForTest } from '../test/store';

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  fetchIssues: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchProjects: apiMocks.fetchProjects,
  fetchIssues: apiMocks.fetchIssues,
  createIssue: apiMocks.createIssue,
  updateIssue: apiMocks.updateIssue,
  deleteIssue: apiMocks.deleteIssue,
}));

/**
 * Deferred promise container for deterministic async race tests.
 * @internal
 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * Creates a deferred promise whose resolution can be controlled by the test.
 * @returns Deferred promise container
 * @internal
 */
function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

/**
 * Creates a minimal test issue payload.
 * @param id - Issue ID suffix
 * @param title - Issue title
 * @returns Issue object with required fields
 * @internal
 */
function createIssueFixture(id: string, title: string): Issue {
  return {
    id,
    projectId: 'project-1',
    title,
    description: null,
    status: 'open',
    priority: 'medium',
    source: 'manual',
    sourceFile: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectName: 'Project One',
  };
}

describe('useStore.loadIssues', () => {
  beforeEach(() => {
    resetStoreForTest();
    apiMocks.fetchProjects.mockReset();
    apiMocks.fetchIssues.mockReset();
    apiMocks.createIssue.mockReset();
    apiMocks.updateIssue.mockReset();
    apiMocks.deleteIssue.mockReset();
  });

  it('keeps the latest issue payload when an older request resolves afterward', async () => {
    const first = createDeferred<{ issues: Issue[]; totalCount: number }>();
    const second = createDeferred<{ issues: Issue[]; totalCount: number }>();
    apiMocks.fetchIssues
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    useStore.getState().setSearch('first');
    const olderRequest = useStore.getState().loadIssues();

    useStore.getState().setSearch('second');
    const latestRequest = useStore.getState().loadIssues();

    second.resolve({
      issues: [createIssueFixture('issue-new', 'Latest issue')],
      totalCount: 1,
    });
    await latestRequest;

    first.resolve({
      issues: [createIssueFixture('issue-old', 'Stale issue')],
      totalCount: 1,
    });
    await olderRequest;

    const state = useStore.getState();
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0].id).toBe('issue-new');
    expect(state.issues[0].title).toBe('Latest issue');
    expect(state.ui.totalCount).toBe(1);
    expect(state.ui.isLoading).toBe(false);
    expect(state.ui.error).toBeNull();
  });
});

describe('useStore mutation warnings', () => {
  beforeEach(() => {
    resetStoreForTest();
    apiMocks.fetchProjects.mockReset();
    apiMocks.fetchIssues.mockReset();
    apiMocks.createIssue.mockReset();
    apiMocks.updateIssue.mockReset();
    apiMocks.deleteIssue.mockReset();
    apiMocks.fetchProjects.mockResolvedValue({ projects: [], stats: {} });
    apiMocks.fetchIssues.mockResolvedValue({ issues: [], totalCount: 0 });
  });

  it('replaces a stale warning with the latest mutation result', async () => {
    apiMocks.createIssue
      .mockResolvedValueOnce({ warning: 'Board sync lagged behind the save.' })
      .mockResolvedValueOnce({ warning: null });

    useStore.setState((state) => ({
      ...state,
      ui: {
        ...state.ui,
        warning: 'Older warning',
      },
    }));

    await useStore.getState().createIssue({
      projectId: 'project-1',
      title: 'Warning path',
      priority: 'high',
      status: 'open',
    });
    expect(useStore.getState().ui.warning).toBe('Board sync lagged behind the save.');

    await useStore.getState().createIssue({
      projectId: 'project-1',
      title: 'Clean path',
      priority: 'high',
      status: 'open',
    });
    expect(useStore.getState().ui.warning).toBeNull();
  });
});
