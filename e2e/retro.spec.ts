import { readFile } from 'node:fs/promises';
import {
  addCard,
  boardMenu,
  card,
  column,
  expect,
  expectPhase,
  OWNER,
  PEER,
  setPhase,
  startRetro,
  TITLE,
  test,
} from './fixtures';

test('a whole retro: write, vote, discuss, group, act, export', async ({
  page,
  peer,
}) => {
  const code = await startRetro(page, peer);

  // Write. Each sees the other's cards arrive, blurred.
  await addCard(page, 'Went well', 'Pairing on the API');
  await addCard(page, 'To improve', 'Flaky deploy pipeline');
  await addCard(peer, 'To improve', 'Deploys fail on Fridays');

  const hiddenFromOwner = column(page, 'To improve').locator(
    'article[data-blurred="true"]',
  );
  await expect(hiddenFromOwner).toHaveCount(1);
  await expect(hiddenFromOwner).toHaveAccessibleName(
    'A card, hidden until the Write phase ends',
  );
  await expect(page.getByText('Deploys fail on Fridays')).toHaveCount(0);
  await expect(peer.locator('article[data-blurred="true"]')).toHaveCount(2);
  await expect(peer.getByText('Flaky deploy pipeline')).toHaveCount(0);

  // Vote. Revealed for everyone; each spends from their own five.
  await setPhase(page, 'Vote');
  await expectPhase(peer, 'Vote');
  await expect(card(peer, 'Flaky deploy pipeline')).toBeVisible();
  await expect(card(page, 'Deploys fail on Fridays')).toBeVisible();

  // Each vote shows on the voter's card before the next.
  async function vote(who: typeof page, text: string, yours: number) {
    const button = card(who, text).getByRole('button', { name: /^Vote\./ });
    await button.click();
    await expect(button).toHaveAccessibleName(new RegExp(`, ${yours} yours$`));
  }
  await vote(peer, 'Flaky deploy pipeline', 1);
  await vote(peer, 'Flaky deploy pipeline', 2);
  await vote(page, 'Flaky deploy pipeline', 1);
  await expect(peer.getByText(/^3\svotes left$/)).toBeVisible();
  await expect(page.getByText(/^4\svotes left$/)).toBeVisible();
  await expect(
    card(page, 'Flaky deploy pipeline').getByRole('button', {
      name: /^Vote\. 3 votes, 1 yours/,
    }),
  ).toBeVisible();

  // Discuss, then stack the two deploy cards by dragging one onto the other.
  await setPhase(page, 'Discuss');
  await expectPhase(peer, 'Discuss');

  const target = card(page, 'Flaky deploy pipeline');
  const dragged = card(page, 'Deploys fail on Fridays');
  await dragged.hover();
  const handle = dragged.getByRole('button', { name: 'Drag to group or move' });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error('Cards are not on screen');
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  for (const who of [page, peer]) {
    const group = column(who, 'To improve').locator('[data-stack]', {
      hasText: 'Group · 2 cards',
    });
    await expect(group).toContainText('Flaky deploy pipeline');
    await expect(group).toContainText('Deploys fail on Fridays');
  }

  // An action item from a card, prefilled with its text, owned by the peer.
  await target.getByRole('button', { name: 'Card actions' }).click();
  await page.getByRole('menuitem', { name: 'Add action item' }).click();
  const sheet = page.getByRole('dialog', { name: 'Action items' });
  await expect(sheet.getByLabel('Action')).toHaveValue('Flaky deploy pipeline');
  await sheet.getByLabel('Action').fill('Quarantine the flaky deploy step');
  await sheet.getByLabel(/Owner/).fill(PEER);
  await sheet.getByRole('button', { name: 'Add' }).click();
  await expect(
    sheet.getByRole('button', { name: 'Show the card: Flaky deploy pipeline' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The peer sees it too.
  await peer.getByRole('button', { name: /^Action items/ }).click();
  const peerSheet = peer.getByRole('dialog', { name: 'Action items' });
  await expect(peerSheet).toContainText('Quarantine the flaky deploy step');
  await expect(peerSheet).toContainText(PEER);
  await peer.keyboard.press('Escape');

  // Export: the dialog's preview and the server's download agree.
  await boardMenu(page, 'Export');
  const exportDialog = page.getByRole('dialog', { name: 'Export' });
  await expect(exportDialog.locator('pre')).toContainText(`# ${TITLE}`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByText('Download .md').click(),
  ]);
  expect(download.suggestedFilename()).toBe(`retro-${code}.md`);
  const markdown = await readFile(await download.path(), 'utf8');

  expect(markdown).toContain(`# ${TITLE}`);
  expect(markdown).toContain(`Retro board \`${code}\``);
  expect(markdown).toContain(
    `## Went well\n\n_What worked that we should keep?_`,
  );
  expect(markdown).toContain(`- Pairing on the API _(${OWNER})_`);
  expect(markdown).toMatch(
    new RegExp(
      [
        '- \\*\\*Group\\*\\* .*3.*',
        `  - Flaky deploy pipeline _\\(${OWNER}\\)_`,
        `  - Deploys fail on Fridays _\\(${PEER}\\)_`,
      ].join('\\n'),
    ),
  );
  expect(markdown).toContain(
    `## Action items\n\n- [ ] Quarantine the flaky deploy step — ${PEER}\n  - From: Flaky deploy pipeline`,
  );
});
