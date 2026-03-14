/**
 * Shared AI provider contracts for Karya.
 * I keep provider-neutral request and response shapes here so Anthropic and OpenAI stay interchangeable.
 * @packageDocumentation
 */

import type { IssuePriority } from '@karya/core';

/**
 * Built-in AI providers supported by Karya today.
 * @public
 */
export const AI_PROVIDERS = ['anthropic', 'openai'] as const;

/**
 * Native AI providers supported by Karya.
 * @public
 */
export type AIProvider = (typeof AI_PROVIDERS)[number];

/**
 * Status snapshot for one provider.
 * @public
 */
export interface AIProviderStatus {
  /** Provider identifier */
  provider: AIProvider;
  /** Human-readable provider label */
  label: string;
  /** Whether requests can be sent right now */
  available: boolean;
  /** Default model for the provider, when configured */
  defaultModel: string | null;
  /** Human-readable reason when unavailable */
  reason?: string;
  /** Rolling request budget */
  requestLimit: number;
  /** Rolling request window in milliseconds */
  requestWindowMs: number;
}

/**
 * Aggregate AI readiness payload surfaced to the API and UI.
 * @public
 */
export interface AIStatus {
  /** Whether any provider is currently available */
  available: boolean;
  /** Default provider used when a request does not specify one */
  defaultProvider: AIProvider | null;
  /** Status for every supported provider */
  providers: AIProviderStatus[];
}

/**
 * Input payload for safe issue suggestions.
 * @public
 */
export interface SuggestIssuesParams {
  /** Target project ID */
  projectId: string;
  /** Optional guidance that narrows the review */
  prompt?: string;
  /** Max suggestions to emit */
  maxSuggestions?: number;
  /** Optional provider override */
  provider?: AIProvider;
  /** Optional model override */
  model?: string;
}

/**
 * One suggested issue returned by an AI provider.
 * @public
 */
export interface SuggestedIssue {
  /** Suggested issue title */
  title: string;
  /** Suggested issue description */
  description: string;
  /** Suggested issue priority */
  priority: IssuePriority;
  /** Short rationale for why the issue matters */
  rationale: string;
}

/**
 * Token usage snapshot returned by a provider.
 * @public
 */
export interface SuggestionUsage {
  /** Input tokens billed by the provider */
  inputTokens: number;
  /** Output tokens billed by the provider */
  outputTokens: number;
  /** Total tokens when the provider exposes them */
  totalTokens?: number;
  /** Cache creation tokens when prompt caching is used */
  cacheCreationTokens?: number;
  /** Cache read tokens when prompt caching is used */
  cacheReadTokens?: number;
}

/**
 * Result payload for suggestion requests.
 * @public
 */
export interface SuggestIssuesResult {
  /** Whether the request completed successfully */
  success: boolean;
  /** Whether the selected provider is available */
  available: boolean;
  /** Provider used for the request */
  provider: AIProvider | null;
  /** Human-readable provider label */
  providerLabel?: string;
  /** Model used for the request */
  model: string | null;
  /** Suggested issues on success */
  suggestions?: SuggestedIssue[];
  /** Provider usage metadata on success */
  usage?: SuggestionUsage;
  /** Non-fatal warning when I trimmed or dropped unsafe output */
  warning?: string;
  /** Error message on failure */
  error?: string;
  /** Suggested HTTP status when this result is surfaced over the API */
  statusCode?: number;
}

/**
 * Minimal provider contract used by the selector.
 * @public
 */
export interface IssueSuggesterProvider {
  /** Returns provider readiness */
  getStatus(): AIProviderStatus;
  /** Returns safe issue suggestions */
  suggestIssues(params: SuggestIssuesParams): Promise<SuggestIssuesResult>;
}
