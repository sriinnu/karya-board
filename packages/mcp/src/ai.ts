/**
 * Provider-neutral AI suggestion selector for Karya.
 * I choose the active provider, expose aggregate status, and keep MCP/HTTP/UI insulated from provider-specific details.
 * @packageDocumentation
 */

import type { Database } from '@karya/core';
import { AnthropicIssueSuggester } from './anthropic.js';
import { OpenAIIssueSuggester } from './openai.js';
import type {
  AIProvider,
  AIStatus,
  IssueSuggesterProvider,
  SuggestIssuesParams,
  SuggestIssuesResult,
} from './ai.types.js';

interface AIIssueSuggesterOptions {
  /** Override environment source for provider selection */
  env?: NodeJS.ProcessEnv;
  /** Optional Anthropic provider override */
  anthropic?: IssueSuggesterProvider;
  /** Optional OpenAI provider override */
  openai?: IssueSuggesterProvider;
}

/**
 * Provider-neutral issue suggester.
 * @public
 */
export class AiIssueSuggester {
  private readonly env: NodeJS.ProcessEnv;
  private readonly providers: Record<AIProvider, IssueSuggesterProvider>;

  /**
   * Creates a new AI issue suggester.
   * @param db - Backing Karya database
   * @param options - Provider overrides for tests or custom runtimes
   */
  constructor(db: Database, options: AIIssueSuggesterOptions = {}) {
    this.env = options.env ?? process.env;
    this.providers = {
      anthropic: options.anthropic ?? new AnthropicIssueSuggester(db),
      openai: options.openai ?? new OpenAIIssueSuggester(db),
    };
  }

  /**
   * Returns aggregate provider readiness for the UI and API.
   * @returns Provider-neutral status payload
   */
  public getStatus(): AIStatus {
    const providers = [this.providers.anthropic.getStatus(), this.providers.openai.getStatus()];
    const defaultProvider = resolveActiveProvider(providers, this.env.KARYA_AI_PROVIDER);

    return {
      available: providers.some((provider) => provider.available),
      defaultProvider,
      providers,
    };
  }

  /**
   * Routes a suggestion request to the selected provider.
   * @param params - Suggestion request payload
   * @returns Provider result payload
   */
  public async suggestIssues(params: SuggestIssuesParams): Promise<SuggestIssuesResult> {
    const status = this.getStatus();
    const provider = params.provider ?? status.defaultProvider;
    const configuredProvider = normalizeProvider(this.env.KARYA_AI_PROVIDER);

    if (!params.provider && configuredProvider && !status.defaultProvider) {
      return {
        success: false,
        available: false,
        provider: configuredProvider,
        model: null,
        statusCode: 503,
        error: `Configured default AI provider "${configuredProvider}" is not available. Fix that provider or choose another provider explicitly.`,
      };
    }

    if (!provider) {
      return {
        success: false,
        available: false,
        provider: null,
        model: null,
        statusCode: 503,
        error:
          'No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable issue suggestions.',
      };
    }

    return this.providers[provider].suggestIssues({
      ...params,
      provider,
    });
  }
}

function resolveActiveProvider(
  providers: ReturnType<AiIssueSuggester['getStatus']>['providers'],
  configuredProvider: string | undefined
): AIProvider | null {
  const normalized = normalizeProvider(configuredProvider);
  if (normalized) {
    return providers.find((provider) => provider.provider === normalized)?.available
      ? normalized
      : null;
  }

  return providers.find((provider) => provider.available)?.provider ?? null;
}

function normalizeProvider(value: string | undefined): AIProvider | null {
  return value === 'anthropic' || value === 'openai' ? value : null;
}
