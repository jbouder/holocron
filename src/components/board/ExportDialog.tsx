import { CopyIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  exportBoard,
  isExportFormat,
} from '#shared/export';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { exportUrl } from '@/lib/api';

const FORMAT_HELP: Record<ExportFormat, string> = {
  md: 'Every column, grouped cards, votes, comments and action items.',
  csv: 'Action items only, one per row, for importing into Jira or Linear.',
  txt: 'The most-voted cards and the action items, short enough for Slack.',
};

const FORMAT_ORDER: ExportFormat[] = ['md', 'csv', 'txt'];

export function ExportDialog({
  open,
  onOpenChange,
  board,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
}) {
  const [format, setFormat] = useState<ExportFormat>('md');
  // Same function the server uses, so copy and download match.
  const text = useMemo(
    () => (open ? exportBoard(board, format) : ''),
    [open, board, format],
  );
  const { label } = EXPORT_FORMATS[format];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            {FORMAT_HELP[format]} The board itself is wiped at the daily reset.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={format}
          onValueChange={(value) => {
            if (typeof value === 'string' && isExportFormat(value)) {
              setFormat(value);
            }
          }}
        >
          <TabsList aria-label="Export format">
            {FORMAT_ORDER.map((f) => (
              <TabsTrigger key={f} value={f}>
                {EXPORT_FORMATS[f].label}
              </TabsTrigger>
            ))}
          </TabsList>
          {FORMAT_ORDER.map((f) => (
            <TabsContent key={f} value={f}>
              {f === format && (
                <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap">
                  {text}
                </pre>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton
            text={text}
            label={`Copy ${label}`}
            icon={<CopyIcon data-icon="inline-start" />}
          />
          <Button
            className="press"
            nativeButton={false}
            render={
              <a
                href={exportUrl(board.code, format)}
                download={`retro-${board.code}.${format}`}
              />
            }
          >
            <DownloadSimpleIcon data-icon="inline-start" />
            Download .{format}
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
