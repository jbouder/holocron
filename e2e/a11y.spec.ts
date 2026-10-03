import {
  addCard,
  boardMenu,
  card,
  expect,
  expectAccessible,
  setPhase,
  startRetro,
  test,
} from './fixtures';

// Measured at rest: no entrance half-faded when contrast is checked.
test.use({ reducedMotion: 'reduce' });

test('home page', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Create board' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('help page', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test('a board in every phase, with every dialog open', async ({
  page,
  peer,
}) => {
  await startRetro(page, peer);
  await addCard(page, 'Went well', 'Pairing on the API');
  await addCard(peer, 'Went well', 'Short standups', { anonymous: true });

  await test.step('write, with a blurred card', async () => {
    await expect(page.locator('article[data-blurred="true"]')).toHaveCount(1);
    await expectAccessible(page);
  });

  await test.step('share', async () => {
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Share this board' }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });

  await test.step('settings', async () => {
    await boardMenu(page, 'Board settings');
    await expect(
      page.getByRole('dialog', { name: 'Board settings' }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });

  await test.step('vote', async () => {
    await setPhase(page, 'Vote');
    await expectAccessible(page);
  });

  await test.step('discuss, with a comment thread open', async () => {
    await setPhase(page, 'Discuss');
    const own = card(page, 'Pairing on the API');
    await own.getByRole('button', { name: 'Add a comment' }).click();
    const reply = own.getByRole('textbox', { name: 'New comment' });
    await reply.fill('Let us keep doing this');
    await reply.press('Enter');
    await expect(own.getByText('Let us keep doing this')).toBeVisible();
    await expectAccessible(page);
  });

  await test.step('action items', async () => {
    await page.getByRole('button', { name: /^Action items/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Action items' });
    await sheet.getByLabel('Action').fill('Keep standups short');
    await sheet.getByRole('button', { name: 'Add' }).click();
    await expect(sheet.getByText('Keep standups short')).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });

  await test.step('export', async () => {
    await boardMenu(page, 'Export');
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });

  await test.step('analysis, at the consent step', async () => {
    await page.getByRole('button', { name: 'Analysis' }).click();
    const panel = page.getByRole('dialog', { name: 'Analysis' });
    await expect(
      panel.getByRole('button', { name: /^Download .* and enable$/ }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });

  await test.step('discuss, as a participant', async () => {
    await expectAccessible(peer);
  });
});
