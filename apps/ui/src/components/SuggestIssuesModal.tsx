/**
 * Native AI suggestion modal for Karya.
 * I keep the flow review-first so provider output stays visible before any issue is created.
 * @packageDocumentation
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { fetchAiStatus, suggestIssues, type AiProvider } from '../api';
import type { AiStatus, SuggestedIssue, SuggestionUsage } from '../ai.types';
import { useStore } from '../store';
import { AiSuggestionResults } from './AiSuggestionResults';
import { findProviderStatus, toSuggestionIssueInput, toSuggestionKey } from './ai-review';
import { getFocusableElements } from './dialog-focus';

interface SuggestIssuesModalProps {
  /** Callback when the modal should close */
  onClose: () => void;
}

/**
 * Review modal for safe AI issue suggestions.
 * @param props - Component props
 * @public
 */
export function SuggestIssuesModal({ onClose }: SuggestIssuesModalProps) {
  const { projects, ui, createIssue } = useStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(ui.selectedProjectId ?? projects[0]?.id ?? '');
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | ''>('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [maxSuggestions, setMaxSuggestions] = useState(4);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultWarning, setResultWarning] = useState<string | null>(null);
  const [resultProviderLabel, setResultProviderLabel] = useState<string | null>(null);
  const [resultModel, setResultModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<SuggestionUsage | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedIssue[]>([]);
  const [createdKeys, setCreatedKeys] = useState<string[]>([]);
  const providerStatus = findProviderStatus(status, selectedProvider);
  const providerUnavailableReason = providerStatus && !providerStatus.available
    ? providerStatus.reason ?? `${providerStatus.label} is not available in this environment.`
    : null;
  const clearGeneratedResults = () => {
    setResultError(null);
    setResultWarning(null);
    setResultProviderLabel(null);
    setResultModel(null);
    setUsage(null);
    setSuggestions([]);
    setCreatedKeys([]);
  };

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    promptRef.current?.focus();

    return () => previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextStatus = await fetchAiStatus();
        if (!active) {
          return;
        }
        setStatus(nextStatus);
        const nextProvider = nextStatus.defaultProvider ?? nextStatus.providers[0]?.provider ?? '';
        setSelectedProvider(nextProvider);
        const nextProviderStatus = findProviderStatus(nextStatus, nextProvider);
        setModel(nextProviderStatus?.defaultModel ?? '');
      } catch (error) {
        if (active) {
          setStatusError(error instanceof Error ? error.message : 'Failed to load AI status');
        }
      } finally {
        if (active) {
          setIsLoadingStatus(false);
        }
      }
    })();

    return () => { active = false; };
  }, []);

  const handleOverlayClick = (event: MouseEvent) => {
    if (!isGenerating && !isApplying && event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!isGenerating && !isApplying) {
        event.preventDefault();
        onClose();
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleProviderChange = (provider: AiProvider) => {
    clearGeneratedResults();
    setSelectedProvider(provider);
    setModel(findProviderStatus(status, provider)?.defaultModel ?? '');
  };

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !selectedProvider || providerUnavailableReason) {
      return;
    }

    setIsGenerating(true);
    clearGeneratedResults();

    try {
      const result = await suggestIssues({
        projectId: selectedProjectId,
        provider: selectedProvider,
        model: model.trim() || undefined,
        prompt: prompt.trim() || undefined,
        maxSuggestions,
      });
      setSuggestions(result.suggestions);
      setUsage(result.usage);
      setResultProviderLabel(result.providerLabel ?? null);
      setResultModel(result.model);
      setResultWarning(result.warning);
    } catch (error) {
      setSuggestions([]);
      setUsage(null);
      setResultProviderLabel(null);
      setResultModel(null);
      setResultError(error instanceof Error ? error.message : 'Failed to generate suggestions');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateOne = async (suggestion: SuggestedIssue) => {
    if (!selectedProjectId) {
      return;
    }

    setIsApplying(true);
    setResultError(null);
    try {
      await createIssue(toSuggestionIssueInput(selectedProjectId, suggestion));
      setCreatedKeys((current) => [...current, toSuggestionKey(suggestion)]);
    } catch (error) {
      setResultError(error instanceof Error ? error.message : 'Failed to create issue from suggestion');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCreateAll = async () => {
    const pending = suggestions.filter((suggestion) => !createdKeys.includes(toSuggestionKey(suggestion)));
    if (!selectedProjectId || pending.length === 0) {
      return;
    }

    let createdCount = 0;
    setIsApplying(true);
    setResultError(null);
    try {
      for (const suggestion of pending) {
        await createIssue(toSuggestionIssueInput(selectedProjectId, suggestion));
        createdCount += 1;
        setCreatedKeys((current) => [...current, toSuggestionKey(suggestion)]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create suggested issues';
      setResultError(
        createdCount > 0
          ? `${message} I already created ${createdCount} suggestion${createdCount === 1 ? '' : 's'} before the failure.`
          : message
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isGenerating || isApplying}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="modal-header">
          <div>
            <p className="modal-kicker">Native AI Review</p>
            <h2 id={titleId} className="modal-title">Review issue suggestions</h2>
            <p id={descriptionId} className="modal-subtitle">I ask the selected provider for missing work and only create issues after you approve them.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Close modal"
            disabled={isGenerating || isApplying}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleGenerate}>
          <div className="modal-body">
            {statusError && <div className="error-banner" role="alert">{statusError}</div>}
            {resultError && <div className="error-banner" role="alert">{resultError}</div>}
            {resultWarning && <div className="notice-inline" role="status">{resultWarning}</div>}

            {isLoadingStatus ? (
              <div className="modal-loading-copy">I am checking AI provider readiness...</div>
            ) : !status?.providers.length ? (
              <div className="notice-inline" role="status">
                No built-in AI provider is configured in this environment.
              </div>
            ) : (
              <>
                {providerUnavailableReason && (
                  <div className="notice-inline" role="status">
                    {providerUnavailableReason}
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="suggest-project">
                      Project
                    </label>
                    <select
                      id="suggest-project"
                      value={selectedProjectId}
                      onChange={(event) => {
                        clearGeneratedResults();
                        setSelectedProjectId(event.target.value);
                      }}
                      className="select"
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <div className="form-hint">I review one tracked project at a time.</div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="suggest-provider">
                      Provider
                    </label>
                    <select
                      id="suggest-provider"
                      value={selectedProvider}
                      onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
                      className="select"
                    >
                      {status.providers.map((provider) => (
                        <option key={provider.provider} value={provider.provider}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <div className="form-hint">This only changes which provider generates the suggestions.</div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="suggest-model">
                      Model
                    </label>
                    <input
                      id="suggest-model"
                      value={model}
                      onChange={(event) => {
                        clearGeneratedResults();
                        setModel(event.target.value);
                      }}
                      className="input"
                      placeholder={providerStatus?.defaultModel ?? 'Enter a provider model'}
                    />
                    <div className="form-hint">I pass this model string directly to the selected provider.</div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="suggest-limit">
                      Suggestions
                    </label>
                    <select
                      id="suggest-limit"
                      value={maxSuggestions}
                      onChange={(event) => {
                        clearGeneratedResults();
                        setMaxSuggestions(Number(event.target.value));
                      }}
                      className="select"
                    >
                      <option value={3}>3 suggestions</option>
                      <option value={4}>4 suggestions</option>
                      <option value={6}>6 suggestions</option>
                    </select>
                    <div className="form-hint">I cap the request so the review stays focused across models.</div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="suggest-prompt">
                    Guidance
                  </label>
                  <textarea
                    id="suggest-prompt"
                    ref={promptRef}
                    value={prompt}
                    onChange={(event) => {
                      clearGeneratedResults();
                      setPrompt(event.target.value);
                    }}
                    className="textarea"
                    placeholder="Focus on missing tests, operations, UX, multi-provider gaps, or another area you want reviewed."
                  />
                  <div className="form-hint">I send project context, issue summaries, provider settings, and this prompt.</div>
                </div>

                <AiSuggestionResults
                  providerLabel={resultProviderLabel}
                  model={resultModel}
                  usage={usage}
                  suggestions={suggestions}
                  createdKeys={createdKeys}
                  isApplying={isApplying}
                  onCreateOne={(suggestion) => {
                    void handleCreateOne(suggestion);
                  }}
                />
              </>
            )}
          </div>

          <div className="modal-footer">
            <div className="form-hint">
              Suggestions stay review-only until you explicitly create them.
            </div>
            <div className="modal-actions">
              {suggestions.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    void handleCreateAll();
                  }}
                  className="btn btn-secondary"
                  disabled={isApplying}
                >
                  {isApplying ? 'Creating...' : 'Create All'}
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  isGenerating ||
                  isApplying ||
                  isLoadingStatus ||
                  !selectedProjectId ||
                  !selectedProvider ||
                  Boolean(providerUnavailableReason)
                }
              >
                {isGenerating ? 'Generating...' : 'Generate Suggestions'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
