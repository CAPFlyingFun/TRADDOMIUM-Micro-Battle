/**
 * THE NEW TEE IN A SAVE (Stage 3, `characterSaves.ts`). Joshua approved it in the Stage 1 plan, under "Saving": "A saved
 * outfit stores the garment's settings, never its mesh: one versioned record in the outfit (SavedClothes), with the
 * cloth dials beside it. Loading remakes the garment from those settings and the character's own body... A library
 * outfit worn with her changes (OutfitRef) carries garment and dial overrides like her colours."
 * - A record comes back through a file whole, in an outfit of her own and under a reference to a library outfit.
 * - A save made before it holds no record anywhere, and loads and resolves exactly as it did.
 * - A record or an override read from a file is read defensively: another version dropped, settings clamped, dials
 *   finite and 0..100, unknown keys and unreadable fields left out, and nothing throws.
 * - A reference carries only the settings and dials she moved (EASE whole), resolves to her whole record and never
 *   touches the shared outfit; an outfit with no record resolves from the defaults.
 * - No record and the default record are the same clothes; any one moved setting or dial is a change.
 */
import { describe, expect, it } from 'vitest';
import { NO_RULES } from '../src/actor/bodyRandom';
import {
  CHARACTER_BOOK_VERSION, EMPTY_BOOK, GARMENT_RECORD_DEFAULT, clothesFor, exportBook, importBook, resolveClothes, sameClothes,
  sanitizeBook, saveInto, saveOutfit, type OutfitRef, type SavedBody, type SavedClothes,
} from '../src/sarahlab/characterSaves';
import type { LayerDetail } from '../src/sarahlab/detailMaterials';
import {
  GARMENT_DEFAULTS, GARMENT_RANGES, GARMENT_RECORD_VERSION, clampGarmentSettings, type GarmentRecord, type GarmentSettings,
} from '../src/sarahlab/garment/settings';
import { CLOTH_DIALS, CLOTH_TUNE_DEFAULT, type ClothTune } from '../src/sarahlab/sarahLabTool';

const D = GARMENT_DEFAULTS, R = GARMENT_RANGES;
const body: SavedBody = { model: 'v2-body', bump: 90, shape: '{"version":1,"shape":{}}', refine: false, random: NO_RULES };
const DETAIL: LayerDetail = { mode: 'auto', material: null, override: { nipple: 0.45, navel: 0.8 } };
const pick = (colour: number) => ({ fabric: { family: 'jersey' as const, colour }, match: true, trim: null, stitch: 1, opacity: null });
/** The new tee over painted leggings in jersey `colour`, with its record when given (without one: a save from before Stage 3). */
const tee = (colour = 0, garment?: GarmentRecord): SavedClothes => ({
  outfit: 'new tee + leggings', shirtLength: 0, garments: {},
  layers: [{ choice: pick(colour), detail: DETAIL, template: { id: 'leggingsFull', params: {} as never }, mask: '' }, null],
  ...(garment ? { garment } : {}),
});
/** A record: the defaults with these settings and dials on top. */
const record = (settings: Partial<GarmentSettings> = {}, dials: Partial<ClothTune> = {}): GarmentRecord =>
  ({ version: GARMENT_RECORD_VERSION, settings: { ...D, ...settings }, dials: { ...CLOTH_TUNE_DEFAULT, ...dials } });
/** Clothes that must be a reference to a library outfit. */
function asRef(c: SavedClothes | OutfitRef | null): OutfitRef {
  if (!c || !('basedOn' in c)) throw new Error('expected a reference to a library outfit');
  return c;
}

