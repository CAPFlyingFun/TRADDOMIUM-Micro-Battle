/**
 * THE INSTANT CUTS OF THE NEW TEE (Stage 3): which of the full-extent tee (`TeeParams.extend`) is worn for a set of
 * settings (`settings.ts`), as a field over its render vertices -- the cloth simulates and draws the triangles it keeps
 * (`garmentCloth.ts`), and the material draws the edge where it crosses 0 (`cutEdge.ts`).
 *
 * Three cut lines, each in its pieces' own plane, every one drawn by the draft's rules (`Draft.guide`):
 * - LENGTH, across the front pair (front, frontExt) and the back pair (back, backExt): a hem standing at side height h
 *   (the slider between her own stops, `garmentStops`), level on her the way the drafted hem is (`draft.ts` hemOf: the
 *   centre lower by the extra a tape down her centre needs), let down or taken up at the centre by FRONT HEM / BACK HEM
 *   and raised at the sides by HEM CURVE:
 *     y(x) = h - extra(h)(1 - s^2) - hem(1 - s^2) + rise s^4,   s = |x| / w held to [0, 1],   rise = curve HEM_CURVE_RISE,
 *   w the piece's half-width where the line meets the side seam (at h + rise: `hemLine`), level past the side seams. At
 *   the Standard stop with nothing moved it IS the drafted hem; at the Knee stop, the extension's.
 * - SLEEVE, across each sleeve and its extension: level, at a height of the sleeve's frame between its stops. A gusset
 *   is worn whole while the cut is under it; above, its lower half -- the half sewn to the body, between the front's and
 *   the back's side seams -- is worn, cut along its diagonal between the sleeve's underarm corners, so the body stays
 *   closed up under her arm (Stage 3: dropped whole, the gusset left a slit 6 cm down her side) and the armhole runs
 *   under her arm from the front's raglan to the back's. The body is never cut by a sleeve: on a raglan cut above the
 *   underarm, the body's raglan edges simply become the armhole.
 * - NECKLINE, the front only, deeper than drafted: from the drafted neckline's side end (the raglan point, a set-in's
 *   shoulder seam) to her centre front at the depth asked, a U (the drafted neckline let down by a quarter ellipse that
 *   is 0 at the side end) blended toward a V (straight from the side end) by NECK SHAPE. It is 0 at the side end, so a
 *   sleeve's and the back's neckline are never cut.
 * `keep` is the signed perpendicular distance to the line that crosses the vertex's piece, so a band of a width is that
 * wide everywhere; a piece its line does not cross reads +1 kept whole or -1 cut away whole. And when a pair's line is
 * exactly the drafted one (the Standard length with that pair's hem and the curve untouched; the Short sleeve), no
 * distance is taken: the plain piece reads +1 and its extension -1, so the default tee is exactly the plain one.
 *
 * Fast enough to run on every slider input: what depends only on the tee is worked out once per tailored tee (a
 * WeakMap on its sewn sheet), and a line's nearest segment is searched outward from the one under the vertex, only while
 * a segment could still be nearer.
 *
 * Plain TypeScript, metres in each piece's plane.
 */
import { EXTENSION_PARENT, type Draft, type DraftGuide } from './draft';
import { draftedNeckDrop, GARMENT_DEFAULTS, LENGTH_STOPS, SLEEVE_STOPS, stopValue, type GarmentSettings, type GarmentStops } from './settings';
import type { BodyMeasure, SewnGarment, Vec2, Vec3 } from './types';

/** What the cuts read: the tee as tailored (`tailor.ts` Tailored has all three). */
export interface CutSource {
  readonly sewn: SewnGarment;
  readonly draft: Draft;
  readonly measure: BodyMeasure;
}

/** The cut of the tee for one set of settings, per render vertex (`SewnGarment.vertexParticle` order). */
export interface GarmentCuts {
  /**
   * Signed metres in the vertex's piece plane from the nearest cut line that crosses its piece (perpendicular distance,
   * so a band of a given width is that wide everywhere): above 0 kept, below 0 cut away. A piece kept whole reads +1 at
   * every vertex, a piece cut away whole -1: at GARMENT_DEFAULTS that is every piece, so the default tee is exactly the
   * plain one with nothing below its hem or cuffs. A triangle is worn when any corner reads above 0.
   */
  readonly keep: Float32Array;
  /**
   * Signed metres from the NECKLINE's cut line, above 0 kept (under it), on the vertices of the piece it crosses (the
   * front); +Infinity on every vertex where no neckline cut runs -- every vertex while the neckline is the drafted one.
   */
  readonly neck: Float32Array;
}

