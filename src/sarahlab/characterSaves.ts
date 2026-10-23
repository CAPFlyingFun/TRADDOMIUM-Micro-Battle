/**
 * CHARACTER SAVES (Joshua, 2026-10-22: "I can adjust how Sarah looks, do any minor adjustments, maybe change her outfit
 * color/style, etc and it gives me the option to save all, just the body, or just clothing... it will save all the
 * value and that will be like the starting").
 *
 * A save is a NAME (Sarah, Lena, ...) holding a body, an outfit, or both:
 *   - the BODY: which model, her bump (the STARTING size; the story clock that grows and later eases it is the game's,
 *     later), every body-shape control, the belly refinement, and RANDOMIZE's ranges and locks (`actor/bodyRandom.ts`);
 *   - the CLOTHES: the outfit she wears, each paint layer (its template and dial settings, or the hand-painted mask
 *     when there is no template), its fabric, colour, stitch and detail-through-paint, each modelled garment's fabric,
 *     the shirt length, the outfit's BREAST and NAVEL DETAIL (each AUTO or a manual value: `DetailOverride`), and the
 *     pieces made in the clothing builder (`built`: straps and cords as data, `strapData.ts`).
 * Saving one part under a name keeps the other part that name already holds, so a body and an outfit can be built and
 * saved separately and still make one character. Loading puts on only what the save holds.
 *
 * OUTFITS are a library of their own (Joshua, 2026-10-22: "Sarah's personal red maternity outfit, Lena's utility outfit,
 * a generic academy uniform... reusable by any compatible female character without duplicating their underlying
 * geometry or texture files. A personal outfit can reference a shared preset and store character-specific overrides
 * such as colors, fabrics, or garment choices. Editing that character's copy should not unexpectedly change the shared
 * original"). An outfit is paint and fabric choices on the shared base model -- no geometry or image of its own -- so
 * any character on that model can wear it. A character's clothes are either a whole outfit of her own, or a REFERENCE
 * to a library outfit with only what she changed (`OutfitRef`): her colours, fabrics, detail, garment choices, shirt
 * length. Saving her copy writes only her overrides; the library outfit is never touched by it.
 *
 * The whole book is one versioned document (`persistence/store.ts`); the room keeps it on the device and can export
 * it as a file and import one, which is how a character moves to another device and, later, into the game.
 *
 * Pure: no DOM, no storage. Reading is defensive -- an imported file is untrusted -- and never throws.
 */
import type { FabricChoice } from './fabricLibrary';
import type { LayerDetail } from './detailMaterials';
import type { CoverageParams } from './paintTemplates';
import type { RandomRule, RandomRules } from '../actor/bodyRandom';
import { builtToJson, sanitizeBuilt, type BuiltPieces } from './strapData';

export type SaveScope = 'all' | 'body' | 'clothes';

export interface SavedBody {
  /** `SARAH_LAB_MODELS` id. */
  readonly model: string;
  /** Her starting bump, percent. */
  readonly bump: number;
  /** `serializeShape` text. */
  readonly shape: string;
  readonly refine: boolean;
  /** RANDOMIZE's ranges and locks (`RandomRules`), as kept; each is clamped to its slider when used. */
  readonly random: RandomRules;
}

export interface SavedLayer {
  readonly choice: FabricChoice;
  readonly detail: LayerDetail;
  /** The template and its dial settings; null when the layer was painted by hand (then `mask` holds it). */
  readonly template: { readonly id: string; readonly params: CoverageParams } | null;
  /** Base64 of one byte a vertex, only for a hand-painted layer ('' otherwise). */
  readonly mask: string;
}

/**
 * BREAST and NAVEL DETAIL through the clothes (Joshua, 2026-10-22: "one shared underlying setting... Each should have its
 * own AUTO/MANUAL state"): null is AUTO (each piece's own fabric and construction decides, `detailMaterials.ts`), a number
 * is MANUAL, 0 to 1, for every piece over that detail. One per outfit, saved with the clothes, never with the body.
 */
