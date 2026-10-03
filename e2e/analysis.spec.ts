import type { Page } from '@playwright/test';
import { createBoard, expect, setPhase, test } from './fixtures';

/**
 * Only the opt-in and unsupported states run here. Loading a model would
 * download a gigabyte or so; nothing in these tests agrees to that, and the
 * fixtures abort any request that leaves localhost regardless.
 */

/** Every request that tried to leave localhost. */
function outbound(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') {
      urls.push(request.url());
    }
  });
  return urls;
}

async function openAnalysis(page: Page) {
  await createBoard(page);
  const button = page.getByRole('button', { name: /^Analysis/ });
  await expect(button).toBeDisabled();
  await setPhase(page, 'Vote');
  await setPhase(page, 'Discuss');
  await button.click();
  return page.getByRole('dialog', { name: 'Analysis' });
}

test('asks before downloading anything', async ({ page }) => {
  const left = outbound(page);
  const panel = await openAnalysis(page);

  await expect(panel.getByRole('radio')).not.toHaveCount(0);
  const consent = panel.getByRole('button', {
    name: /^Download .* and enable$/,
  });
  await expect(consent).toBeVisible();
  await expect(panel).toContainText('It sees the download, never the board.');
  // Opening the panel checks the cache, nothing more.
  await expect(panel.getByRole('radio', { checked: true })).toHaveCount(1);
  expect(left).toEqual([]);
});

test('says so when the browser has no WebGPU', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
  const panel = await openAnalysis(page);

  await expect(panel).toContainText(
    'Analysis is not supported in this browser.',
  );
  await expect(panel.getByRole('button', { name: /^Download/ })).toHaveCount(0);
});
