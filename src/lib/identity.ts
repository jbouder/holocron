import { useSyncExternalStore } from 'react';

/**
 * Who you are on this device. No accounts: a random id, a random secret and
 * a display name in localStorage. Owner tokens for boards you created live
 * beside it.
 *
 * The id is public (it is on every card you sign). The secret is what stops
 * someone else on the board from connecting as you: a board binds the id to
 * the secret's hash the first time it sees it.
 */

export interface Identity {
  id: string;
  secret: string;
  name: string;
}

const KEY = 'holocron:identity';
const OWNER_PREFIX = 'holocron:owner:';

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (typeof parsed.id === 'string' && parsed.id) {
        const identity: Identity = {
          id: parsed.id,
          // Identities saved before secrets existed get one now.
          secret:
            typeof parsed.secret === 'string' && parsed.secret
              ? parsed.secret
              : randomSecret(),
          name: typeof parsed.name === 'string' ? parsed.name : '',
        };
        if (identity.secret !== parsed.secret) {
          write(identity);
        }
        return identity;
      }
    }
  } catch {
    // Fall through to a fresh identity.
  }
  const fresh: Identity = {
    id: crypto.randomUUID(),
    secret: randomSecret(),
    name: '',
  };
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
