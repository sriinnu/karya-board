/**
 * Shared helpers for the AI review flow.
 * I keep provider lookup and suggestion normalization here so the modal stays focused on interaction state.
 * @packageDocumentation
 */

import type { CreateIssueInput } from '../store';
import type { AiProvider, AiProviderStatus, AiStatus, SuggestedIssue } from '../ai.types';

/**
 * Finds one provider status entry from the current readiness payload.
 * @param status - Aggregate AI status payload
 * @param provider - Selected provider
 * @returns Matching provider status when present
 * @public
 */
export function findProviderStatus(
  status: AiStatus | null,
  provider: AiProvider | ''
): AiProviderStatus | undefined {
  return provider ? status?.providers.find((entry) => entry.provider === provider) : undefined;
}

/**
 * Builds a stable client-side key for one AI suggestion.
 * @param suggestion - Suggested issue payload
 * @returns Stable display key
 * @public
 */
export function toSuggestionKey(suggestion: SuggestedIssue): string {
  return `${suggestion.priority}:${suggestion.title}:${suggestion.rationale}`;
}

/**
 * Converts one reviewed suggestion into a create-issue payload.
 * @param projectId - Target project identifier
 * @param suggestion - Reviewed suggestion
 * @returns Issue creation payload
 * @public
 */
export function toSuggestionIssueInput(
  projectId: string,
  suggestion: SuggestedIssue
): CreateIssueInput {
  return {
    projectId,
    title: suggestion.title,
    description: `${suggestion.description}\n\nWhy now: ${suggestion.rationale}`,
    priority: suggestion.priority,
    status: 'open',
  };
}
