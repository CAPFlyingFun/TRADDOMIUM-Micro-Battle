/**
 * HER 0% SHAPE, REFINED, AND HER NAVEL AS ITS OWN PIECE (Joshua, 2026-10-29).
 *
 * The 0% shape was measured against a Meshy non-pregnant reference body
 * (`assets-archive/models/female-base-nonpregnant-meshy/`) and approved from renders: her lower belly smooth into her
 * pubic area and blending low into it, her belly fullest low as the reference's is, her sides smooth from under her
 * breasts to her hips, the creases at her groin soft, her thighs and the crease under her breasts untouched. "Blend
 * this new 0% and fade it into about 80%... past 80% will be good."
 *
 * Her navel: "I want the bellybutton independent of the belly size... make the bellybutton outie look the same from
 * belly 0-200%, then work on the innie from 0-200%, but still allow the default sync." Her belly shapes squeeze the
 * skin round her navel to half its width as she shrinks, so a navel carried by them crumples; `navelPiece.ts` lays it
 * fresh on her skin at every size instead, from two fixed shapes -- her clean 100% outie and the reference's bowl
 * ("same size and shape as the reference model... smoother and like a bowl").
 *
 * Her approved body file is not changed: `models/sarah-v2-body-zero.bin` (baked from the approved renders by
 * `scripts/sarahV2ZeroRefine/`) carries both, put on her as she loads.
 */
import * as THREE from 'three';
import type { ShapeFields } from '../view/bodyShapeView';
import { NavelPiece, type NavelData } from './navelPiece';

export const ZERO_REFINE_PATH = 'models/sarah-v2-body-zero.bin';
export const ZERO_FIELD = 'shape:zeroRefine';
/**
 * Her upper belly smoothed, navel up, one CPU field per belly key below 75% (Joshua, 2026-10-29: "between 0-60% smooth
 * more of the top half of the belly from the bellybutton upwards, but leave the bottom half alone"; of the renders, "just
 * the smooth looks best"): `shape:upper:<key>`, weighted by that key's own belly weight, so it fades with the keys and is
 * gone by 75%. Each key's field also carries (Joshua, same day) the whole belly smoothed inside his approved mask below
 * 60% -- the V crease and ripples her 25-50% shapes carried, "strong" -- and the bump rounded out from 20 to 60%, most
 * at 40% ("the 40% looks too pointed... more round looks best").
 */
export const UPPER_FIELD_PREFIX = 'shape:upper:';
/** Her body's vertex count in the file the corrections were baked for (sarah-v2-body-slim.glb and its -ktx2 twin). */
export const ZERO_REFINE_VERTICES = 115710;
/** By this belly size (percent) the refined 0% shape has faded out entirely (Joshua: "fade it into about 80%"). */
export const ZERO_FADE_TO = 80;

const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

/** On the HYBRID belly curve the refined 0% shape fades out over the whole slider, in one blend (percent). */
export const ZERO_FADE_TO_HYBRID = 200;

/**
 * The refined 0% shape's weight at a belly size: 1 at 0%, eased to 0. On HYBRID, her default curve, in one blend from
 * 0% to 200% (Joshua, 2026-10-29: "blending since we are using the hybrid from the new 0% to 200% directly and not use
 * the 100% like a middle point, but keep it as an option for the other custom shapes"); on every other curve, gone by
 * ZERO_FADE_TO.
 */
export function zeroRefineWeight(bumpPercent: number, curve: string = 'hybrid'): number {
  const b = Number.isFinite(bumpPercent) ? bumpPercent : 100;
  return 1 - smooth(b / (curve === 'hybrid' ? ZERO_FADE_TO_HYBRID : ZERO_FADE_TO));
}

interface Part { readonly index: Uint32Array; readonly pos: Float32Array; readonly nrm: Float32Array }

