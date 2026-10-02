import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from 'react';

/**
 * Pointer-driven drag for retro cards, no library. The dragged card follows
 * the pointer with a transform (CSS vars `--dx`/`--dy`); targets under the
 * pointer get a `data-drop` attribute so the stylesheet can outline them.
 * Nothing re-renders during the drag; FLIP tidies up after the drop.
 *
 * Markup contract:
 *  - every card root has `data-card-id` and `data-group-id` (or "")
 *  - every column body has `data-column-id`
 *  - every stack (card or group wrapper) in a column has `data-stack` and
 *    `data-card-count`
 */

export interface DragHandlers {
  onGroup: (cardId: string, targetCardId: string) => void;
  onMove: (cardId: string, columnId: string, position: number) => void;
}

type Target =
  | { kind: 'group'; el: HTMLElement; cardId: string }
  | { kind: 'move'; el: HTMLElement; columnId: string; position: number }
  | null;

interface DragState {
  cardId: string;
  groupId: string;
  cardEl: HTMLElement;
  startX: number;
  startY: number;
  moving: boolean;
  target: Target;
}

const THRESHOLD = 4;

export function useCardDrag(handlers: DragHandlers, enabled: boolean) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Everything below is created once; it reads the refs for fresh values.
  return useMemo(() => {
    let state: DragState | null = null;

    const clearTarget = () => {
      if (state?.target) {
        state.target.el.removeAttribute('data-drop');
        state.target = null;
      }
    };

    const setTarget = (next: Target) => {
      if (!state) {
        return;
      }
      const same =
        state.target &&
        next &&
        state.target.el === next.el &&
        state.target.kind === next.kind &&
        (next.kind !== 'move' ||
          state.target.kind !== 'move' ||
          state.target.position === next.position);
      if (same) {
        return;
      }
      clearTarget();
      if (next) {
        next.el.setAttribute('data-drop', next.kind);
        state.target = next;
      }
    };

    const findTarget = (x: number, y: number): Target => {
      if (!state) {
        return null;
      }
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hit) {
        return null;
      }
      const card = hit.closest<HTMLElement>('[data-card-id]');
      if (card && card !== state.cardEl) {
        const id = card.dataset.cardId ?? '';
        const group = card.dataset.groupId ?? '';
        if (id && !(group && group === state.groupId)) {
          return { kind: 'group', el: card, cardId: id };
        }
      }
      const column = hit.closest<HTMLElement>('[data-column-id]');
      if (column) {
        // Count the cards in stacks whose middle is above the pointer,
        // skipping the stack being dragged. That is the reducer's `position`.
        let position = 0;
        for (const stack of column.querySelectorAll<HTMLElement>(
          '[data-stack]',
        )) {
          if (stack.contains(state.cardEl)) {
            continue;
          }
          const rect = stack.getBoundingClientRect();
          if (rect.top + rect.height / 2 < y) {
            position += Number(stack.dataset.cardCount ?? 1);
          }
        }
        return {
          kind: 'move',
          el: column,
          columnId: column.dataset.columnId ?? '',
          position,
        };
      }
      return null;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!state) {
        return;
      }
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.moving) {
        if (Math.hypot(dx, dy) < THRESHOLD) {
          return;
        }
        state.moving = true;
        state.cardEl.dataset.dragging = 'true';
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      state.cardEl.style.setProperty('--dx', `${dx}px`);
      state.cardEl.style.setProperty('--dy', `${dy}px`);
      setTarget(findTarget(event.clientX, event.clientY));
    };

    const finish = (commit: boolean) => {
      if (!state) {
        return;
      }
      const { target, cardId, cardEl, moving } = state;
      clearTarget();
      state = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      delete cardEl.dataset.dragging;
      cardEl.style.removeProperty('--dx');
      cardEl.style.removeProperty('--dy');
      if (commit && moving && target) {
        if (target.kind === 'group') {
          handlersRef.current.onGroup(cardId, target.cardId);
        } else {
          handlersRef.current.onMove(cardId, target.columnId, target.position);
        }
      }
    };

    const onPointerUp = () => finish(true);
    const onPointerCancel = () => finish(false);

    /** Spread onto the drag handle of a card. */
    const handleProps = (cardId: string, groupId: string | null) => ({
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (!enabledRef.current || event.button !== 0) {
          return;
        }
        const cardEl = (
          event.currentTarget as HTMLElement
        ).closest<HTMLElement>('[data-card-id]');
        if (!cardEl) {
          return;
        }
        event.preventDefault();
        state = {
          cardId,
          groupId: groupId ?? '',
          cardEl,
          startX: event.clientX,
          startY: event.clientY,
          moving: false,
          target: null,
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
      },
      style: { touchAction: 'none' as const, cursor: 'grab' as const },
    });

    return { handleProps };
  }, []);
}
