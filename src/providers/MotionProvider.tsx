import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

const STORAGE_KEY = 'holocron:motion';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

interface MotionContextValue {
  /** The per-device preference, from Preferences. */
  preference: boolean;
  /** The OS setting. A hard override: when true, nothing animates. */
  reduced: boolean;
  /** What the app actually does: preference AND NOT reduced. */
  active: boolean;
  setPreference: (on: boolean) => void;
}

const MotionContext = createContext<MotionContextValue | null>(null);

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function subscribeReduced(callback: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getReduced() {
  return window.matchMedia(REDUCE_QUERY).matches;
}

/**
 * One attribute on <html> drives the CSS side (`html[data-motion="off"]`
 * zeroes every duration); the JS helpers read `active` directly.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(readPreference);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced);
  const active = preference && !reduced;

  useEffect(() => {
    document.documentElement.dataset.motion = active ? 'on' : 'off';
  }, [active]);

  const value = useMemo<MotionContextValue>(
    () => ({
      preference,
      reduced,
      active,
      setPreference: (on) => {
        setPreferenceState(on);
        try {
          localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
        } catch {
          // Private mode: the choice lasts for this page load.
        }
      },
    }),
    [preference, reduced, active],
  );

  return (
    <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
  );
}

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionContext);
  if (!ctx) {
    throw new Error('useMotion must be used inside MotionProvider');
  }
  return ctx;
}
