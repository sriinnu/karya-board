/**
 * Tests for the native AI suggestion modal.
 * I verify provider readiness messaging and explicit user approval before any issue write happens.
 * @packageDocumentation
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuggestIssuesModal } from './SuggestIssuesModal';
import { useStore } from '../store';
import { resetStoreForTest } from '../test/store';

const apiMocks = vi.hoisted(() => ({
  fetchAiStatus: vi.fn(),
  suggestIssues: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchAiStatus: apiMocks.fetchAiStatus,
    suggestIssues: apiMocks.suggestIssues,
  };
});

/**
 * Creates one stable project fixture for modal tests.
 * @returns Minimal project record for the mocked store
 * @internal
 */
function createProjectFixture() {
  return {
    id: 'project-1',
    name: 'Project One',
    path: '/tmp/project-one',
    createdAt: Date.now(),
    stats: {
      total: 0,
      open: 0,
      inProgress: 0,
      done: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    analytics: {
      urgentCount: 0,
      completionRate: 0,
      docsCount: 0,
      artifactCount: 0,
      scannerIssues: 0,
      manualIssues: 0,
      aiIssues: 0,
      hasReadme: false,
      hasArchitecture: false,
      hasSpec: false,
    },
    documents: [],
    scanSettings: {
      include: ['src/**'],
      exclude: ['dist'],
    },
  };
}

describe('SuggestIssuesModal', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetStoreForTest();
    apiMocks.fetchAiStatus.mockReset();
    apiMocks.suggestIssues.mockReset();
    useStore.setState((state) => ({
      ...state,
      projects: [createProjectFixture()],
      ui: {
        ...state.ui,
        selectedProjectId: 'project-1',
      },
    }));
  });

  it('shows the selected provider readiness reason when no provider is available', async () => {
    apiMocks.fetchAiStatus.mockResolvedValue({
      available: false,
      defaultProvider: null,
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          available: false,
          defaultModel: null,
          reason: 'Set ANTHROPIC_API_KEY to enable Anthropic issue suggestions.',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
        {
          provider: 'openai',
          label: 'OpenAI',
          available: false,
          defaultModel: null,
          reason: 'Set OPENAI_API_KEY to enable OpenAI issue suggestions.',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
      ],
    });

    render(<SuggestIssuesModal onClose={() => undefined} />);

    expect(
      await screen.findByText(/Set ANTHROPIC_API_KEY to enable Anthropic issue suggestions/i)
    ).toBeInTheDocument();
  });

  it('creates a suggestion only after explicit user approval', async () => {
    const createIssueSpy = vi.fn().mockResolvedValue(undefined);
    useStore.setState((state) => ({
      ...state,
      createIssue: createIssueSpy,
    }));

    apiMocks.fetchAiStatus.mockResolvedValue({
      available: true,
      defaultProvider: 'openai',
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          available: true,
          defaultModel: 'claude-sonnet-4-20250514',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
        {
          provider: 'openai',
          label: 'OpenAI',
          available: true,
          defaultModel: 'gpt-5.4',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
      ],
    });
    apiMocks.suggestIssues.mockResolvedValue({
      provider: 'openai',
      providerLabel: 'OpenAI',
      model: 'gpt-5.4',
      suggestions: [
        {
          title: 'Missing reliability test coverage',
          description: 'I suggest adding a regression case for warning-free mutation flows.',
          priority: 'high',
          rationale:
            'The current flow depends on non-fatal warning handling and should stay covered.',
        },
      ],
      usage: { inputTokens: 120, outputTokens: 44 },
      warning: null,
    });

    render(<SuggestIssuesModal onClose={() => undefined} />);

    await screen.findByRole('button', { name: /generate suggestions/i });
    fireEvent.click(screen.getByRole('button', { name: /generate suggestions/i }));

    await waitFor(() => {
      expect(apiMocks.suggestIssues).toHaveBeenCalledWith({
        projectId: 'project-1',
        provider: 'openai',
        model: 'gpt-5.4',
        prompt: undefined,
        maxSuggestions: 4,
      });
    });

    expect(
      await screen.findByText('Missing reliability test coverage')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(createIssueSpy).toHaveBeenCalledWith({
        projectId: 'project-1',
        title: 'Missing reliability test coverage',
        description:
          'I suggest adding a regression case for warning-free mutation flows.\n\nWhy now: The current flow depends on non-fatal warning handling and should stay covered.',
        priority: 'high',
        status: 'open',
      });
    });
  });

  it('updates the model field when I switch providers', async () => {
    apiMocks.fetchAiStatus.mockResolvedValue({
      available: true,
      defaultProvider: 'openai',
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          available: true,
          defaultModel: 'claude-sonnet-4-20250514',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
        {
          provider: 'openai',
          label: 'OpenAI',
          available: true,
          defaultModel: 'gpt-5.4',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
      ],
    });

    render(<SuggestIssuesModal onClose={() => undefined} />);

    const modelInput = await screen.findByLabelText(/model/i);
    expect(modelInput).toHaveValue('gpt-5.4');

    fireEvent.change(screen.getByLabelText(/provider/i), {
      target: { value: 'anthropic' },
    });

    expect(modelInput).toHaveValue('claude-sonnet-4-20250514');
  });

  it('clears stale suggestions when I change the selected provider', async () => {
    apiMocks.fetchAiStatus.mockResolvedValue({
      available: true,
      defaultProvider: 'openai',
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          available: true,
          defaultModel: 'claude-sonnet-4-20250514',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
        {
          provider: 'openai',
          label: 'OpenAI',
          available: true,
          defaultModel: 'gpt-5.4',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
      ],
    });
    apiMocks.suggestIssues.mockResolvedValue({
      provider: 'openai',
      providerLabel: 'OpenAI',
      model: 'gpt-5.4',
      suggestions: [
        {
          title: 'Missing reliability test coverage',
          description: 'I suggest adding a regression case for warning-free mutation flows.',
          priority: 'high',
          rationale: 'The current flow depends on non-fatal warning handling and should stay covered.',
        },
      ],
      usage: { inputTokens: 120, outputTokens: 44 },
      warning: null,
    });

    render(<SuggestIssuesModal onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /generate suggestions/i }));
    expect(await screen.findByText('Missing reliability test coverage')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } });

    await waitFor(() => {
      expect(screen.queryByText('Missing reliability test coverage')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/model/i)).toHaveValue('claude-sonnet-4-20250514');
  });

  it('keeps already-created suggestions marked when create all stops on a later failure', async () => {
    const createIssueSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Second create failed'));
    useStore.setState((state) => ({
      ...state,
      createIssue: createIssueSpy,
    }));

    apiMocks.fetchAiStatus.mockResolvedValue({
      available: true,
      defaultProvider: 'openai',
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic',
          available: true,
          defaultModel: 'claude-sonnet-4-20250514',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
        {
          provider: 'openai',
          label: 'OpenAI',
          available: true,
          defaultModel: 'gpt-5.4',
          requestLimit: 6,
          requestWindowMs: 60_000,
        },
      ],
    });
    apiMocks.suggestIssues.mockResolvedValue({
      provider: 'openai',
      providerLabel: 'OpenAI',
      model: 'gpt-5.4',
      suggestions: [
        {
          title: 'First suggestion',
          description: 'First description',
          priority: 'high',
          rationale: 'First rationale',
        },
        {
          title: 'Second suggestion',
          description: 'Second description',
          priority: 'medium',
          rationale: 'Second rationale',
        },
      ],
      usage: { inputTokens: 120, outputTokens: 44 },
      warning: null,
    });

    render(<SuggestIssuesModal onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /generate suggestions/i }));
    expect(await screen.findByText('First suggestion')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create all/i }));

    await waitFor(() => {
      expect(createIssueSpy).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/already created 1 suggestion before the failure/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Created$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeInTheDocument();
  });
});
