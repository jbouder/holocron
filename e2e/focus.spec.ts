import type { Locator, Page } from '@playwright/test';
import {
  addCard,
  card,
  column,
  createBoard,
  expect,
  setPhase,
  test,
} from './fixtures';

/**
 * When a dialog, sheet or menu closes, focus goes back to the control that
 * opened it, so a keyboard or screen reader user keeps their place (2.4.3).
 */

/** Focus `opener` and press Enter on it, as a keyboard user would. */
async function openFrom(opener: Locator) {
  await opener.focus();
  await opener.press('Enter');
}

/** Each surface, how to close it, and where focus should land after. */
async function expectReturns(
  page: Page,
  {
    open,
    surface,
    close,
    returnsTo,
  }: {
    open: () => Promise<void>;
    surface: Locator;
    close: 'Escape' | Locator;
    returnsTo: Locator;
  },
) {
  await open();
  await expect(surface).toBeVisible();
  if (close === 'Escape') {
    await page.keyboard.press('Escape');
  } else {
    await close.focus();
    await close.press('Enter');
  }
  await expect(surface).toBeHidden();
  await expect(returnsTo).toBeFocused();
}

test('focus returns to the opener of every dialog, sheet and menu', async ({
  page,
}) => {
  await createBoard(page);
  await addCard(page, 'Went well', 'Pairing on the parser');
  await setPhase(page, 'Discuss');

  const share = page.getByRole('button', { name: 'Share', exact: true });
  const boardActions = page.getByRole('button', { name: 'Board actions' });
  const actionItems = page.getByRole('button', { name: /^Action items/ });
  const analysis = page.getByRole('button', { name: 'Analysis', exact: true });
  const cardActions = card(page, 'Pairing on the parser').getByRole('button', {
    name: 'Card actions',
  });

  // A dialog opened from a menu item returns to the menu's trigger: the
  // item itself is gone with the menu.
  const fromBoardMenu = (item: string) => async () => {
    await openFrom(boardActions);
    await page.getByRole('menuitem', { name: item }).press('Enter');
  };

  const surfaces: {
    name: string;
    open: () => Promise<void>;
    surface: Locator;
    returnsTo: Locator;
  }[] = [
    {
      name: 'Share',
      open: () => openFrom(share),
      surface: page.getByRole('dialog', { name: 'Share this board' }),
      returnsTo: share,
    },
    {
      name: 'Export',
      open: fromBoardMenu('Export'),
      surface: page.getByRole('dialog', { name: 'Export' }),
      returnsTo: boardActions,
    },
    {
      name: 'Board settings',
      open: fromBoardMenu('Board settings'),
      surface: page.getByRole('dialog', { name: 'Board settings' }),
      returnsTo: boardActions,
    },
    {
      name: 'Action items',
      open: () => openFrom(actionItems),
      surface: page.getByRole('dialog', { name: 'Action items' }),
      returnsTo: actionItems,
    },
    {
      name: 'Analysis',
      open: () => openFrom(analysis),
      surface: page.getByRole('dialog', { name: 'Analysis' }),
      returnsTo: analysis,
    },
  ];

  for (const { name, open, surface, returnsTo } of surfaces) {
    await test.step(`${name}, with Esc`, () =>
      expectReturns(page, { open, surface, close: 'Escape', returnsTo }));
    await test.step(`${name}, with its Close button`, () =>
      expectReturns(page, {
        open,
        surface,
        close: surface.getByRole('button', { name: 'Close', exact: true }),
        returnsTo,
      }));
  }

  for (const [name, trigger] of [
    ['Board actions', boardActions],
    ['Card actions', cardActions],
    ['Preferences', page.getByRole('button', { name: 'Preferences' })],
  ] as const) {
    await test.step(`the ${name} menu, with Esc`, () =>
      expectReturns(page, {
        open: () => openFrom(trigger),
        surface: page.getByRole('menu'),
        close: 'Escape',
        returnsTo: trigger,
      }));
  }
});

// The card's menu waits for its exit before the delete, so both with and
// without motion.
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`with reducedMotion: ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test('deleting a card from its menu leaves focus on its column', async ({
      page,
    }) => {
      await createBoard(page);
      await addCard(page, 'Went well', 'Pairing on the parser');
      const doomed = card(page, 'Pairing on the parser');

      await openFrom(doomed.getByRole('button', { name: 'Card actions' }));
      await page.getByRole('menuitem', { name: 'Delete' }).press('Enter');
      await expect(doomed).toHaveCount(0);
      await expect(column(page, 'Went well')).toBeFocused();
    });
  });
}
