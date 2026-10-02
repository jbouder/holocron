/**
 * The board document. One of these lives inside each board's Durable Object
 * and is mirrored on every connected client. Everything that changes it goes
 * through `reduce()` in ./reducer.ts, on both sides.
 */

export type Phase = 'write' | 'vote' | 'discuss';

export const PHASES: readonly Phase[] = ['write', 'vote', 'discuss'];

export interface Settings {
  /** Dot votes each participant may spend across the board. */
  votesPerPerson: number;
  /** Whether a card may be posted without an author name. */
  anonymousAllowed: boolean;
  /** Blur other people's cards during the Write phase. */
  blurDuringWrite: boolean;
  /** Only the board owner may change phase, timer, columns and settings. */
  facilitatorOnly: boolean;
}

export interface Column {
  id: string;
  title: string;
  position: number;
}

export interface Card {
  id: string;
  columnId: string;
  /** Cards sharing a groupId render as one stack. */
  groupId: string | null;
  authorId: string;
  /** Snapshot of the author's name at posting time. Empty when anonymous. */
  authorName: string;
  anonymous: boolean;
  text: string;
  position: number;
  createdAt: number;
}

export interface Vote {
  cardId: string;
  participantId: string;
  count: number;
}

export interface ActionItem {
  id: string;
  text: string;
  owner: string;
  done: boolean;
  createdAt: number;
}

export interface Participant {
  id: string;
  name: string;
  /** Has at least one open socket right now. Not persisted. */
  online: boolean;
}

export interface Timer {
  /** Epoch ms when the timer reaches zero. */
  endsAt: number;
  durationMs: number;
}

export interface Board {
  code: string;
  title: string;
  template: string;
  phase: Phase;
  createdAt: number;
  /** Epoch ms of the daily wipe. */
  expiresAt: number;
  ownerId: string;
  settings: Settings;
  timer: Timer | null;
  columns: Column[];
  cards: Card[];
  votes: Vote[];
  actionItems: ActionItem[];
  participants: Participant[];
}

/** Who is performing an operation. The server derives this from the socket. */
export interface Actor {
  id: string;
  name: string;
  isOwner: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  votesPerPerson: 5,
  anonymousAllowed: true,
  blurDuringWrite: true,
  facilitatorOnly: false,
};
