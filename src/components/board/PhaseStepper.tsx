import { PHASES, type Phase } from '#shared/types';
import { HelpLink } from '@/components/HelpLink';
import { cn } from '@/lib/utils';

const LABELS: Record<Phase, { title: string; hint: string }> = {
  write: { title: 'Write', hint: 'Add cards. Others are blurred.' },
  vote: { title: 'Vote', hint: 'Spend your votes.' },
  discuss: { title: 'Discuss', hint: 'Top items first. Decide.' },
};

/**
 * Three steps, one active marker. During a phase view transition the marker
 * carries `view-transition-name: phase-active` and slides to the new step.
 *
 * The marker paints its own copy of the label, so the white text travels
 * with it. The button's real label stays muted underneath: were the button
 * itself to turn white, the live page would do so at once while the marker
 * is still on its way, and the label would vanish against the background
 * until it arrived.
 */
export function PhaseStepper({
  phase,
  enabled,
  onChange,
}: {
  phase: Phase;
  enabled: boolean;
  onChange: (phase: Phase) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <fieldset className="flex items-center rounded-lg border bg-muted/40 p-0.5">
        <legend className="sr-only">Phase</legend>
        {PHASES.map((p, i) => {
          const active = p === phase;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              disabled={!enabled && !active}
              onClick={() => enabled && onChange(p)}
              className={cn(
                'press relative flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground outline-ring/50 transition-colors focus-visible:outline-2',
                !active && 'hover:text-foreground',
                !enabled &&
                  !active &&
                  'cursor-default opacity-60 hover:text-muted-foreground',
              )}
            >
              <span className="tabular opacity-70">{i + 1}</span>
              {LABELS[p].title}
              {active && (
                <span
                  aria-hidden="true"
                  className="phase-active absolute inset-0 flex items-center gap-1.5 rounded-md bg-foreground px-3 text-background"
                >
                  <span className="tabular opacity-70">{i + 1}</span>
                  {LABELS[p].title}
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
      <p
        className="hidden text-xs text-muted-foreground sm:block"
        aria-live="polite"
      >
        {LABELS[phase].hint}
      </p>
      <HelpLink section="phases" label="Phases" className="-ml-1.5" />
    </div>
  );
}