/**
 * Her sides smoothed and the underside of her belly smoothed into her pubic area, at normal baby weight (Joshua,
 * 2026-10-29: "try smoothing more and around the sides... between the belly/back/armpit/hips"; of the labelled renders,
 * "Gentle strength under the belly, max everywhere else"): one field per belly size, `shape:sides:<percent>`, weighted
 * by a tent over the sizes it was baked at (`anchorWeights`), on HYBRID only -- the shapes it was measured on. At 0% it
 * is nothing: her approved 0% body is left as it is.
 */
export const SIDES_FIELD_PREFIX = 'shape:sides:';
/**
 * Her cleavage's rough skin smoothed (Joshua, 2026-10-29, circling the skin between her breasts: "Yes, circled the area
 * between the two breasts"): where her surface folds sharply between and round the tops of her breasts, smoothed; the
 * valley between them, her nipples and the crease under her breasts kept. One field per belly size from 0% to 200%,
 * `shape:chest:<percent>`, a tent over them, on HYBRID only.
 */
export const CHEST_FIELD_PREFIX = 'shape:chest:';
/**
 * The crease between her pubic area and her thighs smoothed (Joshua, 2026-10-29, circled on his phone from 0% to 100%:
 * "looks like a tear between the belly/pubic area and legs/hips... need to smooth that area"; of the renders, "Yes, do
 * C" -- the strongest). Her model folds sharply along it; where it does, the skin and eight rings round it are smoothed,
 * the crease itself kept as a fold, her vulva held. One field per belly size from 0% to 200%, `shape:groin:<percent>`.
 */
export const GROIN_FIELD_PREFIX = 'shape:groin:';

/** What an anchored field carries (the file's own numbers). */
export const ANCHOR_KIND = { sides: 0, light: 1, heavyHalf: 2, heavy: 3, chest: 4, milkLeft: 5, milkRight: 6, milkBoth: 7, groin: 8 } as const;
export interface AnchoredPart extends Part { readonly kind: number; readonly slider: number }

/**
 * Tent weights over anchor sizes (percent, ascending): 1 at an anchor, falling to 0 at its neighbours; below the first
 * anchor the field fades to nothing at 0% (`fromZero`), above the last it holds. Keyed by the anchor size.
 */
export function anchorWeights(bumpPercent: number, anchors: readonly number[], fromZero = true): Map<number, number> {
  const out = new Map<number, number>();
  if (!anchors.length) return out;
  const b = Number.isFinite(bumpPercent) ? bumpPercent : 100;
  const first = anchors[0], last = anchors[anchors.length - 1];
  if (b <= first) { const w = fromZero ? Math.max(0, Math.min(1, b / first)) : 1; if (w > 0) out.set(first, w); return out; }
  if (b >= last) { out.set(last, 1); return out; }
  for (let i = 0; i + 1 < anchors.length; i += 1) {
    const a = anchors[i], c = anchors[i + 1];
    if (b >= a && b <= c) {
      const t = (b - a) / (c - a);
      if (1 - t > 0) out.set(a, 1 - t);
      if (t > 0) out.set(c, t);
      break;
    }
  }
  return out;
}

/**
 * Read anchored parts: u32 count, then per part u8 kind + 3 pad, f32 slider (percent), f32 position scale, f32 normal
 * scale, u32 m; a bit mask over her vertices (LSB first) of the m it moves, ascending; i16 moves [3m] and i8 normal
 * changes [3m], each times its scale; padded to 4 bytes.
 */
