/**
 * THE CHARACTER ROOM HELD UPRIGHT (Joshua, 2026-10-20: "maybe optimize UI for portrait better. I see a few text
 * overlapping and it could be organized better. Maybe add like tabs or buttons similar to the storm tracker at the
 * bottom"). On a portrait screen the room's controls are sorted into tabs along the bottom -- POSE, BODY, CLOTHES and
 * CAMERA -- and the chosen tab's controls open in a sheet above them; tapping the open tab again folds the sheet away,
 * so she has the whole screen. Turned landscape, every control goes back to exactly where it was: the landscape
 * layout is the one Joshua approved and does not change.
 *
 * The scene builds its HUD as it always has and marks each control with `data-tab` (and `data-upright-only` for the
 * few that exist only here); this module moves those elements between their own places and the tabs and nothing
 * else, so every control keeps its `data-action` and its handlers. Where each element came from is recorded once,
 * and put back in that order.
 */
export const UPRIGHT_TABS = Object.freeze([
  { id: 'pose', label: 'POSE', icon: '<circle cx="12" cy="4.5" r="2.2"/><path d="M12 7.5v7M12 9.5l-4.5 3M12 9.5l4.5 3M12 14.5l-3.5 6M12 14.5l3.5 6"/>' },
  { id: 'body', label: 'BODY', icon: '<path d="M9 3c-1 3-1 5 0 7-2.5 2-3 6-1 9M15 3c1 3 1 5 0 7 3.5 1.5 4.5 6 2 9"/><circle cx="15.6" cy="14.5" r=".6"/>' },
  { id: 'clothes', label: 'CLOTHES', icon: '<path d="M8 3l-5 3 2 4 3-1.5V21h8V8.5l3 1.5 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3z"/>' },
  { id: 'camera', label: 'CAMERA', icon: '<path d="M4 7h3l2-2.5h6L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>' },
] as const);
export type UprightTab = (typeof UPRIGHT_TABS)[number]['id'];

/** The `data-action` of a tab's button. */
export const uprightTabAction = (tab: UprightTab) => `sarahlab:tab:${tab}`;
/** The `data-role` of the sheet and of the tab bar, for a probe. */
export const UPRIGHT_SHEET_ROLE = 'sarahlab-sheet', UPRIGHT_TABBAR_ROLE = 'sarahlab-tabs';

export interface UprightLayout {
  /** Lay the controls out for a portrait screen (true) or put them back (false). Repeating a call changes nothing. */
  setPortrait(portrait: boolean): void;
  readonly portrait: boolean;
  /** The open tab, or null with the sheet folded away. */
  readonly open: UprightTab | null;
  show(tab: UprightTab | null): void;
  /** How many CSS pixels at the bottom of the room the tab bar and an open sheet cover (0 in landscape). */
  covered(): number;
}

interface Home { readonly el: HTMLElement; readonly parent: HTMLElement; readonly index: number; readonly style: string | null }

/**
 * `root` holds the HUD; every element under it with `data-tab` is a tab's. `changed` hears every open, fold and
 * turn, after the layout has settled, so the scene can frame her above what the controls now cover.
 */