describe('a record through a file', () => {
  /** Every control and every dial away from its default, each within its range. */
  const hers = record(
    { construction: 'setIn', gusset: 0, neckWidth: 0.22, neckCurve: 0.5, ease: { bust: 0.03, waist: 0.06, hip: 0.05 }, length: 75, frontHem: 0.02, backHem: -0.01, hemCurve: 0.4, sleeve: 80, neckDepth: 0.12, bellyRoom: 0.7 },
    { weight: 60, calm: 40, fit: 70, close: 80, stretch: 30, grip: 20, steps: 90 },
  );

  it('covers every setting and every dial the room shows', () => {
    for (const k of Object.keys(D) as (keyof GarmentSettings)[]) expect(hers.settings[k], k).not.toEqual(D[k]);
    for (const { key } of CLOTH_DIALS) expect(hers.dials[key], key).not.toBe(CLOTH_TUNE_DEFAULT[key]);
    // the dials a record keeps are exactly the room's
    expect(Object.keys(hers.dials).sort()).toEqual(CLOTH_DIALS.map((d) => d.key).sort());
    expect(clampGarmentSettings(hers.settings)).toEqual(hers.settings);
  });

  it('comes back whole in an outfit of her own and in the library', () => {
    let book = saveInto(EMPTY_BOOK, 'Sarah', 'all', body, tee(3, hers), 't1');
    book = saveOutfit(book, 'Long tee', tee(3, hers), 't2');
    const text = exportBook(book);
    const back = importBook(text)!;
    expect(back).toEqual(book);
    expect((back.characters[0].clothes as SavedClothes).garment).toEqual(hers);
    expect(back.outfits[0].clothes.garment).toEqual(hers);
    expect(resolveClothes(back, back.characters[0].clothes)!.garment).toEqual(hers);
    // an optional, additive field: the book's version is unchanged
    expect(CHARACTER_BOOK_VERSION).toBe(1);
    expect(JSON.parse(text).version).toBe(1);
  });

  it('comes back whole under a reference to a library outfit', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Academy tee', tee(0, record()), 't0');
    const ref = asRef(clothesFor(book, tee(0, hers), 'Academy tee'));
    book = saveInto(book, 'Lena', 'clothes', body, ref, 't1');
    const back = importBook(exportBook(book))!;
    expect(back).toEqual(book);
    expect(asRef(back.characters[0].clothes).overrides.garment).toEqual(ref.overrides.garment);
    expect(resolveClothes(back, back.characters[0].clothes)!.garment).toEqual(hers);
  });
});

describe('a save made before the new tee', () => {
  // a book as the room wrote it before Stage 3: her own outfit, a reference and a library outfit, no record anywhere
  const OLD = {
    version: 1,
    characters: [
      { name: 'Sarah', savedAt: 't1', body, clothes: tee(5) },
      { name: 'Lena', savedAt: 't2', body: null, clothes: { basedOn: 'Academy', overrides: { layers: [{ choice: pick(9), detail: DETAIL }, null], garments: {}, shirtLength: 0.3 } } },
    ],
    outfits: [{ name: 'Academy', savedAt: 't0', clothes: tee(0) }],
  };

  it('loads exactly as it did, with no record anywhere', () => {
    const back = importBook(JSON.stringify(OLD))!;
    expect(back).toEqual(OLD);
    expect(JSON.parse(exportBook(back))).toEqual(OLD);
    expect(exportBook(back)).not.toContain('"garment"');
  });

  it('resolves without one, and wearing its outfit as it was adds no override', () => {
    const back = importBook(JSON.stringify(OLD))!;
    for (const c of back.characters) expect('garment' in resolveClothes(back, c.clothes)!, c.name).toBe(false);
    const ref = asRef(clothesFor(back, tee(0), 'Academy'));
    expect('garment' in ref.overrides).toBe(false);
    expect('garment' in resolveClothes(back, ref)!).toBe(false);
  });
});

