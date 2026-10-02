import { useEffect } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { withViewTransition } from '@/lib/motion';
import { setRouteTransition, useRoute } from '@/lib/router';
import { BoardPage } from '@/pages/BoardPage';
import { GonePage } from '@/pages/GonePage';
import { HelpPage } from '@/pages/HelpPage';
import { HomePage } from '@/pages/HomePage';
import { useMotion } from '@/providers/MotionProvider';

/**
 * A slim header and one page. Route changes run inside a view transition so
 * the page lifts out and the next settles in while the header holds still.
 */
export function AppShell() {
  const route = useRoute();
  const { active } = useMotion();

  useEffect(() => {
    setRouteTransition((update) => withViewTransition(update, active, 'page'));
  }, [active]);

  const key = route.name === 'board' ? `board:${route.code}` : route.name;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader route={route} />
      {/* Keyed by route so each page mounts fresh and its entrances replay. */}
      <main key={key} className="page flex min-h-0 flex-1 flex-col">
        {route.name === 'home' && <HomePage />}
        {route.name === 'help' && <HelpPage />}
        {route.name === 'board' && <BoardPage code={route.code} />}
        {route.name === 'gone' && (
          <GonePage reason={route.reason} code={route.code} />
        )}
      </main>
    </div>
  );
}
