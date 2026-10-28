/**
 * THE NEW TEE'S SETTINGS (Stage 3, Joshua 2026-10-28: "Good to do stage 3 now"): every control of the procedural tee
 * as one record -- what the OUTFIT tab shows, what a save keeps (never the mesh), what the room tailors and cuts from.
 *
 * Two kinds, as the Stage 1 plan has them (and the Stage 3 plan's changes to it):
 * - RE-TAILOR settings remake the pattern when a finger lets go (`tailorParams`, compared by `tailorKey`): the
 *   construction and gusset, the neckline's width and shape, the ease at her bust, waist and hip -- and the neckline's
 *   height while it is higher than the approved scoop (R2), since a cut cannot add cloth (`draftedNeckDrop`).
 * - INSTANT settings cut the finished tee while a finger drags (`cuts.ts`): its length, the front and back hems, the
 *   hem's curve, the sleeves' length, a neckline deeper than the scoop; and BELLY ROOM, a cut of the cloth's own lengths
 *   (`garmentCloth.ts`).
 * The tee is drafted once to its full extent (`TeeParams.extend`: to her knee and her wrists), and GARMENT_DEFAULTS is
 * exactly the tee approved in alpha.135.
 *
 * LENGTH and SLEEVE LENGTH are positions on her own landmarks (LENGTH_STOPS, SLEEVE_STOPS, 0..100), so a saved outfit
 * fits Sarah and Lena each as she is built; the hems, the neckline and the ease are metres. Pure: no three.js, no DOM.
 */
import { TEE_DEFAULTS, type SleeveConstruction, type TeeParams } from './draft';
import type { ClothTune } from '../sarahLabTool';

export type Construction = SleeveConstruction;

/** Ease round her (the garment's girth less hers), metres. */
export interface GarmentEase { readonly bust: number; readonly waist: number; readonly hip: number }

export interface GarmentSettings {
  // --- re-tailor: remade when let go ---
  readonly construction: Construction;
  /** 0 none .. 1 the largest gusset (draft.ts GUSSET_SIDE). */
  readonly gusset: number;
  /** The neckline's width at her shoulders, metres; null: the construction's own (CONSTRUCTION_DEFAULTS). */
  readonly neckWidth: number | null;
  /** The front neckline's shape, 0 U .. 1 V (`TeeParams.neckCurve`). */
  readonly neckCurve: number;
  /** BUST, WAIST and HIP FIT. */
  readonly ease: GarmentEase;
  // --- instant: cuts of the finished tee, as a finger drags ---
  /** LENGTH: a position on LENGTH_STOPS, 0 (crop) .. 100 (knee dress). */
  readonly length: number;
  /** FRONT HEM, BACK HEM: metres the hem is let down (+) or taken up (-) at the centre, tapering to nothing at the side seams. */
  readonly frontHem: number;
  readonly backHem: number;
  /** HEM CURVE: 0 level (as drafted) .. 1 a shirttail, the sides raised. */
  readonly hemCurve: number;
  /** SLEEVE LENGTH: a position on SLEEVE_STOPS, 0 (tank) .. 100 (wrist). */
  readonly sleeve: number;
  /**
   * NECKLINE DEPTH: how far under her front neck point the front neckline sits, metres, NECK_DEPTH_CREW (a crew neck)
   * up to her breasts' lower crease (`GarmentStops.neckDeepest`, which bounds it where it is used). Deeper than the
   * approved scoop (TEE_DEFAULTS.neckDrop) is a cut; higher is drafted (`draftedNeckDrop`).
   */
  readonly neckDepth: number;
  /**
   * BELLY ROOM: 0..1, the front cut for her belly at this share of 100% (`garmentCloth.ts`): smaller than that it hangs
   * loose in soft folds, bigger it fits as it does at 0.
   */
  readonly bellyRoom: number;
}

/** A crew neck: the shallowest NECKLINE DEPTH, metres under her front neck point. */
export const NECK_DEPTH_CREW = 0.01;
/** The deepest NECKLINE DEPTH a record may hold, metres (her own crease bounds it where it is used). */
export const NECK_DEPTH_MAX = 0.30;

/** Each construction's own gusset and neckline width (`teeParams`: R2 for the raglan, Stage 2's for a set-in). */
export const CONSTRUCTION_DEFAULTS: Readonly<Record<Construction, { readonly gusset: number; readonly neckWidth: number }>> = Object.freeze({
  raglan: Object.freeze({ gusset: TEE_DEFAULTS.gusset, neckWidth: TEE_DEFAULTS.neckWidth }),
  setIn: Object.freeze({ gusset: 0, neckWidth: 0.20 }),
});

