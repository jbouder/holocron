import { Button } from '@/components/ui/button';
import { forgetBoard } from '@/lib/recent-boards';
import { linkProps } from '@/lib/router';

const COPY = {
  expired: {
    title: 'This board has expired',
    body: 'Erased from the archives, every morning. Everything on it is gone, which is the point.',
  },
  deleted: {
    title: 'This board was deleted',
    body: 'Its owner removed it. Nothing from it is kept.',
  },
  missing: {
    title: 'No board here',
    body: 'Check the code with whoever shared it. It may have expired overnight.',
  },
  refused: {
    title: 'This board does not recognise this browser',
    body: 'Someone on it already uses your participant id from another browser. Clear this site’s data to get a fresh identity, then open the board again.',
  },
} as const;

export function GonePage({
  reason,
  code,
}: {
  reason: keyof typeof COPY;
  code?: string;
}) {
  if (code) {
    forgetBoard(code);
  }
  const copy = COPY[reason];
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <div
        className="stagger-in grid max-w-md gap-2"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        {code && (
          <p className="code-display text-sm text-muted-foreground">{code}</p>
        )}
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {copy.title}
        </h1>
        <p className="text-muted-foreground">{copy.body}</p>
      </div>
      <div
        className="stagger-in flex gap-2"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <Button
          size="lg"
          className="press"
          nativeButton={false}
          render={<a {...linkProps({ name: 'home' })} />}
        >
          Start a new board
        </Button>
      </div>
    </div>
  );
}
