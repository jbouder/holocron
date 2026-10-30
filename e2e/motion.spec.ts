import type { Page } from '@playwright/test';
import { createBoard, expect, phaseButton, test } from './fixtures';

/**
 * Click a phase, then watch every frame for the next second and report each
 * animation seen running (CSS, WAAPI and view transition pseudo-elements all
 * show up in `document.getAnimations()`).
 */
async function animationsDuringPhaseChange(page: Page): Promise<string[]> {
  await expect(phaseButton(page, 'Vote')).toBeEnabled();
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen = new Set<string>();
        const describe = (a: Animation) => {
          const effect = a.effect as KeyframeEffect | null;
          const target = effect?.target as HTMLElement | null;
          const name =
            a instanceof CSSAnimation
              ? a.animationName
              : a instanceof CSSTransition
                ? `transition:${a.transitionProperty}`
                : a.id || 'animation';
          return `${name} on ${target?.tagName.toLowerCase() ?? '?'}${effect?.pseudoElement ?? ''}`;
        };
        const end = performance.now() + 1000;
        const tick = () => {
          for (const a of document.getAnimations()) {
            if (a.playState === 'running') {
              seen.add(describe(a));
            }
          }
          if (performance.now() < end) {
            requestAnimationFrame(tick);
          } else {
            resolve([...seen]);
          }
        };
        const vote = [...document.querySelectorAll('fieldset button')].find(
          (b) => b.textContent?.includes('Vote'),
        ) as HTMLButtonElement;
        vote.click();
        tick();
      }),
  );
}

test.describe('with prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing animates through a phase change', async ({ page }) => {
    await createBoard(page);
    expect(await animationsDuringPhaseChange(page)).toEqual([]);
  });
});

test.describe('with Preferences → Motion off', () => {
  // The system setting stays on, so only the app's own switch can stop it.
  test.use({ reducedMotion: 'no-preference' });

  test('nothing animates through a phase change', async ({ page }) => {
    await createBoard(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    const motion = page.getByRole('menuitemcheckbox', { name: 'Motion' });
    await expect(motion).toBeChecked();
    await motion.click();
    await expect(motion).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(motion).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
    // Let the menu's own exit finish before the probe starts watching.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished)),
    );
    expect(await animationsDuringPhaseChange(page)).toEqual([]);
  });
});

// The control: the probe above is only worth something if it sees motion
// when motion is on.
test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a phase change animates', async ({ page }) => {
    await createBoard(page);
    expect(await animationsDuringPhaseChange(page)).not.toEqual([]);
  });
});
