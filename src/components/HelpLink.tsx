import { QuestionIcon } from '@phosphor-icons/react';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

/** A small `?` that opens the Help page at one section. */
export function HelpLink({
  section,
  label,
  className,
}: {
  section: string;
  /** What the section is about, for the accessible name ("Help: Timer"). */
  label: string;
  className?: string;
}) {
  return (
    <a
      {...linkProps({ name: 'help', section })}
      title={`Help: ${label}`}
      className={cn(
        'press inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-ring/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2',
        className,
      )}
    >
      <QuestionIcon weight="bold" className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Help: {label}</span>
    </a>
  );
}