export function readAnchoredParts(buffer: ArrayBuffer, at: number, vertices: number): { parts: AnchoredPart[]; at: number } {
  const view = new DataView(buffer);
  const count = view.getUint32(at, true); at += 4;
  const parts: AnchoredPart[] = [];
  const maskBytes = (vertices + 7) >> 3;
  for (let p = 0; p < count; p += 1) {
    const kind = view.getUint8(at); at += 4;
    const slider = view.getFloat32(at, true), posScale = view.getFloat32(at + 4, true), nrmScale = view.getFloat32(at + 8, true), m = view.getUint32(at + 12, true);
    at += 16;
    const mask = new Uint8Array(buffer, at, maskBytes); at += maskBytes;
    const index = new Uint32Array(m);
    let k = 0;
    for (let byte = 0; byte < maskBytes && k < m; byte += 1) {
      const bits = mask[byte];
      if (!bits) continue;
      for (let bit = 0; bit < 8; bit += 1) if (bits & (1 << bit)) index[k++] = (byte << 3) + bit;
    }
    if (k !== m) throw new Error('zero refine: an anchored field\'s mask and count disagree');
    const pos = new Float32Array(m * 3), nrm = new Float32Array(m * 3);
    for (let i = 0; i < m * 3; i += 1) pos[i] = view.getInt16(at + i * 2, true) * posScale;
    at += m * 6;
    for (let i = 0; i < m * 3; i += 1) nrm[i] = view.getInt8(at + i) * nrmScale;
    at += m * 3; at += (4 - ((m * 9) % 4)) % 4;
    parts.push({ kind, slider, index, pos, nrm });
  }
  return { parts, at };
}

export interface ZeroRefine {
  readonly vertices: number;
  readonly body: Part;
  readonly navel: NavelData;
  /** The upper-belly fields, by belly key ('belly', 'belly25'...). */
  readonly upper: ReadonlyMap<string, Part>;
  /** Her sides and underside smoothed, by belly size (SZR5; empty in an SZR4 file). */
  readonly sides: readonly AnchoredPart[];
  /** Her cleavage's rough skin smoothed, by belly size from 0% (SZR5; empty when the file has none). */
  readonly chest: readonly AnchoredPart[];
  /** The crease between her pubic area and her thighs smoothed, by belly size from 0% (SZR5; empty when the file has none). */
  readonly groin: readonly AnchoredPart[];
  /** The file's own navelFlat as it was baked against: how many vertices it moves, and its largest move. */
  readonly flatMoved: number;
  readonly flatMax: number;
}

/** Read the baked file ('SZR4', or 'SZR5' with her sides smoothed after it). Throws on anything else. */
export function parseZeroRefine(buffer: ArrayBuffer): ZeroRefine {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'SZR4' && magic !== 'SZR5') throw new Error(`zero refine: not a correction file (${magic})`);
  let at = 4;
  const u32 = () => { const v = view.getUint32(at, true); at += 4; return v; };
  const f32 = () => { const v = view.getFloat32(at, true); at += 4; return v; };
  const take = <T>(make: (b: ArrayBuffer) => T, bytes: number): T => { const out = make(buffer.slice(at, at + bytes)); at += bytes; return out; };
  const vertices = u32(), flatMoved = u32(), flatMax = f32();
  const nb = u32();
  const body: Part = { index: take((b) => new Uint32Array(b), nb * 4), pos: take((b) => new Float32Array(b), nb * 12), nrm: take((b) => new Float32Array(b), nb * 12) };
  const count = u32();
  const flags = take((b) => new Uint8Array(b), count); at += (4 - (count % 4)) % 4;
  const splitStart = take((b) => new Uint32Array(b), (count + 1) * 4);
  const splits = take((b) => new Uint32Array(b), u32() * 4);
  const neighbourStart = take((b) => new Uint32Array(b), (count + 1) * 4);
  const neighbours = take((b) => new Uint32Array(b), u32() * 4);
  const triangles = take((b) => new Uint32Array(b), u32() * 4);
  const seed = u32(), grid = u32(), gridRadius = f32();
  const outie = take((b) => new Float32Array(b), grid * grid * 4);
  const bowl = take((b) => new Float32Array(b), grid * grid * 4);
  const upper = new Map<string, Part>();
  for (let k = u32(); k > 0; k -= 1) {
    const len = u32(), name = new TextDecoder().decode(new Uint8Array(buffer, at, len)); at += len + ((4 - (len % 4)) % 4);
    const m = u32();
    upper.set(name, { index: take((b) => new Uint32Array(b), m * 4), pos: take((b) => new Float32Array(b), m * 12), nrm: take((b) => new Float32Array(b), m * 12) });
  }
  let sides: AnchoredPart[] = [], chest: AnchoredPart[] = [], groin: AnchoredPart[] = [];
  if (magic === 'SZR5') {
    const read = readAnchoredParts(buffer, at, vertices);
    sides = read.parts.filter((p) => p.kind === ANCHOR_KIND.sides).sort((p, q) => p.slider - q.slider);
    chest = read.parts.filter((p) => p.kind === ANCHOR_KIND.chest).sort((p, q) => p.slider - q.slider);
    groin = read.parts.filter((p) => p.kind === ANCHOR_KIND.groin).sort((p, q) => p.slider - q.slider);
    at = read.at;
  }
  if (at !== buffer.byteLength) throw new Error(`zero refine: ${buffer.byteLength - at} bytes left over`);
  for (const p of [body, ...upper.values(), ...sides, ...chest, ...groin]) for (const i of p.index) if (i >= vertices) throw new Error('zero refine: a vertex past the mesh');
  for (const i of splits) if (i >= vertices) throw new Error('zero refine: a navel vertex past the mesh');
  return { vertices, body, upper, sides, chest, groin, flatMoved, flatMax, navel: { count, flags, splitStart, splits, neighbourStart, neighbours, triangles, seed, grid, gridRadius, outie, bowl } };
}

