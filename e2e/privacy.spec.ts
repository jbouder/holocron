import type { Page } from '@playwright/test';
import {
  addCard,
  boardMenu,
  card,
  expect,
  expectPhase,
  PEER,
  participantId,
  phaseButton,
  setPhase,
  startRetro,
  test,
} from './fixtures';

/** Every message the server sends this page, parsed. */
function recordMessages(page: Page): unknown[] {
  const messages: unknown[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      messages.push(JSON.parse(String(payload)));
    });
  });
  return messages;
}

interface Msg {
  type: string;
  actor?: { id: string; name: string };
}

interface CardOnWire {
  id: string;
  authorId: string;
  authorName: string;
}

test('an anonymous card names nobody, on screen or on the wire', async ({
  page,
  peer,
}) => {
  const ownerHeard = recordMessages(page);
  await startRetro(page, peer);
  const peerId = await participantId(peer);

  const posted = await addCard(peer, 'To improve', 'Nobody reads the runbook', {
    anonymous: true,
  });
  await expect(posted).toContainText('Anonymous · yours');
  const cardId = await posted.getAttribute('data-card-id');

  // The author edits it: the echo of their own op must not name them either.
  await posted.getByText('Nobody reads the runbook').dblclick();
  const editor = posted.getByRole('textbox', { name: 'Edit card' });
  await editor.fill('Nobody reads the runbook, me included');
  await editor.press('Enter');

  await setPhase(page, 'Vote');
  const seen = card(page, 'Nobody reads the runbook, me included');
  await expect(seen).toBeVisible();
  await expect(seen).toContainText('Anonymous');
  await expect(seen).not.toContainText(PEER);

  // A fresh snapshot, which carries the whole document.
  await page.reload();
  await expect(seen).toContainText('Anonymous');

  const snapshots = ownerHeard.filter(
    (m): m is { type: 'snapshot'; board: { cards: CardOnWire[] } } =>
      (m as { type: string }).type === 'snapshot',
  );
  const onWire = snapshots
    .at(-1)
    ?.board.cards.find((c) => c.id === cardId) as CardOnWire;
  expect(onWire).toMatchObject({ authorId: '', authorName: '' });

  // Every live message about the card leaves the author out: no id, and
  // the echoes of their own add and edit carry a blank actor.
  const live = ownerHeard
    .filter((m) => !['snapshot', 'presence'].includes((m as Msg).type))
    .map((m) => JSON.stringify(m))
    .filter((raw) => cardId !== null && raw.includes(cardId));
  expect(live.length).toBeGreaterThanOrEqual(2);
  for (const raw of live) {
    expect(raw).not.toContain(peerId);
    const message = JSON.parse(raw) as Msg;
    if (message.type === 'op') {
      expect(message.actor).toMatchObject({ id: '', name: '' });
    }
  }
});

test('only the owner gets the Analysis button', async ({ page, peer }) => {
  await startRetro(page, peer);
  await setPhase(page, 'Vote');
  await setPhase(page, 'Discuss');
  await expectPhase(peer, 'Discuss');

  await expect(page.getByRole('button', { name: 'Analysis' })).toBeEnabled();
  await expect(peer.getByRole('button', { name: /Analysis/ })).toHaveCount(0);
});

test('with facilitation locked, a participant cannot change phase', async ({
  page,
  peer,
}) => {
  await startRetro(page, peer);

  // Locked is the default.
  await expect(peer.getByLabel('Only the owner can facilitate')).toBeVisible();
  for (const phase of ['Vote', 'Discuss'] as const) {
    await expect(phaseButton(peer, phase)).toBeDisabled();
  }
  // Not even a forced click moves it.
  await phaseButton(peer, 'Vote').click({ force: true });
  await expectPhase(peer, 'Write');
  await expectPhase(page, 'Write');

  // The owner can, and can hand facilitation to everyone.
  await setPhase(page, 'Vote');
  await expectPhase(peer, 'Vote');

  await boardMenu(page, 'Board settings');
  const lock = page.getByRole('switch', { name: 'Only I can facilitate' });
  await expect(lock).toBeChecked();
  await lock.click();
  await expect(lock).not.toBeChecked();
  await page.keyboard.press('Escape');

  await expect(peer.getByLabel('Only the owner can facilitate')).toHaveCount(0);
  await setPhase(peer, 'Discuss');
  await expectPhase(page, 'Discuss');
});
