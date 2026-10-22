/**
 * Character saves and RANDOMIZE (Joshua, 2026-10-22): save all / just the body / just the clothes under a name, an
 * outfit library characters can wear and reference, and randomizing within per-control ranges with locks.
 */
import { describe, expect, it } from 'vitest';
import { NO_RULES, isLocked, randomize, ruleFor, sanitizeRules, withGroupLock, withRule, type RandomSpec } from '../src/actor/bodyRandom';
import {
  EMPTY_BOOK, clothesFor, exportBook, holds, importBook, mergeBooks, removeFrom, resolveClothes, saveInto, saveOutfit, type SavedBody, type SavedClothes,
} from '../src/sarahlab/characterSaves';
import { BODY_RANDOM_SPECS } from '../src/sarahlab/sarahLabTool';

const spec = (key: string, group: string, min = 0, max = 100, step = 1): RandomSpec => ({ key, group, min, max, step, defaultMin: min, defaultMax: max });
/** A seeded random source, so every run picks the same numbers. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('RANDOMIZE within ranges, with locks', () => {
  const specs = [spec('bump', 'belly', 0, 200), spec('bellyWidth', 'belly', -15, 15), spec('breastWidth', 'breasts', -25, 25), spec('breastDepth', 'breasts', -25, 25)];
  const values = { bump: 90, bellyWidth: 3, breastWidth: 5, breastDepth: -4 };

  it('picks every unlocked control inside its own range, on its step', () => {
    // Lena: belly 0-40%, breast width 10-20
    let rules = withRule(NO_RULES, specs[0], { min: 0, max: 40 });
    rules = withRule(rules, specs[2], { min: 10, max: 20 });
    const rnd = seeded(7);
    for (let n = 0; n < 200; n++) {
      const v = randomize(values, specs, rules, rnd);
      expect(v.bump).toBeGreaterThanOrEqual(0); expect(v.bump).toBeLessThanOrEqual(40); expect(Number.isInteger(v.bump)).toBe(true);
      expect(v.breastWidth).toBeGreaterThanOrEqual(10); expect(v.breastWidth).toBeLessThanOrEqual(20);
      expect(Math.abs(v.bellyWidth)).toBeLessThanOrEqual(15);
    }
  });
  it('keeps a locked control exactly, and a group lock holds the whole group without forgetting the fine locks', () => {
    let rules = withRule(NO_RULES, specs[3], { locked: true });
    const v = randomize(values, specs, rules, seeded(3));
    expect(v.breastDepth).toBe(-4);
    rules = withGroupLock(rules, 'belly', true);
    const w = randomize(values, specs, rules, seeded(4));
    expect(w.bump).toBe(90); expect(w.bellyWidth).toBe(3); expect(w.breastDepth).toBe(-4);
    expect(w.breastWidth).not.toBe(5);
    // unlocking the group gives back the fine lock set inside the other group, and the belly moves again
    rules = withGroupLock(rules, 'belly', false);
    expect(isLocked(rules, specs[3])).toBe(true);
    expect(isLocked(rules, specs[0])).toBe(false);
  });
  it('keeps every range inside its slider, low never above high, and reads saved rules defensively', () => {
    expect(ruleFor(withRule(NO_RULES, specs[1], { min: 40, max: -90 }), specs[1])).toEqual({ min: -15, max: 15, locked: false });
    const back = sanitizeRules({ rules: { bump: { min: 5, max: 30, locked: true }, nope: { min: 1, max: 2 } }, groups: ['breasts', 'feet'] }, specs);
    expect(back.rules).toEqual({ bump: { min: 5, max: 30, locked: true } });
    expect(back.groups).toEqual(['breasts']);
    expect(sanitizeRules('junk', specs)).toEqual(NO_RULES);
  });
  it('covers the bump and every body control in the room, each default range inside its slider', () => {
    expect(BODY_RANDOM_SPECS[0]).toMatchObject({ key: 'bump', group: 'belly', min: 0 });
    for (const s of BODY_RANDOM_SPECS) { expect(s.defaultMin).toBeGreaterThanOrEqual(s.min); expect(s.defaultMax).toBeLessThanOrEqual(s.max); expect(s.defaultMin).toBeLessThan(s.defaultMax); }
    expect(new Set(BODY_RANDOM_SPECS.map((s) => s.group))).toEqual(new Set(['belly', 'breasts']));
  });
});

describe('character saves', () => {
  const body = (bump: number): SavedBody => ({ model: 'v2-body', bump, shape: '{"version":1,"shape":{}}', refine: false, random: withGroupLock(NO_RULES, 'belly', true) });
  const pick = (colour: number) => ({ fabric: { family: 'jersey' as const, colour }, match: true, trim: null, stitch: 1, opacity: null });
  const tee = (colour: number, length = 0): SavedClothes => ({
    outfit: 'painted tee + leggings', shirtLength: length, garments: {},
    layers: [{ choice: pick(1), detail: { mode: 'auto', material: null, nipple: 0.45, navel: 0.8 } as never, template: { id: 'leggingsFull', params: {} as never }, mask: '' },
      { choice: pick(colour), detail: { mode: 'auto', material: null, nipple: 0.45, navel: 0.8 } as never, template: { id: 'teeShort', params: { length } as never }, mask: '' }, null],
  });

  it('saves all, just the body or just the clothes under a name, keeping the part it does not replace', () => {
    let book = saveInto(EMPTY_BOOK, 'Sarah', 'all', body(90), tee(0), 't1');
    book = saveInto(book, ' sarah ', 'body', body(95), tee(9), 't2');
    expect(book.characters).toHaveLength(1);
    expect(book.characters[0].body?.bump).toBe(95);
    expect((book.characters[0].clothes as SavedClothes).layers[1]?.choice.fabric?.colour).toBe(0);
    book = saveInto(book, 'Lena', 'clothes', body(0), tee(4), 't3');
    expect(book.characters.map((c) => c.name)).toEqual(['Lena', 'Sarah']);
    expect(book.characters[0].body).toBeNull();
    expect(holds(book.characters[0])).toBe('own outfit');
    expect(removeFrom(book, 'LENA').characters.map((c) => c.name)).toEqual(['Sarah']);
  });

  it('keeps a character wearing a library outfit as a reference with only her changes, and never alters the original', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Academy uniform', tee(0), 't1');
    // Sarah wears it in red (colour 15) at a longer length
    const hers = clothesFor(book, tee(15, 0.4), 'Academy uniform');
    expect('basedOn' in hers).toBe(true);
    book = saveInto(book, 'Sarah', 'clothes', body(90), hers, 't2');
    expect(holds(book.characters[0])).toBe('"Academy uniform" + her changes');
    const worn = resolveClothes(book, book.characters[0].clothes)!;
    expect(worn.layers[1]?.choice.fabric?.colour).toBe(15);
    expect(worn.shirtLength).toBe(0.4);
    // the library outfit is untouched
    expect(book.outfits[0].clothes.layers[1]?.choice.fabric?.colour).toBe(0);
    // a change to its make (another template) is kept as her own outfit instead
    const remade = { ...tee(15), layers: [tee(15).layers[0], { ...tee(15).layers[1]!, template: { id: 'teeV', params: {} as never } }, null] };
    expect('basedOn' in clothesFor(book, remade, 'Academy uniform')).toBe(false);
    // a reference to an outfit no longer in the library resolves to nothing rather than to something else
    expect(resolveClothes({ ...book, outfits: [] }, book.characters[0].clothes)).toBeNull();
  });

  it('exports and imports the whole book, characters and outfits, and refuses what is not one', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Combat', tee(3), 't0');
    book = saveInto(book, 'Sarah', 'all', body(90), clothesFor(book, tee(5), 'Combat'), 't1');
    const back = importBook(exportBook(book))!;
    expect(back).toEqual(book);
    expect(importBook('{"version":2}')).toBeNull();
    expect(importBook('not json')).toBeNull();
    const merged = mergeBooks(saveInto(EMPTY_BOOK, 'Lena', 'body', body(10), tee(1), 'x'), back);
    expect(merged.characters.map((c) => c.name)).toEqual(['Sarah', 'Lena']);
    expect(merged.outfits.map((o) => o.name)).toEqual(['Combat']);
    // the body's ranges and locks come back
    expect(back.characters[0].body?.random.groups).toEqual(['belly']);
  });
});
