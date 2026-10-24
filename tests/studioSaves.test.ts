/**
 * WHAT THE STUDIO ADDS TO A SAVE (Joshua, 2026-10-23, from the Character Studio preview): a card's PICTURE for every saved
 * outfit and character, and a CUSTOM colour on any fabric. A save keeps both and reads them back; an imported file can
 * carry neither anything but a small image nor a colour that is not '#rrggbb'. And the WEAR cards offer exactly what
 * the OUTFIT button steps through, each with a baked picture's path.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_BOOK, THUMB_MAX_CHARS, exportBook, importBook, readThumb, saveInto, saveOutfit, sameClothes, type SavedBody, type SavedClothes } from '../src/sarahlab/characterSaves';
import { NO_RULES } from '../src/actor/bodyRandom';
import { OUTFITS, PAINTED_DEFAULT_OUTFIT, SARAH_LEGGINGS, SARAH_RED, nextOutfit, offeredOutfits, outfitThumbPath, recoveredPartsFor, wornGarments, RECOVERED_SHIRTS, type Garment } from '../src/sarahlab/sarahLabTool';
import { COVERAGE_TEMPLATES } from '../src/sarahlab/paintTemplates';
import { sanitizeBuilt } from '../src/sarahlab/strapData';

const body: SavedBody = { model: 'v2-body', bump: 100, shape: '', refine: false, random: NO_RULES };
const picture = `data:image/jpeg;base64,${'A'.repeat(400)}==`;
const red: SavedClothes = {
  outfit: 'painted tee + leggings', shirtLength: 0.4, garments: {},
  layers: [{ choice: { fabric: { family: 'athletic', colour: 0, tint: '#c61e38' }, match: true, trim: null, stitch: 1, opacity: null }, detail: { nipple: 'auto', navel: 'auto' } as never, template: { id: 'teeShort', params: {} as never }, mask: '' }],
};

describe('a card\'s picture in a save', () => {
  it('is kept with a shared outfit and a character, and read back from a file', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Sarah casual', red, '2026-10-23T12:00:00Z', picture);
    book = saveInto(book, 'Sarah', 'all', body, red, '2026-10-23T12:00:00Z', picture);
    const back = importBook(exportBook(book))!;
    expect(back.outfits[0].thumb).toBe(picture);
    expect(back.characters[0].thumb).toBe(picture);
  });

  it('a save without a new picture keeps the one it had', () => {
    let book = saveOutfit(EMPTY_BOOK, 'Sarah casual', red, 't1', picture);
    book = saveOutfit(book, 'sarah casual', red, 't2', null);
    expect(book.outfits[0].thumb).toBe(picture);
    let people = saveInto(EMPTY_BOOK, 'Sarah', 'all', body, red, 't1', picture);
    people = saveInto(people, 'Sarah', 'body', body, red, 't2');
    expect(people.characters[0].thumb).toBe(picture);
  });

  it('only a small base64 image is ever read in', () => {
    expect(readThumb(picture)).toBe(picture);
    expect(readThumb('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'https://example.com/a.jpg',
      'data:image/jpeg;base64,AA AA', `data:image/jpeg;base64,${'A'.repeat(THUMB_MAX_CHARS)}`, 42, null]) expect(readThumb(bad)).toBeUndefined();
    const text = JSON.stringify({ version: 1, characters: [], outfits: [{ name: 'X', savedAt: '', thumb: 'data:image/svg+xml;base64,PHN2Zz4=', clothes: red }] });
    expect(importBook(text)!.outfits[0].thumb).toBeUndefined();
  });
});

describe('a custom colour in a save', () => {
  it('comes back the same, and makes clothes differ from the same outfit in a pack colour', () => {
    const book = saveOutfit(EMPTY_BOOK, 'Red', red, 't');
    const back = importBook(exportBook(book))!.outfits[0].clothes;
    expect(back.layers[0]?.choice.fabric).toEqual({ family: 'athletic', colour: 0, tint: '#c61e38' });
    const white: SavedClothes = { ...red, layers: [{ ...red.layers[0]!, choice: { ...red.layers[0]!.choice, fabric: { family: 'athletic', colour: 0 } } }] };
    const read = (c: SavedClothes) => importBook(exportBook(saveOutfit(EMPTY_BOOK, 'Y', c, 't')))!.outfits[0].clothes;
    expect(sameClothes(back, read(red))).toBe(true);
    expect(sameClothes(back, read(white))).toBe(false);
  });

  it('is dropped when it is not a #rrggbb colour', () => {
    const text = JSON.stringify({ version: 1, characters: [], outfits: [{ name: 'X', savedAt: '', clothes: { ...red, layers: [{ ...red.layers[0], choice: { ...red.layers[0]!.choice, fabric: { family: 'athletic', colour: 3, tint: 'red;background:url(x)' } } }] } }] });
    expect(importBook(text)!.outfits[0].clothes.layers[0]?.choice.fabric).toEqual({ family: 'athletic', colour: 3 });
  });

  it('a built strap keeps its custom colour too', () => {
    const built = sanitizeBuilt({ version: 1, base: 'v2-body', pieces: [{ id: 'a', kind: 'strip', points: [], fabric: { family: 'ribbed', colour: 9, tint: '#3355AA' } }] });
    expect(built?.pieces[0].fabric).toEqual({ family: 'ribbed', colour: 0, tint: '#3355aa' });
  });
});

describe('the WEAR cards', () => {
  const v2: Garment[] = ['leggings', 'leggingsLow', 'bikini', 'swimsuit', ...RECOVERED_SHIRTS];
  it('offer what OUTFIT steps through, without "none"', () => {
    const offered = offeredOutfits(v2);
    const stepped = new Set<number>();
    for (let i = 0, at = 0; i < OUTFITS.length * 2; i++) { at = nextOutfit(at, v2); stepped.add(at); }
    expect(new Set(offered)).toEqual(new Set([...stepped].filter((i) => OUTFITS[i].name !== 'none')));
    // the modelled shirts that need their own big files are not offered where painted clothes are
    expect(offered.map((i) => OUTFITS[i].name)).not.toContain('spandex + high leggings');
    expect(offered.map((i) => OUTFITS[i].name)).toContain('painted tee + leggings');
  });
  it('find each picture at a stable, URL-safe path', () => {
    expect(outfitThumbPath('painted tee + leggings')).toBe('sarahlab/outfits/painted-tee-leggings.jpg');
    expect(outfitThumbPath('painted U-neck tee + leggings')).toBe('sarahlab/outfits/painted-u-neck-tee-leggings.jpg');
  });
});

describe('Sarah\'s own outfit (Joshua, 2026-10-23, from his reference picture)', () => {
  it('is what she opens in: a red tee over charcoal leggings, painted, nothing to download', () => {
    const o = OUTFITS[PAINTED_DEFAULT_OUTFIT];
    expect(o.garments).toEqual([]);
    expect(o.paint).toEqual([
      { template: 'leggingsFull', fabric: { family: 'athletic', colour: 0, tint: SARAH_LEGGINGS } },
      { template: 'teeShort', fabric: { family: 'jersey', colour: 0, tint: SARAH_RED } },
    ]);
    for (const layer of o.paint!) expect(COVERAGE_TEMPLATES.some((t) => t.id === layer.template)).toBe(true);
    const v2: Garment[] = ['leggings', 'leggingsLow', 'bikini', 'swimsuit', ...RECOVERED_SHIRTS];
    expect(recoveredPartsFor(wornGarments(PAINTED_DEFAULT_OUTFIT, v2))).toEqual([]);
    expect(offeredOutfits(v2)).toContain(PAINTED_DEFAULT_OUTFIT);
  });
});
