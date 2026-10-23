/**
 * THE OUTFIT SECTION AS PICTURES. Clothes are chosen by eye, not by name: every outfit she can wear -- the room's
 * built-in ones with their baked images, and the saved ones with the JPEG captured when they were saved -- is a card
 * with a small picture of her in it. Tapping a card puts that outfit on; a saved outfit's ✕ deletes it, asking once
 * (the first tap arms it as DELETE? for four seconds, the second deletes), the way the room's other deletes do.
 *
 * The room calls `set()` whenever anything changes, so cards are kept by id and only what changed is touched: a
 * thumbnail is often a data URL, and assigning the same one again would re-decode it and flash the picture.
 *
 * The look comes from the room's theme, custom properties on an ancestor. This module only reads them, each with a
 * fallback, so it also looks right with no theme at all.
 */
export interface OutfitCard {
  /** Stable key, e.g. 'builtin:painted tee + leggings' or 'shared:Sarah casual'. */
  readonly id: string;
  readonly name: string;
  /** A small second line ("Built-in", "3 painted pieces · worn by Lena"). */
  readonly note?: string;
  /** Image URL or data URL; null/undefined shows the placeholder silhouette. */
  readonly thumb?: string | null;
  /** What she has on now: ringed in the accent, aria-pressed="true". */
  readonly worn?: boolean;
  /** data-action of the card's main button. */
  readonly action: string;
  /** A delete ✕ on the card, with its own data-action. Absent: no ✕. */
  readonly remove?: { readonly action: string };
}
export interface OutfitCardsHooks {
  onPick(id: string): void;
  onRemove?(id: string): void;
}
export interface OutfitCards {
  readonly element: HTMLElement;
  /** Show these cards, in this order. Cards are reused by id: an unchanged thumb keeps its <img> and src (no reload, no flicker). */
  set(cards: readonly OutfitCard[]): void;
  dispose(): void;
}
export const OUTFIT_CARDS_ROLE = 'sarahlab-outfit-cards';

const ARM_MS = 4000;
const GRID = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(var(--sl-card-min, 84px), 1fr));gap:8px';
const WRAP = 'position:relative;min-width:0;min-height:44px';
const CARD = 'display:flex;flex-direction:column;align-items:stretch;gap:4px;width:100%;min-height:44px;margin:0;padding:5px;'
  + 'border-radius:10px;background:var(--sl-surface, #0b0f14);border:1px solid var(--sl-line, #ffffff20);'
  + 'color:var(--sl-ink, #e8e2d8);text-align:left;font:500 10px system-ui;cursor:pointer;touch-action:manipulation;'
  + '-webkit-tap-highlight-color:transparent';
const WORN = ';box-shadow:0 0 0 2px var(--sl-accent, #d4a853)';
const WELL = 'position:relative;width:100%;aspect-ratio:3/4;border-radius:7px;overflow:hidden;'
  + 'background:var(--sl-field, #0d1117);display:flex;align-items:center;justify-content:center';
const IMG = 'position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover';
const NAME = 'font:700 11px system-ui;line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;'
  + 'overflow:hidden;overflow-wrap:anywhere';
const NOTE = 'font-size:10px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const X = 'position:absolute;top:4px;right:4px;z-index:1;width:28px;height:28px;padding:0;margin:0;display:flex;'
  + 'align-items:center;justify-content:center;white-space:nowrap;border-radius:8px;background:var(--sl-btn, #151b23);'
  + 'border:1px solid var(--sl-btn-line, #ffffff30);color:var(--sl-ink, #e8e2d8);font:700 12px system-ui;cursor:pointer';
const X_ARMED = ';width:auto;padding:0 8px;font-size:10px;border-color:var(--sl-danger, #d46a53)';
/** A constant: the only markup this module writes. */
const FIGURE = '<svg viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '
  + 'stroke-linejoin="round" aria-hidden="true" style="width:46%;height:auto;opacity:.45">'
  + '<circle cx="12" cy="5" r="3"/><path d="M12 8.5v11.5M12 11.5l-5 6M12 11.5l5 6M12 20l-4 10M12 20l4 10"/></svg>';
const STOPPED = ['pointerdown', 'pointermove', 'pointerup', 'wheel'] as const;

interface CardView {
  card: OutfitCard;
  readonly wrap: HTMLDivElement;
  readonly button: HTMLButtonElement;
  readonly well: HTMLDivElement;
  readonly name: HTMLDivElement;
  readonly note: HTMLDivElement;
  img: HTMLImageElement | null;
  figure: HTMLDivElement | null;
  /** The thumb on show; undefined until the first set(). */
  thumb: string | null | undefined;
  worn: boolean | null;
  x: HTMLButtonElement | null;
  armed: ReturnType<typeof setTimeout> | null;
}

