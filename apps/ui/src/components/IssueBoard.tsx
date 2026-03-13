/**
 * Issue board component for the primary workspace surface.
 * I keep grouping, filtering, and page-level summary UI here.
 * @packageDocumentation
 */

import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { useStore, type Issue, type ProjectStats } from '../store';
import { IssueCard } from './IssueCard';

/**
 * Priority order for display.
 * @internal
 */
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Human-readable priority labels and descriptions.
 * @internal
 */
const PRIORITY_CONFIG: Record<string, { label: string; description: string }> = {
  critical: { label: 'Critical', description: 'Needs decisive attention immediately.' },
  high: { label: 'High', description: 'Important work that should move next.' },
  medium: { label: 'Medium', description: 'Useful improvements with moderate urgency.' },
  low: { label: 'Low', description: 'Smaller work that can wait for capacity.' },
};

/**
 * Empty stats object for aggregate calculations.
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
 * Status filter options.
 * @internal
 */
const STATUS_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
] as const;

/**
 * Priority filter options.
 * @internal
 */
const PRIORITY_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
] as const;

/**
 * Pagination density presets.
 * @internal
 */
const PAGE_SIZES = [10, 20, 50] as const;

/**
 * Main board component displaying issues organized by priority.
 * @public
 */
export function IssueBoard() {
  const {
    issues,
    projects,
    stats,
    ui,
    setStatusFilter,
    setPriorityFilter,
    setSearch,
    setPage,
    setPageSize,
  } = useStore();
  const [searchDraft, setSearchDraft] = useState(ui.search);
  const deferredSearch = useDeferredValue(searchDraft);
  const totalPages = Math.max(1, Math.ceil(ui.totalCount / ui.pageSize));
  const rangeStart = ui.totalCount === 0 ? 0 : (ui.page - 1) * ui.pageSize + 1;
  const rangeEnd = ui.totalCount === 0 ? 0 : Math.min(ui.totalCount, ui.page * ui.pageSize);
  const activeProjectName = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'All Projects';
  const scopeStats = ui.selectedProjectId
    ? stats[ui.selectedProjectId] ?? EMPTY_STATS
    : Object.values(stats).reduce<ProjectStats>(
        (acc, entry) => ({
          total: acc.total + entry.total,
          open: acc.open + entry.open,
          inProgress: acc.inProgress + entry.inProgress,
          done: acc.done + entry.done,
          critical: acc.critical + entry.critical,
          high: acc.high + entry.high,
          medium: acc.medium + entry.medium,
          low: acc.low + entry.low,
        }),
        EMPTY_STATS
      );
  const activeFilterCount = [
    ui.statusFilter !== 'all',
    ui.priorityFilter !== 'all',
    ui.search.trim().length > 0,
  ].filter(Boolean).length;

  /**
   * I keep the local search field synchronized with store state.
   * @internal
   */
  useEffect(() => {
    setSearchDraft(ui.search);
  }, [ui.search]);

  /**
   * I defer store writes while the search field is actively changing.
   * @internal
   */
  useEffect(() => {
    if (deferredSearch !== ui.search) {
      startTransition(() => {
        setSearch(deferredSearch);
      });
    }
  }, [deferredSearch, setSearch, ui.search]);

  const grouped = issues.reduce(
    (acc, issue) => {
      if (issue.status === 'done') {
        acc.done.push(issue);
      } else {
        acc.byPriority[issue.priority].push(issue);
      }
      return acc;
    },
    {
      byPriority: {
        critical: [] as Issue[],
        high: [] as Issue[],
        medium: [] as Issue[],
        low: [] as Issue[],
      },
      done: [] as Issue[],
    }
  );

  return (
    <div className="surface-stack">
      <section className="surface-panel hero-panel">
        <div className="hero-copy">
          <p className="hero-kicker">Issue Cockpit</p>
          <h2 className="hero-title">{activeProjectName}</h2>
          <p className="hero-description">
            I keep this board centered on signal: scanner findings, manual issues, and the work that
            should move next.
          </p>
        </div>

        <div className="hero-stats">
          <div className="metric-card">
            <span className="metric-label">Open</span>
            <span className="metric-value">{scopeStats.open}</span>
            <span className="metric-note">Outstanding work in the current scope.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">In Progress</span>
            <span className="metric-value">{scopeStats.inProgress}</span>
            <span className="metric-note">Items actively moving now.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Critical</span>
            <span className="metric-value">{scopeStats.critical}</span>
            <span className="metric-note">Issues that deserve immediate attention.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Matching</span>
            <span className="metric-value">{ui.totalCount}</span>
            <span className="metric-note">Rows that match the current filters.</span>
          </div>
        </div>
      </section>

      <section className="surface-panel control-bar">
        <div className="control-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            className="control-search-input"
            placeholder="Search title, description, or source file"
            aria-label="Search issues"
          />
        </div>

        <div className="control-groups">
          <div className="filter-group" role="group" aria-label="Filter issues by status">
            <span className="filter-group-label">Status</span>
            <div className="segment">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={`segment-button ${ui.statusFilter === filter.value ? 'active' : ''}`}
                  aria-pressed={ui.statusFilter === filter.value}
                  onClick={() => {
                    startTransition(() => {
                      setStatusFilter(filter.value);
                    });
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group" role="group" aria-label="Filter issues by priority">
            <span className="filter-group-label">Priority</span>
            <div className="segment">
              {PRIORITY_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={`segment-button ${ui.priorityFilter === filter.value ? 'active' : ''}`}
                  aria-pressed={ui.priorityFilter === filter.value}
                  onClick={() => {
                    startTransition(() => {
                      setPriorityFilter(filter.value);
                    });
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group" role="group" aria-label="Set issues per page">
            <span className="filter-group-label">Density</span>
            <div className="segment">
              {PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`segment-button ${ui.pageSize === size ? 'active' : ''}`}
                  aria-pressed={ui.pageSize === size}
                  onClick={() => {
                    startTransition(() => {
                      setPageSize(size);
                    });
                  }}
                >
                  {size} / page
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="surface-panel board-toolbar">
        <div className="board-summary">
          <span>
            Showing {rangeStart}-{rangeEnd} of {ui.totalCount} issue{ui.totalCount === 1 ? '' : 's'}
          </span>
          {activeFilterCount > 0 && (
            <>
              <span>•</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSearchDraft('');
                  startTransition(() => {
                    setSearch('');
                    setStatusFilter('all');
                    setPriorityFilter('all');
                  });
                }}
              >
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>

        <div className="pagination">
          <button
            type="button"
            onClick={() => setPage(ui.page - 1)}
            className="btn btn-secondary"
            disabled={ui.page <= 1}
          >
            Previous
          </button>
          <span className="pagination-label">
            Page {ui.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(ui.page + 1)}
            className="btn btn-secondary"
            disabled={ui.page >= totalPages}
          >
            Next
          </button>
        </div>
      </section>

      {issues.length === 0 ? (
        <section className="surface-panel empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="4" width="14" height="16" rx="3" />
              <path d="M9 9h6M9 13h6" />
            </svg>
          </div>
          <div className="empty-state-title">No issues found</div>
          <div className="empty-state-text">
            I could not find any issues in the current scope and filter set.
          </div>
          <div className="empty-state-note">
            Create a manual issue, scan a project with TODO or FIXME markers, or clear the active
            filters to widen the view.
          </div>
        </section>
      ) : (
        <div className="surface-stack">
          {PRIORITY_ORDER.map((priority) => {
            const priorityIssues = grouped.byPriority[priority];
            if (priorityIssues.length === 0) {
              return null;
            }

            const config = PRIORITY_CONFIG[priority];

            return (
              <section key={priority} className={`lane lane-${priority}`}>
                <div className="lane-header">
                  <div className="lane-title-row">
                    <span className="lane-marker" aria-hidden="true" />
                    <div>
                      <div className="lane-title">{config.label}</div>
                      <p className="lane-description">{config.description}</p>
                    </div>
                  </div>
                  <span className="lane-count">{priorityIssues.length}</span>
                </div>
                <div className="issue-grid">
                  {priorityIssues.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} />
                  ))}
                </div>
              </section>
            );
          })}

          {grouped.done.length > 0 && (
            <details className="lane lane-done done-lane">
              <summary className="lane-header done-lane-toggle">
                <div className="lane-title-row">
                  <span className="lane-marker" aria-hidden="true" />
                  <div>
                    <div className="lane-title">Done</div>
                    <p className="lane-description">Completed work that still belongs in the recent view.</p>
                  </div>
                </div>
                <div className="flex items-center gap-sm">
                  <span className="lane-count">{grouped.done.length}</span>
                  <svg
                    className="lane-chevron"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </summary>
              <div className="issue-grid">
                {grouped.done.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
