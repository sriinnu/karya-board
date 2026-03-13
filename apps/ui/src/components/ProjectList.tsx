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

  return (
    <nav className="project-rail" aria-label="Project scope">
      <div className="rail-summary">
        <div className="sidebar-title">Workspace Scope</div>
        <h2 className="rail-heading">Projects</h2>
        <p className="rail-copy">
          I keep scope selection tight here so the board stays focused and the counts stay legible.
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
            <span className="project-card-name">All Projects</span>
            <span className="project-card-count">{totalStats.total}</span>
          </div>
          <div className="project-card-details">
            <span className="project-pill">{projects.length} tracked</span>
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
                <span className="project-card-name">{project.name}</span>
                <span className="project-card-count">{projectStats?.total ?? 0}</span>
              </div>
              {projectStats && (
                <div className="project-card-details">
                  {projectStats.open > 0 && (
                    <span className="project-pill">{projectStats.open} open</span>
                  )}
                  {projectStats.inProgress > 0 && (
                    <span className="project-pill" data-tone="progress">
                      {projectStats.inProgress} in progress
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
