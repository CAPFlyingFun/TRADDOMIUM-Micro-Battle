/**
 * THE CHARACTERS & OUTFITS PANEL (Joshua, 2026-10-22): save a character under a name -- SAVE ALL, SAVE BODY or SAVE
 * CLOTHES -- and load her back; keep an outfit library any character can wear; export the whole book to a file and
 * import one. The book and its rules are `characterSaves.ts`; this is only its controls. The room supplies what she is
 * now and how to put a save on her.
 */
import {
  type CharacterBook, type OutfitRef, type SaveScope, type SavedBody, type SavedClothes,
  clothesFor, exportBook, findOutfit, holds, importBook, mergeBooks, removeFrom, removeOutfit, resolveClothes, saveInto, saveOutfit,
} from './characterSaves';

export const CHARACTER_FIELD = Object.freeze({
  name: 'sarahlab-character-name',
  outfitName: 'sarahlab-outfit-name',
  status: 'sarahlab-character-status',
  list: 'sarahlab-character-list',
  outfits: 'sarahlab-outfit-list',
});
export const CHARACTER_ACTION = Object.freeze({
  save: (scope: SaveScope) => `sarahlab:character:save:${scope}`,
  saveOutfit: 'sarahlab:outfit:save',
  load: (name: string) => `sarahlab:character:load:${name}`,
  wear: (name: string) => `sarahlab:outfit:wear:${name}`,
  export: 'sarahlab:character:export',
  import: 'sarahlab:character:import',
});

export interface CharacterPanelHooks {
  read(): CharacterBook;
  write(book: CharacterBook): void;
  /** What she is and wears now. */
  body(): SavedBody;
  clothes(): SavedClothes;
  /** The library outfit she last put on, if she is still wearing it (her changes to it are kept as hers). */
  wornFrom(): string | null;
  putOnBody(body: SavedBody): void;
  /** `from`: the library outfit these clothes come from, if any. */
  putOnClothes(clothes: SavedClothes, from: string | null): void;
  /** Hand the user a file (EXPORT). */
  download(name: string, text: string): void;
}

const BTN = 'min-height:34px;padding:4px 8px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui;cursor:pointer';
const INPUT = 'flex:1;min-width:0;height:32px;padding:0 8px;border-radius:8px;border:1px solid #ffffff30;background:#0d1117;color:#e8e2d8;font:600 12px system-ui';

export interface CharacterPanel { readonly element: HTMLElement; refresh(): void }

