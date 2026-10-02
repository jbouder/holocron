import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, deleteBoard } from '@/lib/api';
import { clearOwnerToken } from '@/lib/identity';
import { forgetBoard } from '@/lib/recent-boards';
import { navigate } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

export function DeleteBoardDialog({
  open,
  onOpenChange,
  code,
  title,
  ownerToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  title: string;
  ownerToken: string | null;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!ownerToken) {
      toast.show('This browser does not hold the owner key for this board');
      return;
    }
    setBusy(true);
    try {
      await deleteBoard(code, ownerToken);
      clearOwnerToken(code);
      forgetBoard(code);
      onOpenChange(false);
      navigate({ name: 'home' }, { replace: true });
      toast.show(`Deleted "${title}"`);
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'Could not delete the board',
      );
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this board?</DialogTitle>
          <DialogDescription>
            "{title}" disappears for everyone right now. Nothing is kept, and
            there is no undo. Export first if you need the content.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            className="press"
            onClick={() => onOpenChange(false)}
          >
            Keep it
          </Button>
          <Button
            variant="destructive"
            className="press"
            disabled={busy}
            onClick={confirm}
          >
            {busy ? 'Deleting…' : 'Delete board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
