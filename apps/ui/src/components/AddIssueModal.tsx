/**
 * Add issue modal component for manual issue creation.
 * I keep the create flow concise but explicit here.
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
import { useStore, type IssuePriority, type IssueStatus } from '../store';

interface AddIssueModalProps {
  /** Callback when modal should close */
  onClose: () => void;
}

/**
 * Modal dialog for creating a new issue.
 * @param props - Component props
 * @public
 */
export function AddIssueModal({ onClose }: AddIssueModalProps) {
  const { projects, ui, createIssue } = useStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(ui.selectedProjectId ?? projects[0]?.id ?? '');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [status, setStatus] = useState<IssueStatus>('open');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const projectFieldId = useId();
  const issueTitleFieldId = useId();
  const issueDescriptionFieldId = useId();
  const priorityFieldId = useId();
  const statusFieldId = useId();

  /**
   * I move focus into the dialog on open and restore it on close.
   * @internal
   */
  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleInputRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !projectId) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createIssue({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        status,
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to create issue'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (!isSubmitting && event.target === event.currentTarget) {
      onClose();
    }
  };

  /**
   * I keep focus trapped in the dialog so keyboard users do not tab behind it.
   * @param event - Keyboard event from the dialog container
   * @internal
   */
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!isSubmitting) {
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
        aria-busy={isSubmitting}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="modal-header">
          <div>
            <p className="modal-kicker">Manual Issue</p>
            <h2 id={titleId} className="modal-title">Create a new issue</h2>
            <p id={descriptionId} className="modal-subtitle">
              I write this into SQLite and the board regenerates automatically after the save lands.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Close modal"
            disabled={isSubmitting}
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

            <div className="form-grid">
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
                <div className="form-hint">I attach the issue to one tracked project at creation time.</div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={issueTitleFieldId}>Title</label>
                <input
                  id={issueTitleFieldId}
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="input"
                  placeholder="Describe the work clearly"
                  required
                />
                <div className="form-hint">Keep it short enough to scan at a glance.</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={issueDescriptionFieldId}>Description</label>
              <textarea
                id={issueDescriptionFieldId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="textarea"
                placeholder="Add context, expected outcome, or a source path if it matters"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor={priorityFieldId}>Priority</label>
                <select
                  id={priorityFieldId}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as IssuePriority)}
                  className="select"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={statusFieldId}>Status</label>
                <select
                  id={statusFieldId}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as IssueStatus)}
                  className="select"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <p className="modal-footnote">
              I keep this flow intentionally compact so creation is fast, but the issue still lands
              with the right project, status, and priority.
            </p>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !title.trim() || !projectId}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner" style={{ width: '16px', height: '16px' }} />
                    Creating...
                  </>
                ) : (
                  'Create Issue'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Returns tabbable descendants inside the modal dialog.
 * @param root - Dialog root element
 * @returns Ordered list of focusable elements
 * @internal
 */
function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}
