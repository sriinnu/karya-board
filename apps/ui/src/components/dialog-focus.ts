/**
 * Shared modal focus helpers.
 * I centralize tabbable-element lookup here so every dialog uses the same keyboard behavior.
 * @packageDocumentation
 */

/**
 * Returns visible, tabbable descendants inside a dialog root.
 * @param root - Dialog root element
 * @returns Ordered list of focusable elements
 * @public
 */
export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true'
  );
}
