/**
 * Live signal marquee for the Spanda dashboard.
 * I keep the moving portfolio tape here so the landing surface feels active without becoming noisy.
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
 * Horizontal live-tape component for the dashboard.
 * @public
 */
export function SignalMarquee() {
  const { projects, ui } = useStore();
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
  const topRiskProject = [...projects].sort(
    (left, right) =>
      right.analytics.urgentCount - left.analytics.urgentCount ||
      right.stats.open - left.stats.open
  )[0] ?? null;
  const documentedProjects = projects.filter((project) => project.analytics.docsCount > 0).length;
  const architectureProjects = projects.filter(
    (project) => project.analytics.hasArchitecture
  ).length;
  const totalArtifacts = projects.reduce(
    (total, project) => total + project.analytics.artifactCount,
    0
  );
  const currentLens = ui.selectedProjectId
    ? projects.find((project) => project.id === ui.selectedProjectId)?.name ?? 'Focused Project'
    : 'All Projects';
  const items = [
    { label: 'Lens', value: currentLens },
    { label: 'Tracked', value: `${portfolioStats.total} issues` },
    { label: 'Urgent', value: `${portfolioStats.critical + portfolioStats.high} active` },
    { label: 'In Progress', value: `${portfolioStats.inProgress} moving` },
    { label: 'Docs', value: `${documentedProjects}/${projects.length || 0} ready` },
    { label: 'Architecture', value: `${architectureProjects} projects` },
    { label: 'Artifacts', value: `${totalArtifacts} scanned files` },
    {
      label: 'Top Risk',
      value: topRiskProject
        ? `${topRiskProject.name} · ${topRiskProject.analytics.urgentCount} urgent`
        : 'No urgent risk yet',
    },
  ];

  return (
    <section className="surface-panel marquee-panel" aria-label="Live portfolio signal">
      <div className="marquee-head">
        <div>
          <p className="dashboard-kicker">Live Tape</p>
          <h3 className="marquee-title">Portfolio feed</h3>
        </div>
        <p className="marquee-copy">
          Execution, docs, and risk in one moving strip.
        </p>
      </div>

      <div className="marquee-window">
        <div className="marquee-track">
          {items.map((item, index) => (
            <article key={`${item.label}-${index}`} className="marquee-card">
              <span className="marquee-card-label">{item.label}</span>
              <strong className="marquee-card-value">{item.value}</strong>
            </article>
          ))}
          {items.map((item, index) => (
            <article
              key={`${item.label}-${index}-repeat`}
              className="marquee-card"
              aria-hidden="true"
            >
              <span className="marquee-card-label">{item.label}</span>
              <strong className="marquee-card-value">{item.value}</strong>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
