import { describe, expect, it } from 'vitest';
import {
  alertTitle,
  parseTimerSound,
  TIME_UP_TITLE,
} from '../src/lib/timer-alert-text';

describe('timer alert', () => {
  it('defaults the sound on unless stored as off', () => {
    expect(parseTimerSound(null)).toBe(true);
    expect(parseTimerSound('on')).toBe(true);
    expect(parseTimerSound('off')).toBe(false);
  });

  it('alternates the title when motion is on', () => {
    expect(alertTitle('Retro', 0, true)).toBe(TIME_UP_TITLE);
    expect(alertTitle('Retro', 1, true)).toBe('Retro');
    expect(alertTitle('Retro', 2, true)).toBe(TIME_UP_TITLE);
  });

  it('holds a static title when motion is off', () => {
    const still = alertTitle('Retro', 0, false);
    expect(still).toContain(TIME_UP_TITLE);
    expect(still).toContain('Retro');
    expect(alertTitle('Retro', 1, false)).toBe(still);
  });
});
