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
  participantsMax: 50,
  votesPerPersonMin: 1,
  votesPerPersonMax: 20,
  timerMinMs: 60_000,
  timerMaxMs: 30 * 60_000,
  /** Ops a single socket may send per second before being dropped. */
  opsPerSecond: 20,
} as const;
