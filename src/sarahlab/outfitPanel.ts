/**
 * THE OUTFIT EDITOR'S SAVE WORKSPACE (Joshua, 2026-10-22: "EDIT OUTFIT... NEW OUTFIT... SAVE AS NEW... SAVE CHANGES...
 * PERSONAL OUTFIT... SHARED OUTFIT... Example: Select the default white shirt and gray leggings, change the shirt to red
 * jersey and the leggings to charcoal athletic knit, and save it as 'Sarah Casual.' The original outfit should remain
 * available").
 *
 * What is being edited is always named, with where it came from:
 *   - a BUILT-IN outfit (the room's own, the OUTFIT button's list): editable, never overwritten -- its changes are kept
 *     by SAVE AS NEW;
 *   - a SHARED outfit (the library any character can wear, `characterSaves.ts`);
 *   - a PERSONAL outfit (one character's clothes);
 *   - a NEW outfit, started blank or from any built-in or shared outfit.
 * SAVE AS NEW keeps the clothes as a new SHARED outfit, or as a character's PERSONAL clothes; SAVE CHANGES writes them
 * back over the shared or personal outfit being edited, after a second tap to confirm. Nothing here ever changes a
 * body: a personal save writes only the character's clothes (`saveInto(..., 'clothes')`).
 */
import {
  type CharacterBook, type SavedBody, type SavedClothes, clothesFor, findOutfit, removeOutfit, sameClothes, saveInto, saveOutfit,
} from './characterSaves';

export type OutfitSourceKind = 'builtin' | 'shared' | 'personal' | 'new';
export interface OutfitSource { readonly kind: OutfitSourceKind; readonly name: string }

export const OUTFIT_FIELD = Object.freeze({
  editing: 'sarahlab-outfit-editing',
  start: 'sarahlab-outfit-start',
  sharedName: 'sarahlab-outfit-name',
  character: 'sarahlab-outfit-character',
  status: 'sarahlab-outfit-status',
  library: 'sarahlab-outfit-list',
});
export const OUTFIT_ACTION = Object.freeze({
  start: 'sarahlab:outfit:new',
  saveShared: 'sarahlab:outfit:save-shared',
  savePersonal: 'sarahlab:outfit:save-personal',
  saveChanges: 'sarahlab:outfit:save-changes',
  wear: (name: string) => `sarahlab:outfit:wear:${name}`,
  remove: (name: string) => `sarahlab:outfit:delete:${name}`,
});

export interface OutfitPanelHooks {
  read(): CharacterBook;
  write(book: CharacterBook): void;
  /** What she wears now. */
  clothes(): SavedClothes;
  /** Her body now (a personal save needs one to call `saveInto`, which keeps the body already saved). */
  body(): SavedBody;
  /** The name in the CHARACTERS panel, for a personal save. */
  characterName(): string;
  /** The room's built-in outfits, by name, for NEW OUTFIT. */
  builtins(): readonly string[];
  wearBuiltin(name: string): void;
  /** Every piece off: a blank outfit to build. */
  startBlank(): void;
  /** Put clothes on, from the library or a character. */
  putOn(clothes: SavedClothes, source: OutfitSource): void;
}

export interface OutfitPanel {
  readonly element: HTMLElement;
  /** The room says what is now on her and where it came from; what she wears now is the "unchanged" mark. */
  editing(source: OutfitSource): void;
  source(): OutfitSource;
  /** Her clothes changed (the editor says so): the CHANGED mark follows. */
  changed(): void;
  refresh(): void;
}

const BTN = 'min-height:36px;padding:5px 9px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui;cursor:pointer';
const INPUT = 'flex:1;min-width:0;height:34px;padding:0 8px;border-radius:8px;border:1px solid #ffffff30;background:#0d1117;color:#e8e2d8;font:600 12px system-ui';
const KIND_WORD: Readonly<Record<OutfitSourceKind, string>> = { builtin: 'built-in outfit', shared: 'shared outfit', personal: 'personal outfit', new: 'new outfit, not saved yet' };