export function outfitCards(hooks: OutfitCardsHooks): OutfitCards {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '') => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
  const grid = el('div', GRID);
  grid.dataset.role = OUTFIT_CARDS_ROLE;
  // a tap on a card must not also turn the 3D view behind it
  const stop = (e: Event) => e.stopPropagation();
  for (const ev of STOPPED) grid.addEventListener(ev, stop);
  const views = new Map<string, CardView>();
  let disposed = false;

  function make(card: OutfitCard): CardView {
    const wrap = el('div', WRAP);
    wrap.dataset.cardId = card.id;
    const button = el('button', CARD);
    button.type = 'button';
    const well = el('div', WELL), name = el('div', NAME), note = el('div', NOTE);
    button.append(well, name, note);
    wrap.append(button);
    const v: CardView = { card, wrap, button, well, name, note, img: null, figure: null, thumb: undefined, worn: null, x: null, armed: null };
    button.addEventListener('click', (e) => { e.stopPropagation(); hooks.onPick(v.card.id); });
    return v;
  }

  function showFigure(v: CardView): void {
    if (!v.figure) {
      v.figure = el('div', 'display:flex;align-items:center;justify-content:center;width:100%;height:100%');
      v.figure.innerHTML = FIGURE;
    }
    if (v.figure.parentNode !== v.well) v.well.replaceChildren(v.figure);
    v.well.dataset.thumb = 'placeholder';
  }

  function showThumb(v: CardView, thumb: string | null): void {
    v.thumb = thumb;
    if (thumb === null) { showFigure(v); return; }
    if (!v.img) {
      const img = el('img', IMG);
      img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
      // a broken picture is the silhouette until a different thumb arrives
      img.addEventListener('error', () => { if (v.img === img && v.thumb !== null) showFigure(v); });
      v.img = img;
    }
    v.img.alt = v.card.name;
    v.img.src = thumb;
    if (v.img.parentNode !== v.well) v.well.replaceChildren(v.img);
    v.well.dataset.thumb = 'image';
  }

  function disarm(v: CardView): void {
    if (v.armed !== null) { clearTimeout(v.armed); v.armed = null; }
    if (v.x) { v.x.textContent = '✕'; v.x.style.cssText = X; v.x.setAttribute('aria-label', `Delete ${v.card.name}`); }
  }

  function arm(v: CardView): void {
    const x = v.x;
    if (!x) return;
    x.textContent = 'DELETE?'; x.style.cssText = X + X_ARMED; x.setAttribute('aria-label', `Confirm: delete ${v.card.name}`);
    v.armed = setTimeout(() => { v.armed = null; disarm(v); }, ARM_MS);
  }

  function update(v: CardView, card: OutfitCard): void {
    v.card = card;
    v.button.dataset.action = card.action;
    v.button.setAttribute('aria-label', card.name);
    const worn = !!card.worn;
    v.button.setAttribute('aria-pressed', String(worn));
    if (worn !== v.worn) { v.worn = worn; v.button.style.cssText = CARD + (worn ? WORN : ''); }
    if (v.name.textContent !== card.name) v.name.textContent = card.name;
    const note = card.note ?? '';
    if (v.note.textContent !== note) v.note.textContent = note;
    v.note.hidden = !note;
    if (v.img) v.img.alt = card.name;
    const thumb = card.thumb ?? null;
    if (thumb !== v.thumb) showThumb(v, thumb);
    // no way to delete, no ✕: an unavailable action must never look functional
    if (card.remove && hooks.onRemove) {
      if (!v.x) {
        const x = el('button', X);
        x.type = 'button'; x.title = 'delete (tap twice)'; x.textContent = '✕';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          if (v.armed === null) { arm(v); return; }
          disarm(v);
          hooks.onRemove?.(v.card.id);
        });
        v.x = x;
        v.wrap.append(x);
      }
      v.x.dataset.action = card.remove.action;
      v.x.setAttribute('aria-label', v.armed === null ? `Delete ${card.name}` : `Confirm: delete ${card.name}`);
    } else if (v.x) {
      disarm(v);
      v.x.remove();
      v.x = null;
    }
  }

  function drop(v: CardView): void {
    if (v.armed !== null) { clearTimeout(v.armed); v.armed = null; }
    v.wrap.remove();
  }

  return {
    element: grid,
    set(cards) {
      if (disposed) return;
      const order: CardView[] = [];
      const seen = new Set<string>();
      for (const card of cards) {
        if (seen.has(card.id)) continue; // the first card with an id wins
        seen.add(card.id);
        let v = views.get(card.id);
        if (!v) { v = make(card); views.set(card.id, v); }
        update(v, card);
        order.push(v);
      }
      for (const [id, v] of views) if (!seen.has(id)) { drop(v); views.delete(id); }
      // move only what is out of place, so an unchanged card is never detached
      order.forEach((v, i) => { const at = grid.children[i]; if (at !== v.wrap) grid.insertBefore(v.wrap, at ?? null); });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const ev of STOPPED) grid.removeEventListener(ev, stop);
      for (const v of views.values()) drop(v);
      views.clear();
      grid.replaceChildren();
    },
  };
}