/** HEM CURVE at 1 raises the hem at the side seams this far, metres: a shirttail. */
export const HEM_CURVE_RISE = 0.08;

/** CROP stands this far under her underbust line, and never nearer than CROP_CLEAR under the gusset's lower corner (the side seam's top), so it never cuts a gusset, metres. */
const CROP_UNDER_BUST = 0.04, CROP_CLEAR = 0.01;
/** TUNIC stands this far under her hip line, metres. */
const TUNIC_UNDER_HIP = 0.09;
/** A raglan TANK leaves a strap of the sleeve this deep under the middle of its top edge; a set-in's cuts the whole sleeve away, this far over its crown, metres. */
const TANK_STRAP = 0.045, TANK_OVER_CROWN = 0.01;
/** ELBOW ends this far past her elbow (metres); THREE-QUARTER this share of the way down her arm from her shoulder point to her wrist. */
const ELBOW_PAST = 0.02, THREE_QUARTER = 0.75;
/** A stop moved to keep the stops in order stands at least this far from its neighbours, metres. */
const STOP_GAP = 0.01;
/** A gusset is worn whole while the sleeve's cut is at least this far under it (above, its lower half), metres. */
const GUSSET_CLEAR = 0.01;
/**
 * A piece none of whose vertices is further than this on the far side of its line is kept whole (or cut away whole),
 * metres: more than the Float32 plane coordinates' rounding, so a line laid exactly along a piece's edge (the Knee stop
 * along the extension's hem, the Wrist along its cuff) keeps the piece whole.
 */
const WHOLE = 1e-7;
/** The hem line's nodes per half: `hemOf`'s, so at the Standard and Knee stops it runs through the drafted hems' own. */
const HEM_NODES = 24;
/** The hem line runs on level this far past the side seams, metres (past any piece). */
const FAR = 10;

const STANDARD_AT = LENGTH_STOPS.find((x) => x.id === 'standard')!.at, SHORT_AT = SLEEVE_STOPS.find((x) => x.id === 'short')!.at;

type Part = 'front' | 'back' | 'sleeve' | 'gusset';
/** One piece's render vertices: a run (`sew.ts` lays them out piece by piece), what it is part of, and whether it is the full extent's. */
interface Run { readonly start: number; readonly end: number; readonly part: Part; readonly extension: boolean; readonly id: string }

/** What depends only on the tailored tee. */
interface Prepared {
  readonly n: number;
  readonly front: readonly Run[];
  readonly back: readonly Run[];
  readonly sleeves: readonly Run[];
  readonly gussets: readonly Run[];
  /** The plain front, where a neckline is cut. */
  readonly neckRun: Run | null;
  /** Each stop's line: LENGTH's side heights, SLEEVE's heights in the sleeve frame, in the stops' order. */
  readonly lengthY: readonly number[];
  readonly sleeveY: readonly number[];
  readonly stops: GarmentStops;
}

