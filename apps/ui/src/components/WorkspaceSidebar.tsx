/**
 * Composite sidebar shell for the Spanda dashboard.
 * I keep navigation, quick commands, and project scope selection together here.
 * @packageDocumentation
 */

import { ProjectList } from './ProjectList';
import { useStore, type ProjectStats } from '../store';

/**
 * Sidebar action callbacks.
 * @public
 */
interface WorkspaceSidebarProps {
  /** Opens the create-issue modal */
  onAddIssue: () => void;
  /** Opens the AI review flow */
  onSuggestIssues: () => void;
  /** Opens the scan-settings modal */
  onEditScanSettings: () => void;
  /** Opens the project management modal */
  onManageProjects?: () => void;
  /** Whether issue creation is disabled */
  disableAddIssue?: boolean;
  /** Whether AI review is disabled */
  disableSuggestIssues?: boolean;
  /** Whether settings are disabled */
  disableScanSettings?: boolean;
}

/**
 * Empty stats object used for aggregate calculations.
 * @internal
 */
const EMPTY_STATS: ProjectStats = {
  total: 0,
  open: 0,
  inProgress: 0,
  done: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
};

/**
 * Full sidebar for the dashboard shell.
 * @param props - Component props
 * @public
 */
export function WorkspaceSidebar({
  onAddIssue,
  onSuggestIssues,
  onEditScanSettings,
  disableAddIssue = false,
  disableSuggestIssues = false,
  disableScanSettings = false,
  onManageProjects,
}: WorkspaceSidebarProps) {
  const { projects, ui } = useStore();
  const stats = projects.reduce<ProjectStats>(
    (acc, project) => ({
      total: acc.total + project.stats.total,
      open: acc.open + project.stats.open,
      inProgress: acc.inProgress + project.stats.inProgress,
      done: acc.done + project.stats.done,
      critical: acc.critical + project.stats.critical,
      high: acc.high + project.stats.high,
      medium: acc.medium + project.stats.medium,
      low: acc.low + project.stats.low,
    }),
    EMPTY_STATS
  );
  const documentedProjects = projects.filter((project) => project.analytics.docsCount > 0).length;
  const activeLens = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'Portfolio';
  const menuItems = [
    {
      href: '#dashboard-overview',
      label: 'Deck',
      value: `${projects.length}`,
      note: 'Portfolio overview decks',
    },
    {
      href: '#board-workspace',
      label: 'Board',
      value: `${stats.open}`,
      note: 'Open execution lanes',
    },
    {
      href: '#project-intel',
      label: 'Docs',
      value: `${documentedProjects}`,
      note: 'Projects with surfaced docs',
    },
    {
      href: '#live-tape',
      label: 'Tape',
      value: `${stats.critical + stats.high}`,
      note: 'Urgent signal feed',
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand-panel">
        <p className="sidebar-script">Spanda</p>
        <p className="sidebar-brand-copy">
          A project cockpit for architecture, docs, signal, and execution.
        </p>
        <div className="sidebar-brand-pills">
          <span className="sidebar-brand-pill">{activeLens}</span>
          <span className="sidebar-brand-pill">{stats.inProgress} moving now</span>
        </div>
      </div>

      <nav className="sidebar-menu" aria-label="Dashboard sections">
        {menuItems.map((item) => (
          <a key={item.href} href={item.href} className="sidebar-menu-card">
            <div className="sidebar-menu-row">
              <span className="sidebar-menu-label">{item.label}</span>
              <strong className="sidebar-menu-value">{item.value}</strong>
            </div>
            <span className="sidebar-menu-note">{item.note}</span>
          </a>
        ))}
      </nav>

      <div className="sidebar-command-panel">
        <div className="sidebar-command-copy">
          <p className="sidebar-command-kicker">Quick Commands</p>
          <p className="sidebar-command-note">
            High-frequency actions stay in the rail.
          </p>
        </div>
        <div className="sidebar-command-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onEditScanSettings}
            disabled={disableScanSettings}
          >
            Scan Rules
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSuggestIssues}
            disabled={disableSuggestIssues}
          >
            Review AI
            <kbd className="btn-kbd">A</kbd>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAddIssue}
            disabled={disableAddIssue}
          >
            Capture Issue
            <kbd className="btn-kbd">N</kbd>
          </button>
        </div>
      </div>

      <details open className="sidebar-collapsible">
        <summary className="sidebar-collapsible-toggle">
          <span className="sidebar-title">Projects</span>
          <span className="sidebar-collapsible-count">{projects.length}</span>
        </summary>
        <ProjectList />
        {onManageProjects && (
          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={onManageProjects}
            style={{ marginTop: '10px', justifyContent: 'center', minHeight: '38px', fontSize: '0.84rem' }}
          >
            Manage Projects
          </button>
        )}
      </details>
    </aside>
  );
}
