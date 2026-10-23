/**
 * THE CLOTHING BUILDER'S DATA (Joshua, 2026-10-23: "one editable strip or bikini strap that attaches correctly, survives
 * the sliders and animations, saves and reloads"; "stable surface attachments (no per-frame nearest-vertex search)";
 * saves as "editable JSON (pieces, points, attachments, fabric, settings), with the mesh generated from the data").
 *
 * A PIECE is a strip (a flat band: a bikini strap, a trim) or a cord (a round string) running through a list of
 * POINTS. Each point is pinned to her SKIN, not to the room: a triangle of the base model's index and barycentric
 * weights inside it. That is what lets a strap survive the body sliders and her animations -- the triangle moves with
 * her, so the point does -- and it is why nothing here is a world position and nothing searches for the nearest vertex
 * each frame: the attachment is decided once, when the point is placed, and only read after that.
 *
 * The geometry (the band's cross-section, its clearance off her skin, the bridges that span a hollow instead of
 * following it) is GENERATED from this data by other modules every frame. What is saved is only this: pieces, points,
 * attachments, fabric and settings, as editable JSON.
 *
 * Every piece and point is immutable: the updaters return a new piece and never touch their input, which is what makes
 * undo a list of states (`History`) rather than a list of inverse operations.
 *
 * Pure: no three, no DOM, no storage. Reading is defensive -- an imported file is untrusted -- and never throws.
 */
import { FABRIC_FAMILIES, type FabricFamilyId } from './fabricLibrary';

export const STRAP_DATA_VERSION = 1;

export type StrapKind = 'strip' | 'cord';

/** Where a point is on her: triangle `tri` of the body's full index (3 vertex indices per triangle), and its barycentric weights (each >= 0, summing to 1). */
export interface StrapAnchor { readonly tri: number; readonly bary: readonly [number, number, number] }

export interface StrapPoint extends StrapAnchor {
  /** Extra millimetres off her skin at this point, on top of the piece's clearance (0 = on the clearance). */
  readonly lift: number;
  /** The stretch from this point to the next spans straight between them (a bridge) instead of following her skin. */
  readonly bridge: boolean;
}

export interface StrapFabric { readonly family: FabricFamilyId; readonly colour: number /* 0..15 */ }

export interface StrapPiece {
  readonly id: string;
  readonly kind: StrapKind;
  readonly name: string;
  readonly points: readonly StrapPoint[];
  /** A loop: the last point joins the first. */
  readonly closed: boolean;
  /** Centimetres across (a cord: its diameter). */
  readonly width: number;
  /** Millimetres thick (a strip's thickness; a cord ignores it). */
  readonly thickness: number;
  /** Millimetres from her skin to the underside. */
  readonly clearance: number;
  /** Null: the builder's default look (plain white). */
  readonly fabric: StrapFabric | null;
  /** A strip shows its fabric's edging (the trim strip with stitched edges) along both sides. */
  readonly edging: boolean;
}

/** Everything built for one outfit, on one base model (attachments are triangles of that model). */
export interface BuiltPieces { readonly version: 1; readonly base: string; readonly pieces: readonly StrapPiece[] }

/**
 * Slider ranges: min, max, step, and the starting value for a new strip and a new cord. A strip starts as a bikini
 * strap (1.2 cm, 1.5 mm thick), a cord as a string (4 mm round); both start 1 mm off her skin so the band never
 * z-fights her. The ranges are what every reader clamps to, so a saved or imported number can never leave them.
 */
export const STRAP_RANGES: Readonly<{
  width: { min: number; max: number; step: number; strip: number; cord: number };
  thickness: { min: number; max: number; step: number; initial: number };
  clearance: { min: number; max: number; step: number; initial: number };
  lift: { min: number; max: number; step: number };
}> = Object.freeze({
  width: Object.freeze({ min: 0.2, max: 6, step: 0.1, strip: 1.2, cord: 0.4 }),
  thickness: Object.freeze({ min: 0.5, max: 6, step: 0.1, initial: 1.5 }),
  clearance: Object.freeze({ min: 0, max: 15, step: 0.5, initial: 1 }),
  lift: Object.freeze({ min: 0, max: 40, step: 1 }),
});