export interface DetailOverride { readonly nipple: number | null; readonly navel: number | null }
export const AUTO_DETAIL: DetailOverride = Object.freeze({ nipple: null, navel: null });

export interface SavedClothes {
  /** `OUTFITS` name. */
  readonly outfit: string;
  readonly shirtLength: number;
  /** Absent in saves made before it existed: AUTO. */
  readonly detail?: DetailOverride;
  /** One per paint layer, bottom first; null for an empty layer. */
  readonly layers: readonly (SavedLayer | null)[];
  /** A modelled garment's fabric choice, by garment name. */
  readonly garments: Readonly<Record<string, FabricChoice>>;
  /**
   * Pieces made in the clothing builder (`strapBuilder.ts`): straps and cords pinned to her skin by triangle and
   * barycentric weights, as editable data; their meshes are made from it. Absent in saves made before it existed, and
   * when nothing is built.
   */
  readonly built?: BuiltPieces;
}

/** What a character changed on a library outfit: per paint layer her fabric choice and detail, her garments, her length. */
export interface ClothesOverrides {
  readonly layers: readonly ({ readonly choice: FabricChoice; readonly detail: LayerDetail } | null)[];
  readonly garments: Readonly<Record<string, FabricChoice>>;
  readonly shirtLength: number | null;
  /** Her breast and navel detail when it differs from the outfit's; absent or null keeps the outfit's. */
  readonly detail?: DetailOverride | null;
}

/** A character's clothes as a library outfit plus her own changes. */
export interface OutfitRef {
  readonly basedOn: string;
  readonly overrides: ClothesOverrides;
}

export interface CharacterSave {
  readonly name: string;
  /** ISO time of the last save into it. */
  readonly savedAt: string;
  readonly body: SavedBody | null;
  readonly clothes: SavedClothes | OutfitRef | null;
}

/** A library outfit. */
export interface OutfitSave {
  readonly name: string;
  readonly savedAt: string;
  readonly clothes: SavedClothes;
}

export interface CharacterBook {
  readonly version: 1;
  readonly characters: readonly CharacterSave[];
  readonly outfits: readonly OutfitSave[];
}

export const CHARACTER_BOOK_VERSION = 1;
export const CHARACTER_BOOK_KEY = 'traddomium.sarahlab.characters';
export const EMPTY_BOOK: CharacterBook = Object.freeze({ version: 1, characters: Object.freeze([]) as readonly CharacterSave[], outfits: Object.freeze([]) as readonly OutfitSave[] });

/** Names match whatever their case and spacing. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A name as it is kept: trimmed, at most 40 characters, never empty. */
export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  return n || 'Unnamed';
}

/**
 * Save into `book` under `name`: `all` replaces both parts, `body` or `clothes` only that one (the other part the
 * name already holds is kept). The save moves to the top of the list.
 */
export function saveInto(book: CharacterBook, name: string, scope: SaveScope, body: SavedBody, clothes: SavedClothes | OutfitRef, now: string): CharacterBook {
  const clean = cleanName(name);
  const had = book.characters.find((c) => same(c.name, clean));
  const next: CharacterSave = {
    name: had?.name ?? clean,
    savedAt: now,
    body: scope === 'clothes' ? had?.body ?? null : body,
    clothes: scope === 'body' ? had?.clothes ?? null : clothes,
  };
  return { ...book, characters: [next, ...book.characters.filter((c) => !same(c.name, clean))] };
}

export function removeFrom(book: CharacterBook, name: string): CharacterBook {
  return { ...book, characters: book.characters.filter((c) => !same(c.name, name)) };
}

