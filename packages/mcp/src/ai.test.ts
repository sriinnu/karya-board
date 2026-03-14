/**
 * Unit tests for provider-neutral AI routing.
 * I verify the selector does not silently cross providers when one is explicitly pinned.
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@karya/core';
import { AiIssueSuggester } from './ai.js';
import type {
  AIProviderStatus,
  IssueSuggesterProvider,
  SuggestIssuesParams,
  SuggestIssuesResult,
} from './ai.types.js';

/**
 * Verifies explicit provider pinning fails closed when that provider is unavailable.
 */
test('I fail closed when the configured default provider is unavailable', async () => {
  let anthropicCalls = 0;
  const suggester = new AiIssueSuggester({} as Database, {
    env: { KARYA_AI_PROVIDER: 'openai' },
    anthropic: createProvider(
      {
        provider: 'anthropic',
        label: 'Anthropic',
        available: true,
        defaultModel: 'claude-sonnet-4-20250514',
        requestLimit: 6,
        requestWindowMs: 60_000,
      },
      async () => {
        anthropicCalls += 1;
        return successResult('anthropic');
      }
    ),
    openai: createProvider({
      provider: 'openai',
      label: 'OpenAI',
      available: false,
      defaultModel: null,
      reason: 'Set OPENAI_API_KEY to enable OpenAI issue suggestions.',
      requestLimit: 6,
      requestWindowMs: 60_000,
    }),
  });

  const status = suggester.getStatus();
  assert.equal(status.defaultProvider, null);

  const result = await suggester.suggestIssues({ projectId: 'project-1' });
  assert.equal(result.success, false);
  assert.equal(result.provider, 'openai');
  assert.equal(result.statusCode, 503);
  assert.match(result.error ?? '', /configured default ai provider "openai" is not available/i);
  assert.equal(anthropicCalls, 0);
});

/**
 * Verifies unpinned selection still chooses the first available provider.
 */
test('I choose the first available provider when no default provider is pinned', () => {
  const suggester = new AiIssueSuggester({} as Database, {
    env: {},
    anthropic: createProvider({
      provider: 'anthropic',
      label: 'Anthropic',
      available: true,
      defaultModel: 'claude-sonnet-4-20250514',
      requestLimit: 6,
      requestWindowMs: 60_000,
    }),
    openai: createProvider({
      provider: 'openai',
      label: 'OpenAI',
      available: false,
      defaultModel: null,
      reason: 'Set OPENAI_API_KEY to enable OpenAI issue suggestions.',
      requestLimit: 6,
      requestWindowMs: 60_000,
    }),
  });

  const status = suggester.getStatus();
  assert.equal(status.defaultProvider, 'anthropic');
});

function createProvider(
  status: AIProviderStatus,
  suggestIssues: (params: SuggestIssuesParams) => Promise<SuggestIssuesResult> = async () => ({
    success: false,
    available: status.available,
    provider: status.provider,
    model: status.defaultModel,
    statusCode: status.available ? 400 : 503,
    error: status.reason ?? 'Provider is unavailable.',
  })
): IssueSuggesterProvider {
  return {
    getStatus: () => status,
    suggestIssues,
  };
}

function successResult(provider: 'anthropic' | 'openai'): SuggestIssuesResult {
  return {
    success: true,
    available: true,
    provider,
    model: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-5.1',
    suggestions: [],
  };
}
