/**
 * Header component for the Karya application shell.
 * I keep workspace identity and primary actions here.
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';
import { BrandMark } from './BrandMark';

/**
 * Scroll distance after which I tighten the sticky header into island mode.
 * @internal
 */
const HEADER_CONDENSE_THRESHOLD = 72;

interface HeaderProps {
  /** Callback when add issue button is clicked */
  onAddIssue: () => void;
  /** Callback when native AI suggestions should open */
  onSuggestIssues: () => void;
  /** Callback when the embedded scanner should start or restart */
  onScannerAction: () => void;
  /** Callback when refresh button is clicked */
  onRefresh: () => void;
  /** Whether creating issues is currently allowed */
  disableAddIssue?: boolean;
  /** Whether native AI suggestions are currently allowed */
  disableSuggestIssues?: boolean;
  /** Number of configured projects */
  projectCount: number;
  /** Current project scope label */
  selectedProjectName: string;
  /** Whether the embedded scanner is currently running */
  isScannerRunning?: boolean;
  /** Whether scanner control is currently in flight */
  isScannerBusy?: boolean;
  /** Number of configured projects for scanner scope */
  scannerProjectCount?: number;
  /** Whether a workspace sync is active */
  isSyncing?: boolean;
  /** Whether a non-fatal backend warning is currently active */
  hasWarning?: boolean;
}

/**
 * Application header with branding, scope context, and main actions.
 * @param props - Component props
 * @public
 */
export function Header({
  onAddIssue,
  onSuggestIssues,
  onScannerAction,
  onRefresh,
  disableAddIssue = false,
  disableSuggestIssues = false,
  projectCount,
  selectedProjectName,
  isScannerRunning = false,
  isScannerBusy = false,
  scannerProjectCount = 0,
  isSyncing = false,
  hasWarning = false,
}: HeaderProps) {
  const [isCondensed, setIsCondensed] = useState(false);
  const workspaceStateLabel = isSyncing
    ? 'Updating now'
    : hasWarning
      ? 'Needs a quick review'
      : 'Stable and live';
  const runtimeNote = isScannerRunning
    ? `Scanner live across ${scannerProjectCount} project${scannerProjectCount === 1 ? '' : 's'}.`
    : 'Start the embedded scanner here to populate the board.';
  const glanceItems = [
    {
      label: 'Scope',
      value: selectedProjectName,
      note: 'Current lens',
    },
    {
      label: 'Portfolio',
      value: `${projectCount} project${projectCount === 1 ? '' : 's'}`,
      note: 'Configured',
    },
    {
      label: 'State',
      value: workspaceStateLabel,
      note: hasWarning ? 'Warning active' : 'Sync clear',
    },
  ];

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;

    /**
     * I sample the current scroll position and flip the compact island state.
     */
    const syncHeaderState = () => {
      frameId = 0;
      setIsCondensed(window.scrollY > HEADER_CONDENSE_THRESHOLD);
    };

    /**
     * I coalesce rapid scroll events into a single paint-friendly update.
     */
    const handleScroll = () => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(syncHeaderState);
    };

    syncHeaderState();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return (
    <header
      className={`header${isCondensed ? ' is-condensed' : ''}`}
      data-state={isCondensed ? 'condensed' : 'expanded'}
      aria-label="Workspace header"
    >
      <div className="header-top">
        <div className="header-brand-block">
          <div className="header-brand">
            <BrandMark variant="breathe" />
            <div className="header-title-block">
              <p className="header-kicker">Local Command Surface</p>
              <div className="header-wordmark-row">
                <h1 className="header-title">Spanda</h1>
                <span className="context-pill context-pill-brand">Karya runtime</span>
              </div>
              <p className="header-title-caption">
                Project architecture, docs, risk, and issue motion in one operating surface.
              </p>
            </div>
          </div>
          <p className="header-subtitle">Portfolio clarity without losing engineering depth.</p>
        </div>

        <div className="header-control-stack">
          <div className="header-badges">
            <span className={`context-pill context-pill-status ${isSyncing ? 'is-busy' : ''}`}>
              <span className="status-dot" aria-hidden="true" />
              {isSyncing ? 'Syncing' : 'Live'}
            </span>
            {hasWarning && (
              <span className="context-pill context-pill-warning" aria-live="polite">
                Warning
              </span>
            )}
            <span className={`context-pill ${isScannerRunning ? 'context-pill-scanner' : ''}`}>
              {isScannerRunning ? `Scanner On · ${scannerProjectCount}` : 'Scanner Off'}
            </span>
            <span className="context-pill context-pill-primary">{selectedProjectName}</span>
          </div>

          <div className="header-actions-frame">
            <div className="header-action-copy">
              <p className="header-action-kicker">Runtime</p>
              <p className="header-action-note">{runtimeNote}</p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                onClick={onScannerAction}
                className="btn btn-secondary"
                disabled={isScannerBusy}
                aria-busy={isScannerBusy}
              >
                {isScannerBusy
                  ? isScannerRunning
                    ? 'Restarting...'
                    : 'Starting...'
                  : isScannerRunning
                    ? 'Restart Scanner'
                    : 'Start Scanner'}
              </button>
              <button
                type="button"
                onClick={onRefresh}
                className="btn btn-secondary"
                disabled={isSyncing}
                aria-busy={isSyncing}
              >
                {isSyncing ? 'Syncing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={onSuggestIssues}
                className="btn btn-secondary"
                disabled={disableSuggestIssues}
                title={disableSuggestIssues ? 'Add a project to review AI suggestions' : undefined}
              >
                AI Review
              </button>
              <button
                type="button"
                onClick={onAddIssue}
                className="btn btn-primary"
                disabled={disableAddIssue}
                title={disableAddIssue ? 'Add a project to create issues' : undefined}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Issue
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="header-glance-grid" aria-label="Workspace summary">
        {glanceItems.map((item) => (
          <div key={item.label} className="header-glance-card">
            <span className="header-glance-label">{item.label}</span>
            <strong className="header-glance-value">{item.value}</strong>
            <span className="header-glance-note">{item.note}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
