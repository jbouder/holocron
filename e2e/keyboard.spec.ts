import type { Locator, Page } from '@playwright/test';
import {
  addCard,
  boardMenu,
  card,
  column,
  createBoard,
  expect,
  expectAccessible,
  expectPhase,
  phaseButton,
  test,
} from './fixtures';

/** Press Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${target}`);
}

test('? opens Help from the board, but not while typing', async ({ page }) => {
  const code = await createBoard(page);

  await page
    .getByRole('region', { name: 'Went well', exact: true })
    .getByRole('textbox', { name: 'New card' })
    .press('?');
  await expect(page).toHaveURL(`/b/${code}`);

  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('?');
  await expect(page).toHaveURL('/help');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('Esc closes every dialog and sheet', async ({ page }) => {
  await createBoard(page);

  const surfaces: [open: () => Promise<void>, name: string][] = [
    [
      () => page.getByRole('button', { name: 'Share' }).click(),
      'Share this board',
    ],
    [() => boardMenu(page, 'Export'), 'Export'],
    [() => boardMenu(page, 'Board settings'), 'Board settings'],
    [
      () => page.getByRole('button', { name: /^Action items/ }).click(),
      'Action items',
    ],
  ];
  for (const [open, name] of surfaces) {
    await open();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  await page.getByRole('button', { name: 'Board actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});

test('the phase stepper works from the keyboard', async ({ page }) => {
  await createBoard(page);

  await tabTo(page, phaseButton(page, 'Vote'));
  await page.keyboard.press('Enter');
  await expectPhase(page, 'Vote');

  await tabTo(page, phaseButton(page, 'Discuss'));
  await page.keyboard.press('Space');
  await expectPhase(page, 'Discuss');
});

test('the export tabs work from the keyboard', async ({ page }) => {
  await createBoard(page);
  await boardMenu(page, 'Export');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  const tab = (name: string) => dialog.getByRole('tab', { name });

  await tabTo(page, tab('Markdown'));
  await page.keyboard.press('ArrowRight');
  await expect(tab('CSV')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tab('CSV')).toHaveAttribute('aria-selected', 'true');
  await expect(
    dialog.getByRole('region', { name: 'CSV preview' }),
  ).toContainText('Summary,Owner,Done,Card');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(tab('Summary')).toHaveAttribute('aria-selected', 'true');

  // The preview takes focus too (after the tab panel), so a long export
  // scrolls by keyboard.
  await tabTo(page, dialog.getByRole('region', { name: 'Summary preview' }), 3);
});

test.describe('arranging cards', () => {
  // axe measures at rest, as in a11y.spec.ts.
  test.use({ reducedMotion: 'reduce' });

  test('a card groups and moves from its menu, without a drag', async ({
    page,
  }) => {
    await createBoard(page);
    await addCard(page, 'To improve', 'Flaky deploy pipeline');
    await addCard(page, 'To improve', 'Deploys fail on Fridays');
    const dragged = card(page, 'Deploys fail on Fridays');
    const actions = dragged.getByRole('button', { name: 'Card actions' });

    // The drag handle is pointer-only now, out of the tab order.
    await expect(
      dragged.getByRole('button', { name: 'Drag to group or move' }),
    ).toHaveAttribute('tabindex', '-1');

    await tabTo(page, actions);
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Group with…' }).focus();
    await page.keyboard.press('ArrowRight');
    const target = page.getByRole('menuitem', {
      name: 'Flaky deploy pipeline',
    });
    await expect(target).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press('Enter');

    const group = column(page, 'To improve').locator('[data-stack]', {
      hasText: 'Group · 2 cards',
    });
    await expect(group).toContainText('Flaky deploy pipeline');
    await expect(group).toContainText('Deploys fail on Fridays');
    await expect(page.getByRole('status')).toContainText(
      'Grouped with "Flaky deploy pipeline"',
    );
    await expect(actions).toBeFocused();

    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Move to column…' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('menuitem', { name: 'Went well' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');

    // The whole group goes, as it does with a drag.
    const moved = column(page, 'Went well').locator('[data-stack]', {
      hasText: 'Group · 2 cards',
    });
    await expect(moved).toContainText('Deploys fail on Fridays');
    await expect(moved).toContainText('Flaky deploy pipeline');
    await expect(page.getByRole('status')).toContainText('Moved to Went well');
    await expect(actions).toBeFocused();
    await expectAccessible(page);
  });
});