describe('a record or an override from untrusted data', () => {
  /** A library outfit read with this as its record. */
  const own = (garment: unknown) => sanitizeBook({ version: 1, outfits: [{ name: 'X', savedAt: 't', clothes: { ...tee(0), garment } }] }).outfits[0].clothes;
  /** A reference read with this as her tee's override. */
  const over = (garment: unknown) =>
    asRef(sanitizeBook({ version: 1, characters: [{ name: 'Y', savedAt: 't', body: null, clothes: { basedOn: 'X', overrides: { layers: [], garments: {}, shirtLength: null, garment } } }] }).characters[0].clothes).overrides;

  it('drops a record of another version, or anything that is not a record, rather than misread it', () => {
    for (const g of [{ ...record({ length: 90 }), version: 2 }, { ...record(), version: '1' }, { settings: record({ length: 90 }).settings, dials: CLOTH_TUNE_DEFAULT }, [record()], 'tee', 7, true, null])
      expect('garment' in own(g), JSON.stringify(g)).toBe(false);
    // and the rest of the outfit reads as it always did
    expect(own({ ...record(), version: 2 })).toEqual(tee(0));
  });

  it('clamps every setting and dial, takes the default for one it cannot read, and keeps nothing it does not know', () => {
    const g = own({
      version: 1, mesh: [1, 2, 3],
      settings: { construction: 'cape', gusset: Infinity, neckWidth: 'wide', neckCurve: NaN, ease: { bust: 1, waist: -1, hip: 'x' }, length: 1e9, frontHem: -Infinity, backHem: -5, hemCurve: '0.5', sleeve: -40, neckDepth: 99, bellyRoom: [1], flare: 0.5 },
      dials: { weight: 1e9, calm: '50', fit: -20, close: NaN, stretch: Infinity, grip: -Infinity, steps: 12.5, colour: 3 },
    }).garment!;
    expect(Object.keys(g).sort()).toEqual(['dials', 'settings', 'version']);
    expect(g.settings).toEqual({ ...D, ease: { bust: R.ease[1], waist: R.ease[0], hip: D.ease.hip }, length: R.length[1], backHem: R.backHem[0], sleeve: R.sleeve[0], neckDepth: R.neckDepth[1] });
    expect(g.dials).toEqual({ ...CLOTH_TUNE_DEFAULT, weight: 100, fit: 0, steps: 12.5 });
    // missing fields are the defaults'; a record with nothing readable is the default tee, still the procedural one
    expect(own({ version: 1, settings: { length: 60 }, dials: { grip: 5 } }).garment).toEqual(record({ length: 60 }, { grip: 5 }));
    expect(own({ version: 1 }).garment).toEqual(GARMENT_RECORD_DEFAULT);
    expect(own({ version: 1, settings: [0.5], dials: 'loud' }).garment).toEqual(GARMENT_RECORD_DEFAULT);
  });

  it('reads a file the same way, even past what a number can hold (1e400 parses as Infinity)', () => {
    const text = JSON.stringify({
      version: 1,
      outfits: [{ name: 'X', savedAt: 't', clothes: { ...tee(0), garment: { version: 1, settings: { length: 'HUGE', sleeve: '-HUGE', gusset: 1e300, ease: [0.1, 0.1, 0.1] }, dials: { weight: 'HUGE', fit: -1e300, steps: [50] } } } }],
    }).replaceAll('"HUGE"', '1e400').replaceAll('"-HUGE"', '-1e400');
    const g = importBook(text)!.outfits[0].clothes.garment!;
    expect(g.settings).toEqual({ ...D, gusset: R.gusset[1] });
    expect(g.dials).toEqual({ ...CLOTH_TUNE_DEFAULT, fit: 0 });
  });

  it('keeps only the override fields it can read, each clamped to its range', () => {
    const o = over({
      settings: { length: 'long', sleeve: NaN, gusset: 9, neckWidth: null, construction: 'cape', hemCurve: -Infinity, ease: { bust: 0.05 }, frontHem: 0.5, flare: 1 },
      dials: { weight: 300, calm: NaN, grip: '5', fit: Infinity, steps: -3, nope: 3 },
      mesh: 'x',
    });
    expect(o.garment).toEqual({ settings: { gusset: R.gusset[1], neckWidth: null, frontHem: R.frontHem[1] }, dials: { weight: 100, steps: 0 } });
    // EASE is one field: read whole with each of its numbers clamped, or left out
    expect(over({ settings: { ease: { bust: 0.5, waist: 0.01, hip: -1 } } }).garment).toEqual({ settings: { ease: { bust: R.ease[1], waist: 0.01, hip: R.ease[0] } } });
    expect(over({ settings: { construction: 'setIn', ease: [0, 0, 0] }, dials: [5] }).garment).toEqual({ settings: { construction: 'setIn' } });
  });

  it('drops an override with nothing readable in it', () => {
    for (const g of [{}, { settings: { length: 'x' }, dials: { calm: 'x' } }, { settings: [], dials: [] }, { settings: null }, [], [{ dials: { fit: 5 } }], 'tee', 5, null])
      expect('garment' in over(g), JSON.stringify(g)).toBe(false);
  });

  it('never throws, and whatever it keeps is whole and in range', () => {
    const junk: unknown[] = [
      undefined, null, 0, NaN, -Infinity, '', 'x', true, [], [1, 'a'], {}, Object.create(null),
      { version: 1 }, { version: 1, settings: null, dials: null }, { version: 1, settings: 'x', dials: [] },
      { version: 1, settings: { ease: null, construction: {}, neckWidth: [] }, dials: { weight: {} } },
      { version: 1, settings: { ease: { bust: [], waist: {}, hip: null } }, dials: { steps: '' } },
      { settings: { ease: 'x' }, dials: 7 }, { settings: Object.create(null), dials: Object.create(null) },
    ];
    for (const g of junk) {
      let clothes: SavedClothes | undefined;
      expect(() => { clothes = own(g); }).not.toThrow();
      expect(() => over(g)).not.toThrow();
      const r = clothes?.garment;
      if (!r) continue;
      expect(r.settings).toEqual(clampGarmentSettings(r.settings));
      expect(Object.keys(r.dials).sort()).toEqual(Object.keys(CLOTH_TUNE_DEFAULT).sort());
      for (const v of Object.values(r.dials)) expect(v >= 0 && v <= 100).toBe(true);
    }
    // and through a file
    const outfit = '{"version":1,"outfits":[{"name":"X","clothes":{"outfit":"t","layers":[],"garment":{"version":1,"settings":"x","dials":[null]}}}]}';
    const ref = '{"version":1,"characters":[{"name":"Y","clothes":{"basedOn":"X","overrides":{"garment":{"settings":{"ease":{}},"dials":{"fit":"9"}}}}}]}';
    expect(importBook(outfit)!.outfits[0].clothes.garment).toEqual(GARMENT_RECORD_DEFAULT);
    expect('garment' in asRef(importBook(ref)!.characters[0].clothes).overrides).toBe(false);
  });
});