/**
 * Whether `mesh` is the body the corrections were baked for: the vertex count, and its navelFlat as it was baked
 * against (a file changed since would move different vertices, or by a different amount).
 */
export function fitsZeroRefine(mesh: THREE.Mesh, data: ZeroRefine): boolean {
  const geom = mesh.geometry as THREE.BufferGeometry, dict = mesh.morphTargetDictionary;
  if (geom.getAttribute('position')?.count !== data.vertices || data.vertices !== ZERO_REFINE_VERTICES || !dict) return false;
  const k = dict.navelFlat, flat = k === undefined ? undefined : geom.morphAttributes.position?.[k];
  if (!flat) return false;
  let moved = 0, max = 0;
  for (let i = 0; i < flat.count; i += 1) {
    const x = Math.abs(flat.getX(i)), y = Math.abs(flat.getY(i)), z = Math.abs(flat.getZ(i));
    if (x + y + z > 0) moved += 1;
    max = Math.max(max, x, y, z);
  }
  return moved === data.flatMoved && Math.abs(max - data.flatMax) < 1e-4;
}

/**
 * Put the corrections on her body: the 0% shape field into `fields` (returned as a new set) and her navel as its own
 * piece. Call after `liftShapeFields` and before her first draw. Null, changing nothing, when the mesh is not the body
 * they were baked for.
 */
export function applyZeroRefine(mesh: THREE.Mesh, fields: ShapeFields, data: ZeroRefine): { fields: ShapeFields; navel: NavelPiece } | null {
  if (!fitsZeroRefine(mesh, data)) return null;
  const map = new Map(fields.fields);
  map.set(ZERO_FIELD, { index: data.body.index, pos: data.body.pos, nrm: data.body.nrm });
  for (const [key, p] of data.upper) map.set(UPPER_FIELD_PREFIX + key, { index: p.index, pos: p.pos, nrm: p.nrm });
  for (const p of data.sides) map.set(SIDES_FIELD_PREFIX + p.slider, { index: p.index, pos: p.pos, nrm: p.nrm });
  for (const p of data.chest) map.set(CHEST_FIELD_PREFIX + p.slider, { index: p.index, pos: p.pos, nrm: p.nrm });
  for (const p of data.groin) map.set(GROIN_FIELD_PREFIX + p.slider, { index: p.index, pos: p.pos, nrm: p.nrm });
  return { fields: { ...fields, fields: map, last: '' }, navel: new NavelPiece(data.navel) };
}

