/**
 * SARAH AS JOSHUA SET HER (2026-10-24: "Here is Sarah and the minor tweaks I did"), saved from the Sarah Lab's
 * LIBRARY on his phone and handed over as the room's own export (`traddomium-characters.json`).
 *
 * She is the approved v2 body at 73%, her navel a little further out than the automatic one (NAVEL +20), in her red
 * light spandex tee, which he re-dyed in the athletic family's swatch 8, over the painted charcoal leggings. Through
 * the leggings, her breast and navel detail is held at 0.45 and 0.8.
 *
 * The room opens on her (`SarahLabScene.ts`), and this is the Sarah the TRADDOMIUM and TMB-Story test scenes start
 * from. It goes through the saves' own `sanitizeBook`, the same door a file from the LIBRARY's IMPORT comes in by, so
 * it is read exactly as his phone would read it back. His card's thumbnail is left out: the room draws its own.
 */
import { sanitizeBook, type CharacterSave, type SavedBody, type SavedClothes } from './characterSaves';

const EXPORTED = {
  version: 1,
  characters: [{
    name: 'Sarah',
    savedAt: '2026-10-25T03:09:40.766Z',
    body: { model: 'v2-body', bump: 73, shape: '{"version":1,"shape":{"navel":20}}', refine: false, random: { rules: {}, groups: [] } },
    clothes: {
      outfit: 'Sarah · red spandex tee + charcoal leggings',
      shirtLength: 0,
      layers: [
        {
          choice: { fabric: { family: 'athletic', colour: 0, tint: '#3a3b52' }, match: true, trim: null, stitch: 0.5, opacity: 1 },
          detail: { mode: 'auto', material: null, override: { nipple: 0.45, navel: 0.8 } },
          template: {
            id: 'leggingsFull',
            params: {
              riseFront: 0.48, riseSide: 0.3999999999999998, riseBack: 0.4, riseFrontWidth: 1, legStart: 0, legEnd: 1, feet: false,
              hemFront: null, hemBack: null, neckFront: null, neckBack: null, sleeve: -1, topFront: null, topBack: null, topSide: null,
              strap: 0, strapIn: 0, armhole: null, neckStyle: 'crew', legCut: null, length: null,
            },
          },
          mask: '',
        },
        null,
        null,
      ],
      garments: { shirtSpandexLite: { fabric: { family: 'athletic', colour: 8 }, match: true, trim: null, stitch: 0.5, opacity: 1 } },
      detail: { nipple: null, navel: null },
    },
  }],
  outfits: [],
};

type Look = CharacterSave & { readonly body: SavedBody; readonly clothes: SavedClothes };
const saved: CharacterSave | undefined = sanitizeBook(EXPORTED).characters[0];
const readable = (s: CharacterSave | undefined): s is Look => !!s?.body && !!s.clothes && 'layers' in s.clothes;

/**
 * Sarah as he saved her; null only if the saves' format ever stops reading her (tests/sarahLook.test.ts fails first),
 * and the room then opens on its own defaults rather than not at all.
 */
export const SARAH_LOOK: Look | null = readable(saved) ? saved : null;
