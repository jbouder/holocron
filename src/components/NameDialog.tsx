import { type FormEvent, useEffect, useState } from 'react';
import { LIMITS } from '#shared/limits';
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
import { setName, useIdentity } from '@/lib/identity';

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true the dialog cannot be dismissed without a name (joining a board). */
  required?: boolean;
}

/** Sets the display name stored on this device. */
export function NameDialog({
  open,
  onOpenChange,
  required = false,
}: NameDialogProps) {
  const identity = useIdentity();
  const [value, setValue] = useState(identity.name);

  useEffect(() => {
    if (open) {
      setValue(identity.name);
    }
  }, [open, identity.name]);

  const trimmed = value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) {
      return;
    }
    setName(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && required && !identity.name) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!required || Boolean(identity.name)}>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {identity.name ? 'Change your name' : 'What should we call you?'}
            </DialogTitle>
            <DialogDescription>
              Shown on your cards and in the list of who is here. Stored only in
              this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="display-name">Name</Label>
            <Input
              id="display-name"
              autoFocus
              autoComplete="nickname"
              maxLength={LIMITS.nameMax}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Leia"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!trimmed} className="press">
              {identity.name ? 'Save' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