/** The sizes her sides smoothing was baked at, from a field set (ascending). */
export function sidesAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  return [...fields.fields.keys()].filter((n) => n.startsWith(SIDES_FIELD_PREFIX)).map((n) => Number(n.slice(SIDES_FIELD_PREFIX.length))).filter(Number.isFinite).sort((a, b) => a - b);
}

/** The sizes her cleavage smoothing was baked at, from a field set (ascending). */
export function chestAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  return [...fields.fields.keys()].filter((n) => n.startsWith(CHEST_FIELD_PREFIX)).map((n) => Number(n.slice(CHEST_FIELD_PREFIX.length))).filter(Number.isFinite).sort((a, b) => a - b);
}

/** Her cleavage smoothing's field weights at a belly size: a tent over the baked sizes (from 0%), on HYBRID only. */
export function chestFieldWeights(bumpPercent: number, anchors: readonly number[], curve: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve !== 'hybrid') return out;
  for (const [s, w] of anchorWeights(bumpPercent, anchors, false)) out[CHEST_FIELD_PREFIX + s] = w;
  return out;
}

/** The sizes the crease at her groin was smoothed at, from a field set (ascending). */
export function groinAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  return [...fields.fields.keys()].filter((n) => n.startsWith(GROIN_FIELD_PREFIX)).map((n) => Number(n.slice(GROIN_FIELD_PREFIX.length))).filter(Number.isFinite).sort((a, b) => a - b);
}

/** The groin crease smoothing's field weights at a belly size: a tent over the baked sizes (from 0%), on HYBRID only. */
export function groinFieldWeights(bumpPercent: number, anchors: readonly number[], curve: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve !== 'hybrid') return out;
  for (const [s, w] of anchorWeights(bumpPercent, anchors, false)) out[GROIN_FIELD_PREFIX + s] = w;
  return out;
}

/** Her sides smoothing's field weights at a belly size: a tent over the baked sizes, on HYBRID only. */
export function sidesFieldWeights(bumpPercent: number, anchors: readonly number[], curve: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve !== 'hybrid') return out;
  for (const [s, w] of anchorWeights(bumpPercent, anchors)) out[SIDES_FIELD_PREFIX + s] = w;
  return out;
}

/** Fetch and read the corrections; null (her body loads as it always has) when they cannot be had. */
export async function loadZeroRefine(url: string): Promise<ZeroRefine | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseZeroRefine(await res.arrayBuffer());
  } catch (error) {
    console.warn('[sarahlab] her refined 0% shape could not be loaded; she keeps the original', error);
    return null;
  }
}

/**
 * HER BABY'S WEIGHT (Joshua, 2026-10-29: "the belly automatically adjusting to the womb/oval shape... could adjust the
 * weight of the baby to allow more or less sag and depth"; of the renders, "Looks good so far!").
 *
 * A womb (an egg seated on her pelvis, fitted inside each approved belly size) moves with the BABY WEIGHT control: heavy
 * tips it forward and down over her pubic bone, deeper and fuller below; light sits it a little higher and tighter, up
 * to her ribs. Her skin follows it most where it is closest, smoothed as approved ("Max" sides, "gentle" under the
 * belly), never inside it, her navel laid fresh on top. Baked per belly size, 25% to 200%, in its own file -- light at
 * full weight, heavy at half and at full (heavy is not a straight line) -- and fetched after her body, in the background:
 * 0 is her approved belly exactly, so nothing waits for it.
 */
export const WOMB_PATH = 'models/sarah-v2-body-womb.bin';
export const BABY_FIELD_PREFIX = 'shape:baby:';
export interface WombFile { readonly vertices: number; readonly parts: readonly AnchoredPart[] }

