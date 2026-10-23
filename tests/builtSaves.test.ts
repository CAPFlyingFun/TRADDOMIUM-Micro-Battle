/**
 * BUILT PIECES IN A SAVE (Joshua, 2026-10-23: the builder's straps "save and reload", as "editable JSON (pieces,
 * points, attachments, fabric, settings), with the mesh generated from the data"). A character's or an outfit's clothes
 * carry the straps built for them; reading a book back gives the same straps; and a character whose straps differ from
 * the library outfit she wears keeps an outfit of her own rather than a reference that would lose them.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOOK, clothesFor, exportBook, importBook, resolveClothes, sameClothes, saveInto, saveOutfit, type SavedBody, type SavedClothes,
} from '../src/sarahlab/characterSaves';
import { addPoint, newPiece, newPoint, setPiece, type BuiltPieces } from '../src/sarahlab/strapData';
import { NO_RULES } from '../src/actor/bodyRandom';

const body: SavedBody = { model: 'v2-body', bump: 100, shape: '', refine: false, random: NO_RULES };
function strap(): BuiltPieces {
  let p = setPiece(newPiece('strip', 'strap-a', 'Left strap'), { width: 1.4, fabric: { family: 'athletic', colour: 8 } });
  p = addPoint(p, newPoint({ tri: 1200, bary: [0.2, 0.3, 0.5] }));
  p = addPoint(p, newPoint({ tri: 1350, bary: [1, 0, 0] }, 2, true));
  return { version: 1, base: 'v2-body', pieces: [p] };
}
const plain: SavedClothes = { outfit: 'relaxed + high leggings', shirtLength: 0.4, layers: [], garments: {} };

describe('built pieces in a save', () => {
  it('come back the same from an exported book', () => {
    const clothes: SavedClothes = { ...plain, built: strap() };
    const book = saveInto(EMPTY_BOOK, 'Sarah', 'all', body, clothes, '2026-10-23T12:00:00Z');
    const back = importBook(exportBook(book));
    const saved = back?.characters[0].clothes as SavedClothes;
    expect(saved.built).toEqual(strap());
    expect(sameClothes(saved, clothes)).toBe(true);
  });

  it('are absent when nothing was built, and an older save reads as before', () => {
    const book = saveInto(EMPTY_BOOK, 'Sarah', 'all', body, plain, '2026-10-23T12:00:00Z');
    const saved = importBook(exportBook(book))?.characters[0].clothes as SavedClothes;
    expect(saved.built).toBeUndefined();
    expect(sameClothes(saved, plain)).toBe(true);
  });

  it('drop unreadable pieces from an imported file without throwing', () => {
    const text = JSON.stringify({ version: 1, characters: [{ name: 'Sarah', savedAt: '', clothes: { ...plain, built: { version: 1, base: 'v2-body', pieces: [{ id: 'x', kind: 'strip', points: [{ tri: -4, bary: 'no' }] }, 'junk'] } } }], outfits: [] });
    const saved = importBook(text)?.characters[0].clothes as SavedClothes;
    expect(saved.built?.pieces.length ?? 0).toBeLessThanOrEqual(1);
    expect(saved.built?.pieces[0]?.points.length ?? 0).toBe(0);
  });

  it('make a character\'s changed straps her own outfit, not a reference that would lose them', () => {
    const library = saveOutfit(EMPTY_BOOK, 'Bikini', { ...plain, built: strap() }, '2026-10-23T12:00:00Z');
    // the same straps: a reference to the library outfit is enough
    expect('basedOn' in clothesFor(library, { ...plain, built: strap() }, 'Bikini')).toBe(true);
    // a moved strap: her own outfit, straps and all
    const moved = strap();
    const changed: SavedClothes = { ...plain, built: { ...moved, pieces: [setPiece(moved.pieces[0], { width: 2.5 })] } };
    const own = clothesFor(library, changed, 'Bikini');
    expect('basedOn' in own).toBe(false);
    expect((own as SavedClothes).built?.pieces[0].width).toBe(2.5);
    // and a reference resolves with the library outfit's straps
    expect(resolveClothes(library, { basedOn: 'Bikini', overrides: { layers: [], garments: {}, shirtLength: null } })?.built).toEqual(strap());
  });
});