const prepared = new WeakMap<SewnGarment, Prepared>();

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Her stops on this tee: the LENGTH stops' side heights and the SLEEVE stops' heights in the sleeve frame. */
function stopLines(draft: Draft, m: BodyMeasure): { lengthY: number[]; sleeveY: number[] } {
  const g = draft.guide, sl = g.sleeve;
  // LENGTH, down her. Standard is the drafted hem and Knee the extension's, exactly; Crop is held clear of the gusset
  // and never under the drafted hem. Tunic and Mini are her hip's: should a body (or a hem drafted elsewhere) put them
  // out of order between Standard and Knee, they are spaced evenly between those two instead (on Sarah they are in
  // order, 8 and 9 cm apart, and stand where their rules put them)
  const standard = draft.notes.hemY, knee = g.kneeY;
  const crop = Math.max(standard, Math.min(m.underbust.y - CROP_UNDER_BUST, g.sideTopY - CROP_CLEAR));
  let tunic = m.hip.y - TUNIC_UNDER_HIP, mini = (m.hip.y + m.kneeY) / 2;
  if (!(standard > tunic && tunic > mini && mini > knee)) { tunic = standard + (knee - standard) / 3; mini = standard + 2 * (knee - standard) / 3; }
  const length: Record<string, number> = { crop, standard, tunic, mini, knee };
  // SLEEVE, down her arm. Short is the drafted cuff and Wrist the extension's, exactly; the others are her landmarks,
  // held a STOP_GAP inside their neighbours should a sleeve be drafted unlike hers (on Sarah none is moved)
  const raglan = g.construction === 'raglan';
  const toElbow = (dist3(m.shoulderPoint[0], m.arms[0].elbow) + dist3(m.shoulderPoint[1], m.arms[1].elbow)) / 2;
  const outside = (m.arms[0].outsideLength + m.arms[1].outsideLength) / 2;
  const short = sl.cuffV, wrist = sl.wristV;
  // a raglan's top edge runs higher at the front than the back: the strap is TANK_STRAP deep under its middle, over her shoulder
  const tank = raglan ? (sl.topFront + sl.topBack) / 2 - TANK_STRAP : Math.max(sl.topFront, sl.topBack) + TANK_OVER_CROWN;
  // a raglan cap midway between her shoulder point's level and the underarm corners (y = 0); a set-in's half its crown
  const cap = Math.min(Math.max(raglan ? sl.shoulderV / 2 : sl.topFront / 2, short + STOP_GAP), tank - STOP_GAP);
  const elbow = Math.max(Math.min(sl.shoulderV - (toElbow + ELBOW_PAST), short - STOP_GAP), wrist + 2 * STOP_GAP);
  const threeQuarter = Math.max(Math.min(sl.shoulderV - THREE_QUARTER * outside, elbow - STOP_GAP), wrist + STOP_GAP);
  const sleeve: Record<string, number> = { tank, cap, short, elbow, threeQuarter, wrist };
  return { lengthY: LENGTH_STOPS.map((x) => length[x.id]), sleeveY: SLEEVE_STOPS.map((x) => sleeve[x.id]) };
}

function prepare(t: CutSource): Prepared {
  const known = prepared.get(t.sewn);
  if (known) return known;
  const { sewn, draft, measure } = t;
  const pieces = draft.pattern.pieces, n = sewn.vertexParticle.length, runs: Run[] = [];
  for (let v = 0; v < n;) {
    const p = sewn.vertexPiece[v];
    let e = v + 1;
    while (e < n && sewn.vertexPiece[e] === p) e++;
    const piece = pieces[p], parent = EXTENSION_PARENT.get(piece.id) ?? piece.id;
    runs.push({ start: v, end: e, part: piece.role === 'torso' ? (parent === 'front' ? 'front' : 'back') : piece.role, extension: EXTENSION_PARENT.has(piece.id), id: piece.id });
    v = e;
  }
  const { lengthY, sleeveY } = stopLines(draft, measure);
  const shoulderV = draft.guide.sleeve.shoulderV;
  const stops: GarmentStops = {
    lengthY, sleeveLength: sleeveY.map((y) => shoulderV - y), hipY: measure.hip.y, kneeY: measure.kneeY,
    // her breasts' lower crease at her centre front
    neckDeepest: measure.neck.front[1] - measure.underbust.y,
  };
  const of = (part: Part) => runs.filter((r) => r.part === part);
  const out: Prepared = {
    n, front: of('front'), back: of('back'), sleeves: of('sleeve'), gussets: of('gusset'),
    neckRun: runs.find((r) => r.id === 'front') ?? null, lengthY, sleeveY, stops,
  };
  prepared.set(sewn, out);
  return out;
}

/** A cut line: a polyline whose x rise, in a piece's plane. */
interface Line { readonly x: Float64Array; readonly y: Float64Array }

/** A side seam's half-width at height y (its polyline's y rise), held at its ends; exactly a point's own x at its own height. */
function halfWidth(side: readonly Vec2[], y: number): number {
  const n = side.length;
  if (y <= side[0][1]) return side[0][0];
  if (y >= side[n - 1][1]) return side[n - 1][0];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (side[mid][1] <= y) lo = mid; else hi = mid; }
  const a = side[lo], b = side[hi];
  return y === a[1] ? a[0] : a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
}

/**
 * The LENGTH line of the front (back) pair at side height h: `hemOf`'s nodes, mirrored, level past the side seams. The
 * curve's rise is held under the gusset's lower corner, as CROP is, so no hem curve cuts a gusset either; and s is taken
 * across the half-width where the line meets the side seam (h, raised by the curve), so it meets the seam exactly there
 * -- her side seam narrows above her hip, and across the width at h a full curve would meet it a centimetre low.
 */
