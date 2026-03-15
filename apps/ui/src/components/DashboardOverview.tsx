/**
 * Portfolio overview for the Spanda dashboard.
 * I keep top-level analytics and cross-project signals here so the board can focus on execution.
 * @packageDocumentation
 */

import { useStore, type ProjectStats } from '../store';

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
 * Top-level analytics strip for the dashboard.
 * @public
 */
export function DashboardOverview() {
  const { projects, ui } = useStore();
  const selectedProject = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId) ?? null
    : null;
  const portfolioStats = projects.reduce<ProjectStats>(
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
  const architectureReadyProjects = projects.filter(
    (project) => project.analytics.hasArchitecture
  ).length;
  const scopeProjects = selectedProject ? [selectedProject] : projects;
  const scopeStats = selectedProject?.stats ?? portfolioStats;
  const scopeUrgent = scopeProjects.reduce(
    (total, project) => total + project.analytics.urgentCount,
    0
  );
  const scopeDocs = scopeProjects.reduce(
    (total, project) => total + project.analytics.docsCount,
    0
  );
  const scopeArtifacts = scopeProjects.reduce(
    (total, project) => total + project.analytics.artifactCount,
    0
  );
  const scopeCompletion = scopeStats.total === 0
    ? 0
    : Math.round((scopeStats.done / scopeStats.total) * 100);
  const topRiskProject = [...projects].sort(
    (left, right) =>
      right.analytics.urgentCount - left.analytics.urgentCount ||
      right.stats.open - left.stats.open
  )[0] ?? null;
  const bestDocumentedProject = [...projects].sort(
    (left, right) => right.analytics.docsCount - left.analytics.docsCount
  )[0] ?? null;
  const scopeLabel = selectedProject ? selectedProject.name : 'Portfolio';

  return (
    <section className="surface-panel dashboard-overview">
      <div className="dashboard-overview-head">
        <div className="dashboard-overview-copy">
          <p className="dashboard-kicker">Command Deck</p>
          <h2 className="dashboard-overview-title">{scopeLabel}</h2>
          <p className="dashboard-overview-text">
            Architecture, docs, scanner coverage, and work in flight stay visible without burying the board.
          </p>
        </div>
        {topRiskProject && topRiskProject.analytics.urgentCount > 0 && (
          <div className="dashboard-overview-callout dashboard-overview-callout-urgent">
            <span className="dashboard-overview-callout-label">Immediate Risk</span>
            <strong className="dashboard-overview-callout-title">
              {topRiskProject.name}
            </strong>
            <span className="dashboard-overview-callout-copy">
              {topRiskProject.analytics.urgentCount} urgent · {topRiskProject.stats.open} open
            </span>
          </div>
        )}
      </div>

      <div className="dashboard-metric-grid" aria-label="Top-level analytics">
        <MetricCard
          label={selectedProject ? 'Open Work' : 'Tracked Issues'}
          value={String(selectedProject ? scopeStats.open : scopeStats.total)}
          detail={selectedProject ? 'Open items in the active project.' : 'Total tracked volume across the portfolio.'}
        />
        <MetricCard
          label="Urgent Load"
          value={String(scopeUrgent)}
          detail="Critical and high-priority items not yet done."
          tone={scopeUrgent > 0 ? 'critical' : 'neutral'}
        />
        <article className="dashboard-metric-card dashboard-metric-completion">
          <div>
            <span className="dashboard-metric-label">Completion</span>
            <span className="dashboard-metric-detail">Share of tracked work already complete.</span>
          </div>
          <div
            className="completion-ring"
            style={{
              background: `conic-gradient(from -90deg, var(--color-accent) ${scopeCompletion * 3.6}deg, rgba(17,24,39,0.08) ${scopeCompletion * 3.6}deg)`,
            }}
            role="img"
            aria-label={`${scopeCompletion}% complete`}
          >
            <div className="completion-ring-inner">
              <strong className="completion-ring-value">{scopeCompletion}%</strong>
            </div>
          </div>
        </article>
        <MetricCard
          label={selectedProject ? 'Docs' : 'Docs Coverage'}
          value={selectedProject ? String(scopeDocs) : `${documentedProjects}/${projects.length || 0}`}
          detail={
            selectedProject
              ? 'Curated docs surfaced for the active project.'
              : 'Projects with surfaced docs across the portfolio.'
          }
        />
      </div>

      <div className="status-bar" aria-label="Status distribution">
        {scopeStats.open > 0 && <div className="status-bar-segment status-bar-open" style={{ flex: scopeStats.open }} />}
        {scopeStats.inProgress > 0 && <div className="status-bar-segment status-bar-progress" style={{ flex: scopeStats.inProgress }} />}
        {scopeStats.done > 0 && <div className="status-bar-segment status-bar-done" style={{ flex: scopeStats.done }} />}
      </div>
      <div className="status-bar-legend">
        <span className="status-bar-legend-item"><span className="status-bar-legend-dot" style={{ background: 'var(--color-accent)' }} />{scopeStats.open} open</span>
        <span className="status-bar-legend-item"><span className="status-bar-legend-dot" style={{ background: 'var(--color-progress)' }} />{scopeStats.inProgress} in progress</span>
        <span className="status-bar-legend-item"><span className="status-bar-legend-dot" style={{ background: 'var(--color-low)' }} />{scopeStats.done} done</span>
      </div>

      <div className="dashboard-spotlight-grid">
        <SpotlightCard
          label="Risk"
          title={topRiskProject?.name ?? 'No projects yet'}
          detail={
            topRiskProject
              ? `${topRiskProject.analytics.urgentCount} urgent, ${topRiskProject.stats.open} open, ${topRiskProject.analytics.completionRate}% complete`
              : 'Add a project to surface operational risk.'
          }
        />
        <SpotlightCard
          label="Documentation"
          title={`${architectureReadyProjects}/${projects.length || 0} architecture-ready`}
          detail={`${documentedProjects} projects expose docs and ${scopeArtifacts} scanned artifacts are tracked in the current lens.`}
        />
        <SpotlightCard
          label="Deepest Docs"
          title={bestDocumentedProject?.name ?? 'No surfaced docs yet'}
          detail={
            bestDocumentedProject
              ? `${bestDocumentedProject.analytics.docsCount} surfaced docs with ${bestDocumentedProject.analytics.artifactCount} tracked artifacts.`
              : 'README, architecture, and spec documents will appear here automatically.'
          }
        />
      </div>
    </section>
  );
}