/** Save an outfit into the library under `name` (replacing one of that name). */
export function saveOutfit(book: CharacterBook, name: string, clothes: SavedClothes, now: string): CharacterBook {
  const clean = cleanName(name);
  return { ...book, outfits: [{ name: clean, savedAt: now, clothes }, ...book.outfits.filter((o) => !same(o.name, clean))] };
}
export function removeOutfit(book: CharacterBook, name: string): CharacterBook {
  return { ...book, outfits: book.outfits.filter((o) => !same(o.name, name)) };
}
export function findOutfit(book: CharacterBook, name: string): OutfitSave | undefined {
  return book.outfits.find((o) => same(o.name, name));
}

const json = (v: unknown) => JSON.stringify(v ?? null);
/** A layer's template without its shirt length: the length is the character's own (`shirtLength`), not the outfit's make. */
const make = (t: SavedLayer['template']) => json(t ? { id: t.id, params: { ...t.params, length: null } } : null);
/** Two outfits built the same way: same outfit, same templates and dials, same hand-painted masks, layer for layer. */
function sameMake(a: SavedClothes, b: SavedClothes): boolean {
  if (a.outfit !== b.outfit) return false;
  // built pieces are part of how an outfit is made: a character's own straps make it her own outfit
  if (json(a.built ? builtToJson(a.built) : null) !== json(b.built ? builtToJson(b.built) : null)) return false;
  const n = Math.max(a.layers.length, b.layers.length);
  for (let i = 0; i < n; i++) {
    const x = a.layers[i] ?? null, y = b.layers[i] ?? null;
    if (!x !== !y) return false;
    if (x && y && (make(x.template) !== make(y.template) || x.mask !== y.mask)) return false;
  }
  return true;
}

/**
 * A character's clothes as she wears them now, kept as a REFERENCE to the library outfit she put on (`wornFrom`) with
 * only her changes, when they are that outfit with different colours, fabrics, detail, garments or length; otherwise
 * (no library outfit, or she changed its make -- a template, a dial, a painted mask) as a whole outfit of her own.
 */
export function clothesFor(book: CharacterBook, current: SavedClothes, wornFrom: string | null): SavedClothes | OutfitRef {
  const base = wornFrom ? findOutfit(book, wornFrom) : undefined;
  if (!base || !sameMake(base.clothes, current)) return current;
  const layers = current.layers.map((l, i) => {
    const b = base.clothes.layers[i];
    return l && b && (json(l.choice) !== json(b.choice) || json(l.detail) !== json(b.detail)) ? { choice: l.choice, detail: l.detail } : null;
  });
  const garments: Record<string, FabricChoice> = {};
  for (const [k, g] of Object.entries(current.garments)) if (json(g) !== json(base.clothes.garments[k])) garments[k] = g;
  const detail = json(current.detail ?? AUTO_DETAIL) !== json(base.clothes.detail ?? AUTO_DETAIL) ? { detail: current.detail ?? AUTO_DETAIL } : {};
  return { basedOn: base.name, overrides: { layers, garments, shirtLength: current.shirtLength !== base.clothes.shirtLength ? current.shirtLength : null, ...detail } };
}

/** Two sets of clothes that put on the same: every layer, fabric, garment, length and detail (for "changed?"). */
export function sameClothes(a: SavedClothes, b: SavedClothes): boolean {
  const norm = (c: SavedClothes) => json({ ...c, detail: c.detail ?? AUTO_DETAIL, layers: c.layers.map((l) => l ?? null) });
  return norm(a) === norm(b);
}

/** What a character wears: her own outfit, or the library outfit her reference names with her changes on top (a copy). */
export function resolveClothes(book: CharacterBook, clothes: SavedClothes | OutfitRef | null): SavedClothes | null {
  if (!clothes) return null;
  if (!('basedOn' in clothes)) return clothes;
  const base = findOutfit(book, clothes.basedOn);
  if (!base) return null;
  const o = clothes.overrides, length = o.shirtLength ?? base.clothes.shirtLength;
  return {
    ...base.clothes,
    shirtLength: length,
    layers: base.clothes.layers.map((l, i) => {
      if (!l) return l;
      const own = o.layers[i] ? { choice: o.layers[i]!.choice, detail: o.layers[i]!.detail } : {};
      // a shirt takes her length
      const template = l.template && l.template.params.length !== null && l.template.params.length !== undefined ? { ...l.template, params: { ...l.template.params, length } } : l.template;
      return { ...l, ...own, template };
    }),
    garments: { ...base.clothes.garments, ...o.garments },
    detail: o.detail ?? base.clothes.detail ?? AUTO_DETAIL,
  };
}

