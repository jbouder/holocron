import { QuestionIcon } from '@phosphor-icons/react';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { linkProps, type Route } from '@/lib/router';

/** Brand on the left, help and preferences on the right. */
export function AppHeader({ route }: { route: Route }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <a
          {...linkProps({ name: 'home' })}
          className="press flex items-center gap-2 rounded-md font-heading text-base font-semibold tracking-tight outline-ring/50 focus-visible:outline-2"
        >
          <HolocronMark className="size-6" />
          <span>Holocron</span>
          <span className="sr-only">home</span>
        </a>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={route.name === 'help' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="press"
                  nativeButton={false}
                  render={<a {...linkProps({ name: 'help' })} />}
                />
              }
            >
              <QuestionIcon weight="bold" />
              <span className="sr-only">Help</span>
            </TooltipTrigger>
            <TooltipContent>Help</TooltipContent>
          </Tooltip>
          <PreferencesMenu />
        </div>
      </div>
    </header>
  );
}

export function HolocronMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M32 10 52 22v20L32 54 12 42V22Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M32 10v44M12 22l20 12 20-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
        opacity=".55"
      />
    </svg>
  );
}
