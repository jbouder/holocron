import { CopyIcon } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useState } from 'react';
import { CODE_LENGTH, isValidCode, normalizeCode } from '#shared/codes';
import type { HandoffResponse } from '#shared/protocol';
import { HelpLink } from '@/components/HelpLink';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRemaining, useNow } from '@/hooks/useNow';
import { ApiError, redeemHandoff, startHandoff } from '@/lib/api';
import { useIdentity } from '@/lib/identity';
import { useToast } from '@/providers/ToastProvider';
import { CopyButton } from './ShareDialog';

/**
 * Owner side of a handoff: create a one-time code to read to the next owner.
 * The code is never shown again; closing the dialog leaves it working until
 * it expires, and creating another cancels it.
 */
export function HandoffDialog({
  open,
  onOpenChange,
  code,
  ownerToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  ownerToken: string | null;
}) {
  const toast = useToast();
  const now = useNow();
  const [handoff, setHandoff] = useState<HandoffResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setHandoff(null);
    }
  }, [open]);

  async function create() {
    if (!ownerToken) {
      toast.show('This browser does not hold the owner key for this board');
      return;
    }
    setBusy(true);
    try {
      setHandoff(await startHandoff(code, ownerToken));
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'Could not create a handoff code',
      );
    } finally {
      setBusy(false);
    }
  }

  const expired = handoff !== null && handoff.expiresAt <= now;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand off this board</DialogTitle>
          <DialogDescription>
            Give ownership to someone already on the board. They choose Claim
            ownership from the board menu and enter the code. It works once, and
            you stop being the owner when they use it.
          </DialogDescription>
        </DialogHeader>
        {handoff && !expired ? (
          <>
            <p className="code-display my-2 text-center text-4xl font-semibold tracking-[0.35em]">
              {handoff.code}
            </p>
            <p className="text-center text-xs text-muted-foreground tabular">
              Expires in {formatRemaining(handoff.expiresAt - now)}. Creating
              another code cancels this one.
            </p>
            <DialogFooter>
              <Button variant="ghost" className="press" onClick={create}>
                New code
              </Button>
              <CopyButton
                text={handoff.code}
                label="Copy code"
                icon={<CopyIcon data-icon="inline-start" />}
                variant="default"
              />
            </DialogFooter>
          </>
        ) : (
          <>
            {expired && (
              <p className="text-sm text-muted-foreground">
                That code expired. Create a new one.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                className="press"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button className="press" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create handoff code'}
              </Button>
            </DialogFooter>
          </>
        )}
        {/* Last in the DOM so the dialog's initial focus skips it. */}
        <HelpLink
          section="ownership"
          label="Ownership and handoff"
          className="absolute top-2 right-10 size-7"
        />
      </DialogContent>
    </Dialog>
  );
}

/** Participant side: redeem a handoff code to become the owner. */
export function ClaimOwnershipDialog({
  open,
  onOpenChange,
  code,
  onClaimed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  onClaimed: (ownerToken: string) => void;
}) {
  const identity = useIdentity();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
    }
  }, [open]);

  const handoffCode = normalizeCode(value);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isValidCode(handoffCode)) {
      setError(`A handoff code is ${CODE_LENGTH} letters and digits`);
      return;
    }
    setBusy(true);
    try {
      const { ownerToken } = await redeemHandoff(code, {
        participantId: identity.id,
        secret: identity.secret,
        code: handoffCode,
      });
      onClaimed(ownerToken);
      onOpenChange(false);
      toast.show('You own this board now');
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'Could not claim the board',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Claim ownership</DialogTitle>
            <DialogDescription>
              Enter the handoff code the owner gave you. This browser becomes
              the board's owner.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="handoff-code">Handoff code</Label>
            <Input
              id="handoff-code"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value.toUpperCase());
                setError(null);
              }}
              placeholder="ABC123"
              maxLength={CODE_LENGTH + 2}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'handoff-error' : undefined}
              className="code-display h-9 text-base"
            />
            {error && (
              <p id="handoff-error" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              className="press"
              disabled={busy || !handoffCode}
            >
              {busy ? 'Claiming…' : 'Claim ownership'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
