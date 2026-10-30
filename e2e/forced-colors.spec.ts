import type { Locator } from '@playwright/test';
import { boardMenu, createBoard, expect, phaseButton, test } from './fixtures';

/**
 * Forced colours (Windows Contrast themes) drop backgrounds, so a state shown
 * by a fill alone needs an outline in a system colour (1.4.1, 1.4.11).
 * Chromium emulates the mode; the colours of a real Contrast theme are still
 * checked by hand on Windows.
 */

/** The outline `el` draws, and the colour `Highlight` resolves to here. */
async function outline(el: Locator) {
  return el.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'Highlight';
    document.body.append(probe);
    const highlight = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(node);
    return {
      style: style.outlineStyle,
      highlighted: style.outlineColor === highlight,
    };
  });
}

const MARKED = { style: 'solid', highlighted: true };

test.describe('in forced colours', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('the current phase, pressed toggles and the selected tab are outlined', async ({
    page,
  }) => {
    await createBoard(page);

    expect(await outline(phaseButton(page, 'Write'))).toEqual(MARKED);
    expect((await outline(phaseButton(page, 'Vote'))).style).toBe('none');

    const done = page.getByRole('button', { name: "I'm done" });
    expect((await outline(done)).style).toBe('none');
    await done.click();
    const pressed = page.getByRole('button', { name: 'Done', exact: true });
    await expect(pressed).toHaveAttribute('aria-pressed', 'true');
    // Moved off it, so the outline seen is the state's, not focus's.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(await outline(pressed)).toEqual(MARKED);

    await boardMenu(page, 'Export');
    const dialog = page.getByRole('dialog', { name: 'Export' });
    const selected = dialog.getByRole('tab', { selected: true });
    await selected.blur();
    expect(await outline(selected)).toEqual(MARKED);
    expect(
      (await outline(dialog.getByRole('tab', { selected: false }).first()))
        .style,
    ).toBe('none');
  });
});

// The control: the outline is for forced colours only.
test('without forced colours the current phase has no outline', async ({
  page,
}) => {
  await createBoard(page);
  expect((await outline(phaseButton(page, 'Write'))).style).toBe('none');
});