/** A slider stop: its id, what the panel calls it, and where it sits on the slider (0..100). */
export interface GarmentStop { readonly id: string; readonly label: string; readonly at: number }

/** LENGTH's presets. Standard is the hem as drafted (her low hip), the default. */
export const LENGTH_STOPS: readonly GarmentStop[] = Object.freeze([
  { id: 'crop', label: 'Crop', at: 0 },
  { id: 'standard', label: 'Standard', at: 25 },
  { id: 'tunic', label: 'Tunic', at: 50 },
  { id: 'mini', label: 'Mini dress', at: 75 },
  { id: 'knee', label: 'Knee dress', at: 100 },
].map((s) => Object.freeze(s)));
/** SLEEVE LENGTH's presets. Short is the sleeve as drafted, the default. */
export const SLEEVE_STOPS: readonly GarmentStop[] = Object.freeze([
  { id: 'tank', label: 'Tank', at: 0 },
  { id: 'cap', label: 'Cap', at: 20 },
  { id: 'short', label: 'Short', at: 40 },
  { id: 'elbow', label: 'Elbow', at: 60 },
  { id: 'threeQuarter', label: 'Three-quarter', at: 80 },
  { id: 'wrist', label: 'Wrist', at: 100 },
].map((s) => Object.freeze(s)));

export const GARMENT_DEFAULTS: GarmentSettings = Object.freeze({
  construction: 'raglan',
  gusset: CONSTRUCTION_DEFAULTS.raglan.gusset,
  neckWidth: null,
  neckCurve: 0,
  ease: Object.freeze({ bust: TEE_DEFAULTS.ease.bust, waist: TEE_DEFAULTS.ease.waist, hip: TEE_DEFAULTS.ease.hip }),
  length: 25,
  frontHem: 0,
  backHem: 0,
  hemCurve: 0,
  sleeve: 40,
  neckDepth: TEE_DEFAULTS.neckDrop,
  bellyRoom: 0,
});

/** Each number's range, [min, max] (ease: each of bust, waist and hip). */
export const GARMENT_RANGES = Object.freeze({
  gusset: [0, 1], neckWidth: [0.18, 0.30], neckCurve: [0, 1], ease: [-0.02, 0.10],
  length: [0, 100], frontHem: [-0.08, 0.08], backHem: [-0.08, 0.08], hemCurve: [0, 1],
  sleeve: [0, 100], neckDepth: [NECK_DEPTH_CREW, NECK_DEPTH_MAX], bellyRoom: [0, 1],
} as const satisfies Record<string, readonly [number, number]>);

/** The settings that remake the pattern; every other one cuts the finished tee (and NECKLINE DEPTH both: `draftedNeckDrop`). */
export const RETAILOR_KEYS: readonly (keyof GarmentSettings)[] = Object.freeze(['construction', 'gusset', 'neckWidth', 'neckCurve', 'ease']);

/** Her landmarks for the instant controls, from the tee as tailored on her (`cuts.ts` garmentStops). */
export interface GarmentStops {
  /** Each LENGTH stop's hem at her side seams, metres above the floor, in LENGTH_STOPS order. */
  readonly lengthY: readonly number[];
  /**
   * Each SLEEVE stop's length from her shoulder point down the top of her arm, metres, in SLEEVE_STOPS order (a tank's
   * and a cap's are short or below 0: those sleeves end above her shoulder point).
   */
  readonly sleeveLength: readonly number[];
  /** Her hip line and her knee, metres above the floor. */
  readonly hipY: number;
  readonly kneeY: number;
  /** The deepest the neckline may be cut: her breasts' lower crease, metres under her front neck point. */
  readonly neckDeepest: number;
}

/** The saved form (`characterSaves.ts` SavedClothes.garment): the settings and the cloth dials it is worn with. */
export interface GarmentRecord {
  readonly version: typeof GARMENT_RECORD_VERSION;
  readonly settings: GarmentSettings;
  readonly dials: ClothTune;
}
export const GARMENT_RECORD_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clampTo = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/**
 * Settings from anything (a save, an imported file, a slider): known fields only, each number finite and within
 * GARMENT_RANGES, anything unreadable taken from `base`. Never throws.
 */
