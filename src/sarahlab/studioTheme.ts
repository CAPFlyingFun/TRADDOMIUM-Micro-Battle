/**
 * THE CHARACTER ROOM'S TWO THEMES (Joshua, 2026-10-23, on ChatGPT's Character Studio preview: "Use the new UI look, but
 * let's keep both themes like a dark/light color"). LIGHT is the studio's look: pale sage panels, white cards, deep
 * green ink and accent. DARK is the room as it was: near-black glass, warm off-white ink, the gold accent.
 *
 * Every panel in the room reads its colours from these custom properties (`var(--sl-ink, <the dark value>)`), set on
 * the HUD's root by `data-theme`, so one attribute switches the whole room and each panel still looks right on its own
 * with no theme at all. The 3D stage behind her changes with it (`THEME_STAGE`): what the canvas clears to, and the
 * floor she stands on.
 *
 * The choice is the person's and is remembered on this device; storage that throws (a private window) only means the
 * room opens in the default.
 */
export type StudioTheme = 'light' | 'dark';
export const STUDIO_THEMES: readonly StudioTheme[] = Object.freeze(['light', 'dark']);
/** Where the choice is kept on this device. */
export const STUDIO_THEME_KEY = 'traddomium.sarahlab.theme';
/** The studio's look is the new default; DARK is one tap away. */
export const DEFAULT_THEME: StudioTheme = 'light';

/** The room's colour tokens. Names are what the panels read; values are each theme's. */
export const THEME_TOKENS: Readonly<Record<StudioTheme, Readonly<Record<string, string>>>> = Object.freeze({
  light: Object.freeze({
    '--sl-ink': '#213936',
    '--sl-muted': '#71837d',
    '--sl-chrome': '#f9fbf8', // the rail
    '--sl-panel': '#f9fbf8', // the inspector, the loading card
    '--sl-surface': '#ffffff', // a card inside a panel
    '--sl-well': '#edf2e9', // a sunken strip (segmented buttons, the editing line)
    '--sl-field': '#ffffff', // inputs and selects
    '--sl-btn': '#f4f8f2',
    '--sl-btn-line': '#d3dfd2',
    '--sl-line': '#dce5de',
    '--sl-accent': '#3d7969',
    '--sl-accent-deep': '#2b5a4d',
    '--sl-on': '#cfe4d6', // a pressed button: still dark ink on it
    '--sl-on-soft': '#e3efe6',
    '--sl-danger': '#c0503a',
    '--sl-glass': 'rgba(247,250,245,0.86)', // pills floating over her
    '--sl-glass-line': 'rgba(255,255,255,0.9)',
    '--sl-shadow': 'rgba(32,61,51,0.14)',
  }),
  dark: Object.freeze({
    '--sl-ink': '#e8e2d8',
    '--sl-muted': '#9aa0a8',
    '--sl-chrome': '#0b0e13',
    '--sl-panel': 'rgba(12,15,20,0.97)',
    '--sl-surface': '#10151c',
    '--sl-well': '#0b0f14',
    '--sl-field': '#0d1117',
    '--sl-btn': '#151b23',
    '--sl-btn-line': '#ffffff30',
    '--sl-line': '#ffffff1f',
    '--sl-accent': '#d4a853',
    '--sl-accent-deep': '#b38a3e',
    '--sl-on': '#806020',
    '--sl-on-soft': '#3a2c10',
    '--sl-danger': '#d46a53',
    '--sl-glass': 'rgba(16,20,26,0.74)',
    '--sl-glass-line': 'rgba(255,255,255,0.14)',
    '--sl-shadow': 'rgba(0,0,0,0.35)',
  }),
});

/** The 3D stage per theme: the canvas's clear colour, her floor and its rim (hexes, for three). */
export const THEME_STAGE: Readonly<Record<StudioTheme, { readonly background: number; readonly floor: number; readonly rim: number }>> = Object.freeze({
  light: Object.freeze({ background: 0xdfe7e0, floor: 0xc4d2c8, rim: 0xa9bcae }),
  dark: Object.freeze({ background: 0x1b2028, floor: 0x2b313a, rim: 0x4a5462 }),
});

export const isTheme = (v: unknown): v is StudioTheme => v === 'light' || v === 'dark';
export const otherTheme = (t: StudioTheme): StudioTheme => (t === 'light' ? 'dark' : 'light');

/** The remembered theme, or the default. Never throws. */
export function readTheme(storage: Pick<Storage, 'getItem'> | null | undefined): StudioTheme {
  try {
    const v = storage?.getItem(STUDIO_THEME_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
/** Remember the theme on this device. Never throws. */
export function storeTheme(storage: Pick<Storage, 'setItem'> | null | undefined, theme: StudioTheme): void {
  try { storage?.setItem(STUDIO_THEME_KEY, theme); } catch { /* a private window: the room just opens in the default */ }
}

/** Both themes' tokens as CSS, for the element matching `scope` (which carries `data-theme`). */
export function themeCss(scope: string): string {
  return STUDIO_THEMES.map((t) => `${scope}[data-theme="${t}"]{${Object.entries(THEME_TOKENS[t]).map(([k, v]) => `${k}:${v}`).join(';')};color-scheme:${t}}`).join('\n');
}
