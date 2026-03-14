/**
 * Header behavior tests for the Spanda shell.
 * I verify that the sticky header tightens into island mode after scroll.
 * @packageDocumentation
 */

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

vi.mock('./BrandMark', () => ({
  BrandMark: () => <div data-testid="brand-mark" />,
}));

/**
 * I render the header with a minimal stable prop set for behavior tests.
 * @returns Testing Library render result
 * @internal
 */
function renderHeader() {
  return render(
    <Header
      onAddIssue={() => undefined}
      onSuggestIssues={() => undefined}
      onScannerAction={() => undefined}
      onRefresh={() => undefined}
      projectCount={3}
      selectedProjectName="All Projects"
      scannerProjectCount={1}
    />
  );
}

describe('Header island compression', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 0);
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tightens into island mode after the user scrolls past the threshold', () => {
    const { container } = renderHeader();
    const header = container.querySelector('.header');

    expect(header).not.toHaveClass('is-condensed');

    Object.defineProperty(window, 'scrollY', {
      value: 120,
      configurable: true,
      writable: true,
    });
    act(() => {
      fireEvent.scroll(window);
      vi.runAllTimers();
    });

    expect(header).toHaveClass('is-condensed');

    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });
    act(() => {
      fireEvent.scroll(window);
      vi.runAllTimers();
    });

    expect(header).not.toHaveClass('is-condensed');
  });
});
