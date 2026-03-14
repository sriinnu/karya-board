/**
 * Tests for the scan-settings modal.
 * I verify that include and exclude rules persist through the UI contract and refresh project data.
 * @packageDocumentation
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanSettingsModal } from './ScanSettingsModal';
import { useStore } from '../store';
import { resetStoreForTest } from '../test/store';

const apiMocks = vi.hoisted(() => ({
  updateProjectScanSettings: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    updateProjectScanSettings: apiMocks.updateProjectScanSettings,
  };
});

/**
 * Creates one stable project fixture for scanner-rule tests.
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
      docsCount: 1,
      artifactCount: 3,
      scannerIssues: 0,
      manualIssues: 0,
      aiIssues: 0,
      hasReadme: true,
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

describe('ScanSettingsModal', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetStoreForTest();
    apiMocks.updateProjectScanSettings.mockReset();
  });

  it('loads the existing rules and persists the edited patterns', async () => {
    const loadProjectsSpy = vi.fn().mockResolvedValue(undefined);
    const setWarningSpy = vi.fn();
    const setErrorSpy = vi.fn();
    const onClose = vi.fn();

    useStore.setState((state) => ({
      ...state,
      projects: [createProjectFixture()],
      loadProjects: loadProjectsSpy,
      setWarning: setWarningSpy,
      setError: setErrorSpy,
      ui: {
        ...state.ui,
        selectedProjectId: 'project-1',
      },
    }));

    apiMocks.updateProjectScanSettings.mockResolvedValue({
      warning: 'Scan rules were saved to karya.config.json. Restart the scanner to apply them.',
      settings: {
        include: ['src/**', 'docs/**'],
        exclude: ['dist', 'coverage'],
      },
    });

    render(<ScanSettingsModal onClose={onClose} />);

    expect(screen.getByLabelText(/include patterns/i)).toHaveValue('src/**');
    expect(screen.getByLabelText(/exclude patterns/i)).toHaveValue('dist');

    fireEvent.change(screen.getByLabelText(/include patterns/i), {
      target: { value: 'src/**\ndocs/**' },
    });
    fireEvent.change(screen.getByLabelText(/exclude patterns/i), {
      target: { value: 'dist\ncoverage' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));

    await waitFor(() => {
      expect(apiMocks.updateProjectScanSettings).toHaveBeenCalledWith('project-1', {
        include: ['src/**', 'docs/**'],
        exclude: ['dist', 'coverage'],
      });
    });

    expect(loadProjectsSpy).toHaveBeenCalledTimes(1);
    expect(setWarningSpy).toHaveBeenCalledWith(
      'Scan rules were saved to karya.config.json. Restart the scanner to apply them.'
    );
    expect(setErrorSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
