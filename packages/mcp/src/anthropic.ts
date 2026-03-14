/**
 * Native Anthropic provider for Karya issue suggestions.
 * I keep the Anthropic-specific SDK, env parsing, and response parsing isolated here.
 * @packageDocumentation
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@karya/core';
import { createLogger } from '@karya/core';
import {
  AI_REVIEW_SYSTEM_PROMPT,
  buildIssueSuggestionSchema,
  buildSuggestionPrompt,
  clampMaxSuggestions,
  normalizeSuggestions,
  readPositiveNumber,
} from './ai.shared.js';
import type {
  AIProviderStatus,
  IssueSuggesterProvider,
  SuggestIssuesParams,
  SuggestIssuesResult,
  SuggestionUsage,
} from './ai.types.js';

/**
 * Anthropic runtime config.
 * @public
 */
export interface AnthropicRuntimeConfig {
  /** Anthropic API key, or null when integration is disabled */
  apiKey: string | null;
  /** Default model used for suggestions */
  model: string;
  /** Response token budget */
  maxTokens: number;
  /** Provider retry count */
  maxRetries: number;
  /** Provider timeout in milliseconds */
  timeoutMs: number;
  /** Max requests per rolling window */
  requestLimit: number;
  /** Rolling rate-limit window in milliseconds */
  requestWindowMs: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1_200;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_LIMIT = 6;
const DEFAULT_REQUEST_WINDOW_MS = 60_000;
const logger = createLogger('anthropic');

interface AnthropicToolInput {
  suggestions?: Array<{
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    rationale?: unknown;
  }>;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    name?: string;
    input?: AnthropicToolInput;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicClientLike {
  messages: {
    create: (payload: unknown) => Promise<AnthropicResponse>;
  };
}

/**
 * Anthropic-backed issue suggester.
 * @public
 */
export class AnthropicIssueSuggester implements IssueSuggesterProvider {
  private readonly db: Database;
  private readonly config: AnthropicRuntimeConfig;
  private readonly client: AnthropicClientLike | null;
  private readonly requestTimestamps: number[] = [];

  /**
   * Creates a new Anthropic suggester.
   * @param db - Backing Karya database
   * @param config - Anthropic runtime config
   * @param client - Optional client override for tests
   */
  constructor(
    db: Database,
    config: AnthropicRuntimeConfig = loadAnthropicRuntimeConfig(),
    client?: AnthropicClientLike
  ) {
    this.db = db;
    this.config = config;
    this.client = client ?? createAnthropicClient(config);
  }

  /**
   * Returns current Anthropic readiness.
   * @returns Provider status snapshot
   */
  public getStatus(): AIProviderStatus {
    if (!this.config.apiKey) {
      return {
        provider: 'anthropic',
        label: 'Anthropic',
        available: false,
        defaultModel: null,
        reason: 'Set ANTHROPIC_API_KEY to enable Anthropic issue suggestions.',
        requestLimit: this.config.requestLimit,
        requestWindowMs: this.config.requestWindowMs,
      };
    }

    return {
      provider: 'anthropic',
      label: 'Anthropic',
      available: true,
      defaultModel: this.config.model,
      requestLimit: this.config.requestLimit,
      requestWindowMs: this.config.requestWindowMs,
    };
  }

  /**
   * Generates safe issue suggestions for one project.
   * @param params - Project scope and optional overrides
   * @returns Suggestion result payload
   */
  public async suggestIssues(params: SuggestIssuesParams): Promise<SuggestIssuesResult> {
    const status = this.getStatus();
    if (!status.available || !this.client) {
      return {
        success: false,
        available: false,
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        model: null,
        statusCode: 503,
        error: status.reason ?? 'Anthropic is not configured.',
      };
    }

    const project = this.db.getProjectById(params.projectId);
    if (!project) {
      return {
        success: false,
        available: true,
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        model: params.model?.trim() || this.config.model,
        statusCode: 404,
        error: `Project not found: ${params.projectId}`,
      };
    }

    const model = params.model?.trim() || this.config.model;

    try {
      this.enforceRateLimit();
      const maxSuggestions = clampMaxSuggestions(params.maxSuggestions);
      const currentIssues = this.db.getIssuesByProject(project.id);
      const response = await this.client.messages.create({
        model,
        max_tokens: this.config.maxTokens,
        temperature: 0.2,
        system: AI_REVIEW_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildSuggestionPrompt(
              project.name,
              this.db.getProjectStats(project.id),
              currentIssues,
              params.prompt,
              maxSuggestions
            ),
          },
        ],
        tools: [
          {
            name: 'emit_issue_suggestions',
            description: 'Return only the reviewed issue suggestions for explicit human approval.',
            strict: true,
            input_schema: buildIssueSuggestionSchema(maxSuggestions),
          },
        ],
        tool_choice: {
          type: 'tool',
          name: 'emit_issue_suggestions',
        },
      });

