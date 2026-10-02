import { type RefObject, useLayoutEffect, useRef } from 'react';
import { EASE_EMPHASIZED } from '@/lib/motion';

/**
 * FLIP for a list: after every render, compare each `[data-flip-id]` child's
 * box with where it was last time and animate the difference with WAAPI.
 * Layout does the hard part; this only measures before and after.
 */
export function useFlip(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const previous = useRef(new Map<string, DOMRect>());

  // No dependency array on purpose: measure after every render.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const next = new Map<string, DOMRect>();
    for (const el of container.querySelectorAll<HTMLElement>(
      '[data-flip-id]',
    )) {
      const id = el.dataset.flipId;
      if (!id) {
        continue;
      }
      const last = el.getBoundingClientRect();
      next.set(id, last);
      const first = previous.current.get(id);
      if (!first || !enabled) {
        continue;
      }
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx === 0 && dy === 0) {
        continue;
      }
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
        duration: 350,
        easing: EASE_EMPHASIZED,
      });
    }
    previous.current = next;
  });
}
