/**
 * Shared prompt and normalization helpers for AI issue suggestions.
 * I keep provider-independent review rules here so Anthropic and OpenAI produce the same board-safe output shape.
 * @packageDocumentation
 */

import type { Issue, IssuePriority } from '@karya/core';
import type { SuggestedIssue } from './ai.types.js';

/**
 * Default number of suggestions when the caller does not specify one.
 * @public
 */
export const DEFAULT_MAX_SUGGESTIONS = 4;

/**
 * Shared system prompt used across providers.
 * @public
 */
export const AI_REVIEW_SYSTEM_PROMPT = [
  'I review a local task board and return only missing, non-duplicate issues.',
  'I do not propose issues that already exist with the same intent.',
  'I keep titles concise, descriptions actionable, and priorities realistic.',
  'I never mutate state. I only emit structured suggestions for human review.',
].join(' ');

/**
 * Builds the JSON schema used for structured issue suggestions.
 * @param maxSuggestions - Maximum suggestions to request
 * @returns JSON schema object
 * @public
 */
export function buildIssueSuggestionSchema(maxSuggestions: number) {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: 1,
        maxItems: maxSuggestions,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            rationale: { type: 'string' },
          },
          required: ['title', 'description', 'priority', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  } as const;
}

/**
 * Builds the structured prompt payload reviewed by providers.
 * @param projectName - Project display name
 * @param stats - Current project stats
 * @param issues - Current project issues
 * @param prompt - Optional user guidance
 * @param maxSuggestions - Maximum suggestions to request
 * @returns Serialized prompt payload
 * @public
 */
export function buildSuggestionPrompt(
  projectName: string,
  stats: {
    total: number;
    open: number;
    inProgress: number;
    done: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  },
  issues: Issue[],
  prompt: string | undefined,
  maxSuggestions: number
): string {
  const visibleIssues = issues.slice(0, 25).map((issue) => ({
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    description: trimText(issue.description ?? '', 180),
  }));

  return JSON.stringify(
    {
      projectName,
      guidance:
        prompt?.trim() ||
        'Look for missing test, reliability, UX, and maintenance work that should be tracked but is not already on the board.',
      maxSuggestions,
      stats,
      currentIssues: visibleIssues,
      rules: [
        'Return only issues that are not already represented by the current board.',
        'Do not mention local file paths unless the user guidance explicitly includes them.',
        'Prefer actionable titles and descriptions that an engineer can implement directly.',
      ],
    },
    null,
    2
  );
}

/**
 * Normalizes raw provider suggestions into safe issue payloads.
 * @param rawSuggestions - Provider suggestions before validation
 * @param currentIssues - Existing project issues for dedupe
 * @param maxSuggestions - Maximum suggestions to keep
 * @returns Safe suggestions plus an optional warning
 * @public
 */
export function normalizeSuggestions(
  rawSuggestions: Array<{
    title?: unknown;
    description?: unknown;
    priority?: unknown;
    rationale?: unknown;
  }>,
  currentIssues: Issue[],
  maxSuggestions: number
): { suggestions: SuggestedIssue[]; warning?: string } {
  if (rawSuggestions.length === 0) {
    throw new Error('The provider did not return any structured issue suggestions.');
  }

  const seenTitles = new Set(currentIssues.map((issue) => normalizeTitle(issue.title)));
  const outputTitles = new Set<string>();
  const suggestions: SuggestedIssue[] = [];

  for (const rawSuggestion of rawSuggestions) {
    const title = trimText(readString(rawSuggestion.title), 120);
    const description = trimText(readString(rawSuggestion.description), 360);
    const rationale = trimText(readString(rawSuggestion.rationale), 220);
    const priority = normalizePriority(rawSuggestion.priority);
    const normalizedTitle = normalizeTitle(title);

    if (
      !title ||
      !description ||
      !rationale ||
      seenTitles.has(normalizedTitle) ||
      outputTitles.has(normalizedTitle)
    ) {
      continue;
    }

    outputTitles.add(normalizedTitle);
    suggestions.push({ title, description, priority, rationale });
    if (suggestions.length >= maxSuggestions) {
      break;
    }
  }

  return {
    suggestions,
    warning:
      suggestions.length === 0
        ? 'The provider returned only duplicates or invalid suggestions, so I did not keep any.'
        : suggestions.length < rawSuggestions.length
          ? 'I filtered duplicate or invalid suggestions before returning the final list.'
          : undefined,
  };
}

/**
 * Clamps the requested suggestion count into the supported range.
 * @param value - Requested suggestion count
 * @returns Safe suggestion count
 * @public
 */
export function clampMaxSuggestions(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_SUGGESTIONS;
  }

  return Math.min(8, Math.max(1, Math.floor(value as number)));
}

/**
 * Reads a positive integer from an environment variable.
 * @param value - Raw environment value
 * @param fallback - Default value when parsing fails
 * @returns Parsed integer
 * @public
 */
export function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizePriority(value: unknown): IssuePriority {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