export function outfitPanel(hooks: OutfitPanelHooks): OutfitPanel {
  let source: OutfitSource = { kind: 'builtin', name: '' };
  let baseline: SavedClothes | null = null;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '') => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
  const heading = (text: string) => { const h = el('div', 'font:700 11px system-ui;letter-spacing:.08em;opacity:.8;margin-top:6px'); h.textContent = text; return h; };
  const row = (...kids: HTMLElement[]) => { const r = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center'); r.append(...kids); return r; };
  const button = (label: string, action: string, onClick: () => void) => {
    const b = el('button', BTN); b.type = 'button'; b.textContent = label; b.dataset.action = action;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  };
  const input = (field: string, placeholder: string) => {
    const i = el('input', INPUT); i.type = 'text'; i.placeholder = placeholder; i.maxLength = 40; i.dataset.field = field;
    i.addEventListener('keydown', (e) => e.stopPropagation());
    return i;
  };
  /** A save that asks first when it would replace something: the first tap arms it, the second saves. */
  const confirmable = (b: HTMLButtonElement, label: () => string, needs: () => string | null, run: () => void) => {
    b.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      const question = needs();
      if (question && b.dataset.armed !== '1') {
        b.dataset.armed = '1'; b.textContent = question; b.style.borderColor = '#d46a53';
        setTimeout(() => { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = label(); b.style.borderColor = '#ffffff30'; } }, 4000);
        return;
      }
      b.dataset.armed = ''; b.style.borderColor = '#ffffff30';
      run();
      b.textContent = label();
    }, { capture: true });
  };
  const now = () => new Date().toISOString();
  const status = el('div', 'font-size:11px;line-height:1.4;opacity:.85;overflow-wrap:anywhere');
  status.dataset.field = OUTFIT_FIELD.status; status.setAttribute('aria-live', 'polite');
  const say = (text: string) => { status.textContent = text; };

  // what is being edited
  const editingLine = el('div', 'display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:10px;background:#0b0f14;border:1px solid #ffffff18');
  editingLine.dataset.field = OUTFIT_FIELD.editing;
  const editingName = el('div', 'font:800 13px system-ui'), editingKind = el('div', 'font:500 11px system-ui;opacity:.75');
  editingLine.append(editingName, editingKind);

  // NEW OUTFIT
  const start = el('select', 'flex:1;min-width:0;min-height:36px;font:600 12px system-ui');
  start.dataset.field = OUTFIT_FIELD.start; start.setAttribute('aria-label', 'Start a new outfit from');
  const startButton = button('NEW OUTFIT', OUTFIT_ACTION.start, () => {
    const v = start.value;
    if (v === 'blank') { hooks.startBlank(); say('A blank outfit. Pick + NEW PIECE in SELECT and choose a style, or paint one in BODY PAINT.'); return; }
    const [kind, name] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    if (kind === 'builtin') { hooks.wearBuiltin(name); pendingNew = name; say(`A new outfit, started from "${name}". The original stays as it is.`); return; }
    const o = findOutfit(hooks.read(), name);
    if (o) { hooks.putOn(o.clothes, { kind: 'new', name: '' }); say(`A new outfit, started from "${o.name}". "${o.name}" itself stays as it is.`); }
  });
  /** A built-in outfit put on to START a new one: when the room says it is on, it is a new outfit, not the built-in. */
  let pendingNew: string | null = null;

  // SAVE AS NEW
  const sharedName = input(OUTFIT_FIELD.sharedName, 'Outfit name (Sarah Casual...)');
  const saveShared = button('SAVE AS SHARED', OUTFIT_ACTION.saveShared, () => undefined);
  confirmable(saveShared, () => 'SAVE AS SHARED', () => {
    const n = sharedName.value.trim();
    return n && findOutfit(hooks.read(), n) ? `REPLACE "${n}"? TAP AGAIN` : null;
  }, () => {
    const n = sharedName.value.trim();
    if (!n) { say('Type a name for the outfit first.'); return; }
    const replacing = !!findOutfit(hooks.read(), n);
    hooks.write(saveOutfit(hooks.read(), n, hooks.clothes(), now()));
    const saved = findOutfit(hooks.read(), n)!;
    mark({ kind: 'shared', name: saved.name });
    say(replacing ? `Replaced the shared outfit "${saved.name}". Characters based on it keep their own changes.` : `Saved "${saved.name}" as a shared outfit any character can wear.${source.kind === 'shared' || source.kind === 'personal' ? '' : ' The outfit you started from is unchanged.'}`);
    refresh();
  });
  const character = input(OUTFIT_FIELD.character, 'Character (Sarah, Lena...)');
  const savePersonal = button('SAVE TO CHARACTER', OUTFIT_ACTION.savePersonal, () => undefined);
  const personalHas = (n: string) => !!hooks.read().characters.find((c) => c.name.toLowerCase() === n.toLowerCase())?.clothes;
  confirmable(savePersonal, () => 'SAVE TO CHARACTER', () => {
    const n = (character.value.trim() || hooks.characterName().trim());
    return n && personalHas(n) && !(source.kind === 'personal' && source.name.toLowerCase() === n.toLowerCase()) ? `REPLACE ${n.toUpperCase()}'S CLOTHES? TAP AGAIN` : null;
  }, () => {
    const n = character.value.trim() || hooks.characterName().trim();
    if (!n) { say('Type the character\'s name first.'); return; }
    savePersonalAs(n);
  });
  function savePersonalAs(n: string): void {
    const book = hooks.read();
    // her clothes as a reference to the shared outfit they came from, when they still are that outfit
    const clothes = clothesFor(book, hooks.clothes(), source.kind === 'shared' ? source.name : null);
    hooks.write(saveInto(book, n, 'clothes', hooks.body(), clothes, now()));
    const saved = hooks.read().characters.find((c) => c.name.toLowerCase() === n.toLowerCase());
    const basedOn = 'basedOn' in clothes ? clothes.basedOn : null;
    mark({ kind: 'personal', name: saved?.name ?? n });
    say(`Saved as ${saved?.name ?? n}'s personal outfit${basedOn ? ` (based on "${basedOn}", only her changes)` : ''}. Her saved body is unchanged.`);
    refresh();
  }

  // SAVE CHANGES
  const saveChanges = button('SAVE CHANGES', OUTFIT_ACTION.saveChanges, () => undefined);
  const changesNote = el('div', 'font-size:10px;opacity:.7;line-height:1.35');
  confirmable(saveChanges, () => saveChangesLabel(), () => (canSaveChanges() ? `OVERWRITE "${source.name}"? TAP AGAIN` : null), () => {
    if (!canSaveChanges()) { say(changesNote.textContent ?? ''); return; }
    if (source.kind === 'shared') {
      hooks.write(saveOutfit(hooks.read(), source.name, hooks.clothes(), now()));
      mark(source);
      say(`Saved your changes to the shared outfit "${source.name}".`);
    } else savePersonalAs(source.name);
    refresh();
  });
  const canSaveChanges = () => source.kind === 'shared' || source.kind === 'personal';
  const saveChangesLabel = () => (canSaveChanges() ? `SAVE CHANGES TO "${source.name.toUpperCase()}"` : 'SAVE CHANGES');

  // the shared library
  const library = el('div', 'display:flex;flex-direction:column;gap:4px');
  library.dataset.field = OUTFIT_FIELD.library;

  const element = el('div', 'display:flex;flex-direction:column;gap:6px');
  element.append(
    editingLine,
    heading('SAVE'),
    row(saveChanges), changesNote,
    heading('SAVE AS NEW · SHARED: any character can wear it'),
    row(sharedName, saveShared),
    heading('SAVE AS NEW · PERSONAL: one character\'s own clothes'),
    row(character, savePersonal),
    heading('NEW OUTFIT · start from'),
    row(start, startButton),
    heading('SHARED OUTFITS'),
    library,
    status,
  );
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) element.addEventListener(ev, (e) => e.stopPropagation());

  function mark(next: OutfitSource): void { source = next; baseline = hooks.clothes(); refresh(); }
  function isChanged(): boolean { return !!baseline && !sameClothes(baseline, hooks.clothes()); }

  function refresh(): void {
    const changed = isChanged();
    editingName.textContent = source.kind === 'new' && !source.name ? 'New outfit' : source.name || '—';
    editingKind.textContent = `EDITING · ${KIND_WORD[source.kind]}${changed ? ' · CHANGED' : ''}`;
    editingKind.style.color = changed ? '#d4a853' : '';
    const can = canSaveChanges();
    saveChanges.style.opacity = can ? '1' : '.45';
    saveChanges.setAttribute('aria-disabled', String(!can));
    if (saveChanges.dataset.armed !== '1') saveChanges.textContent = saveChangesLabel();
    changesNote.textContent = can ? (changed ? 'Your changes are not saved yet.' : 'Nothing changed since it was saved.')
      : source.kind === 'builtin' ? 'A built-in outfit is never overwritten: SAVE AS NEW keeps your version, and the original stays available.'
        : 'Not saved yet: use SAVE AS NEW.';
    if (!character.value && document.activeElement !== character) character.placeholder = hooks.characterName() ? `Character (${hooks.characterName()})` : 'Character (Sarah, Lena...)';
    // NEW OUTFIT's choices: blank, every built-in, every shared outfit
    const book = hooks.read();
    const keep = start.value;
    start.replaceChildren(new Option('Blank (nothing on)', 'blank'));
    const built = document.createElement('optgroup'); built.label = 'Built-in';
    for (const n of hooks.builtins()) built.appendChild(new Option(n, `builtin:${n}`));
    start.appendChild(built);
    if (book.outfits.length) {
      const shared = document.createElement('optgroup'); shared.label = 'Shared';
      for (const o of book.outfits) shared.appendChild(new Option(o.name, `shared:${o.name}`));
      start.appendChild(shared);
    }
    start.value = [...start.options].some((o) => o.value === keep) ? keep : 'blank';
    library.replaceChildren(...(book.outfits.length ? book.outfits.map((o) => {
      const r = el('div', 'display:flex;gap:6px;align-items:center;justify-content:space-between');
      const t = el('div', 'font-size:12px;min-width:0;overflow-wrap:anywhere');
      const b = el('b'); b.textContent = o.name;
      const users = book.characters.filter((c) => c.clothes && 'basedOn' in c.clothes && c.clothes.basedOn.toLowerCase() === o.name.toLowerCase()).map((c) => c.name);
      const s = el('div', 'font-size:10px;opacity:.7'); s.textContent = `${o.clothes.layers.filter(Boolean).length} painted pieces${users.length ? ` · worn by ${users.join(', ')}` : ''}`;
      t.append(b, s);
      const wear = button('EDIT', OUTFIT_ACTION.wear(o.name), () => { hooks.putOn(o.clothes, { kind: 'shared', name: o.name }); say(`Editing the shared outfit "${o.name}".`); });
      const del = button('✕', OUTFIT_ACTION.remove(o.name), () => undefined);
      del.title = 'delete (tap twice)';
      confirmable(del, () => '✕', () => 'DELETE?', () => {
        hooks.write(removeOutfit(hooks.read(), o.name));
        say(users.length ? `Deleted "${o.name}". ${users.join(', ')} still refer to it: load and re-save them with another outfit.` : `Deleted "${o.name}".`);
        if (source.kind === 'shared' && source.name.toLowerCase() === o.name.toLowerCase()) source = { kind: 'new', name: '' };
        refresh();
      });
      const a = el('div', 'display:flex;gap:4px;flex:none'); a.append(wear, del);
      r.append(t, a);
      return r;
    }) : [Object.assign(el('div', 'font-size:11px;opacity:.6'), { textContent: 'No shared outfits yet.' })]));
  }

  refresh();
  return {
    element,
    editing(next) {
      if (pendingNew !== null && next.kind === 'builtin' && next.name === pendingNew) next = { kind: 'new', name: '' };
      pendingNew = null;
      mark(next);
    },
    source: () => source,
    changed() { refresh(); },
    refresh,
  };
}
