/** The DOM-free parts of the timer alert, so tests can run them in workerd. */

export const TIME_UP_TITLE = "⏰ Time's up";

/** Off only when explicitly stored as off. Unset, or unreadable, means on. */
export function parseTimerSound(stored: string | null): boolean {
  return stored !== 'off';
}

/**
 * The title for one tick of the flash. With motion it alternates between
 * the alert and the page title; without, it holds the alert until focus.
 */
export function alertTitle(
  original: string,
  tick: number,
  animate: boolean,
): string {
  if (!animate) return `${TIME_UP_TITLE} · ${original}`;
  return tick % 2 === 0 ? TIME_UP_TITLE : original;
}
