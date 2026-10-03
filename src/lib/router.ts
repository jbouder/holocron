import { useSyncExternalStore } from 'react';
import { isValidCode, normalizeCode } from '#shared/codes';

/**
 * A small `history.pushState` router with one dynamic segment. Route changes
 * go through `runTransition`, which the app points at `withViewTransition`
 * so navigation animates as a page transition.
 */

export type GoneReason =
  | 'expired'
  | 'deleted'
  | 'missing'
  | 'refused'
  | 'full'
  | 'replaced'
  | 'removed';

export type Route =
  | { name: 'home' }
  | { name: 'board'; code: string }
  | { name: 'help'; section?: string }
  | { name: 'gone'; reason: GoneReason; code?: string };

export function parse(pathname: string, hash = ''): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (clean === '/') {
    return { name: 'home' };
  }
  if (clean === '/help') {
    const section = decodeURIComponent(hash.replace(/^#/, ''));
    return section ? { name: 'help', section } : { name: 'help' };
  }
  const board = clean.match(/^\/b\/([^/]+)$/);
  if (board) {
    const code = normalizeCode(decodeURIComponent(board[1]));
    return isValidCode(code)
      ? { name: 'board', code }
      : { name: 'gone', reason: 'missing', code };
  }
  return { name: 'home' };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'help':
      return route.section
        ? `/help#${encodeURIComponent(route.section)}`
        : '/help';
    case 'board':
      return `/b/${route.code}`;
    case 'gone':
      return route.code ? `/b/${route.code}` : '/';
  }
}

function here(): string {
  return window.location.pathname + window.location.hash;
}

let current: Route = parse(window.location.pathname, window.location.hash);
const listeners = new Set<() => void>();

type Transition = (update: () => void) => void;
let runTransition: Transition = (update) => update();

/** The app shell installs the view-transition wrapper here. */
export function setRouteTransition(transition: Transition) {
  runTransition = transition;
}

function commit(next: Route) {
  const update = () => {
    current = next;
    for (const listener of listeners) {
      listener();
    }
  };
  // Moving between sections of the same page is a scroll, not a page change.
  if (next.name === 'help' && current.name === 'help') {
    update();
    return;
  }
  runTransition(update);
}

export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const path = pathFor(route);
  if (options.replace) {
    window.history.replaceState(null, '', path);
  } else if (path !== here()) {
    window.history.pushState(null, '', path);
  }
  commit(route);
}

/** Show the "gone" page for the current board without changing the URL. */
export function markGone(reason: GoneReason, code?: string) {
  commit({ name: 'gone', reason, code });
}

window.addEventListener('popstate', () => {
  commit(parse(window.location.pathname, window.location.hash));
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** For real anchors: middle-click and "open in new tab" keep working. */
export function linkProps(route: Route) {
  return {
    href: pathFor(route),
    onClick(event: React.MouseEvent<HTMLAnchorElement>) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(route);
    },
  };
}
