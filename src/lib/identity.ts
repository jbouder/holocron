import { useSyncExternalStore } from 'react';

/**
 * Who you are on this device. No accounts: a random id and a display name in
 * localStorage. Owner tokens for boards you created live beside it.
 */

export interface Identity {
  id: string;
  name: string;
}

const KEY = 'holocron:identity';
const OWNER_PREFIX = 'holocron:owner:';

function read(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (typeof parsed.id === 'string' && parsed.id) {
        return {
          id: parsed.id,
          name: typeof parsed.name === 'string' ? parsed.name : '',
        };
      }
    }
  } catch {
    // Fall through to a fresh identity.
  }
  const fresh = { id: crypto.randomUUID(), name: '' };
  write(fresh);
  return fresh;
}

function write(identity: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Private mode: the identity lives for this page load only.
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getIdentity(): Identity {
  return current;
}

export function setName(name: string) {
  current = { ...current, name: name.trim() };
  write(current);
  for (const listener of listeners) {
    listener();
  }
}

export function useIdentity(): Identity {
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

export function getOwnerToken(code: string): string | null {
  try {
    return localStorage.getItem(OWNER_PREFIX + code);
  } catch {
    return null;
  }
}

export function setOwnerToken(code: string, token: string) {
  try {
    localStorage.setItem(OWNER_PREFIX + code, token);
  } catch {
    // Without storage the owner can still delete during this page load.
  }
}

export function clearOwnerToken(code: string) {
  try {
    localStorage.removeItem(OWNER_PREFIX + code);
  } catch {
    // Nothing to clear.
  }
}

/** Two letters for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