describe('a library outfit worn with her changes', () => {
  const shared = record({ length: 50, sleeve: 60 }, { weight: 40 });
  const library = () => saveOutfit(EMPTY_BOOK, 'Academy tee', tee(0, shared), 't0');

  it('stays a reference, carrying only the settings and dials she moved, EASE whole', () => {
    const hers = record({ length: 50, sleeve: 100, ease: { ...D.ease, waist: 0.07 } }, { weight: 40, fit: 60 });
    const ref = asRef(clothesFor(library(), tee(0, hers), 'Academy tee'));
    expect(ref.overrides.garment).toEqual({ settings: { sleeve: 100, ease: { bust: D.ease.bust, waist: 0.07, hip: D.ease.hip } }, dials: { fit: 60 } });
    // her other changes are kept beside it, as before
    const recoloured = asRef(clothesFor(library(), tee(7, hers), 'Academy tee'));
    expect(recoloured.overrides.layers[0]?.choice.fabric?.colour).toBe(7);
    expect(recoloured.overrides.garment).toEqual(ref.overrides.garment);
    // another construction is her change, not a change of the outfit's make
    expect(asRef(clothesFor(library(), tee(0, record({ construction: 'setIn', gusset: 0 })), 'Academy tee')).overrides.garment?.settings).toMatchObject({ construction: 'setIn', gusset: 0 });
  });

  it('resolves to her whole record and leaves the shared outfit as it was', () => {
    let book = library();
    const before = exportBook(book);
    const hers = record({ construction: 'setIn', gusset: 0, neckWidth: 0.24, length: 90 }, { grip: 10 });
    book = saveInto(book, 'Sarah', 'clothes', body, clothesFor(book, tee(0, hers), 'Academy tee'), 't1');
    expect(resolveClothes(book, book.characters[0].clothes)!.garment).toEqual(hers);
    expect(book.outfits[0].clothes.garment).toBe(shared);
    expect(shared).toEqual(record({ length: 50, sleeve: 60 }, { weight: 40 }));
    expect(exportBook({ ...book, characters: [] })).toBe(before);
    // and through a file
    const back = importBook(exportBook(book))!;
    expect(resolveClothes(back, back.characters[0].clothes)!.garment).toEqual(hers);
  });

  it('resolves from the defaults when the outfit holds no record', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Old tee', tee(0), 't0');
    const hers = record({ length: 90, frontHem: 0.04 }, { weight: 70 });
    const ref = asRef(clothesFor(book, tee(0, hers), 'Old tee'));
    expect(ref.overrides.garment).toEqual({ settings: { length: 90, frontHem: 0.04 }, dials: { weight: 70 } });
    book = saveInto(book, 'Sarah', 'clothes', body, ref, 't1');
    expect(resolveClothes(book, book.characters[0].clothes)!.garment).toEqual(hers);
    expect('garment' in book.outfits[0].clothes).toBe(false);
  });

  it('adds nothing when her tee is the outfit\'s or she wears no record, and the outfit\'s then stands as it is', () => {
    expect('garment' in asRef(clothesFor(library(), tee(4, shared), 'Academy tee')).overrides).toBe(false);
    expect('garment' in asRef(clothesFor(library(), tee(4, record(shared.settings, shared.dials)), 'Academy tee')).overrides).toBe(false);
    // the default tee on an outfit that holds no record
    expect('garment' in asRef(clothesFor(saveOutfit(EMPTY_BOOK, 'Old', tee(0), 't'), tee(4, record()), 'Old')).overrides).toBe(false);
    // no record on her: no override, even where the outfit has one
    const bare = asRef(clothesFor(library(), tee(4), 'Academy tee'));
    expect('garment' in bare.overrides).toBe(false);
    expect(resolveClothes(library(), bare)!.garment).toBe(shared);
    // an empty override, or a null one, is none
    expect(resolveClothes(library(), { ...bare, overrides: { ...bare.overrides, garment: {} } })!.garment).toBe(shared);
    expect(resolveClothes(library(), { ...bare, overrides: { ...bare.overrides, garment: null } })!.garment).toBe(shared);
  });

  it('takes a partial dials override: the dials she moved, the outfit\'s for the rest', () => {
    let book = library();
    const hers: GarmentRecord = { ...shared, dials: { ...shared.dials, steps: 90 } };
    const ref = asRef(clothesFor(book, tee(0, hers), 'Academy tee'));
    expect(ref.overrides.garment).toEqual({ dials: { steps: 90 } });
    book = saveInto(book, 'Sarah', 'clothes', body, ref, 't1');
    const back = importBook(exportBook(book))!;
    expect(resolveClothes(back, back.characters[0].clothes)!.garment).toEqual(hers);
    // as a file might hold one, with a dial it cannot read among them: the outfit's dial stands for that one
    const read = sanitizeBook({
      ...JSON.parse(exportBook(library())),
      characters: [{ name: 'Lena', savedAt: 't', body: null, clothes: { basedOn: 'Academy tee', overrides: { layers: [], garments: {}, shirtLength: null, garment: { dials: { close: 10, calm: NaN } } } } }],
    });
    expect(asRef(read.characters[0].clothes).overrides.garment).toEqual({ dials: { close: 10 } });
    expect(resolveClothes(read, read.characters[0].clothes)!.garment).toEqual({ ...shared, dials: { ...shared.dials, close: 10 } });
  });
});