/** What a save holds, as the list says it. */
export function holds(save: CharacterSave): string {
  const clothes = save.clothes ? ('basedOn' in save.clothes ? `"${save.clothes.basedOn}" + her changes` : 'own outfit') : '';
  return save.body && clothes ? `body + ${clothes}` : save.body ? 'body' : clothes || 'empty';
}

/** Merge an imported book in: an imported name replaces the same name here (characters and outfits alike). */
export function mergeBooks(into: CharacterBook, imported: CharacterBook): CharacterBook {
  const keep = <T extends { name: string }>(mine: readonly T[], theirs: readonly T[]) => [...theirs, ...mine.filter((c) => !theirs.some((t) => same(t.name, c.name)))];
  return { version: 1, characters: keep(into.characters, imported.characters), outfits: keep(into.outfits, imported.outfits) };
}

// ------------------------------------------------------------------ reading untrusted data

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readPick(v: unknown): FabricChoice['fabric'] {
  if (!isRecord(v) || typeof v.family !== 'string') return null;
  return { family: v.family as NonNullable<FabricChoice['fabric']>['family'], colour: Math.round(num(v.colour, 0, 255, 0)) };
}
function readChoice(v: unknown): FabricChoice | null {
  if (!isRecord(v)) return null;
  return {
    fabric: readPick(v.fabric),
    match: v.match !== false,
    trim: readPick(v.trim),
    stitch: num(v.stitch, 0.1, 10, 1),
    opacity: v.opacity === null || v.opacity === undefined ? null : num(v.opacity, 0, 1, 1),
  };
}
function readDetail(v: unknown): DetailOverride {
  if (!isRecord(v)) return AUTO_DETAIL;
  const one = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);
  return { nipple: one(v.nipple), navel: one(v.navel) };
}
function readLayer(v: unknown): SavedLayer | null {
  if (!isRecord(v)) return null;
  const choice = readChoice(v.choice);
  if (!choice) return null;
  const t = v.template;
  const template = isRecord(t) && typeof t.id === 'string' && isRecord(t.params) ? { id: t.id, params: t.params as unknown as CoverageParams } : null;
  const mask = template ? '' : str(v.mask, 4_000_000);
  if (!template && !mask) return null;
  return { choice, detail: (isRecord(v.detail) ? v.detail : {}) as unknown as LayerDetail, template, mask };
}
/** Ranges and locks as kept: any control key, finite numbers (each is clamped to its slider when used). */
function readRandom(v: unknown): RandomRules {
  const rules: Record<string, RandomRule> = {};
  if (!isRecord(v)) return { rules, groups: [] };
  if (isRecord(v.rules)) for (const [k, r] of Object.entries(v.rules).slice(0, 200)) {
    if (!isRecord(r) || typeof r.min !== 'number' || typeof r.max !== 'number' || !Number.isFinite(r.min) || !Number.isFinite(r.max)) continue;
    rules[k.slice(0, 40)] = { min: r.min, max: r.max, locked: r.locked === true };
  }
  const groups = Array.isArray(v.groups) ? v.groups.filter((g): g is string => typeof g === 'string').slice(0, 40).map((g) => g.slice(0, 40)) : [];
  return { rules, groups };
}
function readBody(v: unknown): SavedBody | null {
  if (!isRecord(v) || typeof v.model !== 'string') return null;
  return { model: str(v.model, 40), bump: num(v.bump, 0, 1000, 0), shape: str(v.shape, 20_000), refine: v.refine === true, random: readRandom(v.random) };
}
function readRef(v: unknown): OutfitRef | null {
  if (!isRecord(v) || typeof v.basedOn !== 'string' || !isRecord(v.overrides)) return null;
  const o = v.overrides, garments: Record<string, FabricChoice> = {};
  if (isRecord(o.garments)) for (const [k, g] of Object.entries(o.garments)) { const c = readChoice(g); if (c) garments[k.slice(0, 60)] = c; }
  const layers = Array.isArray(o.layers) ? o.layers.slice(0, 8).map((l) => {
    if (!isRecord(l)) return null;
    const choice = readChoice(l.choice);
    return choice ? { choice, detail: (isRecord(l.detail) ? l.detail : {}) as unknown as LayerDetail } : null;
  }) : [];
  return { basedOn: str(v.basedOn, 80), overrides: { layers, garments, shirtLength: typeof o.shirtLength === 'number' ? num(o.shirtLength, 0, 1, 0) : null, ...(isRecord(o.detail) ? { detail: readDetail(o.detail) } : {}) } };
}
function readClothes(v: unknown): SavedClothes | null {
  if (!isRecord(v) || typeof v.outfit !== 'string') return null;
  const garments: Record<string, FabricChoice> = {};
  if (isRecord(v.garments)) for (const [k, g] of Object.entries(v.garments)) { const c = readChoice(g); if (c) garments[k.slice(0, 60)] = c; }
  return {
    outfit: str(v.outfit, 80),
    shirtLength: num(v.shirtLength, 0, 1, 0),
    layers: Array.isArray(v.layers) ? v.layers.slice(0, 8).map(readLayer) : [],
    garments,
    ...(isRecord(v.detail) ? { detail: readDetail(v.detail) } : {}),
    ...built(v.built),
  };
}
/** Built pieces from untrusted data: only a readable set with something in it. */
function built(v: unknown): { built?: BuiltPieces } {
  const b = v === undefined ? null : sanitizeBuilt(v);
  return b && b.pieces.length ? { built: b } : {};
}

