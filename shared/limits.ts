/** Hard limits enforced by the reducer (so the UI and the server agree). */
export const LIMITS = {
  titleMax: 80,
  nameMax: 40,
  cardTextMax: 500,
  columnTitleMax: 40,
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
  votesPerPersonMin: 1,
  votesPerPersonMax: 20,
  timerMinMs: 60_000,
  timerMaxMs: 30 * 60_000,
  /** Ops a single socket may send per second before being dropped. */
  opsPerSecond: 20,
} as const;