describe('changed?', () => {
  it('counts no record and the default record as the same clothes', () => {
    expect(GARMENT_RECORD_DEFAULT).toEqual({ version: GARMENT_RECORD_VERSION, settings: GARMENT_DEFAULTS, dials: CLOTH_TUNE_DEFAULT });
    expect(sameClothes(tee(0), tee(0, GARMENT_RECORD_DEFAULT))).toBe(true);
    expect(sameClothes(tee(0, record()), tee(0))).toBe(true);
    expect(sameClothes(tee(0, record({ length: 60 }, { grip: 5 })), tee(0, record({ length: 60 }, { grip: 5 })))).toBe(true);
    // the rest of the clothes still count
    expect(sameClothes(tee(0, record()), tee(1, record()))).toBe(false);
  });

  it('counts any one moved setting or dial as a change', () => {
    const moved: [string, GarmentRecord][] = [];
    for (const k of Object.keys(D) as (keyof GarmentSettings)[]) {
      if (k === 'construction') moved.push([k, record({ construction: 'setIn' })]);
      else if (k === 'neckWidth') moved.push([k, record({ neckWidth: 0.25 })]);
      else if (k === 'ease') for (const e of ['bust', 'waist', 'hip'] as const) moved.push([`ease.${e}`, record({ ease: { ...D.ease, [e]: D.ease[e] + 0.01 } })]);
      else moved.push([k, record({ [k]: D[k] === R[k][1] ? R[k][0] : R[k][1] } as Partial<GarmentSettings>)]);
    }
    for (const d of Object.keys(CLOTH_TUNE_DEFAULT) as (keyof ClothTune)[]) moved.push([`dial ${d}`, record({}, { [d]: CLOTH_TUNE_DEFAULT[d] === 100 ? 99 : CLOTH_TUNE_DEFAULT[d] + 1 } as Partial<ClothTune>)]);
    expect(moved).toHaveLength(Object.keys(D).length + 2 + CLOTH_DIALS.length);
    for (const [what, g] of moved) {
      expect(sameClothes(tee(0), tee(0, g)), what).toBe(false);
      expect(sameClothes(tee(0, g), tee(0, GARMENT_RECORD_DEFAULT)), what).toBe(false);
      expect(sameClothes(tee(0, g), tee(0, record(g.settings, g.dials))), what).toBe(true);
    }
  });
});
