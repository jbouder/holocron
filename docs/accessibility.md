# Accessibility

Holocron aims to conform to **WCAG 2.2 Level AA**, in every theme. It
**partially conforms**: what is checked, how, and the known exceptions are
below. A new exception gets an issue and a line here.

## How it is checked

Automated, on every pull request (CI's `check` job runs the unit tests, its
`e2e` job the browser suite, in Chromium):

| What | Where |
|---|---|
| axe (the WCAG 2.0, 2.1 and 2.2 A and AA rules) on the home page, Help, and a live board through Write (with a blurred card), Vote and Discuss (with a comment thread open), with Share, Board settings, Action items, Export and Analysis (at its consent step) open, as the owner and as a participant, in Light, Dark, Dagobah, Tatooine and Kamino | `e2e/a11y.spec.ts`, `expectAccessible()` in `e2e/fixtures.ts` |
| Contrast of every theme's tokens: text ≥ 4.5:1 on each surface it sits on; the focus ring ≥ 3:1 on the page and on cards | `test/themes.test.ts` |
| Target size (2.5.8): the board code button is at least 24px tall | `e2e/a11y.spec.ts` |
| Reflow at 320px (a 1280px window at 400% zoom): a board with a long title keeps every toolbar control on screen, and the home page lists recent boards, with no sideways scrolling | `e2e/reflow.spec.ts` |
| Every page has its own title (a board's is its code, not its title) | `e2e/reflow.spec.ts` |
| From the keyboard: the phase stepper, the Export tabs and their preview, Esc closes every dialog, sheet and menu, and `?` opens Help but not while typing | `e2e/keyboard.spec.ts` |
| Focus returns to the control that opened Share, Export, Board settings, Action items, Analysis and the Board actions, card and Preferences menus, closed with Esc and with Close; a card deleted from its own menu leaves focus on its column | `e2e/focus.spec.ts` |
| Motion off, by either switch (the system's `prefers-reduced-motion`, or Preferences → Motion with the system setting left on): nothing animates through a phase change, against a control that sees motion when both are on | `e2e/motion.spec.ts` |
| Forced colours (emulated): the current phase, a pressed toggle and the selected tab get an outline in the system's `Highlight` colour, and nothing does without forced colours | `e2e/forced-colors.spec.ts` |
| The time-up tab title holds still with motion off instead of flashing | `test/timer-alert.test.ts` |

Manual, before each release (record the date and anything found):

| Check | Last done | Notes |
|---|---|---|
| VoiceOver on macOS (Safari): create a board, post a card, vote, comment, react, add an action item, export | _not yet recorded_ | |
| VoiceOver on iOS (Safari): join a board by its code and run the same retro | _not yet recorded_ | |
| Keyboard only, no mouse, through a whole retro as owner and as participant | _not yet recorded_ | The automated specs cover the stepper, Export and dialogs. |
| 200% browser zoom on desktop | _not yet recorded_ | Reflow at 320px is automated. |
| Forced colours on Windows (Contrast themes) | _not yet recorded_ | The outlines are automated under Chromium's emulation; this checks a real Contrast theme's colours. |

## Dragging

Grouping and moving cards is a drag: a card's handle onto another card
groups them, onto an empty part of a column moves it. It works with a mouse,
a pen or one finger (the handle shows on touch screens without hover).

| Drag | Another way |
|---|---|
| Group a card onto another | None for everyone yet (see below; #102). The owner's Analysis, in Discuss, can suggest groupings to accept with a button. |
| Move a card or group to another column | None yet (#102) |
| Pull a card out of a group | Not a drag: Ungroup, on the card and in its `⋯` menu |

## Known exceptions

- **Grouping and moving cards need a drag** (2.1.1 Keyboard, 2.5.7 Dragging
  Movements). The handle, "Drag to group or move", takes focus but does
  nothing from the keyboard, and there is no single-pointer way to do either.
  Everything else in a retro works without them. #102 adds menu items for
  both.
- **Only Chromium is automated**, at desktop size and at 320px wide. Safari,
  Firefox and touch are not run (#106).
- **Analysis is written by a language model**, in the owner's browser. Its
  text is not reviewed for reading level or structure; the owner chooses
  what to accept.
- **The manual checks above have not been recorded yet.** Until they are,
  this statement rests on the automated checks.

## Building it in

- Colors are tokens (`src/index.css`), per theme; a new pair that carries
  meaning gets a row in `TEXT` or `NON_TEXT` in `test/themes.test.ts`, and a
  new theme a token block there.
- A new page, dialog or phase state gets an `expectAccessible()` step in
  `e2e/a11y.spec.ts`; a new page also a title (`usePageTitle`) and a line in
  `e2e/reflow.spec.ts`.
- A new toolbar control or list must stay on screen at 320px.
- A new drag needs a keyboard and a single-pointer way to do the same, and a
  row in the table above.
- Motion follows the rules in [AGENTS.md](../AGENTS.md): both switches,
  tokens, `opacity` and `transform` only.

Found something? Open an issue with the `accessibility` label.