export function characterPanel(hooks: CharacterPanelHooks): CharacterPanel {
  const panel = document.createElement('details');
  panel.style.cssText = 'border-top:1px solid rgba(255,255,255,0.12);padding-top:6px';
  const summary = document.createElement('summary');
  summary.textContent = 'CHARACTERS & OUTFITS';
  summary.style.cssText = 'cursor:pointer;font:700 12px system-ui,sans-serif;letter-spacing:.08em;padding:4px 0';
  panel.appendChild(summary);
  const button = (label: string, action: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.action = action; b.style.cssText = BTN;
    b.addEventListener('click', onClick);
    return b;
  };
  const row = (...kids: HTMLElement[]) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px'; r.append(...kids); return r; };
  const heading = (text: string) => { const h = document.createElement('div'); h.textContent = text; h.style.cssText = 'font:700 11px system-ui;letter-spacing:.08em;opacity:.8;margin-top:10px'; return h; };
  const input = (field: string, placeholder: string, value: string) => {
    const i = document.createElement('input');
    i.type = 'text'; i.placeholder = placeholder; i.value = value; i.maxLength = 40; i.dataset.field = field; i.style.cssText = INPUT;
    return i;
  };
  const status = document.createElement('div');
  status.dataset.field = CHARACTER_FIELD.status;
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'font-size:11px;line-height:1.4;opacity:.85;margin-top:6px;overflow-wrap:anywhere';
  const say = (text: string) => { status.textContent = text; };
  const now = () => new Date().toISOString();

  // ---------------------------------------------------------------- characters
  const name = input(CHARACTER_FIELD.name, 'Character name (Sarah, Lena...)', 'Sarah');
  const save = (scope: SaveScope) => {
    const n = name.value.trim();
    if (!n) { say('Type a name first.'); return; }
    const book = hooks.read();
    // her clothes as a reference to the library outfit she put on, when they are still that outfit
    const clothes: SavedClothes | OutfitRef = clothesFor(book, hooks.clothes(), hooks.wornFrom());
    hooks.write(saveInto(book, n, scope, hooks.body(), clothes, now()));
    say(scope === 'all' ? `Saved ${n}: body and clothes.` : scope === 'body' ? `Saved ${n}'s body. Her clothes in the save are unchanged.` : `Saved ${n}'s clothes${'basedOn' in clothes ? ` (based on "${clothes.basedOn}", only her changes)` : ''}. Her body in the save is unchanged.`);
    refresh();
  };
  const list = document.createElement('div');
  list.dataset.field = CHARACTER_FIELD.list;
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px';

  // ---------------------------------------------------------------- outfits
  const outfitName = input(CHARACTER_FIELD.outfitName, 'Outfit name (Academy uniform...)', '');
  const outfits = document.createElement('div');
  outfits.dataset.field = CHARACTER_FIELD.outfits;
  outfits.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px';

  /** A delete that asks once: the first tap arms it for a few seconds, the second deletes. */
  const deleteButton = (action: string, onDelete: () => void) => {
    const b = button('✕', action, () => {
      if (b.dataset.armed === '1') { onDelete(); return; }
      b.dataset.armed = '1'; b.textContent = 'DELETE?'; b.style.borderColor = '#d46a53';
      setTimeout(() => { b.dataset.armed = ''; b.textContent = '✕'; b.style.borderColor = '#ffffff30'; }, 3000);
    });
    b.title = 'delete (tap twice)';
    return b;
  };
  const line = (title: string, detail: string, ...actions: HTMLElement[]) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:space-between';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:12px;line-height:1.25;min-width:0;overflow-wrap:anywhere';
    const strong = document.createElement('b'); strong.textContent = title;
    const small = document.createElement('div'); small.textContent = detail; small.style.cssText = 'font-size:10px;opacity:.7';
    t.append(strong, small);
    const a = document.createElement('div'); a.style.cssText = 'display:flex;gap:4px;flex:none'; a.append(...actions);
    r.append(t, a);
    return r;
  };

  function refresh(): void {
    const book = hooks.read();
    list.replaceChildren(...(book.characters.length ? book.characters.map((c) => line(c.name, holds(c),
      button('LOAD', CHARACTER_ACTION.load(c.name), () => {
        if (c.body) hooks.putOnBody(c.body);
        if (c.clothes) {
          const worn = resolveClothes(hooks.read(), c.clothes);
          if (worn) hooks.putOnClothes(worn, 'basedOn' in c.clothes ? c.clothes.basedOn : null);
          else if ('basedOn' in c.clothes) { say(`${c.name}'s outfit is based on "${c.clothes.basedOn}", which is not in the outfit library any more.`); return; }
        }
        name.value = c.name;
        say(`Loaded ${c.name}: ${holds(c)}.`);
      }),
      deleteButton(`sarahlab:character:delete:${c.name}`, () => { hooks.write(removeFrom(hooks.read(), c.name)); say(`Deleted ${c.name}.`); refresh(); }),
    )) : [placeholder('No characters saved yet.')]));
    outfits.replaceChildren(...(book.outfits.length ? book.outfits.map((o) => line(o.name, `${o.clothes.outfit}${o.clothes.layers.some((l) => l && !l.template) ? ' · hand painted' : ''}`,
      button('WEAR', CHARACTER_ACTION.wear(o.name), () => { hooks.putOnClothes(o.clothes, o.name); say(`Wearing "${o.name}". Change its colours or fabrics and SAVE CLOTHES to keep them as hers; "${o.name}" itself stays as it is.`); }),
      deleteButton(`sarahlab:outfit:delete:${o.name}`, () => {
        const users = hooks.read().characters.filter((c) => c.clothes && 'basedOn' in c.clothes && c.clothes.basedOn.toLowerCase() === o.name.toLowerCase()).map((c) => c.name);
        hooks.write(removeOutfit(hooks.read(), o.name));
        say(users.length ? `Deleted "${o.name}". ${users.join(', ')} still refer to it: load and re-save them with another outfit.` : `Deleted "${o.name}".`);
        refresh();
      }),
    )) : [placeholder('No outfits saved yet.')]));
  }
  function placeholder(text: string): HTMLElement { const d = document.createElement('div'); d.textContent = text; d.style.cssText = 'font-size:11px;opacity:.6'; return d; }

  // ---------------------------------------------------------------- the file
  const file = document.createElement('input');
  file.type = 'file'; file.accept = '.json,application/json'; file.style.display = 'none';
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      const book = importBook(text);
      if (!book) { say(`${f.name} is not a character file.`); return; }
      hooks.write(mergeBooks(hooks.read(), book));
      say(`Imported ${book.characters.length} character${book.characters.length === 1 ? '' : 's'} and ${book.outfits.length} outfit${book.outfits.length === 1 ? '' : 's'} from ${f.name}. Same names were replaced.`);
      refresh();
    }).finally(() => { file.value = ''; });
  });

  panel.append(
    heading('CHARACTER'),
    row(name),
    row(button('SAVE ALL', CHARACTER_ACTION.save('all'), () => save('all')), button('SAVE BODY', CHARACTER_ACTION.save('body'), () => save('body')), button('SAVE CLOTHES', CHARACTER_ACTION.save('clothes'), () => save('clothes'))),
    list,
    heading('OUTFIT LIBRARY · any character can wear these'),
    row(outfitName, button('SAVE OUTFIT', CHARACTER_ACTION.saveOutfit, () => {
      const n = outfitName.value.trim();
      if (!n) { say('Type an outfit name first.'); return; }
      const replacing = !!findOutfit(hooks.read(), n);
      hooks.write(saveOutfit(hooks.read(), n, hooks.clothes(), now()));
      say(replacing ? `Replaced "${n}" in the library. Characters based on it keep their own changes.` : `Saved "${n}" to the outfit library.`);
      refresh();
    })),
    outfits,
    heading('FILE'),
    row(button('EXPORT', CHARACTER_ACTION.export, () => { hooks.download('traddomium-characters.json', exportBook(hooks.read())); say('Exported every character and outfit.'); }),
      button('IMPORT', CHARACTER_ACTION.import, () => file.click())),
    file,
    status,
  );
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']) panel.addEventListener(ev, (e) => e.stopPropagation());
  refresh();
  return { element: panel, refresh };
}
