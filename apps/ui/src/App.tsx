/**
 * Main App component for the Karya UI.
 * I keep the shell layout and top-level data orchestration here.
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';
import {
  fetchScannerStatus,
  restartScanner,
  startScanner,
  type ScannerStatus,
} from './api';
import { Header } from './components/Header';
import { AddIssueModal } from './components/AddIssueModal';
import { DashboardOverview } from './components/DashboardOverview';
import { IssueBoard } from './components/IssueBoard';
import { ProjectIntelligencePanel } from './components/ProjectIntelligencePanel';
import { ScanSettingsModal } from './components/ScanSettingsModal';
import { SignalMarquee } from './components/SignalMarquee';
import { SuggestIssuesModal } from './components/SuggestIssuesModal';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
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
    setError,
    ui,
  } = useStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanSettingsModal, setShowScanSettingsModal] = useState(false);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);
  const [isScannerMutating, setIsScannerMutating] = useState(false);
  const selectedProjectName = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'All Projects';
  const hasNoProjects = projects.length === 0;
  const scannerRunning = scannerStatus?.running ?? false;

  /**
   * I refresh embedded scanner state alongside normal board data.
   * @internal
   */
  const loadScannerState = async (): Promise<void> => {
    const nextStatus = await fetchScannerStatus();
    setScannerStatus(nextStatus);
  };

  /**
   * I keep refresh behavior in one place so loading indicators stay consistent.
   * @internal
   */
  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await Promise.all([refresh(), loadScannerState()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  /**
   * I start or restart the embedded scanner from the header control.
   * @internal
   */
  const handleScannerAction = async (): Promise<void> => {
    setIsScannerMutating(true);
    try {
      setError(null);
      const nextStatus = scannerRunning ? await restartScanner() : await startScanner();
      setScannerStatus(nextStatus);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to control the scanner');
    } finally {
      setIsScannerMutating(false);
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
   * I load embedded scanner state once so the header can expose a real control.
   * @internal
   */
  useEffect(() => {
    void loadScannerState().catch(() => undefined);
  }, []);

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
      <div className="app-shell">
        <Header
          onAddIssue={() => setShowAddModal(true)}
          onSuggestIssues={() => setShowSuggestModal(true)}
          onScannerAction={() => {
            void handleScannerAction().catch(() => undefined);
          }}
          onRefresh={() => {
            void handleRefresh().catch(() => undefined);
          }}
          disableAddIssue={hasNoProjects}
          disableSuggestIssues={hasNoProjects}
          isScannerRunning={scannerRunning}
          isScannerBusy={isScannerMutating}
          scannerProjectCount={scannerStatus?.projectCount ?? 0}
          isSyncing={ui.isLoading || isRefreshing}
          hasWarning={Boolean(ui.warning)}
          projectCount={projects.length}
          selectedProjectName={selectedProjectName}
        />

        <main id="workspace-content" className="app-main" tabIndex={-1} aria-busy={ui.isLoading}>
          <WorkspaceSidebar
            onAddIssue={() => setShowAddModal(true)}
            onEditScanSettings={() => setShowScanSettingsModal(true)}
            onSuggestIssues={() => setShowSuggestModal(true)}
            disableAddIssue={hasNoProjects}
            disableScanSettings={hasNoProjects}
            disableSuggestIssues={hasNoProjects}
          />

          <section className="content-area content-stack">
            <div id="live-tape">
              <SignalMarquee />
            </div>

            <div id="dashboard-overview">
              <DashboardOverview />
            </div>

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
              <div id="board-workspace" className="dashboard-workspace">
                <div className="dashboard-primary">
                  <IssueBoard />
                </div>
                <div id="project-intel" className="dashboard-secondary">
                  <ProjectIntelligencePanel
                    onEditScanSettings={() => setShowScanSettingsModal(true)}
                  />
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      {showAddModal && (
        <AddIssueModal onClose={() => setShowAddModal(false)} />
      )}
      {showScanSettingsModal && (
        <ScanSettingsModal onClose={() => setShowScanSettingsModal(false)} />
      )}
      {showSuggestModal && (
        <SuggestIssuesModal onClose={() => setShowSuggestModal(false)} />
      )}
    </div>
  );
}

export default App;