/** A book from untrusted parsed JSON: known fields only, numbers clamped, unreadable characters dropped. */
export function sanitizeBook(raw: unknown): CharacterBook {
  if (!isRecord(raw)) return EMPTY_BOOK;
  const characters: CharacterSave[] = [], outfits: OutfitSave[] = [];
  for (const c of Array.isArray(raw.characters) ? raw.characters.slice(0, 200) : []) {
    if (!isRecord(c) || typeof c.name !== 'string') continue;
    const body = readBody(c.body), clothes = readRef(c.clothes) ?? readClothes(c.clothes);
    if (!body && !clothes) continue;
    if (characters.some((k) => same(k.name, c.name as string))) continue;
    characters.push({ name: cleanName(c.name), savedAt: str(c.savedAt, 40), body, clothes });
  }
  for (const o of Array.isArray(raw.outfits) ? raw.outfits.slice(0, 200) : []) {
    if (!isRecord(o) || typeof o.name !== 'string') continue;
    const clothes = readClothes(o.clothes);
    if (!clothes || outfits.some((k) => same(k.name, o.name as string))) continue;
    outfits.push({ name: cleanName(o.name), savedAt: str(o.savedAt, 40), clothes });
  }
  return { version: 1, characters, outfits };
}

/** The book as a file. */
export function exportBook(book: CharacterBook): string {
  return JSON.stringify({ version: CHARACTER_BOOK_VERSION, characters: book.characters, outfits: book.outfits }, null, 1);
}
/** A file read back; null if it is not a character book. */
export function importBook(text: string): CharacterBook | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || raw.version !== CHARACTER_BOOK_VERSION) return null;
    const book = sanitizeBook(raw);
    return book.characters.length || book.outfits.length ? book : null;
  } catch {
    return null;
  }
}