      const rawSuggestions = response.content.find(
        (block) => block.type === 'tool_use' && block.name === 'emit_issue_suggestions'
      )?.input?.suggestions;
      const parsed = normalizeSuggestions(
        Array.isArray(rawSuggestions) ? rawSuggestions : [],
        currentIssues,
        maxSuggestions
      );

      logger.info(`Anthropic suggestion completed for ${project.name}`, {
        model,
        suggestions: parsed.suggestions.length,
      });

      return {
        success: true,
        available: true,
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        model,
        suggestions: parsed.suggestions,
        usage: toUsage(response),
        warning: parsed.warning,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = classifyAnthropicFailure(error, Boolean(params.model?.trim()));
      logger.error(`Anthropic suggestion failed for ${project.name}: ${message}`);
      return {
        success: false,
        available: failure.available,
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        model,
        statusCode: failure.statusCode,
        error: failure.message,
      };
    }
  }

  private enforceRateLimit(): void {
    const now = Date.now();
    const windowStart = now - this.config.requestWindowMs;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < windowStart) {
      this.requestTimestamps.shift();
    }

    if (this.requestTimestamps.length >= this.config.requestLimit) {
      throw new Error(
        `Anthropic request limit reached. Wait ${Math.ceil(
          this.config.requestWindowMs / 1000
        )} seconds before trying again.`
      );
    }

    this.requestTimestamps.push(now);
  }
}

/**
 * Loads Anthropic runtime config from environment variables.
 * @param env - Source environment map
 * @returns Parsed Anthropic runtime config
 * @public
 */
export function loadAnthropicRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): AnthropicRuntimeConfig {
  return {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
    maxTokens: readPositiveNumber(env.KARYA_ANTHROPIC_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    maxRetries: readPositiveNumber(env.KARYA_ANTHROPIC_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    timeoutMs: readPositiveNumber(env.KARYA_ANTHROPIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    requestLimit: readPositiveNumber(
      env.KARYA_ANTHROPIC_REQUEST_LIMIT,
      DEFAULT_REQUEST_LIMIT
    ),
    requestWindowMs: readPositiveNumber(
      env.KARYA_ANTHROPIC_REQUEST_WINDOW_MS,
      DEFAULT_REQUEST_WINDOW_MS
    ),
  };
}

function createAnthropicClient(
  config: AnthropicRuntimeConfig
): AnthropicClientLike | null {
  if (!config.apiKey) {
    return null;
  }

  return new Anthropic({
    apiKey: config.apiKey,
    maxRetries: config.maxRetries,
    timeout: config.timeoutMs,
  }) as unknown as AnthropicClientLike;
}

function toUsage(response: AnthropicResponse): SuggestionUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    totalTokens:
      (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
    cacheCreationTokens: response.usage.cache_creation_input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens,
  };
}

function classifyAnthropicFailure(
  error: unknown,
  requestedModelOverride: boolean
): {
  available: boolean;
  statusCode: number;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = readErrorStatus(error);

  if (statusCode === 429 || /request limit reached|rate limit/i.test(message)) {
    return { available: false, statusCode: 429, message };
  }

  if (statusCode === 400 && requestedModelOverride) {
    return { available: false, statusCode: 400, message };
  }

  if (statusCode === 400 && /model|unsupported/i.test(message)) {
    return { available: false, statusCode: 400, message };
  }

  if (statusCode === 401 || statusCode === 403) {
    return { available: false, statusCode: 503, message };
  }

  if (
    (typeof statusCode === 'number' && statusCode >= 500) ||
    /timeout|network|socket|ECONN|ENOTFOUND|fetch failed/i.test(message)
  ) {
    return { available: false, statusCode: 503, message };
  }

  return { available: false, statusCode: statusCode ?? 503, message };
}

function readErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
