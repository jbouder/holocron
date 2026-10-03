/**
 * The selectable themes. `light` and `dark` are the stock token sets on
 * `:root` / `.dark`; the rest are `html[data-theme="<id>"]` blocks in
 * src/index.css layered on the base they name. `system` follows the OS.
 *
 * index.html applies the saved theme before first paint and keeps its own
 * copy of the dark-based ids and the legacy mapping; update it when adding
 * or retiring a theme here.
 */

export type ThemeId =
  | 'system'
  | 'light'
  | 'dark'
  | 'dagobah'
  | 'tatooine'
  | 'kamino';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  /** Which stock theme it builds on. `system` resolves at runtime. */
  base: 'light' | 'dark' | 'system';
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'system', label: 'System', base: 'system' },
  { id: 'light', label: 'Light', base: 'light' },
  { id: 'dark', label: 'Dark (side)', base: 'dark' },
  { id: 'dagobah', label: 'Dagobah', base: 'dark' },
  { id: 'tatooine', label: 'Tatooine', base: 'light' },
  { id: 'kamino', label: 'Kamino', base: 'dark' },
];

/** Themes with their own token block (everything but the stock three). */
export const PALETTE_IDS = THEMES.filter(
  (t) => t.id !== 'system' && t.id !== 'light' && t.id !== 'dark',
).map((t) => t.id);

/**
 * Retired theme ids and what replaced them, so a saved choice carries over
 * instead of falling back to System. index.html keeps the same mapping.
 */
export const LEGACY_THEMES: Readonly<Record<string, ThemeId>> = {
  synthwave: 'kamino',
};

/** A saved value, with retired ids mapped forward. */
export function migrateThemeId(value: string | null): string | null {
  return value !== null && Object.hasOwn(LEGACY_THEMES, value)
    ? LEGACY_THEMES[value]
    : value;
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function themeOption(id: ThemeId): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
