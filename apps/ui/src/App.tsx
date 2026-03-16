/**
 * Main App component for the Karya UI.
 * Shell layout, data orchestration, keyboard shortcuts, command palette, and focus mode.
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchScannerStatus,
  restartScanner,
  startScanner,
  type ScannerStatus,
} from './api';
import { Header } from './components/Header';
import { AddIssueModal } from './components/AddIssueModal';
import { CommandPalette } from './components/CommandPalette';
import { DashboardOverview } from './components/DashboardOverview';
import { Footer } from './components/Footer';
import { IssueBoard } from './components/IssueBoard';
import { ProjectManageModal } from './components/ProjectManageModal';
import { ProjectIntelligencePanel } from './components/ProjectIntelligencePanel';
import { ScanSettingsModal } from './components/ScanSettingsModal';
import { ScrollProgress } from './components/ScrollProgress';
import { SignalMarquee } from './components/SignalMarquee';
import { SuggestIssuesModal } from './components/SuggestIssuesModal';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { useStore } from './store';

/**
 * Main application component.
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
    setSelectedProject,
    setStatusFilter,
    setPriorityFilter,
    toggleFocusMode,
  } = useStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanSettingsModal, setShowScanSettingsModal] = useState(false);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showProjectManage, setShowProjectManage] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);
  const [isScannerMutating, setIsScannerMutating] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' }>>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = String(++toastIdRef.current);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const selectedProjectName = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'All Projects';
  const hasNoProjects = projects.length === 0;
  const scannerRunning = scannerStatus?.running ?? false;
  const anyModalOpen = showAddModal || showSuggestModal || showScanSettingsModal || showCommandPalette || showProjectManage;

  const loadScannerState = async (): Promise<void> => {
    const nextStatus = await fetchScannerStatus();
    setScannerStatus(nextStatus);
  };

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await Promise.all([refresh(), loadScannerState()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleScannerAction = async (): Promise<void> => {
    setIsScannerMutating(true);
    try {
      setError(null);
      const nextStatus = scannerRunning ? await restartScanner() : await startScanner();
      setScannerStatus(nextStatus);
      await refresh();
      addToast(scannerRunning ? 'Scanner restarted' : 'Scanner started', 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to control the scanner';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setIsScannerMutating(false);
    }
  };

  /** Dynamic page title showing open issue count */
  useEffect(() => {
    const count = ui.totalCount;
    document.title = count > 0 ? `Spanda (${count})` : 'Spanda | Karya Issue Board';
  }, [ui.totalCount]);

  /** Global keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (anyModalOpen) return;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !hasNoProjects) { e.preventDefault(); setShowAddModal(true); return; }
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void handleRefresh().catch(() => undefined); return; }
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !hasNoProjects) { e.preventDefault(); setShowSuggestModal(true); return; }
      if (e.key === '?') { e.preventDefault(); setShowCommandPalette(true); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [anyModalOpen, hasNoProjects, toggleFocusMode]);

  useEffect(() => {
    void loadProjects().catch(() => undefined);
  }, [loadProjects]);

  useEffect(() => {
    void loadScannerState().catch(() => undefined);
  }, []);

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

  /** Breadcrumb scope trail */
  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Current scope">
      <button type="button" onClick={() => { setSelectedProject(null); setStatusFilter('all'); setPriorityFilter('all'); }}>
        Portfolio
      </button>
      {ui.selectedProjectId && (
        <>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">{selectedProjectName}</span>
        </>
      )}
      {ui.statusFilter !== 'all' && (
        <>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">
            {ui.statusFilter === 'in_progress' ? 'In Progress' : ui.statusFilter.charAt(0).toUpperCase() + ui.statusFilter.slice(1)}
          </span>
        </>
      )}
      {ui.priorityFilter !== 'all' && (
        <>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">
            {ui.priorityFilter.charAt(0).toUpperCase() + ui.priorityFilter.slice(1)}
          </span>
        </>
      )}
    </nav>
  );

  return (
    <div className="app-container">
      <ScrollProgress />
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
      <div className={`app-shell${ui.isFocusMode ? ' focus-mode' : ''}`}>
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
            onManageProjects={() => setShowProjectManage(true)}
            disableAddIssue={hasNoProjects}
            disableScanSettings={hasNoProjects}
            disableSuggestIssues={hasNoProjects}
          />

          <section className="content-area content-stack">
            {breadcrumb}

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
                  Pulling the latest issues, project totals, and current filters into the board.
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

      <Footer />

      {showAddModal && (
        <AddIssueModal onClose={() => setShowAddModal(false)} />
      )}
      {showScanSettingsModal && (
        <ScanSettingsModal onClose={() => setShowScanSettingsModal(false)} />
      )}
      {showSuggestModal && (
        <SuggestIssuesModal onClose={() => setShowSuggestModal(false)} />
      )}
      {showProjectManage && (
        <ProjectManageModal onClose={() => setShowProjectManage(false)} />
      )}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onAddIssue={() => setShowAddModal(true)}
          onSuggestIssues={() => setShowSuggestModal(true)}
          onRefresh={() => { void handleRefresh().catch(() => undefined); }}
          onScannerAction={() => { void handleScannerAction().catch(() => undefined); }}
          onManageProjects={() => setShowProjectManage(true)}
        />
      )}

      {ui.isFocusMode && (
        <button type="button" className="focus-exit-btn" onClick={toggleFocusMode}>
          Exit Focus Mode
          <kbd className="btn-kbd">&#8984;.</kbd>
        </button>
      )}

      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
