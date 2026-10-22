/**
 * JOSHUA'S FABRIC PACK (2026-10-20, "TRADDOMIUM Texture Pack v2"): five fabric families, each a plain atlas and a trim
 * atlas of sixteen colours, at full resolution (his note: "keep the full-resolution texture atlases for now, including
 * on mobile, unless testing shows a meaningful performance hit"). Served from `public/fabrics/`, one family's atlas
 * fetched only when that family is first chosen.
 *
 * A plain atlas is a 4 x 4 grid of swatches, a trim atlas sixteen strips top to bottom, both in the pack's colour
 * order. The pack's two hosiery files were the other way round (09 "plain" was the strips, 10 "trim" the grid); they
 * are stored here by what they are, so `pantyhose-plain.jpg` is the grid.
 *
 * Pure data and arithmetic: `fabricMaterial.ts` puts a swatch on a material, `fabricPanel.ts` is the editor.
 */

import type { LayerDetail } from './detailMaterials';
import type { CoverageParams } from './paintTemplates';
export type FabricLayout = 'grid' | 'strips';
export type FabricFamilyId = 'jersey' | 'athletic' | 'sweater' | 'ribbed' | 'pantyhose';

export interface FabricFamily {
  readonly id: FabricFamilyId;
  readonly name: string;
  /** Public paths: the main fabric (a grid) and its edging (strips). */
  readonly plain: string;
  readonly trim: string;
  /** How wide one swatch repeats on her, in centimetres, at stitch size 1x: what makes a knit read as its gauge. */
  readonly tileCm: number;
  /** Hosiery: see-through, by an amount the editor sets (his note: "adjustable transparency in code"). */
  readonly sheer: boolean;
  /** How matte it reads under light, 0 glossy to 1 flat: knits are matte, athletic knit and nylon have a soft sheen. */
  readonly roughness: number;
}

export const FABRIC_FAMILIES: readonly FabricFamily[] = Object.freeze(([
  { id: 'jersey', name: 'Jersey', plain: 'fabrics/jersey-plain.jpg', trim: 'fabrics/jersey-trim.jpg', tileCm: 3, sheer: false, roughness: 0.92 },
  { id: 'athletic', name: 'Athletic', plain: 'fabrics/athletic-plain.jpg', trim: 'fabrics/athletic-trim.jpg', tileCm: 5, sheer: false, roughness: 0.72 },
  { id: 'sweater', name: 'Sweater', plain: 'fabrics/sweater-plain.jpg', trim: 'fabrics/sweater-trim.jpg', tileCm: 10, sheer: false, roughness: 0.97 },
  { id: 'ribbed', name: 'Ribbed', plain: 'fabrics/ribbed-plain.jpg', trim: 'fabrics/ribbed-trim.jpg', tileCm: 8, sheer: false, roughness: 0.9 },
  { id: 'pantyhose', name: 'Pantyhose', plain: 'fabrics/pantyhose-plain.jpg', trim: 'fabrics/pantyhose-trim.jpg', tileCm: 3, sheer: true, roughness: 0.6 },
] as FabricFamily[]).map((f) => Object.freeze(f)));

export const fabricFamily = (id: FabricFamilyId): FabricFamily => FABRIC_FAMILIES.find((f) => f.id === id)!;

/** The pack's sixteen colours, in its order (README_FOR_CLAUDE.md, "Suggested color order"). */
export const FABRIC_COLOURS = Object.freeze([
  'White', 'Light gray', 'Medium gray', 'Dark gray', 'Black', 'Cream', 'Brown', 'Pink',
  'Red', 'Orange', 'Yellow', 'Olive', 'Green', 'Cyan', 'Blue', 'Purple',
]);
/** The hosiery set has no olive: its row runs green, mint, cyan. */
const HOSIERY_COLOURS = Object.freeze([...FABRIC_COLOURS.slice(0, 11), 'Green', 'Mint', 'Cyan', 'Blue', 'Purple']);
export const colourName = (family: FabricFamilyId, index: number): string => (family === 'pantyhose' ? HOSIERY_COLOURS : FABRIC_COLOURS)[index] ?? '';

/**
 * Each family's sixteen swatches as one colour, the average of its plain atlas cell (measured from the pack's files,
 * 2026-10-20): what the editor's colour buttons show before an atlas has been fetched.
 */
export const SWATCH_HEX: Readonly<Record<FabricFamilyId, readonly string[]>> = Object.freeze({
  jersey: Object.freeze(['#cfd1d2', '#999ea3', '#65676f', '#37383e', '#191b1e', '#b59d83', '#5b3d2b', '#852d31', '#a6221b', '#c7642d', '#d9ba44', '#4e642e', '#247842', '#238592', '#1144a1', '#532191']),
  athletic: Object.freeze(['#ededee', '#a7a8af', '#605f68', '#2d2d33', '#101016', '#e0be95', '#562a18', '#c80e25', '#d60a07', '#f0530e', '#f4d90b', '#3b6921', '#158a42', '#0ea6d4', '#1824cd', '#540cd0']),
  sweater: Object.freeze(['#dfdedc', '#a0a3aa', '#66656e', '#2d2f37', '#18191f', '#d2b291', '#623823', '#b4152b', '#c40909', '#e85810', '#eec415', '#466e26', '#0b7e3a', '#0994b3', '#1231b9', '#5e10b6']),
  ribbed: Object.freeze(['#e4e3e3', '#9c9ca3', '#56545b', '#2a292f', '#1a191d', '#deb88b', '#693722', '#c3182c', '#ca0b0a', '#e85210', '#efcf19', '#456e28', '#148d46', '#0babcf', '#1631bc', '#5f11bd']),
  pantyhose: Object.freeze(['#ece5df', '#acaab0', '#6c6b70', '#323035', '#141416', '#dea285', '#7c5248', '#ef2a7b', '#d91914', '#f26411', '#f5d217', '#0e8551', '#65dfb0', '#11b8f1', '#2431e5', '#5c21dd']),
});

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * Where colour `index` sits in an atlas `size` pixels square. A grid cell is inset a few pixels so no neighbour bleeds
 * in at its edge; a strip keeps its middle band, the knit without the stitched edges that make it trim.
 */
