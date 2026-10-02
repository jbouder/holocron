import { useEffect, useRef } from 'react';
import { useTheme } from '@/providers/ThemeProvider';

/**
 * Cloudflare Turnstile, rendered explicitly so React owns its lifetime. Only
 * mounted when the deployment turned Turnstile on (AppConfig.turnstileSiteKey).
 * Tokens are single-use: remount it (change its `key`) to get a fresh one.
 */

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not load'));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(script);
  });
  return loading;
}

export function Turnstile({
  siteKey,
  action,
  onToken,
  onError,
}: {
  siteKey: string;
  action: string;
  /** A fresh token, or null when the last one expired. */
  onToken: (token: string | null) => void;
  /** The script failed to load. Widget errors show inside the widget. */
  onError?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode } = useTheme();
  // Callbacks change every render; the widget should not.
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) {
          return;
        }
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          action,
          theme: mode,
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => handlers.current.onToken(null),
        });
      })
      .catch(() => handlers.current.onError?.());
    return () => {
      cancelled = true;
      if (widgetId !== null) {
        window.turnstile?.remove(widgetId);
      }
    };
  }, [siteKey, action, mode]);

  return <div ref={ref} className="min-h-[65px]" />;
}
