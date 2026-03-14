/**
 * Scan settings modal for project include/exclude rules.
 * I keep scanner rule editing explicit here so it stays understandable and safe.
 * @packageDocumentation
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { updateProjectScanSettings } from '../api';
import { useStore } from '../store';
import { getFocusableElements } from './dialog-focus';

interface ScanSettingsModalProps {
  /** Callback when the modal should close */
  onClose: () => void;
}

/**
 * Modal dialog for editing per-project scan rules.
 * @param props - Component props
 * @public
 */
export function ScanSettingsModal({ onClose }: ScanSettingsModalProps) {
  const { projects, ui, loadProjects, setWarning, setError } = useStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const includeRef = useRef<HTMLTextAreaElement | null>(null);
  const [projectId, setProjectId] = useState(ui.selectedProjectId ?? projects[0]?.id ?? '');
  const [includeDraft, setIncludeDraft] = useState('');
  const [excludeDraft, setExcludeDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setLocalError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const projectFieldId = useId();
  const includeFieldId = useId();
  const excludeFieldId = useId();
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    includeRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setIncludeDraft('');
      setExcludeDraft('');
      return;
    }

    setIncludeDraft(selectedProject.scanSettings.include.join('\n'));
    setExcludeDraft(selectedProject.scanSettings.exclude.join('\n'));
  }, [selectedProject]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    setIsSaving(true);
    setLocalError(null);
    try {
      const result = await updateProjectScanSettings(selectedProject.id, {
        include: parsePatternDraft(includeDraft),
        exclude: parsePatternDraft(excludeDraft),
      });
      await loadProjects();
      setWarning(result.warning);
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to update scan settings';
      setError(message);
      setLocalError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (!isSaving && event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!isSaving) {
        event.preventDefault();
        onClose();
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (!(activeElement instanceof HTMLElement) || !dialog.contains(activeElement)) {
      event.preventDefault();
      firstElement.focus();
      return;
    }

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isSaving}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="modal-header">
          <div>
            <p className="modal-kicker">Scanner Rules</p>
            <h2 id={titleId} className="modal-title">Configure include and exclude paths</h2>
            <p id={descriptionId} className="modal-subtitle">
              I persist these rules to `karya.config.json`. Restart the scanner after saving so the
              watcher picks them up.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Close modal"
            disabled={isSaving}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}

            <div className="modal-summary-strip" aria-label="Settings behavior">
              <span className="modal-summary-pill">Config write</span>
              <span className="modal-summary-pill">Project scoped</span>
              <span className="modal-summary-pill">Scanner restart required</span>
            </div>

            <section className="modal-section">
              <div className="modal-section-heading">
                <p className="sidebar-title">Scope</p>
                <p className="modal-section-copy">
                  Choose the project whose scanner rules you want to refine.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={projectFieldId}>Project</label>
                <select
                  id={projectFieldId}
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="select"
                  required
                >
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="modal-section">
              <div className="modal-section-heading">
                <p className="sidebar-title">Include Rules</p>
                <p className="modal-section-copy">
                  Add folders, files, or glob patterns to actively pull into scanning.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={includeFieldId}>Include patterns</label>
                <textarea
                  id={includeFieldId}
                  ref={includeRef}
                  value={includeDraft}
                  onChange={(event) => setIncludeDraft(event.target.value)}
                  className="textarea"
                  placeholder={'src/**\ndocs/**\nREADME.md'}
                />
                <div className="form-hint">
                  One pattern per line. Use folders like `src` or globs like `src/**`.
                </div>
              </div>
            </section>

            <section className="modal-section">
              <div className="modal-section-heading">
                <p className="sidebar-title">Exclude Rules</p>
                <p className="modal-section-copy">
                  Add folders or patterns the scanner should ignore entirely.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={excludeFieldId}>Exclude patterns</label>
                <textarea
                  id={excludeFieldId}
                  value={excludeDraft}
                  onChange={(event) => setExcludeDraft(event.target.value)}
                  className="textarea"
                  placeholder={'node_modules\n.git\ndist'}
                />
                <div className="form-hint">
                  Use this for generated folders, dependency trees, or paths that create noise.
                </div>
              </div>
            </section>
          </div>

          <div className="modal-footer">
            <p className="modal-footnote">
              These rules are stored in the config file and apply the next time the scanner starts.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={isSaving || !selectedProject}>
                {isSaving ? 'Saving...' : 'Save Rules'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Splits a textarea draft into stable scanner patterns.
 *
 * @param draft - Newline-delimited text
 * @returns Trimmed patterns
 * @internal
 */
function parsePatternDraft(draft: string): string[] {
  return draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
