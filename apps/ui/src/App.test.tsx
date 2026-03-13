/**
 * App-level warning rendering tests for Karya.
 * I verify that non-fatal sync warnings stay visible in the shell and can be dismissed.
 * @packageDocumentation
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const appStoreMock = vi.hoisted(() => ({
  current: createStoreFixture(),
}));

vi.mock('./store', () => ({
  useStore: () => appStoreMock.current,
}));

vi.mock('./components/Header', () => ({
  Header: ({ hasWarning }: { hasWarning?: boolean }) => (
    <div data-testid="header-warning-state">{hasWarning ? 'warning' : 'clear'}</div>
  ),
}));

vi.mock('./components/ProjectList', () => ({
  ProjectList: () => <div>Project rail</div>,
}));

vi.mock('./components/IssueBoard', () => ({
  IssueBoard: () => <div>Issue board</div>,
}));

vi.mock('./components/AddIssueModal', () => ({
  AddIssueModal: () => <div>Modal</div>,
}));

/**
 * Creates a stable mocked store payload for App rendering tests.
 * @returns Minimal store contract consumed by App
 * @internal
 */
function createStoreFixture() {
  return {
    projects: [
      {
        id: 'project-1',
        name: 'Project One',
        path: '/tmp/project-one',
        createdAt: Date.now(),
      },
    ],
    loadProjects: vi.fn().mockResolvedValue(undefined),
    loadIssues: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    clearWarning: vi.fn(),
    ui: {
      selectedProjectId: null,
      statusFilter: 'all',
      priorityFilter: 'all',
      search: '',
      page: 1,
      pageSize: 20,
      totalCount: 1,
      isLoading: false,
      error: null,
      warning: 'BOARD.md sync finished with a warning.',
    },
  };
}

describe('App warning shell', () => {
  beforeEach(() => {
    appStoreMock.current = createStoreFixture();
  });

  it('renders the warning banner and routes dismiss through the store', () => {
    render(<App />);

    expect(screen.getByText('Sync Warning')).toBeInTheDocument();
    expect(screen.getByText('Your update saved, but board sync had an issue')).toBeInTheDocument();
    expect(screen.getByTestId('header-warning-state')).toHaveTextContent('warning');

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(appStoreMock.current.clearWarning).toHaveBeenCalledTimes(1);
  });
});
