import type { Page } from '@playwright/test';
import { createBoard, expect, test } from './fixtures';

/**
 * WCAG 1.4.10 Reflow: at 320 CSS px wide (a 1280 px window at 400% zoom)
 * nothing should need sideways scrolling, and no control may end up off
 * screen. A long board title is the worst case for both the toolbar and the
 * recent-boards list.
 */
const LONG_TITLE = 'Accessibility audit retro for the platform team';

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('at 320px wide', () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test('a board keeps every toolbar control on screen', async ({ page }) => {
    await createBoard(page, { title: LONG_TITLE });
    await expectNoSidewaysScroll(page);
    const timer = page.getByRole('button', { name: 'Set a timer' });
    await expect(timer).toBeInViewport({ ratio: 1 });
  });

  test('the home page lists recent boards without overflowing', async ({
    page,
  }) => {
    const code = await createBoard(page, { title: LONG_TITLE });
    await page.goto('/');
    const recent = page.getByRole('link', { name: new RegExp(code) });
    await expect(recent).toBeVisible();
    await expectNoSidewaysScroll(page);
    const timeLeft = recent.getByText(/left$/);
    await timeLeft.scrollIntoViewIfNeeded();
    await expect(timeLeft).toBeInViewport({ ratio: 1 });
  });
});

test('every page has its own title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Holocron');
  await page.goto('/help');
  await expect(page).toHaveTitle('Help · Holocron');
  const code = await createBoard(page);
  await expect(page).toHaveTitle(`Board ${code} · Holocron`);
});
