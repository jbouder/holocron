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
import {
  isThemeId,
  migrateThemeId,
  PALETTE_IDS,
  type ThemeId,
  themeOption,
} from '@/lib/themes';
import { useMotion } from '@/providers/MotionProvider';

const STORAGE_KEY = 'holocron:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  /** What the person picked, `system` included. */
  theme: ThemeId;
  /** Light or dark after resolving `system` and the theme's base. */
  mode: 'light' | 'dark';
  /** Switch theme inside a short crossfade (a view transition). */
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** No saved choice (or an unknown one) means follow the OS. */
function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const saved = migrateThemeId(stored);
    if (isThemeId(saved)) {
      if (saved !== stored) {
        // Rewrite a retired id so the inline script needs no mapping later.
        localStorage.setItem(STORAGE_KEY, saved);
      }
      return saved;
    }
  } catch {
    // Blocked storage: follow the OS.
  }
  return 'system';
}

function systemDark(): boolean {
  return matchMedia(DARK_QUERY).matches;
}

function resolveMode(theme: ThemeId): 'light' | 'dark' {
  const { base } = themeOption(theme);
  if (base === 'system') {
    return systemDark() ? 'dark' : 'light';
  }
  return base;
}

/** Same logic as the inline script in index.html. */
function apply(theme: ThemeId) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolveMode(theme) === 'dark');
  if (PALETTE_IDS.includes(theme)) {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}

function save(theme: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still changes for this session.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { active } = useMotion();
  const [theme, setThemeState] = useState<ThemeId>(readTheme);
  const [mode, setMode] = useState(() => resolveMode(theme));

  useEffect(() => {
    apply(theme);
    setMode(resolveMode(theme));
  }, [theme]);

  // Following the OS: re-resolve when it flips.
  useEffect(() => {
    if (theme !== 'system') {
      return;
    }
    const query = matchMedia(DARK_QUERY);
    const onChange = () => {
      withViewTransition(
        () => {
          apply('system');
          setMode(resolveMode('system'));
        },
        active,
        'theme',
      );
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme, active]);

  const setTheme = useCallback(
    (next: ThemeId) => {
      if (next === theme) {
        return;
      }
      save(next);
      // The DOM has to change inside the transition callback so the "new"
      // snapshot is taken in the new theme; the state update follows.
      withViewTransition(
        () => {
          apply(next);
          setThemeState(next);
          setMode(resolveMode(next));
        },
        active,
        'theme',
      );
    },
    [theme, active],
  );

  const value = useMemo(
    () => ({ theme, mode, setTheme }),
    [theme, mode, setTheme],
  );

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