export function uprightLayout(root: HTMLElement, changed: () => void, first: UprightTab = 'body'): UprightLayout {
  const doc = root.ownerDocument;
  const homes: Home[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-tab]')) homes.push({ el, parent: el.parentElement!, index: [...el.parentElement!.childNodes].indexOf(el), style: el.getAttribute('style') });
  const keep = (e: Event) => e.stopPropagation();

  const sheet = doc.createElement('div');
  sheet.dataset.role = UPRIGHT_SHEET_ROLE;
  sheet.style.cssText = 'position:absolute;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:calc(64px + env(safe-area-inset-bottom));max-height:44%;overflow-y:auto;touch-action:pan-y;padding:12px;border-radius:14px;background:rgba(10,13,18,0.9);border:1px solid rgba(255,255,255,0.1);display:none;box-sizing:border-box';
  const sections = new Map<UprightTab, HTMLElement>();
  for (const t of UPRIGHT_TABS) {
    const s = doc.createElement('div');
    s.dataset.tabSection = t.id;
    s.style.cssText = 'display:none;flex-direction:column;gap:6px';
    sections.set(t.id, s); sheet.appendChild(s);
  }

  const bar = doc.createElement('nav');
  bar.dataset.role = UPRIGHT_TABBAR_ROLE;
  bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:calc(60px + env(safe-area-inset-bottom));padding:0 max(6px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(6px,env(safe-area-inset-left));display:none;justify-content:space-around;align-items:stretch;background:rgba(8,10,14,0.96);border-top:1px solid rgba(255,255,255,0.12);box-sizing:border-box';
  const tabButtons = new Map<UprightTab, HTMLButtonElement>();
  for (const t of UPRIGHT_TABS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.action = uprightTabAction(t.id);
    b.setAttribute('aria-label', t.label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>`;
    b.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:none;border:0;color:#9aa0a8;font:700 10px system-ui,sans-serif;letter-spacing:.08em;padding:6px 0;min-width:0';
    b.addEventListener('click', (e) => { e.stopPropagation(); layout.show(layout.open === t.id ? null : t.id); });
    tabButtons.set(t.id, b); bar.appendChild(b);
  }
  for (const el of [sheet, bar]) for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) el.addEventListener(ev, keep);
  // a sheet that grows or shrinks (a section opened inside it, the texture panel unfolding) frames her again
  let lastHeight = -1;
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const h = Math.round(sheet.getBoundingClientRect().height);
    if (portrait && h !== lastHeight) { lastHeight = h; changed(); }
  });
  watch?.observe(sheet);

  let portrait = false, open: UprightTab | null = first;
  const paint = () => {
    for (const [id, s] of sections) s.style.display = portrait && open === id ? 'flex' : 'none';
    sheet.style.display = portrait && open ? 'block' : 'none';
    bar.style.display = portrait ? 'flex' : 'none';
    for (const [id, b] of tabButtons) { b.style.color = open === id ? '#d4a853' : '#9aa0a8'; b.setAttribute('aria-pressed', String(open === id)); }
  };

  const layout: UprightLayout = {
    get portrait() { return portrait; },
    get open() { return open; },
    setPortrait(next) {
      if (next === portrait) return;
      portrait = next;
      if (portrait) {
        root.append(sheet, bar);
        // each tab's controls in the order they stand in landscape; a run of buttons shares a row that wraps
        const order = [...homes].sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1));
        const rows = new Map<UprightTab, HTMLElement | null>();
        for (const { el } of order) {
          const tab = el.dataset.tab as UprightTab, section = sections.get(tab);
          if (!section) continue;
          el.style.position = 'static'; el.style.left = el.style.right = el.style.top = el.style.bottom = '';
          if (el.tagName === 'BUTTON' && !el.dataset.uprightWhole) {
            let row = rows.get(tab) ?? null;
            if (!row || row !== section.lastElementChild) { row = doc.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'; section.appendChild(row); rows.set(tab, row); }
            row.appendChild(el);
          } else { section.appendChild(el); rows.set(tab, null); }
        }
      } else {
        // back where each came from, lowest place first so every index is right as it is filled
        for (const h of [...homes].sort((a, b) => a.index - b.index)) { if (h.style === null) h.el.removeAttribute('style'); else h.el.setAttribute('style', h.style); h.parent.insertBefore(h.el, h.parent.childNodes[h.index] ?? null); }
        sheet.remove(); bar.remove();
        for (const s of sections.values()) s.replaceChildren();
      }
      paint(); changed();
    },
    show(tab) { open = tab; paint(); changed(); },
    covered() {
      if (!portrait) return 0;
      return bar.getBoundingClientRect().height + (open ? sheet.getBoundingClientRect().height + 8 : 0);
    },
  };
  paint();
  return layout;
}
