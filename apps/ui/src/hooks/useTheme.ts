/**
 * Theme management hook for dark/light mode switching.
 * @packageDocumentation
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Available theme modes.
 * @public
 */
export type Theme = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'karya-theme';

/**
 * Check if localStorage is available.
 * @internal
 */
function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const testKey = '__test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Hook for managing theme (dark/light mode).
 *
 * @returns Object with current theme state and toggle function
 *
 * @example
 * ```tsx
 * const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
 * ```
 *
 * @public
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const storage = getLocalStorage();
    if (!storage) return 'system';
    const stored = storage.getItem(THEME_STORAGE_KEY) as Theme | null;
    return stored ?? 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Update resolved theme based on theme preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia) {
      // Fallback for test environments without matchMedia
      setResolvedTheme(theme === 'dark' ? 'dark' : 'light');
      return;
    }

    const updateResolvedTheme = () => {
      if (theme === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setResolvedTheme(systemDark ? 'dark' : 'light');
      } else {
        setResolvedTheme(theme);
      }
    };

    updateResolvedTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        updateResolvedTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(THEME_STORAGE_KEY, newTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark',
  };
}
