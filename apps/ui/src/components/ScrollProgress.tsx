/**
 * Scroll progress indicator component.
 * Shows a progress bar at the top of the page that fills as user scrolls.
 * @packageDocumentation
 */

import { useScrollProgress } from '../hooks/useParallax';

/**
 * Scroll progress indicator that displays at the top of the viewport.
 * @public
 */
export function ScrollProgress() {
  const progress = useScrollProgress();

  return (
    <div className="scroll-progress" aria-hidden="true">
      <div
        className="scroll-progress-bar"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
