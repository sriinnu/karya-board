/**
 * Project intelligence panel for the Spanda dashboard.
 * I keep documentation previews and per-project operational signals here.
 * @packageDocumentation
 */

import { useStore, type ProjectOverview } from '../store';

interface ProjectIntelligencePanelProps {
  /** Opens the scan-settings modal */
  onEditScanSettings: () => void;
}

/**
 * Intelligence panel shown beside the board.
 * @public
 */
export function ProjectIntelligencePanel({ onEditScanSettings }: ProjectIntelligencePanelProps) {
  const { projects, ui } = useStore();
  const selectedProject = resolveFocusProject(projects, ui.selectedProjectId);
  const riskProjects = [...projects]
    .sort(
      (left, right) =>
        right.analytics.urgentCount - left.analytics.urgentCount ||
        right.stats.open - left.stats.open
    )
    .slice(0, 4);

  if (!selectedProject) {
    return (
      <aside className="surface-panel intelligence-panel">
        <div className="intelligence-empty">
          <p className="dashboard-kicker">Project Intelligence</p>
          <h3 className="intelligence-title">No project data yet</h3>
          <p className="intelligence-copy">
            I will surface README, architecture, and spec intelligence here once the workspace
            loads at least one configured project.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="surface-panel intelligence-panel">
      <div className="intelligence-header">
        <div>
          <p className="dashboard-kicker">Project Intelligence</p>
          <h3 className="intelligence-title">{selectedProject.name}</h3>
        </div>
        <div className="intelligence-chip-row">
          <StatusChip active={selectedProject.analytics.hasReadme} label="README" />
          <StatusChip active={selectedProject.analytics.hasArchitecture} label="Architecture" />
          <StatusChip active={selectedProject.analytics.hasSpec} label="Spec" />
        </div>
      </div>

      <p className="intelligence-path" title={selectedProject.path}>
        {selectedProject.path}
      </p>

      <div className="intelligence-stat-grid">
        <InsightStat
          label="Docs"
          value={String(selectedProject.analytics.docsCount)}
          detail="Curated markdown surfaced from the project root."
        />
        <InsightStat
          label="Artifacts"
          value={String(selectedProject.analytics.artifactCount)}
          detail="Scanned files currently tracked in SQLite."
        />
        <InsightStat
          label="Scanner"
          value={String(selectedProject.analytics.scannerIssues)}
          detail="Issues created from code or markdown scanning."
        />
        <InsightStat
          label="Manual + AI"
          value={String(selectedProject.analytics.manualIssues + selectedProject.analytics.aiIssues)}
          detail="Human and AI-authored items currently tracked."
        />
      </div>

      <section className="intelligence-section">
        <div className="intelligence-section-head">
          <span className="intelligence-section-label">Docs Library</span>
          <span className="intelligence-section-note">
            {selectedProject.documents.length} surfaced
          </span>
        </div>

        {selectedProject.documents.length > 0 ? (
          <div className="doc-list">
            {selectedProject.documents.map((document) => (
              <article key={`${selectedProject.id}-${document.relativePath}`} className="doc-card">
                <div className="doc-card-head">
                  <span className={`doc-kind doc-kind-${document.kind}`}>{document.kind}</span>
                  <time className="doc-updated">{formatDocDate(document.updatedAt)}</time>
                </div>
                <strong className="doc-title">{document.title}</strong>
                <p className="doc-path">{document.relativePath}</p>
                <p className="doc-preview">
                  {document.preview || 'No preview text was available for this markdown file.'}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="intelligence-empty-card">
            <strong className="intelligence-empty-title">No surfaced docs</strong>
            <p className="intelligence-empty-copy">
              I look for README, architecture/design, spec, and notes-style markdown files in the
              project root and `docs/`.
            </p>
          </div>
        )}
      </section>

      <section className="intelligence-section">
        <div className="intelligence-section-head">
          <span className="intelligence-section-label">Scan Rules</span>
          <button type="button" className="text-button" onClick={onEditScanSettings}>
            Edit Rules
          </button>
        </div>

        <div className="scan-rule-grid">
          <article className="scan-rule-card">
            <span className="scan-rule-label">Include</span>
            <div className="scan-rule-chip-list">
              {selectedProject.scanSettings.include.length > 0 ? (
                selectedProject.scanSettings.include.map((pattern) => (
                  <span key={`${selectedProject.id}-include-${pattern}`} className="scan-rule-chip">
                    {pattern}
                  </span>
                ))
              ) : (
                <span className="scan-rule-empty">Using scanner defaults</span>
              )}
            </div>
          </article>

          <article className="scan-rule-card">
            <span className="scan-rule-label">Exclude</span>
            <div className="scan-rule-chip-list">
              {selectedProject.scanSettings.exclude.length > 0 ? (
                selectedProject.scanSettings.exclude.map((pattern) => (
                  <span key={`${selectedProject.id}-exclude-${pattern}`} className="scan-rule-chip">
                    {pattern}
                  </span>
                ))
              ) : (
                <span className="scan-rule-empty">Using scanner defaults</span>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="intelligence-section">
        <div className="intelligence-section-head">
          <span className="intelligence-section-label">Risk Radar</span>
          <span className="intelligence-section-note">Portfolio</span>
        </div>

        <div className="risk-list">
          {riskProjects.map((project) => (
            <article key={project.id} className="risk-card">
              <div className="risk-card-row">
                <strong className="risk-card-title">{project.name}</strong>
                <span className="risk-card-badge">{project.analytics.urgentCount} urgent</span>
              </div>
              <p className="risk-card-copy">
                {project.stats.open} open, {project.stats.inProgress} in progress,{' '}
                {project.analytics.completionRate}% complete.
              </p>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

interface InsightStatProps {
  /** Short label */
  label: string;
  /** Main value */
  value: string;
  /** Supporting detail */
  detail: string;
}

/**
 * Small stats tile for the intelligence panel.
 * @param props - Component props
 * @internal
 */
function InsightStat({ label, value, detail }: InsightStatProps) {
  return (
    <article className="intelligence-stat-card">
      <span className="intelligence-stat-label">{label}</span>
      <strong className="intelligence-stat-value">{value}</strong>
      <span className="intelligence-stat-detail">{detail}</span>
    </article>
  );
}

interface StatusChipProps {
  /** Whether the backing document exists */
  active: boolean;
  /** Display label */
  label: string;
}

/**
 * Simple readiness chip used in the intelligence header.
 * @param props - Component props
 * @internal
 */
function StatusChip({ active, label }: StatusChipProps) {
  return (
    <span className={`status-chip ${active ? 'is-active' : ''}`}>
      {label}
    </span>
  );
}

/**
 * Chooses the active project for the intelligence panel.
 *
 * @param projects - Known projects
 * @param selectedProjectId - Current UI-selected project
 * @returns Focus project or null
 * @internal
 */
function resolveFocusProject(
  projects: ProjectOverview[],
  selectedProjectId: string | null
): ProjectOverview | null {
  if (selectedProjectId) {
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  }

  return (
    [...projects].sort(
      (left, right) =>
        right.analytics.urgentCount - left.analytics.urgentCount ||
        right.stats.open - left.stats.open
    )[0] ?? null
  );
}

/**
 * Formats a document timestamp for the UI.
 * @param timestamp - Millisecond timestamp
 * @returns Short date string
 * @internal
 */
function formatDocDate(timestamp: number): string {
  if (!timestamp) {
    return 'Unknown';
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
