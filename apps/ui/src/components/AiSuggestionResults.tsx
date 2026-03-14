/**
 * Presentational list for reviewed AI suggestions.
 * I keep the metadata pills and per-suggestion create actions here so the modal stays readable.
 * @packageDocumentation
 */

import type { SuggestedIssue, SuggestionUsage } from '../ai.types';
import { toSuggestionKey } from './ai-review';

interface AiSuggestionResultsProps {
  /** Provider label used for the current result set */
  providerLabel: string | null;
  /** Model used for the current result set */
  model: string | null;
  /** Usage summary for the current result set */
  usage: SuggestionUsage | null;
  /** Suggestions currently shown to the user */
  suggestions: SuggestedIssue[];
  /** Keys already created into the board */
  createdKeys: string[];
  /** Whether creation is currently in flight */
  isApplying: boolean;
  /** Callback when the user approves one suggestion */
  onCreateOne: (suggestion: SuggestedIssue) => void;
}

/**
 * Renders the reviewed suggestion output returned by the backend.
 * @param props - Component props
 * @public
 */
export function AiSuggestionResults({
  providerLabel,
  model,
  usage,
  suggestions,
  createdKeys,
  isApplying,
  onCreateOne,
}: AiSuggestionResultsProps) {
  return (
    <>
      {(providerLabel || model || usage) && (
        <div className="suggestion-meta-row" role="status">
          {providerLabel && <span className="project-pill">{providerLabel}</span>}
          {model && <span className="project-pill">{model}</span>}
          {usage && (
            <span className="project-pill">
              {usage.inputTokens} in / {usage.outputTokens} out
            </span>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="suggestion-list" aria-live="polite">
          {suggestions.map((suggestion) => {
            const suggestionKey = toSuggestionKey(suggestion);
            const isCreated = createdKeys.includes(suggestionKey);

            return (
              <article key={suggestionKey} className="suggestion-card">
                <div className="suggestion-card-top">
                  <div>
                    <p className="suggestion-card-kicker">{suggestion.priority.toUpperCase()}</p>
                    <h3 className="suggestion-card-title">{suggestion.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCreateOne(suggestion)}
                    className="btn btn-secondary"
                    disabled={isApplying || isCreated}
                  >
                    {isCreated ? 'Created' : 'Create'}
                  </button>
                </div>
                <p className="suggestion-card-copy">{suggestion.description}</p>
                <p className="suggestion-card-rationale">Why now: {suggestion.rationale}</p>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
