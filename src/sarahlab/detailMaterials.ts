/**
 * HOW MUCH OF HER SHOWS THROUGH A FABRIC, BY WHAT THE FABRIC IS (Joshua, 2026-10-20: "I'd like the default visibility
 * to eventually depend on fabric thickness and garment structure, with manual sliders available as overrides. For
 * example, a structured padded bra could hide nearly all nipple detail, a sports bra might preserve around 50%, and an
 * unpadded swimsuit could preserve more").
 *
 * The table and the formula are his tracker's "Material Detail Formula" sheet (TRADDOMIUM Fabric & Clothing Tracker,
 * 2026-10-20), carried across as written. He calls them "calibration suggestions, not rigid physical rules", and so
 * are these: art-direction defaults, every number editable here and overridable on the panel.
 *
 * A paint layer's detail is one of three things:
 *   AUTO     -- from a material row: the garment's construction when its template has one (a sports bra, a swimsuit),
 *               otherwise the fabric family's own row; or a row picked by hand.
 *   OVERRIDE -- the two sliders, as set.
 *   OFF      -- her detail unchanged under the paint (100% / 100%).
 * It acts only where that layer's paint is (`bodyDetail.ts`, `fabricMaterial.ts`): never on bare skin, the bikini or
 * the approved body.
 *
 * Pure data and arithmetic.
 */
import type { DetailKeep } from './bodyDetail';
import { DEFAULT_KEEP } from './bodyDetail';
import type { FabricFamilyId } from './fabricLibrary';

export interface DetailMaterial {
  readonly id: string;
  readonly name: string;
  /** Relative thickness, 0 to 1. */
  readonly thickness: number;
  /** Structure, lining or padding, 0 to 1. */
  readonly structure: number;
  /** Base visibility, percent, before thickness and structure adjust it. */
  readonly breast: number;
  readonly navel: number;
  readonly note: string;
}

/** His sheet's rows, in his order. */
export const DETAIL_MATERIALS: readonly DetailMaterial[] = Object.freeze(([
  ['fineJersey', 'Fine jersey', 0.45, 0.1, 45, 80, 'Soft tee; medium default target'],
  ['athleticKnit', 'Athletic knit', 0.35, 0.25, 50, 85, 'Stretch knit; sports-style material'],
  ['chunkySweater', 'Chunky sweater', 0.85, 0.2, 15, 45, 'Thicker knit; details mostly bridged'],
  ['ribbedKnit', 'Ribbed knit', 0.55, 0.2, 35, 72, 'Ribbed material can accent surface'],
  ['sheerNylon', 'Sheer nylon', 0.1, 0, 85, 95, 'Opacity independently adjustable'],
  ['swimsuit', 'Swimsuit / bikini', 0.18, 0.1, 85, 95, 'Thin unpadded swimwear'],
  ['sportsBra', 'Sports bra', 0.5, 0.55, 50, 95, 'Intermediate support / structure'],
  ['structuredBra', 'Structured bra', 0.7, 0.95, 0, 100, 'Padding / lining; nipples hidden'],
  ['paintMedium', 'Body paint medium', 0.45, 0.2, 45, 80, 'The earlier default'],
  ['paintThin', 'Body paint thin', 0.2, 0, 70, 95, 'The earlier thin preset'],
  ['paintThick', 'Body paint thick', 0.85, 0.4, 20, 50, 'The earlier thick preset'],
] as const).map(([id, name, thickness, structure, breast, navel, note]) => Object.freeze({ id, name, thickness, structure, breast, navel, note })));

export const detailMaterial = (id: string): DetailMaterial | undefined => DETAIL_MATERIALS.find((m) => m.id === id);

/** Each fabric family's own row. */
export const FAMILY_MATERIAL: Readonly<Record<FabricFamilyId, string>> = Object.freeze({
  jersey: 'fineJersey', athletic: 'athleticKnit', sweater: 'chunkySweater', ribbed: 'ribbedKnit', pantyhose: 'sheerNylon',
});

/**
 * His formula: visibility = clamp(round(base - kT x (thickness - 0.45) - kS x (structure - 0.20)), 0, 100), with
 * kT 15 and kS 25 for the breast, 10 and 12 for the navel. The reference point (0.45, 0.20) is his medium paint.
 */
export const DETAIL_FORMULA = Object.freeze({
  thicknessRef: 0.45, structureRef: 0.2,
  breast: Object.freeze({ thickness: 15, structure: 25 }),
  navel: Object.freeze({ thickness: 10, structure: 12 }),
});

/** Spreadsheet ROUND: half away from zero, after shedding float dust (0.55 - 0.2 is 0.35000000000000003). */
const roundHalfAway = (x: number) => { const y = Number(x.toFixed(9)); return Math.sign(y) * Math.round(Math.abs(y)); };
const percent = (base: number, m: DetailMaterial, k: { readonly thickness: number; readonly structure: number }) =>
  Math.max(0, Math.min(100, roundHalfAway(base - k.thickness * (m.thickness - DETAIL_FORMULA.thicknessRef) - k.structure * (m.structure - DETAIL_FORMULA.structureRef))));

/** A material row's visibility, as fractions (0 hidden, 1 all of it). */
export function autoKeep(m: DetailMaterial): DetailKeep {
  return { nipple: percent(m.breast, m, DETAIL_FORMULA.breast) / 100, navel: percent(m.navel, m, DETAIL_FORMULA.navel) / 100 };
}

export type DetailMode = 'auto' | 'override' | 'off';
export interface LayerDetail {
  readonly mode: DetailMode;
  /** AUTO's row picked by hand; null takes it from the garment's construction, else the fabric family. */
  readonly material: string | null;
  /** OVERRIDE's values. */
  readonly override: DetailKeep;
}
export const DEFAULT_LAYER_DETAIL: LayerDetail = Object.freeze({ mode: 'auto', material: null, override: DEFAULT_KEEP });

export interface ResolvedDetail { readonly keep: DetailKeep; readonly material: DetailMaterial | null }
const ALL: DetailKeep = Object.freeze({ nipple: 1, navel: 1 });

/** What a layer's detail comes to, given its fabric family and its template's construction (if any). */
export function resolveDetail(d: LayerDetail, family: FabricFamilyId | null, construction: string | undefined): ResolvedDetail {
  if (d.mode === 'off') return { keep: ALL, material: null };
  if (d.mode === 'override') return { keep: d.override, material: null };
  const m = detailMaterial(d.material ?? construction ?? (family ? FAMILY_MATERIAL[family] : 'paintMedium')) ?? detailMaterial('paintMedium')!;
  return { keep: autoKeep(m), material: m };
}
