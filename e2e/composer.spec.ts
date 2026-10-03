import { addCard, card, createBoard, expect, test } from './fixtures';

// The composer stays open while focused and shrinks when it loses focus.
// A press elsewhere takes focus on pointerdown, so shrinking then would move
// whatever was under the pointer before the click landed.
test('the first click after posting a card lands', async ({ page }) => {
  await createBoard(page);
  await addCard(page, 'Went well', 'Pairing on the API');
  await expect(
    page.getByRole('textbox', { name: 'New card' }).first(),
  ).toBeFocused();

  // A button that acts on click (menus open on pointerdown, too early to
  // tell).
  const posted = card(page, 'Pairing on the API');
  await posted.getByRole('button', { name: 'Add a comment' }).click();
  await expect(
    posted.getByRole('textbox', { name: 'New comment' }),
  ).toBeVisible();
});

test('ticking anonymous before typing keeps the composer open', async ({
  page,
}) => {
  await createBoard(page);
  const column = page.getByRole('region', { name: 'Went well', exact: true });
  const box = column.getByRole('textbox', { name: 'New card' });
  await box.click();
  const anonymous = column.getByRole('checkbox', { name: 'Post anonymously' });
  await anonymous.click();
  // Past the point where a collapse after the click would have run.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
  await expect(anonymous).toBeVisible();
  await expect(anonymous).toBeChecked();

  await box.fill('Nobody reads the runbook');
  await box.press('Enter');
  await expect(card(page, 'Nobody reads the runbook')).toContainText(
    'Anonymous · yours',
  );
});
