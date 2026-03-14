/**
 * Provider failure classification tests for native AI integrations.
 * I verify incompatible model overrides are surfaced as unavailable request targets.
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, ProjectStats } from '@karya/core';
import { AnthropicIssueSuggester, type AnthropicRuntimeConfig } from './anthropic.js';
import { OpenAIIssueSuggester, type OpenAIRuntimeConfig } from './openai.js';

const PROJECT_STATS: ProjectStats = {
  total: 0,
  open: 0,
  inProgress: 0,
  done: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
};

test('I mark invalid OpenAI model overrides as unavailable request targets', async () => {
  const suggester = new OpenAIIssueSuggester(
    createDbStub(),
    createOpenAIConfig(),
    {
      responses: {
        create: async () => {
          throw withStatus(new Error('Unsupported model override'), 400);
        },
      },
    }
  );

  const result = await suggester.suggestIssues({ projectId: 'project-1', model: 'bad-model' });
  assert.equal(result.success, false);
  assert.equal(result.available, false);
  assert.equal(result.statusCode, 400);
});

test('I mark invalid Anthropic model overrides as unavailable request targets', async () => {
  const suggester = new AnthropicIssueSuggester(
    createDbStub(),
    createAnthropicConfig(),
    {
      messages: {
        create: async () => {
          throw withStatus(new Error('Unsupported model override'), 400);
        },
      },
    }
  );

  const result = await suggester.suggestIssues({ projectId: 'project-1', model: 'bad-model' });
  assert.equal(result.success, false);
  assert.equal(result.available, false);
  assert.equal(result.statusCode, 400);
});

function createDbStub(): Database {
  return {
    getProjectById: () => ({
      id: 'project-1',
      name: 'Project One',
      path: '/tmp/project-one',
      createdAt: new Date().toISOString(),
    }),
    getProjectStats: () => PROJECT_STATS,
    getIssuesByProject: () => [],
  } as unknown as Database;
}

function createOpenAIConfig(): OpenAIRuntimeConfig {
  return {
    apiKey: 'test-key',
    model: 'gpt-5.1',
    maxTokens: 1200,
    maxRetries: 1,
    timeoutMs: 1000,
    requestLimit: 6,
    requestWindowMs: 60000,
  };
}

function createAnthropicConfig(): AnthropicRuntimeConfig {
  return {
    apiKey: 'test-key',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1200,
    maxRetries: 1,
    timeoutMs: 1000,
    requestLimit: 6,
    requestWindowMs: 60000,
  };
}

function withStatus(error: Error, status: number): Error & { status: number } {
  return Object.assign(error, { status });
}
