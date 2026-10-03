import { CopyIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { boardToMarkdown } from '#shared/export';
import type { Board } from '#shared/types';
import { CopyButton } from '@/components/board/ShareDialog';
import { HelpLink } from '@/components/HelpLink';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { exportUrl } from '@/lib/api';

export function ExportDialog({
  open,
  onOpenChange,
  board,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
}) {
  // Same function the server uses, so copy and download match.
  const markdown = useMemo(
    () => (open ? boardToMarkdown(board) : ''),
    [open, board],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Markdown with every column, grouped cards, votes and action items.
            The board itself is wiped at the daily reset.
          </DialogDescription>
        </DialogHeader>
        <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap">
          {markdown}
        </pre>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton
            text={markdown}
            label="Copy Markdown"
            icon={<CopyIcon data-icon="inline-start" />}
          />
          <Button
            className="press"
            nativeButton={false}
            render={
              <a
                href={exportUrl(board.code)}
                download={`retro-${board.code}.md`}
              />
            }
          >
            <DownloadSimpleIcon data-icon="inline-start" />
            Download .md
          </Button>
        </div>
        {/* Last in the DOM so the dialog's initial focus skips it. */}
        <HelpLink
          section="export"
          label="Export"
          className="absolute top-2 right-10 size-7"
        />
      </DialogContent>
    </Dialog>
  );
}
