/**
 * Issue card component for a single board item.
 * I keep issue presentation and inline status actions here.
 * @packageDocumentation
 */

import { useState } from 'react';
import type { Issue, IssueStatus } from '../store';
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
 * Card component displaying a single issue with details and actions.
 * @param props - Component props
 * @public
 */
export function IssueCard({ issue }: IssueCardProps) {
  const { updateIssue, deleteIssue } = useStore();
  const isDone = issue.status === 'done';
  const [isPending, setIsPending] = useState(false);

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
    <article className={`issue-card ${isDone ? 'done' : ''} ${isPending ? 'pending' : ''}`}>
      <div className="issue-card-header">
        <div className="issue-card-signal">
          <span className={`priority-dot priority-${issue.priority}`} aria-hidden="true" />
          <div className="flex-1">
            <div className="issue-card-kicker">{issue.projectName ?? 'Manual Issue'}</div>
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
          {issue.status === 'in_progress' ? 'In Progress' : issue.status}
        </span>
        <span className={`badge badge-${issue.priority}`}>{issue.priority}</span>
        {issue.sourceFile && <span className="badge">Source File</span>}
      </div>

      {issue.sourceFile && (
        <div className="issue-source truncate">{issue.sourceFile}</div>
      )}

      <div className="issue-card-footer">
        <div className="status-switch">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`status-switch-button ${issue.status === option.value ? 'active' : ''}`}
              aria-pressed={issue.status === option.value}
              onClick={() => {
                void handleStatusChange(option.value);
              }}
              disabled={isPending || issue.status === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="issue-timestamp">{formatRelativeTime(issue.updatedAt)}</span>
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
