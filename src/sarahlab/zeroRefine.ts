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

/** What an anchored field carries (the file's own numbers). */
export const ANCHOR_KIND = { sides: 0, light: 1, heavyHalf: 2, heavy: 3 } as const;
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
  let sides: AnchoredPart[] = [];
  if (magic === 'SZR5') {
    const read = readAnchoredParts(buffer, at, vertices);
    sides = read.parts.filter((p) => p.kind === ANCHOR_KIND.sides).sort((p, q) => p.slider - q.slider);
    at = read.at;
  }
  if (at !== buffer.byteLength) throw new Error(`zero refine: ${buffer.byteLength - at} bytes left over`);
  for (const p of [body, ...upper.values(), ...sides]) for (const i of p.index) if (i >= vertices) throw new Error('zero refine: a vertex past the mesh');
  for (const i of splits) if (i >= vertices) throw new Error('zero refine: a navel vertex past the mesh');
  return { vertices, body, upper, sides, flatMoved, flatMax, navel: { count, flags, splitStart, splits, neighbourStart, neighbours, triangles, seed, grid, gridRadius, outie, bowl } };
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
  return { fields: { ...fields, fields: map, last: '' }, navel: new NavelPiece(data.navel) };
}

/** The sizes her sides smoothing was baked at, from a field set (ascending). */
export function sidesAnchors(fields: ShapeFields | null | undefined): number[] {
  if (!fields) return [];
  return [...fields.fields.keys()].filter((n) => n.startsWith(SIDES_FIELD_PREFIX)).map((n) => Number(n.slice(SIDES_FIELD_PREFIX.length))).filter(Number.isFinite).sort((a, b) => a - b);
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
