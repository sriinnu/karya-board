/**
 * Custom hooks for parallax scroll effects and 3D transformations.
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Configuration for the useParallaxCard hook.
 * @public
 */
export interface ParallaxCardConfig {
  /** Maximum rotation in degrees (default: 12) */
  maxRotation?: number;
  /** Scale factor on hover (default: 1.02) */
  scale?: number;
  /** Perspective distance (default: 1000) */
  perspective?: number;
  /** Whether to enable the effect (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useParallaxCard hook.
 * @public
 */
export interface ParallaxCardResult<T extends HTMLElement> {
  /** Ref to attach to the card element */
  ref: React.RefObject<T>;
  /** CSS variables for transform */
  style: React.CSSProperties;
  /** Bindings to spread on the element */
  bindings: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    'data-parallax': string;
  };
}

/**
 * Hook for 3D parallax card effect following mouse movement.
 *
 * @param config - Configuration options
 * @returns Object with ref, style, and event bindings
 *
 * @example
 * ```tsx
 * const { ref, style, bindings } = useParallaxCard({ maxRotation: 15 });
 * return <div ref={ref} style={style} {...bindings}>Card content</div>;
 * ```
 *
 * @public
 */
export function useParallaxCard<T extends HTMLElement = HTMLDivElement>(
  config: ParallaxCardConfig = {}
): ParallaxCardResult<T> {
  const {
    maxRotation = 12,
    scale = 1.02,
    perspective = 1000,
    enabled = true,
  } = config;

  const ref = useRef<T>(null);
  const [transform, setTransform] = useState({ rx: 0, ry: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || !ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const mouseX = e.clientX - centerX;
      const mouseY = e.clientY - centerY;

      // Calculate rotation based on mouse position relative to center
      const rx = (mouseY / (rect.height / 2)) * -maxRotation;
      const ry = (mouseX / (rect.width / 2)) * maxRotation;

      setTransform({ rx, ry });
      setIsHovered(true);
    },
    [enabled, maxRotation]
  );

  const handleMouseLeave = useCallback(() => {
    setTransform({ rx: 0, ry: 0 });
    setIsHovered(false);
  }, []);

  const style = {
    '--rx': `${transform.rx}deg`,
    '--ry': `${transform.ry}deg`,
    '--mouse-x': `${50 + (transform.ry / maxRotation) * 25}%`,
    '--mouse-y': `${50 - (transform.rx / maxRotation) * 25}%`,
    transform: isHovered
      ? `perspective(${perspective}px) rotateX(${transform.rx}deg) rotateY(${transform.ry}deg) scale(${scale})`
      : undefined,
  } as React.CSSProperties;

  return {
    ref,
    style,
    bindings: {
      onMouseMove: handleMouseMove,
      onMouseLeave: handleMouseLeave,
      'data-parallax': enabled ? 'true' : 'false',
    },
  };
}

/**
 * Configuration for the useScrollVisibility hook.
 * @public
 */
export interface ScrollVisibilityConfig {
  /** Threshold for visibility (0-1, default: 0.1) */
  threshold?: number;
  /** Root margin for intersection observer (default: '0px') */
  rootMargin?: string;
  /** Whether to track visibility (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useScrollVisibility hook.
 * @public
 */
export interface ScrollVisibilityResult<T extends HTMLElement> {
  /** Ref to attach to the element */
  ref: React.RefObject<T>;
  /** Current visibility state */
  visibility: 'hidden' | 'entering' | 'visible' | 'exiting';
  /** Whether the element is currently visible */
  isVisible: boolean;
  /** Intersection ratio (0-1) */
  intersectionRatio: number;
}

/**
 * Hook for tracking element visibility during scroll.
 * Useful for scroll-triggered animations.
 *
 * @param config - Configuration options
 * @returns Object with ref and visibility state
 *
 * @example
 * ```tsx
 * const { ref, visibility, isVisible } = useScrollVisibility({ threshold: 0.2 });
 * return <div ref={ref} data-visibility={visibility}>Content</div>;
 * ```
 *
 * @public
 */
export function useScrollVisibility<T extends HTMLElement = HTMLDivElement>(
  config: ScrollVisibilityConfig = {}
): ScrollVisibilityResult<T> {
  const { threshold = 0.1, rootMargin = '0px', enabled = true } = config;

  const ref = useRef<T>(null);
  const [state, setState] = useState<{
    visibility: 'hidden' | 'entering' | 'visible' | 'exiting';
    intersectionRatio: number;
  }>({
    visibility: 'hidden',
    intersectionRatio: 0,
  });

  useEffect(() => {
    if (!enabled || !ref.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const ratio = entry.intersectionRatio;
          let visibility: 'hidden' | 'entering' | 'visible' | 'exiting';

          if (ratio === 0) {
            visibility = 'hidden';
          } else if (ratio < threshold) {
            visibility = 'entering';
          } else if (ratio >= 0.9) {
            visibility = 'visible';
          } else if (ratio < state.intersectionRatio) {
            visibility = 'exiting';
          } else {
            visibility = 'entering';
          }

          setState({ visibility, intersectionRatio: ratio });
        });
      },
      {
        threshold: [0, threshold, 0.5, 0.9, 1],
        rootMargin,
      }
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [enabled, threshold, rootMargin, state.intersectionRatio]);

