import { describe, expect, it } from 'vitest';
import { nextResetAt, zonedParts } from '#shared/reset-time';

const TZ = 'America/New_York';

function at(iso: string): number {
  return Date.parse(iso);
}

function etParts(ts: number) {
  const p = zonedParts(ts, TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

describe('nextResetAt', () => {
  it('is 6 AM ET later today when created before 6 AM ET', () => {
    // 05:59 EDT = 09:59 UTC
    const now = at('2026-07-15T09:59:00Z');
    const next = nextResetAt(now, TZ, 6);
    expect(etParts(next)).toBe('2026-07-15 06:00');
    expect(next).toBe(at('2026-07-15T10:00:00Z'));
    expect(next - now).toBe(60_000);
  });

  it('is 6 AM ET tomorrow when created at or after 6 AM ET', () => {
    const exactly = at('2026-07-15T10:00:00Z');
    expect(etParts(nextResetAt(exactly, TZ, 6))).toBe('2026-07-16 06:00');

    const evening = at('2026-07-15T23:30:00Z'); // 19:30 EDT
    expect(etParts(nextResetAt(evening, TZ, 6))).toBe('2026-07-16 06:00');
  });

  it('handles the evening in ET being the next day in UTC', () => {
    // 22:00 EST on Jan 10 is 03:00 UTC on Jan 11.
    const now = at('2026-01-11T03:00:00Z');
    expect(etParts(nextResetAt(now, TZ, 6))).toBe('2026-01-11 06:00');
    expect(nextResetAt(now, TZ, 6)).toBe(at('2026-01-11T11:00:00Z'));
  });

  it('is 23 hours apart across the spring-forward night', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 in New York.
    const before = at('2026-03-07T12:00:00Z'); // noon UTC, 07:00 EST
    const first = nextResetAt(before, TZ, 6); // Mar 8 06:00 EDT = 10:00 UTC
    const second = nextResetAt(first, TZ, 6); // Mar 9 06:00 EDT = 10:00 UTC
    expect(first).toBe(at('2026-03-08T10:00:00Z'));
    expect(second - first).toBe(24 * 3_600_000);
    const prev = nextResetAt(at('2026-03-06T12:00:00Z'), TZ, 6); // Mar 7 06:00 EST = 11:00 UTC
    expect(first - prev).toBe(23 * 3_600_000);
  });

  it('is 25 hours apart across the fall-back night', () => {
    // 2026-11-01: clocks fall back 02:00 → 01:00 in New York.
    const oct31 = nextResetAt(at('2026-10-30T12:00:00Z'), TZ, 6); // Oct 31 06:00 EDT = 10:00 UTC
    const nov1 = nextResetAt(oct31, TZ, 6); // Nov 1 06:00 EST = 11:00 UTC
    expect(oct31).toBe(at('2026-10-31T10:00:00Z'));
    expect(nov1).toBe(at('2026-11-01T11:00:00Z'));
    expect(nov1 - oct31).toBe(25 * 3_600_000);
  });

  it('respects other zones and hours', () => {
    const now = at('2026-07-15T12:00:00Z');
    const london = nextResetAt(now, 'Europe/London', 9); // 09:00 BST = 08:00 UTC next day
    expect(london).toBe(at('2026-07-16T08:00:00Z'));
    const tokyo = nextResetAt(now, 'Asia/Tokyo', 0); // midnight JST = 15:00 UTC today
    expect(tokyo).toBe(at('2026-07-15T15:00:00Z'));
  });

  it('is always strictly in the future', () => {
    let now = at('2026-01-01T00:00:00Z');
    for (let i = 0; i < 400; i++) {
      const next = nextResetAt(now, TZ, 6);
      expect(next).toBeGreaterThan(now);
      expect(etParts(next).endsWith('06:00')).toBe(true);
      now = next;
    }
  });
});
