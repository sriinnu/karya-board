/**
 * Shared brand mark for the Spanda surface.
 * I keep the asset usage centralized so the shell stays visually consistent.
 * @packageDocumentation
 */

interface BrandMarkProps {
  /** Optional size treatment for the rendered mark */
  size?: 'default' | 'compact';
  /** Optional motion variant for the rendered mark */
  variant?: 'static' | 'breathe' | 'orbit' | 'signal';
}

/**
 * Renders the shared brand asset.
 * @param props - Component props
 * @public
 */
export function BrandMark({ size = 'default', variant = 'static' }: BrandMarkProps) {
  const className = size === 'compact' ? 'brand-mark brand-mark-compact' : 'brand-mark';
  const sourceByVariant: Record<NonNullable<BrandMarkProps['variant']>, string> = {
    static: '/karya.svg',
    breathe: '/spanda-breathe.svg',
    orbit: '/spanda-orbit.svg',
    signal: '/spanda-signal.svg',
  };

  return (
    <div className={className} aria-hidden="true">
      {/* I reuse the same SVG in docs and the product shell so the brand stays aligned. */}
      <img src={sourceByVariant[variant]} alt="" className="brand-mark-image" />
    </div>
  );
}
