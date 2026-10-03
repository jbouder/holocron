import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

export { expect };

/**
 * Board creation is rate limited per client IP (10 a minute), and Miniflare
 * enforces it, so a whole suite from one address would trip it. Each test
 * gets its own address, shared by everyone in that test like a team in one
 * office.
 */
function clientIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/**
 * Nothing leaves localhost: no font CDNs (fonts are bundled), and above all
 * no model download if the Analysis panel ever gets that far.
 */
async function offline(context: BrowserContext) {
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  );
}

interface Fixtures {
  /**
   * A second person on the same board, in their own browser context (their
   * own identity and storage), with the same options as `page`.
   */
  peer: Page;
}

export const test = base.extend<Fixtures>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    await use({ ...extraHTTPHeaders, 'cf-connecting-ip': clientIp() });
  },
  context: async ({ context }, use) => {
    await offline(context);
    await use(context);
  },
  peer: async ({ browser, extraHTTPHeaders, reducedMotion, viewport }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders,
      reducedMotion,
      viewport,
    });
    await offline(context);
    await use(await context.newPage());
    await context.close();
  },
});

export const OWNER = 'Leia';
export const PEER = 'Han';
export const TITLE = 'Sprint 42 retro';

/** Create a board from the home page. Returns its code. */
export async function createBoard(
  page: Page,
  { name = OWNER, title = TITLE }: { name?: string; title?: string } = {},
): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel(/Board title/).fill(title);
  await page.getByRole('button', { name: 'Create board' }).click();
  await page.waitForURL(/\/b\/[A-Z0-9]{6}$/);
  await expect(boardTitle(page, title)).toBeVisible();
  return page.url().slice(-6);
}

/** Join a board by its code from the home page, picking a name on the way. */
export async function joinBoard(
  page: Page,
  code: string,
  { name = PEER, title = TITLE }: { name?: string; title?: string } = {},
) {
  await page.goto('/');
  await page.getByLabel('Board code').fill(code);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForURL(`/b/${code}`);
  const dialog = page.getByRole('dialog', { name: 'What should we call you?' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toBeHidden();
  await expect(boardTitle(page, title)).toBeVisible();
}

/** The owner creates a board, then the peer joins it. */
export async function startRetro(page: Page, peer: Page): Promise<string> {
  const code = await createBoard(page);
  await joinBoard(peer, code);
  // Both are seated once each sees the other in the presence list.
  await expect(page.getByText('2 here')).toBeAttached();
  return code;
}

export function boardTitle(page: Page, title = TITLE): Locator {
  return page.getByRole('heading', { level: 1, name: title });
}

/** A board column, by its title. */
export function column(page: Page, title: string): Locator {
  return page.getByRole('region', { name: title, exact: true });
}

/** A card, by (part of) its text. */
export function card(page: Page, text: string): Locator {
  return page.locator('article[data-card-id]', { hasText: text });
}

/** Post a card from a column's composer and wait for it to land. */
export async function addCard(
  page: Page,
  columnTitle: string,
  text: string,
  { anonymous = false }: { anonymous?: boolean } = {},
): Promise<Locator> {
  const col = column(page, columnTitle);
  const box = col.getByRole('textbox', { name: 'New card' });
  await box.fill(text);
  if (anonymous) {
    await col.getByRole('checkbox', { name: 'Post anonymously' }).check();
  }
  await box.press('Enter');
  const posted = card(page, text);
  await expect(posted).toBeVisible();
  return posted;
}

export type PhaseName = 'Write' | 'Vote' | 'Discuss';

export function phaseButton(page: Page, phase: PhaseName): Locator {
  return page
    .getByRole('group', { name: 'Phase' })
    .getByRole('button', { name: phase });
}

export async function setPhase(page: Page, phase: PhaseName) {
  await phaseButton(page, phase).click();
  await expectPhase(page, phase);
}

/**
 * The phase is `phase`, and its view transition is over: while one runs the
 * page under it takes no clicks.
 */
export async function expectPhase(page: Page, phase: PhaseName) {
  await expect(phaseButton(page, phase)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-vt');
}

/** An item in the toolbar's "Board actions" menu. */
export async function boardMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Board actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The participant id this page's browser uses, from its stored identity. */
export async function participantId(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('holocron:identity') ?? '{}') as {
          id?: string;
        }
      ).id ?? '',
  );
}

/**
 * axe-core over the whole page against WCAG 2.1 A and AA, open dialogs and
 * the page under them alike. Soft, so one run lists every page and dialog
 * that fails, not just the first.
 */
export async function expectAccessible(page: Page) {
  // Let entrances finish so contrast is measured at rest. Endless ones
  // (the reconnecting pulse) never would.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished),
    ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
  expect.soft(summary).toEqual([]);
}
