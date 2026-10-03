import { LIMITS } from '#shared/limits';
import type { Op } from '#shared/protocol';
import type { Board } from '#shared/types';
import { HelpLink } from '@/components/HelpLink';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Owner-only board settings. Each change is an op, applied live. */
export function SettingsDialog({
  open,
  onOpenChange,
  board,
  dispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  dispatch: (op: Op) => void;
}) {
  const s = board.settings;
  const update = (settings: Partial<Board['settings']>) =>
    dispatch({ type: 'updateSettings', settings });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription>
            Changes apply to everyone immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid grid-cols-[1fr_5rem] items-center gap-3">
            <div>
              <Label htmlFor="votes-per-person">Votes per person</Label>
              <p className="text-xs text-muted-foreground">
                {LIMITS.votesPerPersonMin}–{LIMITS.votesPerPersonMax}. Spent
                across the board.
              </p>
            </div>
            <Input
              id="votes-per-person"
              type="number"
              inputMode="numeric"
              min={LIMITS.votesPerPersonMin}
              max={LIMITS.votesPerPersonMax}
              value={s.votesPerPerson}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (
                  n >= LIMITS.votesPerPersonMin &&
                  n <= LIMITS.votesPerPersonMax
                ) {
                  update({ votesPerPerson: n });
                }
              }}
              className="tabular"
            />
          </div>

          <Row
            id="blur"
            label="Blur others' cards while writing"
            hint="Keeps people from anchoring on the first card posted."
            checked={s.blurDuringWrite}
            onChange={(v) => update({ blurDuringWrite: v })}
          />
          <Row
            id="anon"
            label="Allow anonymous cards"
            hint="Each card has its own checkbox."
            checked={s.anonymousAllowed}
            onChange={(v) => update({ anonymousAllowed: v })}
          />
          <Row
            id="facilitator"
            label="Only I can facilitate"
            hint="Phase, timer, board title, columns and moving cards become owner-only."
            checked={s.facilitatorOnly}
            onChange={(v) => update({ facilitatorOnly: v })}
          />
        </div>
        {/* Last in the DOM so the dialog's initial focus skips it. */}
        <HelpLink
          section="ownership"
          label="Ownership and settings"
          className="absolute top-2 right-10 size-7"
        />
      </DialogContent>
    </Dialog>
  );
}

function Row({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
