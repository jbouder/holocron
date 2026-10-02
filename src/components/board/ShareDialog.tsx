import { CheckIcon, CopyIcon, LinkIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { pathFor } from '@/lib/router';

export function ShareDialog({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
}) {
  const link = new URL(
    pathFor({ name: 'board', code }),
    window.location.origin,
  ).toString();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this board</DialogTitle>
          <DialogDescription>
            Anyone with the code can join. Read it out, or send the link.
          </DialogDescription>
        </DialogHeader>
        <p className="code-display my-2 text-center text-4xl font-semibold tracking-[0.35em]">
          {code}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton
            text={code}
            label="Copy code"
            icon={<CopyIcon data-icon="inline-start" />}
          />
          <CopyButton
            text={link}
            label="Copy link"
            icon={<LinkIcon data-icon="inline-start" />}
          />
        </div>
        <p className="truncate text-center text-xs text-muted-foreground">
          {link}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function CopyButton({
  text,
  label,
  icon,
  variant = 'secondary',
}: {
  text: string;
  label: string;
  icon?: React.ReactNode;
  variant?: 'secondary' | 'outline' | 'default';
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      className="press"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: the text is visible to select by hand.
        }
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : icon}
      {copied ? 'Copied' : label}
    </Button>
  );
}
