import { TimerIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Timer } from '#shared/types';
import { HelpLink } from '@/components/HelpLink';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatClock, useNow } from '@/hooks/useNow';
import {
  flashTitle,
  playChime,
  useAudioUnlock,
  useTimerSound,
} from '@/lib/timer-alert';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

const PRESETS = [1, 2, 3, 5, 10, 15];

/** A shared countdown: an SVG ring whose dashoffset eases each second. */
export function TimerControl({
  timer,
  enabled,
  onSet,
  onClear,
}: {
  timer: Timer | null;
  enabled: boolean;
  onSet: (durationMs: number) => void;
  onClear: () => void;
}) {
  const now = useNow(250);
  const [open, setOpen] = useState(false);
  const remaining = timer ? Math.max(0, timer.endsAt - now) : 0;
  const progress = timer ? remaining / timer.durationMs : 0;
  const done = timer !== null && remaining === 0;

  // Pulse once when it hits zero, not on every render afterwards.
  const [pulse, setPulse] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (done && wasRunning.current) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 1200);
      return () => window.clearTimeout(t);
    }
    wasRunning.current = timer !== null && remaining > 0;
  }, [done, timer, remaining]);

  // Chime and title flash, once per timer, and only for a timer this tab
  // saw running: rejoining a board whose timer already ran out stays quiet.
  useAudioUnlock();
  const sound = useTimerSound();
  const motion = useMotion();
  const endsAt = timer?.endsAt ?? null;
  const sawRunning = useRef<number | null>(null);
  const alerted = useRef<number | null>(null);
  const stopTitle = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (endsAt === null) return;
    if (!done) {
      sawRunning.current = endsAt;
      return;
    }
    if (sawRunning.current !== endsAt || alerted.current === endsAt) return;
    alerted.current = endsAt;
    if (sound) playChime();
    stopTitle.current?.();
    stopTitle.current = flashTitle(motion.active);
  }, [endsAt, done, sound, motion.active]);
  // A new or cleared timer, or leaving the board, puts the title back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: endsAt is the trigger, not an input
  useEffect(
    () => () => {
      stopTitle.current?.();
      stopTitle.current = null;
    },
    [endsAt],
  );

  const R = 8;
  const C = 2 * Math.PI * R;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={timer ? 'secondary' : 'ghost'}
            size="sm"
            className={cn('press tabular', pulse && 'timer-done')}
            aria-label={
              timer ? `Timer, ${formatClock(remaining)} left` : 'Set a timer'
            }
          />
        }
      >
        {timer ? (
          <svg
            viewBox="0 0 20 20"
            className="timer-ring size-4 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="2.5"
            />
            <circle
              cx="10"
              cy="10"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
            />
          </svg>
        ) : (
          <TimerIcon data-icon="inline-start" />
        )}
        {timer ? formatClock(remaining) : 'Timer'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            {enabled
              ? 'Everyone sees the same countdown.'
              : 'Only the owner can set the timer.'}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant="outline"
                disabled={!enabled}
                className="press tabular"
                onClick={() => {
                  onSet(minutes * 60_000);
                  setOpen(false);
                }}
              >
                {minutes} min
              </Button>
            ))}
          </div>
          {timer && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!enabled}
              className="press"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              <XIcon data-icon="inline-start" />
              Clear timer
            </Button>
          )}
          <HelpLink
            section="timer"
            label="Timer"
            className="justify-self-end"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
