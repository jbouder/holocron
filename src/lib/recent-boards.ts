import { useSyncExternalStore } from 'react';

/** Boards this browser has opened, so the home page can offer them back. */
export interface RecentBoard {
  code: string;
  title: string;
  expiresAt: number;
  openedAt: number;
  owner: boolean;
}

const KEY = 'holocron:recent';
const MAX = 8;

function read(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentBoard[]) : [];
    return prune(list);
  } catch {
    return [];
  }
}

function prune(list: RecentBoard[]): RecentBoard[] {
  const now = Date.now();
  return list
    .filter((b) => b.expiresAt > now)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX);
}

let current = read();
const listeners = new Set<() => void>();

function write(list: RecentBoard[]) {
  current = prune(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: fine, the list is a convenience.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function rememberBoard(board: Omit<RecentBoard, 'openedAt'>) {
  write([
    { ...board, openedAt: Date.now() },
    ...current.filter((b) => b.code !== board.code),
  ]);
}

export function forgetBoard(code: string) {
  write(current.filter((b) => b.code !== code));
}

export function useRecentBoards(): RecentBoard[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
