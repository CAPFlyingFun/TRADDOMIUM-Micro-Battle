/**
 * THE CHARACTER ROOM AS A STUDIO (Joshua, 2026-10-23, after trying ChatGPT's Character Studio preview: "Use the new UI
 * look, but let's keep both themes like a dark/light color"). Its layout replaces the room's floating panel and its
 * upright tabs (`uprightTabs.ts`, retired):
 *
 *   - a RAIL of sections -- BODY, FACE, OUTFIT, FABRIC, BUILD, POSE, LIBRARY -- down the left side held landscape, along the
 *     bottom held upright;
 *   - an INSPECTOR showing the open section's controls under its title, on the right held landscape and as a sheet
 *     above the rail held upright. FOLD tucks it away (landscape) or down to its title (upright), so she has the room;
 *     tapping the open section again does the same;
 *   - the STAGE, what is left of the screen, where she is framed (`covered()` tells the scene how much the rail and
 *     the inspector take) and where a few controls float over her: a top row, a bottom row and a corner.
 *
 * The scene builds its controls as it always has and marks each with `data-tab="<section>"`; this module moves those
 * elements into their sections once, in document order (a run of loose buttons shares a row that wraps), and nothing
 * else, so every control keeps its `data-action` and its handlers. Turning the phone only changes the CSS.
 *
 * Colours are the theme's custom properties (`studioTheme.ts`): `data-theme` on the root switches them all.
 */
import { DEFAULT_THEME, themeCss, type StudioTheme } from './studioTheme';

