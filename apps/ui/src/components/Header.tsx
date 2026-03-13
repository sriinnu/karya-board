/**
 * Header component for the Karya application shell.
 * I keep workspace identity and primary actions here.
 * @packageDocumentation
 */

interface HeaderProps {
  /** Callback when add issue button is clicked */
  onAddIssue: () => void;
  /** Callback when refresh button is clicked */
  onRefresh: () => void;
  /** Whether creating issues is currently allowed */
  disableAddIssue?: boolean;
  /** Number of configured projects */
  projectCount: number;
  /** Current project scope label */
  selectedProjectName: string;
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
  onRefresh,
  disableAddIssue = false,
  projectCount,
  selectedProjectName,
  isSyncing = false,
  hasWarning = false,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header-brand-block">
        <div className="header-brand">
          <div className="logo-mark" aria-hidden="true">
            K
          </div>
          <div>
            <p className="header-kicker">Local Issue Intelligence</p>
            <h1 className="header-title">Karya Board</h1>
          </div>
        </div>
        <p className="header-subtitle">
          A calmer surface for scanner discoveries, manual triage, and BOARD generation.
        </p>
      </div>

      <div className="header-side">
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
          <span className="context-pill context-pill-primary">{selectedProjectName}</span>
          <span className="context-pill">
            {projectCount} project{projectCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="header-actions">
          <button
            type="button"
            onClick={onRefresh}
            className="btn btn-secondary"
            disabled={isSyncing}
            aria-busy={isSyncing}
          >
            {isSyncing ? 'Syncing...' : 'Sync'}
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
    </header>
  );
}
