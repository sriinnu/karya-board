/**
 * Main App component for the Karya UI.
 * I keep the shell layout and top-level data orchestration here.
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { AddIssueModal } from './components/AddIssueModal';
import { IssueBoard } from './components/IssueBoard';
import { ProjectList } from './components/ProjectList';
import { useStore } from './store';

/**
 * Main application component.
 * Sets up the application shell and data loading.
 * @public
 */
function App() {
  const {
    projects,
    loadProjects,
    loadIssues,
    refresh,
    clearWarning,
    ui,
  } = useStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const selectedProjectName = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'All Projects';
  const hasNoProjects = projects.length === 0;

  /**
   * I keep refresh behavior in one place so loading indicators stay consistent.
   * @internal
   */
  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  /**
   * I load projects once at startup.
   * @internal
   */
  useEffect(() => {
    void loadProjects().catch(() => undefined);
  }, [loadProjects]);

  /**
   * I reload issues when filters or pagination change.
   * @internal
   */
  useEffect(() => {
    void loadIssues().catch(() => undefined);
  }, [
    loadIssues,
    ui.selectedProjectId,
    ui.statusFilter,
    ui.priorityFilter,
    ui.search,
    ui.page,
    ui.pageSize,
  ]);

  return (
    <div className="app-container">
      <a href="#workspace-content" className="skip-link">
        Skip to board content
      </a>
      <div className="sr-only" aria-live="polite">
        {ui.isLoading
          ? 'Workspace is loading'
          : ui.error
            ? `Workspace error: ${ui.error}`
            : ui.warning
              ? `Workspace warning: ${ui.warning}`
            : 'Workspace loaded'}
      </div>
      <Header
        onAddIssue={() => setShowAddModal(true)}
        onRefresh={() => {
          void handleRefresh().catch(() => undefined);
        }}
        disableAddIssue={hasNoProjects}
        isSyncing={ui.isLoading || isRefreshing}
        hasWarning={Boolean(ui.warning)}
        projectCount={projects.length}
        selectedProjectName={selectedProjectName}
      />

      <main id="workspace-content" className="app-main" tabIndex={-1} aria-busy={ui.isLoading}>
        <aside className="sidebar">
          <ProjectList />
        </aside>

        <section className="content-area">
          {ui.warning && (
            <div className="surface-panel notice-panel notice-warning">
              <div className="state-title-row">
                <div className="state-icon state-icon-warning" aria-hidden="true">
                  !
                </div>
                <div className="space-y-md">
                  <p className="hero-kicker">Sync Warning</p>
                  <h2 className="font-semibold">Your update saved, but board sync had an issue</h2>
                </div>
              </div>
              <p className="notice-copy" role="status">{ui.warning}</p>
              <div className="notice-actions">
                <button
                  type="button"
                  onClick={clearWarning}
                  className="btn btn-secondary"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {ui.isLoading ? (
            <div className="surface-panel loading-panel">
              <div className="state-title-row">
                <div className="state-icon" aria-hidden="true">
                  <div className="spinner" />
                </div>
                <div className="space-y-md">
                  <p className="hero-kicker">Synchronizing</p>
                  <h2 className="font-semibold">Refreshing your workspace</h2>
                </div>
              </div>
              <p className="loading-copy">
                I am pulling the latest issues, project totals, and current filters into the board.
              </p>
              <div className="loading-skeleton-list" aria-hidden="true">
                <div className="loading-skeleton loading-skeleton-wide" />
                <div className="loading-skeleton loading-skeleton-mid" />
                <div className="loading-skeleton loading-skeleton-tight" />
              </div>
            </div>
          ) : ui.error ? (
            <div className="surface-panel notice-panel notice-error">
              <div className="state-title-row">
                <div className="state-icon state-icon-error" aria-hidden="true">
                  !
                </div>
                <div className="space-y-md">
                  <p className="hero-kicker">Workspace Error</p>
                  <h2 className="font-semibold">The board could not finish loading</h2>
                </div>
              </div>
              <p className="notice-copy" role="alert">{ui.error}</p>
              <p className="notice-hint">
                Verify the local API and scanner are running, then retry to repopulate project and
                issue state.
              </p>
              <div className="notice-actions">
                <button
                  type="button"
                  onClick={() => {
                    void handleRefresh().catch(() => undefined);
                  }}
                  className="btn btn-secondary"
                  disabled={isRefreshing}
                  aria-busy={isRefreshing}
                >
                  {isRefreshing ? 'Retrying...' : 'Try Again'}
                </button>
              </div>
            </div>
          ) : (
            <IssueBoard />
          )}
        </section>
      </main>

      {showAddModal && (
        <AddIssueModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}

export default App;
