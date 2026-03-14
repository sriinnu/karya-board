/**
 * MCP Tool: suggest_issues
 * I expose native AI suggestions without letting the model mutate the board implicitly.
 * @packageDocumentation
 */

import type {
  AiIssueSuggester,
} from '../ai.js';
import { AI_PROVIDERS, type SuggestIssuesParams, type SuggestIssuesResult } from '../ai.types.js';

export type { SuggestIssuesParams } from '../ai.types.js';

/**
 * JSON schema for the suggest_issues tool.
 * @public
 */
export const SUGGEST_ISSUES_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Project ID to review for missing work.',
    },
    provider: {
      type: 'string',
      enum: [...AI_PROVIDERS],
      description: 'Optional provider override. Defaults to the configured default provider.',
    },
    model: {
      type: 'string',
      description: 'Optional model override supported by the selected provider.',
    },
    prompt: {
      type: 'string',
      description: 'Optional guidance that narrows what the selected provider should look for.',
    },
    maxSuggestions: {
      type: 'number',
      description: 'Maximum number of suggestions to return. Defaults to 4 and caps at 8.',
    },
  },
  required: ['projectId'],
  additionalProperties: false,
} as const;

/**
 * Creates the suggest_issues MCP tool handler.
 * @param suggester - Provider-neutral AI suggester
 * @returns Tool handler
 * @public
 */
export function createSuggestIssuesTool(suggester: AiIssueSuggester) {
  return async function suggestIssues(
    params: SuggestIssuesParams
  ): Promise<SuggestIssuesResult> {
    return suggester.suggestIssues(params);
  };
}
