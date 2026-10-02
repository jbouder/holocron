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

/**
 * The fixed reaction set. No free-form emoji: a short list keeps reactions a
 * quick signal and the document small.
 */
export const REACTIONS = [
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '😂', label: 'Laughing' },
  { emoji: '🎉', label: 'Party' },
  { emoji: '🤔', label: 'Thinking' },
] as const;

export type ReactionEmoji = (typeof REACTIONS)[number]['emoji'];

export const REACTION_EMOJI = REACTIONS.map((r) => r.emoji) as [
  ReactionEmoji,
  ...ReactionEmoji[],
];

/** One participant's reaction to a card. Separate from votes. */
export interface Reaction {
  cardId: string;
  participantId: string;
  emoji: ReactionEmoji;
}

export interface Comment {
  id: string;
  cardId: string;
  authorId: string;
  /** Snapshot of the author's name. Empty when anonymous. */
  authorName: string;
  anonymous: boolean;
  text: string;
  createdAt: number;
  /** Set when the author edits it. */
  editedAt: number | null;
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
  reactions: Reaction[];
  comments: Comment[];
  actionItems: ActionItem[];
  participants: Participant[];
}

/**
 * Who is performing an operation. The server derives this from the socket.
 *
 * Anonymous cards and comments reach clients with an empty `authorId`, so a
 * client cannot tell who wrote them from the document. The author's own
 * client instead learns which ones are theirs from the two id lists (sent
 * in `you` on the snapshot and on echoes of their own ops). On the server
 * the document holds the real author ids and the lists are not needed.
 *
 * `id` is empty on an echo of an anonymous author's op to everyone else, so
 * the echo does not reveal them either; `withParticipant` ignores it.
 */
export interface Actor {
  id: string;
  name: string;
  isOwner: boolean;
  anonymousCardIds?: readonly string[];
  anonymousCommentIds?: readonly string[];
}

/** Enough of an actor to decide whether something is theirs. */
export type Viewer = Pick<
  Actor,
  'id' | 'anonymousCardIds' | 'anonymousCommentIds'
>;

export const DEFAULT_SETTINGS: Settings = {
  votesPerPerson: 5,
  anonymousAllowed: true,
  blurDuringWrite: true,
  facilitatorOnly: false,
};
