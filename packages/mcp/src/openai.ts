/**
 * Native OpenAI provider for Karya issue suggestions.
 * I keep the OpenAI SDK, Responses API call, and compatible base URL support here.
 * @packageDocumentation
 */

import OpenAI from 'openai';
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
 * OpenAI runtime config.
 * @public
 */
export interface OpenAIRuntimeConfig {
  /** OpenAI API key, or null when integration is disabled */
  apiKey: string | null;
  /** Optional base URL for OpenAI-compatible gateways */
  baseURL?: string;
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

const DEFAULT_MODEL = 'gpt-5.1';
const DEFAULT_MAX_TOKENS = 1_200;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_LIMIT = 6;
const DEFAULT_REQUEST_WINDOW_MS = 60_000;
const FUNCTION_NAME = 'emit_issue_suggestions';
const logger = createLogger('openai');

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIClientLike {
  responses: {
    create: (payload: unknown) => Promise<OpenAIResponse>;
  };
}

/**
 * OpenAI-backed issue suggester.
 * @public
 */
export class OpenAIIssueSuggester implements IssueSuggesterProvider {
  private readonly db: Database;
  private readonly config: OpenAIRuntimeConfig;
  private readonly client: OpenAIClientLike | null;
  private readonly requestTimestamps: number[] = [];

  /**
   * Creates a new OpenAI suggester.
   * @param db - Backing Karya database
   * @param config - OpenAI runtime config
   * @param client - Optional client override for tests
   */
  constructor(
    db: Database,
    config: OpenAIRuntimeConfig = loadOpenAIRuntimeConfig(),
    client?: OpenAIClientLike
  ) {
    this.db = db;
    this.config = config;
    this.client = client ?? createOpenAIClient(config);
  }

  /**
   * Returns current OpenAI readiness.
   * @returns Provider status snapshot
   */
  public getStatus(): AIProviderStatus {
    if (!this.config.apiKey) {
      return {
        provider: 'openai',
        label: 'OpenAI',
        available: false,
        defaultModel: null,
        reason: 'Set OPENAI_API_KEY to enable OpenAI issue suggestions.',
        requestLimit: this.config.requestLimit,
        requestWindowMs: this.config.requestWindowMs,
      };
    }

    return {
      provider: 'openai',
      label: 'OpenAI',
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
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: null,
        statusCode: 503,
        error: status.reason ?? 'OpenAI is not configured.',
      };
    }

    const project = this.db.getProjectById(params.projectId);
    if (!project) {
      return {
        success: false,
        available: true,
        provider: 'openai',
        providerLabel: 'OpenAI',
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
      const response = await this.client.responses.create({
        model,
        instructions: AI_REVIEW_SYSTEM_PROMPT,
        input: buildSuggestionPrompt(
          project.name,
          this.db.getProjectStats(project.id),
          currentIssues,
          params.prompt,
          maxSuggestions
        ),
        max_output_tokens: this.config.maxTokens,
        temperature: 0.2,
        store: false,
        tools: [
          {
            type: 'function',
            name: FUNCTION_NAME,
            description: 'Return only the reviewed issue suggestions for explicit human approval.',
            parameters: buildIssueSuggestionSchema(maxSuggestions),
            strict: true,
          },
        ],
        tool_choice: {
          type: 'function',
          name: FUNCTION_NAME,
        },
      });

      const payload = readSuggestionPayload(response);
      const parsed = normalizeSuggestions(payload.suggestions ?? [], currentIssues, maxSuggestions);

      logger.info(`OpenAI suggestion completed for ${project.name}`, {
        model,
        suggestions: parsed.suggestions.length,
      });

      return {
        success: true,
        available: true,
        provider: 'openai',
        providerLabel: 'OpenAI',
        model,
        suggestions: parsed.suggestions,
        usage: toUsage(response),
        warning: parsed.warning,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = classifyOpenAIFailure(error, Boolean(params.model?.trim()));
      logger.error(`OpenAI suggestion failed for ${project.name}: ${message}`);
      return {
        success: false,
        available: failure.available,
        provider: 'openai',
        providerLabel: 'OpenAI',
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
        `OpenAI request limit reached. Wait ${Math.ceil(
          this.config.requestWindowMs / 1000
        )} seconds before trying again.`
      );
    }

    this.requestTimestamps.push(now);
  }
}

/**
 * Loads OpenAI runtime config from environment variables.
 * @param env - Source environment map
 * @returns Parsed OpenAI runtime config
 * @public
 */
export function loadOpenAIRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): OpenAIRuntimeConfig {
  return {
    apiKey: env.OPENAI_API_KEY?.trim() || null,
    baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    maxTokens: readPositiveNumber(env.KARYA_OPENAI_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    maxRetries: readPositiveNumber(env.KARYA_OPENAI_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    timeoutMs: readPositiveNumber(env.KARYA_OPENAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    requestLimit: readPositiveNumber(env.KARYA_OPENAI_REQUEST_LIMIT, DEFAULT_REQUEST_LIMIT),
    requestWindowMs: readPositiveNumber(
      env.KARYA_OPENAI_REQUEST_WINDOW_MS,
      DEFAULT_REQUEST_WINDOW_MS
    ),
  };
}

function createOpenAIClient(config: OpenAIRuntimeConfig): OpenAIClientLike | null {
  if (!config.apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: config.maxRetries,
    timeout: config.timeoutMs,
  }) as unknown as OpenAIClientLike;
}

function readSuggestionPayload(response: OpenAIResponse): {
  suggestions?: Array<{
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    rationale?: unknown;
  }>;
} {
  const functionArguments = response.output?.find(
    (item) => item.type === 'function_call' && item.name === FUNCTION_NAME
  )?.arguments;
  if (typeof functionArguments === 'string') {
    return parseSuggestionJson(functionArguments, 'OpenAI returned invalid function arguments JSON');
  }

  const outputText =
    response.output_text ??
    response.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === 'output_text' && typeof content.text === 'string')
      ?.text;

  if (!outputText) {
    throw new Error('OpenAI did not return any structured issue suggestions.');
  }

  return parseSuggestionJson(outputText, 'OpenAI returned invalid structured JSON');
}

function toUsage(response: OpenAIResponse): SuggestionUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    totalTokens: response.usage.total_tokens,
  };
}

function parseSuggestionJson(
  rawJson: string,
  prefix: string
): {
  suggestions?: Array<{
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    rationale?: unknown;
  }>;
} {
  try {
    return JSON.parse(rawJson) as {
      suggestions?: Array<{
        title?: unknown;
        description?: unknown;
        priority?: unknown;
        rationale?: unknown;
      }>;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${prefix}: ${message}`);
  }
}

function classifyOpenAIFailure(
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

  if (
    statusCode === 404 &&
    /responses|function call|not found|not implemented|unsupported/i.test(message)
  ) {
    return {
      available: false,
      statusCode: 503,
      message:
        'The configured OpenAI endpoint does not support the Responses API function-calling contract required for AI suggestions.',
    };
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
