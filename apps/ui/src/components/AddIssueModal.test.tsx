import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddIssueModal } from './AddIssueModal';
import { useStore } from '../store';
import { resetStoreForTest } from '../test/store';

/**
 * Creates a minimal project fixture for modal tests.
 * @returns Project payload required by store state
 * @internal
 */
function createProjectFixture() {
  return {
    id: 'project-1',
    name: 'Project One',
    path: '/tmp/project-one',
    createdAt: Date.now(),
  };
}

describe('AddIssueModal accessibility behavior', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetStoreForTest();
    useStore.setState({
      projects: [createProjectFixture()],
      ui: {
        ...useStore.getState().ui,
        selectedProjectId: 'project-1',
      },
    });
  });

  it('focuses the title input on open and restores previous focus on unmount', () => {
    const previouslyFocused = document.createElement('button');
    previouslyFocused.type = 'button';
    previouslyFocused.textContent = 'Launch';
    document.body.appendChild(previouslyFocused);
    previouslyFocused.focus();

    const onClose = vi.fn();
    const view = render(<AddIssueModal onClose={onClose} />);

    expect(screen.getByLabelText(/title/i)).toHaveFocus();

    view.unmount();
    expect(previouslyFocused).toHaveFocus();
    previouslyFocused.remove();
  });

  it('closes on Escape when not submitting', () => {
    const onClose = vi.fn();
    render(<AddIssueModal onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus within the dialog when tabbing at boundaries', () => {
    const onClose = vi.fn();
    render(<AddIssueModal onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    const closeButton = screen.getByRole('button', { name: /close modal/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(cancelButton).toHaveFocus();

    cancelButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });
});