  return {
    ref,
    visibility: state.visibility,
    isVisible: state.visibility !== 'hidden',
    intersectionRatio: state.intersectionRatio,
  };
}

/**
 * Configuration for the useParallaxScroll hook.
 * @public
 */
export interface ParallaxScrollConfig {
  /** Parallax speed factor (default: 0.1) */
  speed?: number;
  /** Whether to enable the effect (default: true) */
  enabled?: boolean;
  /** Direction of parallax (default: 'vertical') */
  direction?: 'vertical' | 'horizontal';
}

/**
 * Return type for the useParallaxScroll hook.
 * @public
 */
export interface ParallaxScrollResult<T extends HTMLElement> {
  /** Ref to attach to the element */
  ref: React.RefObject<T>;
  /** Transform style to apply */
  style: React.CSSProperties;
  /** Current scroll offset */
  offset: number;
}

/**
 * Hook for scroll-based parallax effect.
 * Elements move at different speeds as user scrolls.
 *
 * @param config - Configuration options
 * @returns Object with ref and style
 *
 * @example
 * ```tsx
 * const { ref, style } = useParallaxScroll({ speed: 0.3 });
 * return <div ref={ref} style={style}>Parallax content</div>;
 * ```
 *
 * @public
 */
export function useParallaxScroll<T extends HTMLElement = HTMLDivElement>(
  config: ParallaxScrollConfig = {}
): ParallaxScrollResult<T> {
  const { speed = 0.1, enabled = true, direction = 'vertical' } = config;

  const ref = useRef<T>(null);
  const [offset, setOffset] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setOffset(0);
      return;
    }

    const handleScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!ref.current) return;

        const rect = ref.current.getBoundingClientRect();
        const scrollProgress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
        const clampedProgress = Math.max(0, Math.min(1, scrollProgress));
        const newOffset = (clampedProgress - 0.5) * speed * 200;

        setOffset(newOffset);
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [enabled, speed]);

  const style: React.CSSProperties = direction === 'vertical'
    ? { transform: `translateY(${offset}px)` }
    : { transform: `translateX(${offset}px)` };

  return { ref, style, offset };
}

/**
 * Configuration for the useMagneticHover hook.
 * @public
 */
export interface MagneticHoverConfig {
  /** Magnetic strength (default: 0.3) */
  strength?: number;
  /** Radius of magnetic effect in pixels (default: 100) */
  radius?: number;
  /** Whether to enable the effect (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useMagneticHover hook.
 * @public
 */
export interface MagneticHoverResult<T extends HTMLElement> {
  /** Ref to attach to the element */
  ref: React.RefObject<T>;
  /** Transform style to apply */
  style: React.CSSProperties;
  /** Bindings to spread on the element */
  bindings: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
  };
}

/**
 * Hook for magnetic hover effect.
 * Elements are attracted to the cursor within a radius.
 *
 * @param config - Configuration options
 * @returns Object with ref, style, and bindings
 *
 * @example
 * ```tsx
 * const { ref, style, bindings } = useMagneticHover({ strength: 0.4 });
 * return <button ref={ref} style={style} {...bindings}>Click me</button>;
 * ```
 *
 * @public
 */
export function useMagneticHover<T extends HTMLElement = HTMLButtonElement>(
  config: MagneticHoverConfig = {}
): MagneticHoverResult<T> {
  const { strength = 0.3, radius = 100, enabled = true } = config;

  const ref = useRef<T>(null);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || !ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const distanceX = e.clientX - centerX;
      const distanceY = e.clientY - centerY;
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (distance < radius) {
        const factor = (1 - distance / radius) * strength;
        setTranslate({
          x: distanceX * factor,
          y: distanceY * factor,
        });
      } else {
        setTranslate({ x: 0, y: 0 });
      }
    },
    [enabled, radius, strength]
  );

  const handleMouseLeave = useCallback(() => {
    setTranslate({ x: 0, y: 0 });
  }, []);

  const style: React.CSSProperties = {
    transform: `translate(${translate.x}px, ${translate.y}px)`,
  };

  return {
    ref,
    style,
    bindings: {
      onMouseMove: handleMouseMove,
      onMouseLeave: handleMouseLeave,
    },
  };
}

/**
 * Hook for scroll progress tracking.
 *
 * @returns Current scroll progress (0-1)
 *
 * @example
 * ```tsx
 * const progress = useScrollProgress();
 * return <div style={{ width: `${progress * 100}%` }} />;
 * ```
 *
 * @public
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollProgress = docHeight > 0 ? scrollTop / docHeight : 0;
        setProgress(scrollProgress);
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return progress;
}