interface MetricCardProps {
  /** Short metric label */
  label: string;
  /** Main metric value */
  value: string;
  /** Supporting text */
  detail: string;
  /** Optional visual tone */
  tone?: 'neutral' | 'critical';
}

/**
 * Small metric card used in the overview grid.
 * @param props - Component props
 * @internal
 */
function MetricCard({ label, value, detail, tone = 'neutral' }: MetricCardProps) {
  return (
    <article className={`dashboard-metric-card ${tone === 'critical' ? 'is-critical' : ''}`}>
      <span className="dashboard-metric-label">{label}</span>
      <strong className="dashboard-metric-value">{value}</strong>
      <span className="dashboard-metric-detail">{detail}</span>
    </article>
  );
}

interface SpotlightCardProps {
  /** Card label */
  label: string;
  /** Card title */
  title: string;
  /** Card detail copy */
  detail: string;
}

/**
 * Spotlight card used for the secondary portfolio strip.
 * @param props - Component props
 * @internal
 */
function SpotlightCard({ label, title, detail }: SpotlightCardProps) {
  return (
    <article className="dashboard-spotlight-card">
      <span className="dashboard-spotlight-label">{label}</span>
      <strong className="dashboard-spotlight-title">{title}</strong>
      <p className="dashboard-spotlight-detail">{detail}</p>
    </article>
  );
}
