/**
 * Provider-neutral AI contracts for the Karya UI.
 * I keep the shared suggestion types here so the HTTP client and React components stay smaller.
 * @packageDocumentation
 */

import type { IssuePriority } from '@karya/core';

/**
 * Supported built-in AI providers.
 * @public
 */
export type AiProvider = 'anthropic' | 'openai';

/**
 * One provider readiness entry returned by the backend.
 * @public
 */
export interface AiProviderStatus {
  /** Stable provider identifier */
  provider: AiProvider;
  /** Human-readable provider label */
  label: string;
  /** Whether the provider is configured and callable */
  available: boolean;
  /** Default model configured for this provider */
  defaultModel: string | null;
  /** Human-readable reason when the provider is unavailable */
  reason?: string;
  /** Rolling request budget */
  requestLimit: number;
  /** Rolling request window in milliseconds */
  requestWindowMs: number;
}

/**
 * Aggregate readiness payload for the built-in AI lanes.
 * @public
 */
export interface AiStatus {
  /** Whether at least one provider is currently available */
  available: boolean;
  /** Default provider used when the caller does not choose one */
  defaultProvider: AiProvider | null;
  /** Known built-in providers */
  providers: AiProviderStatus[];
}

/**
 * Input payload for safe AI suggestions.
 * @public
 */
export interface SuggestIssuesInput {
  /** Target project ID */
  projectId: string;
  /** Optional provider override */
  provider?: AiProvider;
  /** Optional model override */
  model?: string;
  /** Optional review guidance */
  prompt?: string;
  /** Maximum number of suggestions to request */
  maxSuggestions?: number;
}

/**
 * One AI suggestion returned to the UI.
 * @public
 */
export interface SuggestedIssue {
  /** Suggested title */
  title: string;
  /** Suggested description */
  description: string;
  /** Suggested priority */
  priority: IssuePriority;
  /** Why the suggestion matters */
  rationale: string;
}

/**
 * AI usage metadata surfaced to the UI.
 * @public
 */
export interface SuggestionUsage {
  /** Input tokens consumed by the request */
  inputTokens: number;
  /** Output tokens consumed by the request */
  outputTokens: number;
  /** Total tokens when the provider exposes them */
  totalTokens?: number;
  /** Optional prompt-cache creation tokens */
  cacheCreationTokens?: number;
  /** Optional prompt-cache read tokens */
  cacheReadTokens?: number;
}
