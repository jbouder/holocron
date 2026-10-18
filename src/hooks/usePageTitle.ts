import { useEffect } from 'react';

const APP = 'Holocron';

/**
 * Give each page its own tab title (WCAG 2.4.2), e.g. "Help · Holocron".
 * No argument is the bare app name, for the home page.
 *
 * Keep user content out of it: titles land in browser history, which
 * outlives the daily wipe. A board code is fine (it is already in the URL);
 * a board title is not.
 */
export function usePageTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} · ${APP}` : APP;
  }, [page]);
}