/** Read the baby-weight file ('SZW1'). Throws on anything else. */
export function parseWombFile(buffer: ArrayBuffer): WombFile {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'SZW1') throw new Error(`womb: not a baby-weight file (${magic})`);
  const vertices = view.getUint32(4, true);
  const { parts, at } = readAnchoredParts(buffer, 8, vertices);
  if (at !== buffer.byteLength) throw new Error(`womb: ${buffer.byteLength - at} bytes left over`);
  for (const p of parts) {
    if (p.kind !== ANCHOR_KIND.light && p.kind !== ANCHOR_KIND.heavyHalf && p.kind !== ANCHOR_KIND.heavy) throw new Error(`womb: a field of kind ${p.kind}`);
    for (const i of p.index) if (i >= vertices) throw new Error('womb: a vertex past the mesh');
  }
  return { vertices, parts };
}

/** Put the baby-weight fields into a field set (returned as a new one); null when the mesh is not the body they were baked for. */
export function applyWomb(mesh: THREE.Mesh, fields: ShapeFields, data: WombFile): ShapeFields | null {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (geom.getAttribute('position')?.count !== data.vertices || data.vertices !== ZERO_REFINE_VERTICES) return null;
  const map = new Map(fields.fields);
  for (const p of data.parts) map.set(`${BABY_FIELD_PREFIX}${p.kind}:${p.slider}`, { index: p.index, pos: p.pos, nrm: p.nrm });
  return { ...fields, fields: map, last: '' };
}

/** The belly sizes the baby-weight fields were baked at, from a field set (ascending). */
export function babyAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  const at = new Set<number>();
  for (const n of fields.fields.keys()) if (n.startsWith(BABY_FIELD_PREFIX)) { const s = Number(n.split(':').pop()); if (Number.isFinite(s)) at.add(s); }
  return [...at].sort((a, b) => a - b);
}

/**
 * The share of each baked weight at a BABY WEIGHT value (-100 light .. 0 normal .. +100 heavy): light is a straight
 * line; heavy goes through its half (0 -> half -> full), so 50 is exactly the baked half and 100 the baked full.
 */
export function babyWeightShares(weightPercent: number): { light: number; heavyHalf: number; heavy: number } {
  const w = Math.min(1, Math.max(-1, (Number.isFinite(weightPercent) ? weightPercent : 0) / 100));
  if (w <= 0) return { light: w < 0 ? -w : 0, heavyHalf: 0, heavy: 0 };
  return w <= 0.5 ? { light: 0, heavyHalf: 2 * w, heavy: 0 } : { light: 0, heavyHalf: 2 - 2 * w, heavy: 2 * w - 1 };
}

/** The baby-weight fields' weights at a belly size and BABY WEIGHT: a tent over the baked sizes times the weight's shares, on HYBRID only. */
export function babyFieldWeights(bumpPercent: number, weightPercent: number, anchors: readonly number[], curve: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve !== 'hybrid' || !anchors.length) return out;
  const share = babyWeightShares(weightPercent);
  if (!share.light && !share.heavyHalf && !share.heavy) return out;
  for (const [s, t] of anchorWeights(bumpPercent, anchors)) {
    if (share.light) out[`${BABY_FIELD_PREFIX}${ANCHOR_KIND.light}:${s}`] = t * share.light;
    if (share.heavyHalf) out[`${BABY_FIELD_PREFIX}${ANCHOR_KIND.heavyHalf}:${s}`] = t * share.heavyHalf;
    if (share.heavy) out[`${BABY_FIELD_PREFIX}${ANCHOR_KIND.heavy}:${s}`] = t * share.heavy;
  }
  return out;
}

/** Fetch and read the baby-weight file; null (BABY WEIGHT does nothing) when it cannot be had. */
export async function loadWomb(url: string): Promise<WombFile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseWombFile(await res.arrayBuffer());
  } catch (error) {
    console.warn('[sarahlab] her baby-weight shapes could not be loaded; BABY WEIGHT does nothing', error);
    return null;
  }
}

