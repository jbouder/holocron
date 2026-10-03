/** Hard limits enforced by the reducer (so the UI and the server agree). */
export const LIMITS = {
  titleMax: 80,
  nameMax: 40,
  cardTextMax: 500,
  columnTitleMax: 40,
  columnPromptMax: 120,
  actionTextMax: 300,
  cardsMax: 500,
  columnsMax: 8,
  actionItemsMax: 100,
  /** Reactions across the whole board (each is one emoji by one person). */
  reactionsMax: 3000,
  commentTextMax: 300,
  commentsPerCardMax: 20,
  commentsMax: 500,
  participantsMax: 50,
  /** Open sockets (tabs) one participant may hold on a board. */
  socketsPerParticipant: 5,
  /** Open sockets on a board, across everyone. */
  socketsMax: 120,
  votesPerPersonMin: 1,
  votesPerPersonMax: 20,
  timerMinMs: 60_000,
  /** The timer popover offers presets up to this. */
  timerMaxMs: 15 * 60_000,
  /** Ops a single socket may send per second before being refused. */
  opsPerSecond: 20,
  /** How long an ownership handoff code works after the owner creates it. */
  handoffTtlMs: 10 * 60_000,
  /** Wrong handoff codes a board accepts per minute before refusing tries. */
  handoffAttemptsPerMinute: 5,
} as const;
