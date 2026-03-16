/**
 * App footer component with copyright and live ECG animation.
 * @packageDocumentation
 */

/**
 * Footer component displaying copyright and animated ECG line.
 * @public
 */
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <svg
        className="ecg-icon"
        width="32"
        height="20"
        viewBox="0 0 32 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="ecg-line"
          d="M0 10 L6 10 L8 10 L10 4 L12 16 L14 8 L16 12 L18 10 L24 10 L26 10 L28 6 L30 14 L32 10"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="app-footer-divider" aria-hidden="true" />
      <span>© 2000–{currentYear} Srinivas Pendela</span>
      <span className="app-footer-divider" aria-hidden="true" />
      <a href="https://github.com/sriinnu/karya-board" target="_blank" rel="noopener noreferrer">
        Karya Board
      </a>
    </footer>
  );
}