export const STUDIO_SECTIONS = Object.freeze([
  { id: 'body', label: 'Body', title: 'Body & proportions', icon: '<circle cx="12" cy="4.6" r="2.4"/><path d="M8.2 9.5h7.6l1.6 6.2h-3.2V21h-4.4v-5.3H6.6z"/>' },
  // her face and skin (Joshua, 2026-10-24): the skin's map chosen, uploaded or painted, and her face's own controls
  { id: 'face', label: 'Face', title: 'Face & skin', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10.2v.6M15 10.2v.6M8.8 14.6c.9 1.3 2 1.9 3.2 1.9s2.3-.6 3.2-1.9"/>' },
  { id: 'outfit', label: 'Outfit', title: 'Outfits', icon: '<path d="M8 3l-5 3 2 4 3-1.5V21h8V8.5l3 1.5 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3z"/>' },
  { id: 'fabric', label: 'Fabric', title: 'Fabric & paint', icon: '<path d="M4 4l16 1-1 15-15-1z"/><path d="M8.5 4.3v15M14 4.6v15.2M4.2 9.5h15.5M4.1 14.8h15.3"/>' },
  { id: 'build', label: 'Build', title: 'Straps & cords', icon: '<path d="M4 17c3-6 6-9 9-9s5 2 7 1"/><circle cx="4" cy="17" r="1.6"/><circle cx="13" cy="8" r="1.6"/><circle cx="20" cy="9" r="1.6"/>' },
  { id: 'pose', label: 'Pose', title: 'Pose & motion', icon: '<circle cx="13" cy="4" r="2"/><path d="M6 10l6-3 5 4 4-1M12 7l-2 8-5 6M10 15l6 6"/>' },
  { id: 'library', label: 'Library', title: 'Characters', icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 3.5V10h8V3.5M7 20.5V14h10v6.5"/>' },
] as const);
export type StudioSection = (typeof STUDIO_SECTIONS)[number]['id'];
export const isStudioSection = (v: unknown): v is StudioSection => STUDIO_SECTIONS.some((s) => s.id === v);

/** The `data-action` of a section's rail button. */
export const studioSectionAction = (section: StudioSection) => `sarahlab:section:${section}`;
export const STUDIO_FOLD_ACTION = 'sarahlab:fold';
/** `data-role`s, for a probe. */
export const STUDIO_ROLE = Object.freeze({ rail: 'sarahlab-rail', inspector: 'sarahlab-inspector', stage: 'sarahlab-stage', title: 'sarahlab-section-title' });

export interface StudioCovered { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

export interface StudioLayout {
  /** Held upright (true) or landscape. Repeating a call changes nothing. */
  setPortrait(portrait: boolean): void;
  readonly portrait: boolean;
  readonly open: StudioSection;
  readonly folded: boolean;
  /** Open a section (and unfold the inspector). */
  show(section: StudioSection): void;
  fold(folded: boolean): void;
  readonly theme: StudioTheme;
  setTheme(theme: StudioTheme): void;
  /** CSS pixels of the room the rail and the inspector cover on each side: she is framed in the rest. */
  covered(): StudioCovered;
  /** The stage and the places on it the room fills: a row along its top, one along its bottom, its bottom-right corner. */
  readonly stage: { readonly element: HTMLElement; readonly top: HTMLElement; readonly bottom: HTMLElement; readonly corner: HTMLElement };
  /** A section's own container. */
  section(id: StudioSection): HTMLElement;
  dispose(): void;
}

export interface StudioLayoutOptions {
  /** Hears every open, fold, turn and theme change, after the layout has settled, so the scene can frame her again. */
  changed(): void;
  readonly first?: StudioSection;
  readonly theme?: StudioTheme;
  /** The small caps line over the section title. */
  readonly eyebrow?: string;
}

const CLASS = 'sl-studio';
const S = `.${CLASS}`;
/** The layout. Sizes are for a phone first: 932 × 430 landscape, 430 × 932 upright. */
const LAYOUT_CSS = `
${S}{--sl-rail:calc(62px + env(safe-area-inset-left));--sl-insp:clamp(250px,30vw,340px);--sl-rail-h:calc(60px + env(safe-area-inset-bottom));--sl-insp-h:42%;--sl-head-h:50px;
  color:var(--sl-ink);font:600 12px system-ui,sans-serif}
${S} .sl-rail{position:absolute;left:0;top:0;bottom:0;width:var(--sl-rail);box-sizing:border-box;padding:10px 4px calc(10px + env(safe-area-inset-bottom)) calc(4px + env(safe-area-inset-left));
  display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--sl-chrome);border-right:1px solid var(--sl-line);overflow-y:auto;z-index:3;touch-action:pan-y}
${S} .sl-rail>button{flex:none;width:54px;height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0;border:0;border-radius:12px;
  background:transparent;color:var(--sl-muted);font:600 9.5px system-ui,sans-serif;letter-spacing:.03em;cursor:pointer;-webkit-tap-highlight-color:transparent}
${S} .sl-rail>button svg{width:21px;height:21px}
${S} .sl-rail>button[aria-pressed="true"]{background:var(--sl-on-soft);color:var(--sl-ink)}
${S} .sl-inspector{position:absolute;right:0;top:0;bottom:0;width:calc(var(--sl-insp) + env(safe-area-inset-right));box-sizing:border-box;padding-right:env(safe-area-inset-right);
  display:flex;flex-direction:column;background:var(--sl-panel);border-left:1px solid var(--sl-line);z-index:3}
${S} .sl-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:var(--sl-head-h);box-sizing:border-box;padding:8px 10px 8px 14px;border-bottom:1px solid var(--sl-line)}
${S} .sl-eyebrow{font:700 8.5px system-ui,sans-serif;letter-spacing:.18em;color:var(--sl-muted);text-transform:uppercase}
${S} .sl-title{font:750 16px system-ui,sans-serif;letter-spacing:-.02em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${S} .sl-fold{flex:none;width:40px;height:36px;border-radius:10px;border:1px solid var(--sl-btn-line);background:var(--sl-btn);color:var(--sl-ink);font:700 15px system-ui;cursor:pointer}
${S} .sl-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box;padding:12px 12px calc(16px + env(safe-area-inset-bottom)) 14px}
${S} .sl-section{display:none;flex-direction:column;gap:9px}
${S} .sl-section[data-open]{display:flex}
${S} .sl-row{display:flex;gap:6px;flex-wrap:wrap}
${S} .sl-section>details,${S} .sl-card{background:var(--sl-surface)!important;border:1px solid var(--sl-line)!important;border-radius:12px;padding:8px 11px!important}
${S} .sl-section>details>summary{font:750 11px system-ui,sans-serif!important;letter-spacing:.06em;color:var(--sl-ink)}
${S} .sl-section>details[data-sl-whole]{background:transparent!important;border:0!important;padding:0!important}
${S} .sl-section>details[data-sl-whole]>summary{pointer-events:none;list-style:none;font:600 11px system-ui!important;opacity:.75;padding:0 0 4px!important}
${S} .sl-section>details[data-sl-whole]>summary::-webkit-details-marker{display:none}
${S} input[type=range]{accent-color:var(--sl-accent)}
${S} select{background:var(--sl-field);color:var(--sl-ink);border:1px solid var(--sl-btn-line);border-radius:8px}
${S} .sl-stage{position:absolute;top:0;bottom:0;left:var(--sl-rail);right:calc(var(--sl-insp) + env(safe-area-inset-right))}
${S}[data-folded] .sl-inspector{display:none}
${S}[data-folded] .sl-stage{right:0}
${S} .sl-top{position:absolute;top:calc(8px + env(safe-area-inset-top));left:10px;right:10px;display:flex;align-items:flex-start;gap:8px}
${S} .sl-bottom{position:absolute;bottom:calc(10px + env(safe-area-inset-bottom));left:10px;right:58px;display:flex;justify-content:center;align-items:center;gap:8px}
${S} .sl-corner{position:absolute;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));display:flex;gap:6px}
${S} .sl-pill{display:flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:var(--sl-glass);border:1px solid var(--sl-glass-line);box-shadow:0 5px 22px var(--sl-shadow);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
${S} .sl-pill>button{min-width:36px;min-height:34px;padding:5px 9px;border:0;border-radius:9px;background:transparent;color:var(--sl-ink);font:700 11px system-ui,sans-serif;letter-spacing:.03em;cursor:pointer}
${S} .sl-pill>button[aria-pressed="true"]{background:var(--sl-accent);color:var(--sl-chrome)}
${S} .sl-pill>button:disabled{opacity:.35;cursor:default}
${S}[data-orient="portrait"] .sl-rail{top:auto;right:0;width:auto;height:var(--sl-rail-h);flex-direction:row;justify-content:space-around;align-items:stretch;gap:0;
  padding:2px max(4px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(4px,env(safe-area-inset-left));border-right:0;border-top:1px solid var(--sl-line);overflow:hidden}
${S}[data-orient="portrait"] .sl-rail>button{flex:1;width:auto;height:auto;min-width:0}
${S}[data-orient="portrait"] .sl-inspector{left:0;top:auto;bottom:var(--sl-rail-h);width:auto;height:var(--sl-insp-h);padding-right:0;border-left:0;border-top:1px solid var(--sl-line);border-radius:18px 18px 0 0;
  box-shadow:0 -6px 24px var(--sl-shadow)}
${S}[data-orient="portrait"] .sl-body{padding-bottom:14px}
${S}[data-orient="portrait"] .sl-stage{left:0;right:0;bottom:calc(var(--sl-rail-h) + var(--sl-insp-h))}
${S}[data-orient="portrait"][data-folded] .sl-inspector{display:flex;height:var(--sl-head-h)}
${S}[data-orient="portrait"][data-folded] .sl-body{display:none}
${S}[data-orient="portrait"][data-folded] .sl-stage{bottom:calc(var(--sl-rail-h) + var(--sl-head-h))}
@media (prefers-reduced-motion: reduce){${S} *{transition:none!important}}`;

export function studioLayout(root: HTMLElement, opts: StudioLayoutOptions): StudioLayout {
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
  root.classList.add(CLASS);
  const style = el('style');
  style.textContent = `${themeCss(S)}\n${LAYOUT_CSS}`;

  // ------------------------------------------------------------ the stage
  const stage = el('div', 'sl-stage');
  stage.dataset.role = STUDIO_ROLE.stage;
  const top = el('div', 'sl-top'), bottom = el('div', 'sl-bottom'), corner = el('div', 'sl-corner');
  stage.append(top, bottom, corner);

  // ------------------------------------------------------------ the inspector
  const inspector = el('aside', 'sl-inspector');
  inspector.dataset.role = STUDIO_ROLE.inspector;
  const head = el('div', 'sl-head');
  const titles = el('div');
  titles.style.minWidth = '0';
  const eyebrow = el('div', 'sl-eyebrow'); eyebrow.textContent = opts.eyebrow ?? 'Sarah Lab';
  const title = el('div', 'sl-title'); title.dataset.role = STUDIO_ROLE.title;
  titles.append(eyebrow, title);
  const foldButton = el('button', 'sl-fold');
  foldButton.type = 'button'; foldButton.dataset.action = STUDIO_FOLD_ACTION;
  foldButton.addEventListener('click', (e) => { e.stopPropagation(); layout.fold(!folded); });
  head.append(titles, foldButton);
  const body = el('div', 'sl-body');
  const sections = new Map<StudioSection, HTMLElement>();
  for (const s of STUDIO_SECTIONS) {
    const box = el('div', 'sl-section');
    box.dataset.section = s.id;
    sections.set(s.id, box); body.appendChild(box);
  }
  inspector.append(head, body);

  // ------------------------------------------------------------ the rail
  const rail = el('nav', 'sl-rail');
  rail.dataset.role = STUDIO_ROLE.rail;
  rail.setAttribute('aria-label', 'Sections');
  const railButtons = new Map<StudioSection, HTMLButtonElement>();
  for (const s of STUDIO_SECTIONS) {
    const b = el('button');
    b.type = 'button';
    b.dataset.action = studioSectionAction(s.id);
    b.setAttribute('aria-label', s.title);
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg><span>${s.label}</span>`;
    // the open section again folds it away, or brings it back
    b.addEventListener('click', (e) => { e.stopPropagation(); if (open === s.id) layout.fold(!folded); else layout.show(s.id); });
    railButtons.set(s.id, b); rail.appendChild(b);
  }

  // the rail and the inspector are controls, not the stage: a drag on them never turns her
  const keep = (e: Event) => e.stopPropagation();
  for (const node of [rail, inspector]) for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) node.addEventListener(ev, keep);

  // ------------------------------------------------------------ the controls, into their sections (once)
  const tagged = [...root.querySelectorAll<HTMLElement>('[data-tab]')].filter((e) => !e.parentElement?.closest('[data-tab]'));
  let row: HTMLElement | null = null, rowSection: StudioSection | null = null;
  for (const node of tagged) {
    const id = node.dataset.tab;
    if (!isStudioSection(id)) continue;
    const section = sections.get(id)!;
    node.style.position = 'static';
    node.style.left = node.style.right = node.style.top = node.style.bottom = '';
    if (node.tagName === 'BUTTON') {
      if (!row || rowSection !== id || row !== section.lastElementChild) { row = el('div', 'sl-row'); section.appendChild(row); rowSection = id; }
      row.appendChild(node);
    } else { section.appendChild(node); row = null; }
  }
  root.append(style, stage, rail, inspector);

  let portrait = false, folded = false, open: StudioSection = opts.first ?? 'body', theme: StudioTheme = opts.theme ?? DEFAULT_THEME;
  const meta = (id: StudioSection) => STUDIO_SECTIONS.find((s) => s.id === id)!;
  const paint = () => {
    root.dataset.orient = portrait ? 'portrait' : 'landscape';
    root.dataset.theme = theme;
    if (folded) root.dataset.folded = ''; else delete root.dataset.folded;
    for (const [id, box] of sections) { if (id === open) box.dataset.open = ''; else delete box.dataset.open; }
    for (const [id, b] of railButtons) b.setAttribute('aria-pressed', String(id === open && !folded));
    title.textContent = meta(open).title;
    foldButton.textContent = portrait ? (folded ? '⌃' : '⌄') : '⟩';
    foldButton.setAttribute('aria-label', folded ? 'Show the controls' : 'Hide the controls');
  };
  let lastCovered = '';
  const settle = () => { paint(); lastCovered = JSON.stringify(layout.covered()); opts.changed(); };
  // a stage that changes size by itself (a font loading, the browser's own bars) frames her again
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const now = JSON.stringify(layout.covered());
    if (now !== lastCovered) { lastCovered = now; opts.changed(); }
  });
  watch?.observe(stage);

  const layout: StudioLayout = {
    get portrait() { return portrait; },
    get open() { return open; },
    get folded() { return folded; },
    get theme() { return theme; },
    setPortrait(next) { if (next === portrait) return; portrait = next; settle(); },
    show(id) { open = id; folded = false; settle(); body.scrollTop = 0; },
    fold(next) { if (next === folded) return; folded = next; settle(); },
    setTheme(next) { if (next === theme) return; theme = next; settle(); },
    covered() {
      const r = root.getBoundingClientRect(), s = stage.getBoundingClientRect();
      if (!r.width || !r.height || !s.width) return { left: 0, right: 0, top: 0, bottom: 0 };
      return { left: Math.max(0, s.left - r.left), right: Math.max(0, r.right - s.right), top: Math.max(0, s.top - r.top), bottom: Math.max(0, r.bottom - s.bottom) };
    },
    stage: { element: stage, top, bottom, corner },
    section: (id) => sections.get(id)!,
    dispose() { watch?.disconnect(); },
  };
  paint();
  return layout;
}
