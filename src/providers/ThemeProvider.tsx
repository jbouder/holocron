import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { withViewTransition } from '@/lib/motion';
import { useMotion } from '@/providers/MotionProvider';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'holocron:theme';

interface ThemeContextValue {
  theme: Theme;
  /** Flip the theme inside a short crossfade (a view transition). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** index.html already applied this before first paint; read it back. */
function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still changes for this session.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { active } = useMotion();
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    // The class has to change inside the transition callback so the "new"
    // snapshot is taken in the new theme; the state update follows.
    withViewTransition(
      () => {
        apply(next);
        setTheme(next);
      },
      active,
      'theme',
    );
  }, [theme, active]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
