import { createContext, useContext } from 'react';

/**
 * Opens the action items sheet with a new item linked to a card. Provided by
 * the board page, which owns the sheet's state, so a card can reach it
 * without threading a callback through every column.
 */
export const AddActionForCard = createContext<(cardId: string) => void>(
  () => undefined,
);

export function useAddActionForCard() {
  return useContext(AddActionForCard);
}

/** Scroll a card into view and flash it, e.g. from a linked action item. */
export function revealCard(cardId: string, motion: boolean) {
  const el = document.querySelector<HTMLElement>(
    `[data-card-id="${CSS.escape(cardId)}"]`,
  );
  if (!el) {
    return false;
  }
  el.scrollIntoView({
    behavior: motion ? 'smooth' : 'auto',
    block: 'center',
    inline: 'center',
  });
  el.removeAttribute('data-revealed');
  // Restart the highlight if it is already running.
  void el.offsetWidth;
  el.setAttribute('data-revealed', '');
  window.setTimeout(() => el.removeAttribute('data-revealed'), 1600);
  return true;
}
