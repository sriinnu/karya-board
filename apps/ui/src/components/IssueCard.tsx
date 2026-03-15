/**
 * Issue card component for a single board item.
 * I keep issue presentation and inline status actions here.
 * @packageDocumentation
 */

import { useState } from 'react';
import type { Issue, IssuePriority, IssueStatus } from '../store';
import { useStore } from '../store';

/**
 * Props for IssueCard component.
 * @public
 */
interface IssueCardProps {
  /** Issue to display */
  issue: Issue;
}

/**
 * Status options available for inline issue updates.
 * @internal
 */
const STATUS_OPTIONS: Array<{ label: string; value: IssueStatus }> = [
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
];

/**
 * Priority options for inline priority switching.
 * @internal
 */
const PRIORITY_OPTIONS: Array<{ value: IssuePriority }> = [
  { value: 'critical' },
  { value: 'high' },
  { value: 'medium' },
  { value: 'low' },
];

/**
 * Card component displaying a single issue with details and actions.
 * @param props - Component props
 * @public
 */
export function IssueCard({ issue }: IssueCardProps) {
  const { updateIssue, deleteIssue, toggleIssueSelection, ui } = useStore();
  const isSelected = ui.selectedIssueIds.includes(issue.id);
  const isDone = issue.status === 'done';
  const [isPending, setIsPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const ageDays = Math.floor((Date.now() - issue.updatedAt) / 86400000);
  const ageTag = ageDays >= 14 ? 'ancient' : ageDays >= 7 ? 'stale' : 'fresh';
  const isStale = issue.status !== 'done' && ageDays >= 14;

  const handleStatusChange = async (newStatus: IssueStatus) => {
    setIsPending(true);
    try {
      await updateIssue(issue.id, { status: newStatus });
    } catch {
      // I rely on the shared store to surface request failures.
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${issue.title}"?`)) {
      return;
    }

    setIsPending(true);
    try {
      await deleteIssue(issue.id);
    } catch {
      // I rely on the shared store to surface request failures.
    } finally {
      setIsPending(false);
    }
  };

  return (
    <article
      className={`issue-card priority-${issue.priority} ${isDone ? 'done' : ''} ${isPending ? 'pending' : ''} ${isSelected ? 'is-selected' : ''}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          toggleIssueSelection(issue.id);
        }
      }}
    >
      <div className="issue-card-header">
        <div className="issue-card-signal">
          <div className="flex-1">
            <div className="issue-card-meta-line">
              <span className={`priority-dot priority-${issue.priority}`} aria-hidden="true" />
              <span className="issue-card-kicker">{issue.projectName ?? 'Manual Issue'}</span>
              <span className="issue-card-divider" aria-hidden="true" />
              <span className="issue-timestamp" data-age={ageTag}>{formatRelativeTime(issue.updatedAt)}</span>
            </div>
            <h3 className="issue-card-title">{issue.title}</h3>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void handleDelete();
          }}
          className="icon-button"
          title="Delete issue"
          aria-label="Delete issue"
          disabled={isPending}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>

      {issue.description && (
        <p className="issue-card-description line-clamp-2">
          {issue.description}
        </p>
      )}

      <div className="issue-card-meta">
        <span className={`badge badge-${issue.status === 'in_progress' ? 'progress' : issue.status}`}>
          {issue.status === 'in_progress' ? 'In Progress' : issue.status === 'open' ? 'Open' : 'Done'}
        </span>
        <span className={`badge badge-${issue.priority}`}>
          {issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1)}
        </span>
        {isStale && <span className="badge badge-critical">Stale</span>}
        {issue.sourceFile && (
          <button
            type="button"
            className="badge badge-source"
            title={copied ? 'Copied!' : `Click to copy: ${issue.sourceFile}`}
            onClick={() => {
              navigator.clipboard.writeText(issue.sourceFile!).then(
                () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
                () => { /* clipboard not available */ }
              );
            }}
          >
            {copied ? 'Copied!' : issue.sourceFile.split('/').pop()}
          </button>
        )}
      </div>

      <div className="issue-card-footer">
        <div className="status-switch">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`status-switch-button ${issue.status === option.value ? 'active' : ''}`}
              aria-pressed={issue.status === option.value}
              aria-label={`Set issue status to ${option.label}`}
              onClick={() => {
                void handleStatusChange(option.value);
              }}
              disabled={isPending || issue.status === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="priority-switch" role="group" aria-label="Change priority">
          {PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`priority-switch-btn ${issue.priority === option.value ? 'active' : ''}`}
              aria-pressed={issue.priority === option.value}
              aria-label={`Set priority to ${option.value}`}
              disabled={isPending || issue.priority === option.value}
              onClick={() => {
                setIsPending(true);
                void updateIssue(issue.id, { priority: option.value })
                  .catch(() => undefined)
                  .finally(() => setIsPending(false));
              }}
            >
              <span className={`priority-dot priority-${option.value}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * Formats a timestamp as relative time.
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted relative time string
 * @internal
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