/**
 * The baby's weight at full term a BABY WEIGHT reads as (Joshua, 2026-10-29: "might as well check for baby(s) weight"):
 * about 3.4 kg at 0, the middle of the usual full-term range; 2.5 kg at -100, a small baby; 4.5 kg at +100, a large one
 * (over 4 to 4.5 kg is what obstetrics calls macrosomia). A label for the slider, not a measurement: a real belly's
 * size and carry depend on far more than the baby's weight.
 */
export function babyWeightKg(weightPercent: number): number {
  const w = Math.min(100, Math.max(-100, Number.isFinite(weightPercent) ? weightPercent : 0)) / 100;
  return w < 0 ? 3.4 + 0.9 * w : 3.4 + 1.1 * w;
}
const lbOz = (kg: number): string => { const oz = Math.round(kg * 35.274); return `${Math.floor(oz / 16)} lb ${oz % 16} oz`; };

/** What the BABY WEIGHT line adds: how her baby sits and about what it weighs at full term, or why the control does nothing here. */
export function babyWeightState(weightPercent: number, ready: boolean, curve: string): string {
  if (!ready) return 'her v2 body only (loading or not this body)';
  if (curve !== 'hybrid') return 'HYBRID belly curve only';
  const w = Number.isFinite(weightPercent) ? weightPercent : 0;
  const kg = babyWeightKg(w), weighs = `about ${kg.toFixed(1)} kg (${lbOz(kg)}) at full term`;
  if (w === 0) return `normal · ${weighs}`;
  const a = Math.abs(w);
  const how = a < 35 ? 'a little ' : a < 75 ? '' : 'very ';
  return w < 0 ? `${how}light · sits higher · ${weighs}` : `${how}heavy · drops lower · ${weighs}`;
}

/**
 * MILK (Joshua, 2026-10-29: "something similar for the breasts like filled with milk? Both can be synced with the same
 * amount or you can tweak each one slightly"; of the renders, "Try twice as much", then "Looks good").
 *
 * Each breast filled from a gland behind its nipple: fuller all over and most in its upper pole, lifted a little, its
 * nipple and areola riding on it whole, her cleavage kept smooth. MILK fills both; MILK BALANCE takes some from one
 * side, so the two can differ a little. Baked per belly size, 0% to 200%, in its own file: her left breast full, her
 * right, and what both full at once differ from the two added. At 100% each breast holds about a third of a litre more
 * -- the generous end of what a breast is measured to hold (roughly 80 to 600 mL), above the typical growth of early
 * breastfeeding (about 210 mL a breast); around half is a typical full feed.
 */
export const MILK_PATH = 'models/sarah-v2-body-milk.bin';
export const MILK_FIELD_PREFIX = 'shape:milk:';
/** How much of a breast MILK BALANCE can take away at full turn (GAME TUNING: the approved render was 100% and 60%). */
export const MILK_BALANCE_SHARE = 0.4;
/** About how much milk a full breast holds, for the line (measured on her shapes: 265 to 400 cm3 a breast with the belly size). */
export const MILK_FULL_ML = 330;

/** Read the milk file ('SZK1'). Throws on anything else. */
export function parseMilkFile(buffer: ArrayBuffer): WombFile {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'SZK1') throw new Error(`milk: not a milk file (${magic})`);
  const vertices = view.getUint32(4, true);
  const { parts, at } = readAnchoredParts(buffer, 8, vertices);
  if (at !== buffer.byteLength) throw new Error(`milk: ${buffer.byteLength - at} bytes left over`);
  for (const p of parts) {
    if (p.kind !== ANCHOR_KIND.milkLeft && p.kind !== ANCHOR_KIND.milkRight && p.kind !== ANCHOR_KIND.milkBoth) throw new Error(`milk: a field of kind ${p.kind}`);
    for (const i of p.index) if (i >= vertices) throw new Error('milk: a vertex past the mesh');
  }
  return { vertices, parts };
}

