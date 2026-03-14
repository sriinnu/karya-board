/**
 * Project list component for the workspace rail.
 * I keep scope selection and high-level project totals here.
 * @packageDocumentation
 */

import { useStore } from '../store';

/**
 * Sidebar component displaying all projects with their issue counts.
 * @public
 */
export function ProjectList() {
  const { projects, stats, ui, setSelectedProject } = useStore();
  const totalStats = Object.values(stats).reduce(
    (acc, entry) => ({
      total: acc.total + entry.total,
      open: acc.open + entry.open,
      inProgress: acc.inProgress + entry.inProgress,
      critical: acc.critical + entry.critical,
    }),
    { total: 0, open: 0, inProgress: 0, critical: 0 }
  );
  const toProjectGlyph = (name: string) => name.trim().charAt(0).toUpperCase() || 'K';

  return (
    <nav className="project-rail" aria-label="Project scope">
      <div className="rail-summary">
        <div className="sidebar-title">Workspace Scope</div>
        <h2 className="rail-heading">Projects</h2>
        <p className="rail-copy">
          I keep scope, documentation readiness, and issue load visible here.
        </p>
        <div className="rail-metrics">
          <div className="rail-metric">
            <span className="rail-metric-label">Total</span>
            <span className="rail-metric-value">{totalStats.total}</span>
          </div>
          <div className="rail-metric">
            <span className="rail-metric-label">Open</span>
            <span className="rail-metric-value">{totalStats.open}</span>
          </div>
          <div className="rail-metric">
            <span className="rail-metric-label">Critical</span>
            <span className="rail-metric-value">{totalStats.critical}</span>
          </div>
        </div>
      </div>

      <div className="project-list">
        <button
          type="button"
          onClick={() => setSelectedProject(null)}
          className={`project-card ${ui.selectedProjectId === null ? 'active' : ''}`}
          aria-pressed={ui.selectedProjectId === null}
        >
          <div className="project-card-top">
            <div className="project-card-identity">
              <span className="project-card-glyph" aria-hidden="true">
                A
              </span>
              <div>
                <span className="project-card-name">All Projects</span>
                <p className="project-card-caption">A wide-angle view across the full workspace.</p>
              </div>
            </div>
            <span className="project-card-count">{totalStats.total}</span>
          </div>
          <div className="project-card-details">
            <span className="project-pill">{projects.length} tracked</span>
            <span className="project-pill">{projects.filter((project) => project.analytics.docsCount > 0).length} documented</span>
            {totalStats.inProgress > 0 && (
              <span className="project-pill" data-tone="progress">
                {totalStats.inProgress} in progress
              </span>
            )}
            {totalStats.critical > 0 && (
              <span className="project-pill" data-tone="critical">
                {totalStats.critical} critical
              </span>
            )}
          </div>
        </button>

        {projects.map((project) => {
          const projectStats = stats[project.id];
          const isSelected = ui.selectedProjectId === project.id;

          return (
            <button
              type="button"
              key={project.id}
              onClick={() => setSelectedProject(project.id)}
              className={`project-card ${isSelected ? 'active' : ''}`}
              aria-pressed={isSelected}
            >
              <div className="project-card-top">
                <div className="project-card-identity">
                  <span className="project-card-glyph" aria-hidden="true">
                    {toProjectGlyph(project.name)}
                  </span>
                  <div>
                    <span className="project-card-name">{project.name}</span>
                    <p className="project-card-caption">
                      {projectStats?.open ?? 0} open, {projectStats?.inProgress ?? 0} moving now
                    </p>
                  </div>
                </div>
                <span className="project-card-count">{projectStats?.total ?? 0}</span>
              </div>
              {projectStats && (
                <div className="project-card-details">
                  {projectStats.open > 0 && (
                    <span className="project-pill">{projectStats.open} open</span>
                  )}
                  {project.analytics.docsCount > 0 && (
                    <span className="project-pill">
                      {project.analytics.docsCount} docs
                    </span>
                  )}
                  {projectStats.inProgress > 0 && (
                    <span className="project-pill" data-tone="progress">
                      {projectStats.inProgress} in progress
                    </span>
                  )}
                  {project.analytics.hasArchitecture && (
                    <span className="project-pill" data-tone="docs">
                      Architecture
                    </span>
                  )}
                  {projectStats.critical > 0 && (
                    <span className="project-pill" data-tone="critical">
                      {projectStats.critical} critical
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