/** Caps that keep an imported file from asking a phone to build more than it should, and the editor honest about it. */
export const MAX_PIECES = 32;
export const MAX_POINTS = 400;

/** Strings a save carries are trimmed and capped: an id, a name and the base model's key are all short labels. */
const ID_CAP = 40;
const NAME_CAP = 40;
const BASE_CAP = 40;

/**
 * A weight sum this close to 1 is already normalized and is left exactly as it is. Without the tolerance a second
 * normalization would divide by 0.9999999999999999 and nudge the last bits, and a save would not read back equal to
 * what was written.
 */
const BARY_TOLERANCE = 1e-9;

const KIND_NAMES: Readonly<Record<StrapKind, string>> = Object.freeze({ strip: 'Strap', cord: 'Cord' });

// ---------------------------------------------------------------------------------------------------------------------
// Small readers. Each takes anything and returns a value inside the contract.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isKind = (v: unknown): v is StrapKind => v === 'strip' || v === 'cord';
const isFamily = (v: unknown): v is FabricFamilyId => typeof v === 'string' && FABRIC_FAMILIES.some((f) => f.id === v);

/** A finite number clamped to [min, max]; anything else (NaN, Infinity, a string) is the fallback. */
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Trimmed and capped by code point (so an emoji is never cut in half); a non-string is ''. */
function cleanString(v: unknown, cap: number): string {
  if (typeof v !== 'string') return '';
  return Array.from(v.trim()).slice(0, cap).join('').trim();
}

const cleanWidth = (v: unknown, kind: StrapKind): number => clampNum(v, STRAP_RANGES.width.min, STRAP_RANGES.width.max, STRAP_RANGES.width[kind]);
const cleanThickness = (v: unknown): number => clampNum(v, STRAP_RANGES.thickness.min, STRAP_RANGES.thickness.max, STRAP_RANGES.thickness.initial);
const cleanClearance = (v: unknown): number => clampNum(v, STRAP_RANGES.clearance.min, STRAP_RANGES.clearance.max, STRAP_RANGES.clearance.initial);
const cleanLift = (v: unknown): number => clampNum(v, STRAP_RANGES.lift.min, STRAP_RANGES.lift.max, 0);
const cleanName = (v: unknown, kind: StrapKind): string => cleanString(v, NAME_CAP) || KIND_NAMES[kind];

/** A family the pack has and a colour 0..15 (rounded), or null -- the builder's plain white. */
function cleanFabric(v: unknown): StrapFabric | null {
  if (!isObject(v) || !isFamily(v.family)) return null;
  return Object.freeze({ family: v.family, colour: Math.round(clampNum(v.colour, 0, 15, 0)) });
}

/**
 * Barycentric weights made valid: a negative or non-finite weight is 0, and the rest are scaled to sum to 1. All zero
 * means no information about where in the triangle, so the point takes the triangle's first corner -- still on the
 * right triangle, which is the part of the attachment that matters most.
 */
function cleanBary(bary: ArrayLike<unknown>): readonly [number, number, number] {
  const w = [0, 1, 2].map((i) => {
    const x = bary[i];
    return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : 0;
  });
  const sum = w[0] + w[1] + w[2];
  let out: [number, number, number];
  if (!(sum > 0)) out = [1, 0, 0];
  else if (Math.abs(sum - 1) <= BARY_TOLERANCE) out = [w[0], w[1], w[2]];
  else out = [w[0] / sum, w[1] / sum, w[2] / sum];
  return Object.freeze(out) as readonly [number, number, number];
}

/** A triangle index from trusted code: made a non-negative integer. (Untrusted files are stricter: see `readPoint`.) */
const cleanTri = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