function hemLine(g: DraftGuide, side: 'front' | 'back', h: number, hem: number, curve: number): Line {
  const rise = Math.max(0, Math.min(curve * HEM_CURVE_RISE, g.sideTopY - CROP_CLEAR - h));
  const w = Math.max(1e-6, halfWidth(g.side[side], h + rise)), extra = Math.max(0, g.extra(side, h));
  const m = 2 * HEM_NODES + 3, x = new Float64Array(m), y = new Float64Array(m), c = HEM_NODES + 1;
  for (let k = HEM_NODES; k >= 0; k--) {
    const f = k / HEM_NODES, at = h - extra * (1 - f * f) - hem * (1 - f * f) + rise * (f * f * f * f);
    x[c - k] = -f * w; y[c - k] = at;
    x[c + k] = f * w; y[c + k] = at;
  }
  x[0] = -(w + FAR); y[0] = y[1]; x[m - 1] = w + FAR; y[m - 1] = y[m - 2];
  return { x, y };
}

/**
 * The NECKLINE's cut line, to the centre front at `vDeep` (a pattern height of the front): at each node of the drafted
 * neckline's half (`DraftGuide.frontNeck`), a U -- the drafted neckline let down by (its centre - vDeep) times a
 * quarter ellipse, the whole drop at the centre (level there) and none at the side end (where it falls straight) --
 * blended by `curve` toward a V, the drafted neckline or the straight line from its side end to the deep centre,
 * whichever is lower. Mirrored about the centre. (The U was a smooth step first, level at both ends: halfway across it
 * stood half as deep as at the centre, as the V does, and on her it read as a V.)
 */
function neckLine(half: readonly Vec2[], vDeep: number, curve: number): Line {
  const q = half.length, [uSide, vSide] = half[0], drop = half[q - 1][1] - vDeep;
  const x = new Float64Array(2 * q - 1), y = new Float64Array(2 * q - 1);
  for (let i = 0; i < q; i++) {
    const [u, v] = half[q - 1 - i], s = Math.min(1, u / uSide), step = Math.sqrt(Math.max(0, 1 - s * s));
    const U = v - drop * step, V = Math.min(v, vDeep + (vSide - vDeep) * s), at = U + curve * (V - U);
    x[q - 1 - i] = -u; y[q - 1 - i] = at;
    x[q - 1 + i] = u; y[q - 1 + i] = at;
  }
  return { x, y };
}

/** Squared distance from (px, py) to segment i of a line. */
function segment2(L: Line, i: number, px: number, py: number): number {
  const ax = L.x[i], ay = L.y[i], dx = L.x[i + 1] - ax, dy = L.y[i + 1] - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - ax - t * dx, ey = py - ay - t * dy;
  return ex * ex + ey * ey;
}

/**
 * Signed distance from (px, py) to a line: + on or above it, - below. The segment under px first, then outward each way
 * while a segment's box could still be nearer than the nearest found (its horizontal gap only grows outward).
 */
function signedDistance(L: Line, px: number, py: number): number {
  const X = L.x, Y = L.y, m = X.length;
  let j: number;
  if (px <= X[0]) j = 0;
  else if (px >= X[m - 1]) j = m - 2;
  else { let lo = 0, hi = m - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (X[mid] <= px) lo = mid; else hi = mid; } j = lo; }
  const span = X[j + 1] - X[j], f = span > 0 ? Math.max(0, Math.min(1, (px - X[j]) / span)) : 0, under = Y[j] + (Y[j + 1] - Y[j]) * f;
  let best = segment2(L, j, px, py);
  for (let i = j - 1; i >= 0; i--) {
    const gx = px - X[i + 1];
    if (gx * gx >= best) break;
    const lo = Y[i] < Y[i + 1] ? Y[i] : Y[i + 1], hi = Y[i] < Y[i + 1] ? Y[i + 1] : Y[i], gy = py < lo ? lo - py : py > hi ? py - hi : 0;
    if (gx * gx + gy * gy >= best) continue;
    const d = segment2(L, i, px, py);
    if (d < best) best = d;
  }
  for (let i = j + 1; i < m - 1; i++) {
    const gx = X[i] - px;
    if (gx * gx >= best) break;
    const lo = Y[i] < Y[i + 1] ? Y[i] : Y[i + 1], hi = Y[i] < Y[i + 1] ? Y[i + 1] : Y[i], gy = py < lo ? lo - py : py > hi ? py - hi : 0;
    if (gx * gx + gy * gy >= best) continue;
    const d = segment2(L, i, px, py);
    if (d < best) best = d;
  }
  const d = Math.sqrt(best);
  return py >= under ? d : -d;
}