export function swatchRect(layout: FabricLayout, index: number, size: number): Rect {
  const i = Math.max(0, Math.min(15, Math.floor(index)));
  if (layout === 'grid') {
    const cell = size / 4, inset = Math.round(cell * 0.015);
    return { x: Math.round((i % 4) * cell) + inset, y: Math.round(Math.floor(i / 4) * cell) + inset, w: Math.round(cell) - 2 * inset, h: Math.round(cell) - 2 * inset };
  }
  const strip = size / 16;
  return { x: 0, y: Math.round(i * strip + strip * 0.3), w: size, h: Math.max(1, Math.round(strip * 0.4)) };
}

/** What a choice is: a family's colour, or nothing (the garment's own material). */
export interface FabricPick { readonly family: FabricFamilyId; readonly colour: number }

export interface FabricChoice {
  readonly fabric: FabricPick | null;
  /** Trim follows the fabric (MATCH) or has its own pick. */
  readonly match: boolean;
  readonly trim: FabricPick | null;
  /** Multiplies the family's repeat: 0.5 finer stitches, 2 coarser. The swatch keeps its own proportions. */
  readonly stitch: number;
  /** 1 opaque; lower is see-through on a garment, a lighter coat when painted on. Null: the family's own default. */
  readonly opacity: number | null;
}

export const DEFAULT_CHOICE: FabricChoice = Object.freeze({ fabric: null, match: true, trim: null, stitch: 1, opacity: null });
export const STITCH_RANGE = Object.freeze({ min: 0.5, max: 2, step: 0.05 });
export const OPACITY_RANGE = Object.freeze({ min: 0.1, max: 1, step: 0.05 });
/** Hosiery starts half see-through (his note: "start around 50% opacity"); everything else opaque. */
export const opacityOf = (choice: FabricChoice): number => choice.opacity ?? (choice.fabric && fabricFamily(choice.fabric.family).sheer ? 0.5 : 1);

/** The trim a choice dresses the edging in: the fabric's own colour from the family's trim atlas while matched. */
export function trimPick(choice: FabricChoice): FabricPick | null {
  return choice.match ? choice.fabric : choice.trim;
}

/**
 * PAINTED ON (Joshua, 2026-10-19: "clothing needs to sit over the body, and/or be painted on"; 2026-10-20: paint is
 * "a separate, editable paint layer" with a brush and an eraser). A FILL lays one garment's footprint at once: the
 * body carries, at every vertex, which of the original garments covers it (`_cloth_cover`, the bits of `coverMask`).
 */
export interface PaintFill { readonly id: string; readonly name: string; readonly bits: number }
export const PAINT_FILLS: readonly PaintFill[] = Object.freeze([
  { id: 'top', name: 'TEE', bits: 1 << 0 },
  { id: 'leggings', name: 'HIGH LEGGINGS', bits: 1 << 1 },
  { id: 'leggingsLow', name: 'LOW LEGGINGS', bits: 1 << 5 },
].map((a) => Object.freeze(a)));
export const PAINT_LAYER_NAMES = Object.freeze(['Paint layer 1', 'Paint layer 2', 'Paint layer 3']);

export type FabricMode = 'garment' | 'paint';
export type PaintTool = 'brush' | 'erase' | 'region' | 'orbit';

/** Centimetres of repeat to the material's own units: `unitsPerCm` is how many of the mesh's local units make 1 cm. */
export const tileUnits = (family: FabricFamily, stitch: number, unitsPerCm: number): number => family.tileCm * stitch * unitsPerCm;

/**
 * AN OUTFIT AS DATA (Joshua, 2026-10-20: "save, load, duplicate, and reuse these outfits for Sarah, Lena, and other
 * characters sharing the female base model... a lightweight configuration format such as JSON"). Not yet saved
 * anywhere; this is the shape a preset manager will store. Meshes and textures stay in their own files: an outfit
 * names them by id. A paint layer's mask is one byte a vertex of the shared base body, base64.
 */
export interface OutfitConfig {
  readonly version: 1;
  /** The base model the paint masks were made on (they are per vertex of it). */
  readonly base: string;
  readonly outfit: string;
  readonly garments: Readonly<Record<string, FabricChoice>>;
  /**
   * Each paint layer: its fabric, its detail through paint (AUTO / OVERRIDE / OFF, `detailMaterials.ts`), the template
   * it came from with its dial settings (null once painted by hand), and its mask.
   */
  readonly paint: readonly { readonly choice: FabricChoice; readonly detail: LayerDetail; readonly template: { readonly id: string; readonly params: CoverageParams } | null; readonly mask: string }[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(text: string): Uint8Array {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
