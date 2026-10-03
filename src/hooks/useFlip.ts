import { type RefObject, useLayoutEffect, useRef } from 'react';
import { EASE_EMPHASIZED } from '@/lib/motion';

/**
 * FLIP for a list: after every render, compare each `[data-flip-id]` child's
 * box with where it was last time and animate the difference with WAAPI.
 * Layout does the hard part; this only measures before and after.
 *
 * Renders happen mid-slide all the time (the server echoes an op a few
 * hundred milliseconds after the optimistic render), and a bounding box
 * measured then includes the slide's translate. So the box is corrected by
 * the running translate to recover the layout position, which is what gets
 * remembered and compared. When layout really did change under a running
 * slide, the new slide starts from where the card visibly is, not from
 * where layout put it, so it never jumps.
 */

interface Point {
  left: number;
  top: number;
}

const DURATION_MS = 350;

/** The element's current `translate`, from a slide in progress or none. */
function currentTranslate(el: HTMLElement): Point {
  const value = getComputedStyle(el).translate;
  if (!value || value === 'none') {
    return { left: 0, top: 0 };
  }
  const [x = '0', y = '0'] = value.split(' ');
  return { left: Number.parseFloat(x) || 0, top: Number.parseFloat(y) || 0 };
}

export function useFlip(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const previous = useRef(new Map<string, Point>());
  const sliding = useRef(new WeakMap<HTMLElement, Animation>());

  // No dependency array on purpose: measure after every render.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const next = new Map<string, Point>();
    for (const el of container.querySelectorAll<HTMLElement>(
      '[data-flip-id]',
    )) {
      const id = el.dataset.flipId;
      if (!id) {
        continue;
      }
      const slide = sliding.current.get(el);
      const offset =
        slide && slide.playState === 'running'
          ? currentTranslate(el)
          : { left: 0, top: 0 };
      const box = el.getBoundingClientRect();
      // Where layout put it, with any slide in progress taken back out.
      const last: Point = {
        left: box.left - offset.left,
        top: box.top - offset.top,
      };
      next.set(id, last);
      const first = previous.current.get(id);
      if (!first || !enabled) {
        continue;
      }
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        // Layout is unchanged; a slide in progress carries on untouched.
        continue;
      }
      // Start from where the card visibly is right now.
      slide?.cancel();
      const animation = el.animate(
        [
          { translate: `${dx + offset.left}px ${dy + offset.top}px` },
          { translate: '0 0' },
        ],
        { duration: DURATION_MS, easing: EASE_EMPHASIZED },
      );
      sliding.current.set(el, animation);
    }
    previous.current = next;
  });
}