/** Put the milk fields into a field set (returned as a new one); null when the mesh is not the body they were baked for. */
export function applyMilk(mesh: THREE.Mesh, fields: ShapeFields, data: WombFile): ShapeFields | null {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (geom.getAttribute('position')?.count !== data.vertices || data.vertices !== ZERO_REFINE_VERTICES) return null;
  const map = new Map(fields.fields);
  for (const p of data.parts) map.set(`${MILK_FIELD_PREFIX}${p.kind}:${p.slider}`, { index: p.index, pos: p.pos, nrm: p.nrm });
  return { ...fields, fields: map, last: '' };
}

/** The belly sizes the milk fields were baked at, from a field set (ascending). */
export function milkAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  const at = new Set<number>();
  for (const n of fields.fields.keys()) if (n.startsWith(MILK_FIELD_PREFIX)) { const v = Number(n.split(':').pop()); if (Number.isFinite(v)) at.add(v); }
  return [...at].sort((a, b) => a - b);
}

/** How full each breast is (0..1) for MILK (0..100) and MILK BALANCE (-100 her right fuller .. +100 her left fuller). */
export function milkShares(milkPercent: number, balancePercent: number): { left: number; right: number } {
  const m = Math.min(1, Math.max(0, (Number.isFinite(milkPercent) ? milkPercent : 0) / 100));
  const b = Math.min(1, Math.max(-1, (Number.isFinite(balancePercent) ? balancePercent : 0) / 100));
  return { left: m * (b < 0 ? 1 + MILK_BALANCE_SHARE * b : 1), right: m * (b > 0 ? 1 - MILK_BALANCE_SHARE * b : 1) };
}

/** The milk fields' weights: a tent over the baked sizes (from 0%) times each breast's share, on HYBRID only. */
export function milkFieldWeights(bumpPercent: number, milkPercent: number, balancePercent: number, anchors: readonly number[], curve: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve !== 'hybrid' || !anchors.length) return out;
  const { left, right } = milkShares(milkPercent, balancePercent);
  if (!left && !right) return out;
  for (const [s, t] of anchorWeights(bumpPercent, anchors, false)) {
    if (left) out[`${MILK_FIELD_PREFIX}${ANCHOR_KIND.milkLeft}:${s}`] = t * left;
    if (right) out[`${MILK_FIELD_PREFIX}${ANCHOR_KIND.milkRight}:${s}`] = t * right;
    if (left && right) out[`${MILK_FIELD_PREFIX}${ANCHOR_KIND.milkBoth}:${s}`] = t * left * right;
  }
  return out;
}

/** What the MILK line adds: how full, about how much a breast, or why the control does nothing here. */
export function milkState(milkPercent: number, balancePercent: number, ready: boolean, curve: string): string {
  if (!ready) return 'her v2 body only (loading or not this body)';
  if (curve !== 'hybrid') return 'HYBRID belly curve only';
  const m = Number.isFinite(milkPercent) ? milkPercent : 0;
  if (m <= 0) return 'none';
  const how = m < 35 ? 'a little' : m < 70 ? 'typical full' : 'very full';
  const { left, right } = milkShares(m, balancePercent);
  const ml = (x: number) => Math.round((x * MILK_FULL_ML) / 10) * 10;
  return left === right ? `${how} · about ${ml(left)} mL a breast` : `${how} · about ${ml(left)} mL her left, ${ml(right)} mL her right`;
}

/** What the MILK BALANCE line adds. */
export function milkBalanceState(balancePercent: number): string {
  const b = Number.isFinite(balancePercent) ? balancePercent : 0;
  return b === 0 ? 'even' : b > 0 ? 'her left fuller' : 'her right fuller';
}

/** Fetch and read the milk file; null (MILK does nothing) when it cannot be had. */
export async function loadMilk(url: string): Promise<WombFile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseMilkFile(await res.arrayBuffer());
  } catch (error) {
    console.warn('[sarahlab] her milk shapes could not be loaded; MILK does nothing', error);
    return null;
  }
}