const freezePiece = (p: StrapPiece): StrapPiece => Object.freeze({ ...p, points: Object.freeze(p.points.slice()) });

const validIndex = (piece: StrapPiece, index: number): boolean => Number.isInteger(index) && index >= 0 && index < piece.points.length;

// ---------------------------------------------------------------------------------------------------------------------
// Making pieces and points.

/** A fresh unique id like 'strap-1a2b3c' (not cryptographic; Math.random is fine here). */
export function pieceId(): string {
  return `strap-${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
}

/** An empty piece with the starting values for its kind. A strip shows its edging from the start; a cord has none. */
export function newPiece(kind: StrapKind, id: string, name?: string): StrapPiece {
  const k: StrapKind = isKind(kind) ? kind : 'strip';
  return freezePiece({
    id: cleanString(id, ID_CAP) || pieceId(),
    kind: k,
    name: cleanName(name, k),
    points: [],
    closed: false,
    width: STRAP_RANGES.width[k],
    thickness: STRAP_RANGES.thickness.initial,
    clearance: STRAP_RANGES.clearance.initial,
    fabric: null,
    edging: k === 'strip',
  });
}

/** A point at `anchor` with its weights normalized and its lift clamped. */
export function newPoint(anchor: StrapAnchor, lift = 0, bridge = false): StrapPoint {
  return Object.freeze({ tri: cleanTri(anchor.tri), bary: cleanBary(anchor.bary), lift: cleanLift(lift), bridge: bridge === true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Immutable updaters: each returns a NEW piece and never mutates its input; an index out of range returns the piece
// unchanged (the same object), so a caller can tell "nothing happened" with Object.is and not record an undo step.

/** Insert `point` before index `at` (default: append). Refused (piece unchanged) once the piece holds MAX_POINTS. */
export function addPoint(piece: StrapPiece, point: StrapPoint, at?: number): StrapPiece {
  if (piece.points.length >= MAX_POINTS) return piece;
  const i = at === undefined ? piece.points.length : at;
  if (!Number.isInteger(i) || i < 0 || i > piece.points.length) return piece;
  const points = piece.points.slice();
  points.splice(i, 0, newPoint(point, point.lift, point.bridge));
  return freezePiece({ ...piece, points });
}

/** Re-attach a point somewhere else on her; it keeps its own lift and bridge. */
export function movePoint(piece: StrapPiece, index: number, anchor: StrapAnchor): StrapPiece {
  if (!validIndex(piece, index)) return piece;
  const old = piece.points[index];
  const points = piece.points.slice();
  points[index] = newPoint(anchor, old.lift, old.bridge);
  return freezePiece({ ...piece, points });
}

export function removePoint(piece: StrapPiece, index: number): StrapPiece {
  if (!validIndex(piece, index)) return piece;
  const points = piece.points.slice();
  points.splice(index, 1);
  return freezePiece({ ...piece, points });
}

export function setPointLift(piece: StrapPiece, index: number, lift: number): StrapPiece {
  if (!validIndex(piece, index)) return piece;
  const points = piece.points.slice();
  points[index] = Object.freeze({ ...points[index], lift: cleanLift(lift) });
  return freezePiece({ ...piece, points });
}

export function setPointBridge(piece: StrapPiece, index: number, bridge: boolean): StrapPiece {
  if (!validIndex(piece, index)) return piece;
  const points = piece.points.slice();
  points[index] = Object.freeze({ ...points[index], bridge: bridge === true });
  return freezePiece({ ...piece, points });
}

/**
 * Change the piece's settings. Numbers are clamped to STRAP_RANGES; an empty name falls back to the kind's own (the
 * same rule a save is read with, so what the editor holds always reads back equal); an unknown fabric family is the
 * plain default. Changing kind keeps the points -- a strap turned into a cord runs exactly where it ran.
 */
export function setPiece(
  piece: StrapPiece,
  change: Partial<Pick<StrapPiece, 'name' | 'closed' | 'width' | 'thickness' | 'clearance' | 'fabric' | 'edging' | 'kind'>>,
): StrapPiece {
  const kind: StrapKind = change.kind !== undefined && isKind(change.kind) ? change.kind : piece.kind;
  return freezePiece({
    ...piece,
    kind,
    name: change.name !== undefined ? cleanName(change.name, kind) : piece.name,
    closed: change.closed !== undefined ? change.closed === true : piece.closed,
    width: change.width !== undefined ? clampNum(change.width, STRAP_RANGES.width.min, STRAP_RANGES.width.max, piece.width) : piece.width,
    thickness: change.thickness !== undefined ? clampNum(change.thickness, STRAP_RANGES.thickness.min, STRAP_RANGES.thickness.max, piece.thickness) : piece.thickness,
    clearance: change.clearance !== undefined ? clampNum(change.clearance, STRAP_RANGES.clearance.min, STRAP_RANGES.clearance.max, piece.clearance) : piece.clearance,
    fabric: change.fabric !== undefined ? cleanFabric(change.fabric) : piece.fabric,
    edging: change.edging !== undefined ? change.edging === true : piece.edging,
  });
}

/**
 * A copy with a new id, its points in reverse order (used for a mirrored copy, whose order runs the other way round
 * her). A point keeps its own lift, but a BRIDGE belongs to the stretch from its point to the next, so the flags move
 * one place with the reversal: the stretches that spanned straight still span straight, including a closed loop's
 * closing stretch.
 */
export function reversed(piece: StrapPiece, id: string): StrapPiece {
  const src = piece.points, n = src.length;
  const points = src.map((_, k) => {
    const p = src[n - 1 - k];
    // Reversed stretch k -> k+1 is original stretch (n-2-k) -> (n-1-k); the last flag takes the original last's.
    const bridge = src[(n - 2 - k + n) % n].bridge;
    return p.bridge === bridge ? p : Object.freeze({ ...p, bridge });
  });
  return freezePiece({ ...piece, id: cleanString(id, ID_CAP) || pieceId(), points });
}

// ---------------------------------------------------------------------------------------------------------------------
// Saves: reading untrusted JSON, and writing the canonical document.

/**
 * One point from a file, or null to drop it. A point whose triangle is not a whole number, is negative, or is past the
 * model's triangle count has no place on her and is DROPPED, never moved to a guess -- a strap pinned to the wrong
 * triangle is worse than one point fewer. The same goes for a point with no three weights to read.
 */
function readPoint(raw: unknown, triangleCount: number | undefined): StrapPoint | null {
  if (!isObject(raw)) return null;
  const { tri, bary } = raw;
  if (typeof tri !== 'number' || !Number.isInteger(tri) || tri < 0) return null;
  if (triangleCount !== undefined && tri >= triangleCount) return null;
  if (!Array.isArray(bary) || bary.length !== 3) return null;
  return Object.freeze({ tri, bary: cleanBary(bary), lift: cleanLift(raw.lift), bridge: raw.bridge === true });
}

function readPiece(raw: Record<string, unknown>, triangleCount: number | undefined): StrapPiece {
  const kind: StrapKind = isKind(raw.kind) ? raw.kind : 'strip';
  const points: StrapPoint[] = [];
  if (Array.isArray(raw.points)) {
    for (const p of raw.points) {
      if (points.length >= MAX_POINTS) break;
      const point = readPoint(p, triangleCount);
      if (point) points.push(point);
    }
  }
  return {
    id: cleanString(raw.id, ID_CAP),
    kind,
    name: cleanName(raw.name, kind),
    points,
    closed: raw.closed === true,
    width: cleanWidth(raw.width, kind),
    thickness: cleanThickness(raw.thickness),
    clearance: cleanClearance(raw.clearance),
    fabric: cleanFabric(raw.fabric),
    edging: typeof raw.edging === 'boolean' ? raw.edging : kind === 'strip',
  };
}

/** `wanted`, or the first of wanted-2, wanted-3, ... that is free, kept inside the id cap. */
function uniqueId(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = Array.from(wanted).slice(0, ID_CAP - suffix.length).join('') + suffix;
    if (!taken.has(id)) return id;
  }
}

/**
 * Read untrusted parsed JSON: known fields only, numbers clamped to their ranges, bary normalized, tri an integer >= 0
 * and, when `triangleCount` is given, < triangleCount (points failing that are dropped), at most MAX_PIECES pieces and
 * MAX_POINTS points each, strings trimmed and capped (id 40, name 40, base 40), duplicate piece ids made unique,
 * unknown fabric families -> fabric null, colour rounded and clamped 0..15. Returns null if `raw` is not an object
 * with an array `pieces` (version must be 1 if present; any other version -> null). Never throws.
 *
 * A piece with no id gets `strap-<n>` from its place in the file, so reading the same file twice gives the same ids.
 */
export function sanitizeBuilt(raw: unknown, triangleCount?: number): BuiltPieces | null {
  try {
    if (!isObject(raw) || !Array.isArray(raw.pieces)) return null;
    if (raw.version !== undefined && raw.version !== STRAP_DATA_VERSION) return null;
    const count = typeof triangleCount === 'number' && Number.isFinite(triangleCount) ? Math.max(0, Math.floor(triangleCount)) : undefined;
    const taken = new Set<string>();
    const pieces: StrapPiece[] = [];
    for (const entry of raw.pieces) {
      if (pieces.length >= MAX_PIECES) break;
      if (!isObject(entry)) continue;
      const piece = readPiece(entry, count);
      const id = uniqueId(piece.id || `strap-${pieces.length + 1}`, taken);
      taken.add(id);
      pieces.push(freezePiece({ ...piece, id }));
    }
    return Object.freeze({ version: 1, base: cleanString(raw.base, BASE_CAP), pieces: Object.freeze(pieces) });
  } catch {
    // Parsed JSON cannot throw from a read, but a caller may hand us anything (a Proxy, a getter); an unreadable
    // document is simply not a document.
    return null;
  }
}

/** The canonical JSON a save stores (plain objects/arrays, no class instances; round-trips through sanitizeBuilt unchanged). */
export function builtToJson(built: BuiltPieces): unknown {
  return {
    version: STRAP_DATA_VERSION,
    base: built.base,
    pieces: built.pieces.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      points: p.points.map((q) => ({ tri: q.tri, bary: [q.bary[0], q.bary[1], q.bary[2]], lift: q.lift, bridge: q.bridge })),
      closed: p.closed,
      width: p.width,
      thickness: p.thickness,
      clearance: p.clearance,
      fabric: p.fabric ? { family: p.fabric.family, colour: p.fabric.colour } : null,
      edging: p.edging,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Undo and redo.

/**
 * Undo/redo over immutable states. `push` records a new state (dropping any redo); `undo`/`redo` return the state to
 * show, or null when there is nothing to undo/redo. Holds at most `limit` (default 100) states, forgetting the oldest.
 * `reset(state)` clears history to just that state. `current` is the state shown now.
 *
 * Pushing the state already shown (the same object) records nothing: the updaters hand back their input when they
 * refuse (an index out of range, a piece full of points), and an undo step that changes nothing would read as broken.
 */
export class History<T> {
  private states: T[];
  private index = 0;
  private readonly limit: number;

  constructor(initial: T, limit = 100) {
    this.states = [initial];
    this.limit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
  }

  get current(): T { return this.states[this.index]; }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.states.length - 1; }

  push(state: T): void {
    if (Object.is(state, this.current)) return;
    this.states.length = this.index + 1;
    this.states.push(state);
    if (this.states.length > this.limit) this.states.splice(0, this.states.length - this.limit);
    this.index = this.states.length - 1;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.current;
  }

  reset(state: T): void {
    this.states = [state];
    this.index = 0;
  }
}
