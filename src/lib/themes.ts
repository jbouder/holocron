/**
 * The selectable themes. `light` and `dark` are the stock token sets on
 * `:root` / `.dark`; the rest are `html[data-theme="<id>"]` blocks in
 * src/index.css layered on the base they name. `system` follows the OS.
 *
 * index.html applies the saved theme before first paint and keeps its own
 * copy of the dark-based ids; update it when adding a theme here.
 */

export type ThemeId =
  | 'system'
  | 'light'
  | 'dark'
  | 'dagobah'
  | 'tatooine'
  | 'synthwave';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  /** Which stock theme it builds on. `system` resolves at runtime. */
  base: 'light' | 'dark' | 'system';
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'system', label: 'System', base: 'system' },
  { id: 'light', label: 'Light', base: 'light' },
  { id: 'dark', label: 'Dark', base: 'dark' },
  { id: 'dagobah', label: 'Dagobah', base: 'dark' },
  { id: 'tatooine', label: 'Tatooine', base: 'light' },
  { id: 'synthwave', label: 'Synthwave', base: 'dark' },
];

/** Themes with their own token block (everything but the stock three). */
export const PALETTE_IDS = THEMES.filter(
  (t) => t.id !== 'system' && t.id !== 'light' && t.id !== 'dark',
).map((t) => t.id);

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function themeOption(id: ThemeId): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