export function clampGarmentSettings(raw: unknown, base: GarmentSettings = GARMENT_DEFAULTS): GarmentSettings {
  const r = isRecord(raw) ? raw : {};
  const R = GARMENT_RANGES, e = isRecord(r.ease) ? r.ease : {};
  const construction: Construction = r.construction === 'raglan' || r.construction === 'setIn' ? r.construction : base.construction;
  return {
    construction,
    gusset: clampTo(r.gusset, R.gusset, base.gusset),
    // null is the construction's own; a number is clamped; anything else keeps the base's (which may be null)
    neckWidth: r.neckWidth === null ? null : typeof r.neckWidth === 'number' && Number.isFinite(r.neckWidth) ? clampTo(r.neckWidth, R.neckWidth, 0) : base.neckWidth,
    neckCurve: clampTo(r.neckCurve, R.neckCurve, base.neckCurve),
    ease: { bust: clampTo(e.bust, R.ease, base.ease.bust), waist: clampTo(e.waist, R.ease, base.ease.waist), hip: clampTo(e.hip, R.ease, base.ease.hip) },
    length: clampTo(r.length, R.length, base.length),
    frontHem: clampTo(r.frontHem, R.frontHem, base.frontHem),
    backHem: clampTo(r.backHem, R.backHem, base.backHem),
    hemCurve: clampTo(r.hemCurve, R.hemCurve, base.hemCurve),
    sleeve: clampTo(r.sleeve, R.sleeve, base.sleeve),
    neckDepth: clampTo(r.neckDepth, R.neckDepth, base.neckDepth),
    bellyRoom: clampTo(r.bellyRoom, R.bellyRoom, base.bellyRoom),
  };
}

/** The same settings in another construction, with that construction's own gusset and neckline width. */
export function withConstruction(s: GarmentSettings, construction: Construction): GarmentSettings {
  if (s.construction === construction) return s;
  return { ...s, construction, gusset: CONSTRUCTION_DEFAULTS[construction].gusset, neckWidth: null };
}

/** The neckline as drafted, metres under her front neck point: NECKLINE DEPTH while it is higher than the scoop, else the scoop (deeper is cut). */
export function draftedNeckDrop(s: GarmentSettings): number {
  return Math.min(s.neckDepth, TEE_DEFAULTS.neckDrop);
}

/** The draft's parameters for these settings (`teeParams` fills the rest): always the full extent. */
export function tailorParams(s: GarmentSettings): Partial<TeeParams> {
  return {
    construction: s.construction,
    gusset: s.gusset,
    ...(s.neckWidth !== null ? { neckWidth: s.neckWidth } : {}),
    neckCurve: s.neckCurve,
    neckDrop: draftedNeckDrop(s),
    ease: { ...TEE_DEFAULTS.ease, bust: s.ease.bust, waist: s.ease.waist, hip: s.ease.hip },
    extend: true,
  };
}

/** Equal for two settings that draft the same pattern (so moving an instant control never re-tailors). */
export function tailorKey(s: GarmentSettings): string {
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return JSON.stringify([s.construction, r(s.gusset), r(s.neckWidth ?? CONSTRUCTION_DEFAULTS[s.construction].neckWidth), r(s.neckCurve), r(draftedNeckDrop(s)), r(s.ease.bust), r(s.ease.waist), r(s.ease.hip)]);
}

/** Whether two settings are the same in every control (for "changed?"). */
export function sameGarment(a: GarmentSettings, b: GarmentSettings): boolean {
  return JSON.stringify(clampGarmentSettings(a)) === JSON.stringify(clampGarmentSettings(b));
}

/** The value at slider `position` on `stops` that stand at `values` (piecewise straight between stops, held at the ends). */
export function stopValue(position: number, stops: readonly GarmentStop[], values: readonly number[]): number {
  const n = Math.min(stops.length, values.length);
  if (n === 0) return NaN;
  const p = Number.isFinite(position) ? position : stops[0].at;
  if (p <= stops[0].at) return values[0];
  for (let i = 1; i < n; i++) {
    if (p <= stops[i].at) {
      const t = (p - stops[i - 1].at) / Math.max(1e-9, stops[i].at - stops[i - 1].at);
      return values[i - 1] + (values[i] - values[i - 1]) * t;
    }
  }
  return values[n - 1];
}

/** The stop nearest slider `position` (the first on a tie). */
export function nearestStop(position: number, stops: readonly GarmentStop[]): GarmentStop {
  let best = stops[0];
  for (const s of stops) if (Math.abs(s.at - position) < Math.abs(best.at - position)) best = s;
  return best;
}