/** A piece its line does not cross (to within WHOLE) reads +1 kept whole or -1 cut away whole. */
function whole(keep: Float32Array, r: Run): void {
  let lo = Infinity, hi = -Infinity;
  for (let v = r.start; v < r.end; v++) { const k = keep[v]; if (k < lo) lo = k; if (k > hi) hi = k; }
  if (lo >= -WHOLE) keep.fill(1, r.start, r.end);
  else if (hi <= WHOLE) keep.fill(-1, r.start, r.end);
}

/** The front's pattern height for her height H at her centre front: developed above the underarm line (`develop.ts`), down the hem rule's tape below it. */
function frontCentreV(draft: Draft, H: number): number {
  const g = draft.guide;
  return H >= g.underarmY ? draft.develop.front.v(0, H) + draft.notes.bustLift : H - Math.max(0, g.extra('front', H));
}

/** The cut for `settings`: see the file's head. */
export function garmentCuts(t: CutSource, settings: GarmentSettings = GARMENT_DEFAULTS): GarmentCuts {
  const P = prepare(t), s = settings, g = t.draft.guide, uv = t.sewn.uv;
  const keep = new Float32Array(P.n), neck = new Float32Array(P.n).fill(Infinity);

  // LENGTH: each pair on its own line, or exactly as drafted
  const h = stopValue(s.length, LENGTH_STOPS, P.lengthY);
  for (const side of ['front', 'back'] as const) {
    const runs = side === 'front' ? P.front : P.back, hem = side === 'front' ? s.frontHem : s.backHem;
    if (s.length === STANDARD_AT && hem === 0 && s.hemCurve === 0) {
      for (const r of runs) keep.fill(r.extension ? -1 : 1, r.start, r.end);
      continue;
    }
    const line = hemLine(g, side, h, hem, s.hemCurve);
    for (const r of runs) {
      for (let v = r.start; v < r.end; v++) keep[v] = signedDistance(line, uv[2 * v], uv[2 * v + 1]);
      whole(keep, r);
    }
  }

  // SLEEVE: level across both sleeves, or exactly as drafted. A gusset whole while the cut is under it; above, the half
  // sewn to the body, cut along its diagonal between the sleeve's underarm corners
  const yCut = stopValue(s.sleeve, SLEEVE_STOPS, P.sleeveY), short = s.sleeve === SHORT_AT;
  for (const r of P.sleeves) {
    if (short) { keep.fill(r.extension ? -1 : 1, r.start, r.end); continue; }
    for (let v = r.start; v < r.end; v++) keep[v] = uv[2 * v + 1] - yCut;
    whole(keep, r);
  }
  const gussetWhole = short || yCut <= -t.draft.notes.gussetSide - GUSSET_CLEAR;
  for (const r of P.gussets) {
    if (gussetWhole) { keep.fill(1, r.start, r.end); continue; }
    for (let v = r.start; v < r.end; v++) keep[v] = -uv[2 * v + 1];
  }

  // NECKLINE: only deeper than drafted, the front only
  const front = P.neckRun;
  if (front && s.neckDepth > draftedNeckDrop(s)) {
    const half = g.frontNeck, depth = Math.min(s.neckDepth, P.stops.neckDeepest);
    const vDeep = frontCentreV(t.draft, t.measure.neck.front[1] - depth);
    if (half[half.length - 1][1] - vDeep > 0) {
      const line = neckLine(half, vDeep, Math.max(0, Math.min(1, s.neckCurve))), uSide = half[0][0];
      for (let v = front.start; v < front.end; v++) {
        const u = uv[2 * v], sd = signedDistance(line, u, uv[2 * v + 1]);
        // under the line is kept; beside the neckline (past its side end) is the shoulder's, kept
        const d = Math.abs(u) > uSide ? Math.abs(sd) : -sd;
        neck[v] = d;
        if (d < keep[v]) keep[v] = d;
      }
    }
  }
  return { keep, neck };
}

/** Her landmarks for the instant controls, on this tee (see GarmentStops). */
export function garmentStops(t: CutSource): GarmentStops {
  return prepare(t).stops;
}
