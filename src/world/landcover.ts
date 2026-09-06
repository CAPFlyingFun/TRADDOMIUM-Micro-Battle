/**
 * WHAT GROWS WHERE, FROM THE REAL ISLAND.
 *
 * ESA WorldCover 10 m, by way of Beyond Extinction's baked rasters and
 * v0's `scripts/bakeVeg.py`: three 384-square planes over the same 56 km
 * world square as the height grid — the land-cover CLASS, the tree
 * CANOPY cover, and the RIVER-corridor intensity. Measured over the
 * square: 54.3% water, 28.9% tree, 14.0% grass, 2.0% shrub, and a mean
 * canopy over land of 167 of 255. Kauaʻi is genuinely dense.
 *
 * ONE PIXEL IS 146 METRES, and that is the right coarseness for what it
 * decides. This says a neighbourhood is jungle rather than pasture; it
 * never says where an individual blade of grass stands. That is the
 * populator's own hash, which is deterministic and much finer.
 *
 * WHY THIS FILE READS THE RASTER TWO WAYS. v0 read it nearest-neighbour
 * only, on the argument that a class is a category and the average of
 * "tree" and "grass" is neither. True of the CLASS — and exactly wrong
 * for what a habitat needs from it, which is not "which single word
 * describes this 146 m square" but "how much of the ground here is
 * forest". Read nearest, a 146 m pixel boundary is a wall: pasture on
 * one side of a line nobody surveyed, jungle on the other, and the line
 * is visible from the air as a chequerboard. So `mixAt` returns the four
 * neighbouring pixels' classes as WEIGHTS, bilinearly blended, and the
 * populator lets the weights fade the forest into the pasture across the
 * pixel. `classAt` still answers the categorical question for anything
 * that genuinely wants one word.
 *
 * IT DOES NOT DECIDE WATER. The class has an 80 for it, but the island's
 * water comes from the heightfield (ground below sea level IS the sea,
 * `water/router.ts`) and the drainage (`water/islandChannels.ts`), at
 * metres rather than at 146 of them. Where the two disagree the ground
 * wins. The class's water weight is used only to keep vegetation off
 * lakes the heightfield cannot see.
 *
 * THE BINARY IS CARRIED FROM v0 VERBATIM. Its source PNGs live in the
 * Beyond Extinction repository, not here, so it cannot be re-baked from
 * this tree; `VEG_BYTES` and the class shares in the test are what pin
 * it to the file that shipped.
 *
 * Pure: no three, no DOM, no fetch. `assets/vegSource.ts` fetches; this
 * decodes and answers. `src/world/` is core.
 */
import { ISLAND_HALF_SPAN } from './dem';
import { ISLAND_SPAN, type WorldPoint } from './coords';

/**
 * `TMBV`, read the way the file is read — as the bytes T, M, B, V in
 * that order through a little-endian uint32. DERIVED FROM THE LETTERS,
 * not typed as a number: v0 typed `0x564d4254`, which is those bytes in
 * file order and exactly what a little-endian read does NOT return, and
 * its decoder threw on the real file for four days before anything
 * called it. The regression guard is a test that decodes the shipped
 * file itself.
 */
export const VEG_MAGIC = new DataView(new Uint8Array([0x54, 0x4d, 0x42, 0x56]).buffer).getUint32(0, true);
export const VEG_VERSION = 1;
export const VEG_HEADER_BYTES = 12;
/** Pixels a side. 56 km over 384 is 146 m a pixel. */
export const VEG_SIDE = 384;
/** What the bake wrote: header + three planes. The loading bar's honest maximum. */
export const VEG_BYTES = VEG_HEADER_BYTES + VEG_SIDE * VEG_SIDE * 3;

/** ESA WorldCover classes, as the legend numbers them. */
export const TREE = 10;
export const SHRUB = 20;
export const GRASS = 30;
export const CROP = 40;
export const BUILT = 50;
export const BARE = 60;
export const WATER = 80;
export const WETLAND = 90;
export const MANGROVE = 95;

/** The cover at one pixel, categorically. */
export interface Cover {
  /** The ESA class here. */
  readonly kind: number;
  /** Tree canopy cover, 0 to 1. */
  readonly canopy: number;
  /** River-corridor intensity, 0 to 1. */
  readonly river: number;
}

/**
 * The cover around a point as WEIGHTS that sum to one: how much of the
 * ground here the survey calls each thing. `canopy` and `river` are
 * blended the same way.
 *
 * `crop` and `built` are folded into `grass`: at ant scale a sugar-cane
 * field and a lawn behind a house are both grass, and Kauaʻi has no
 * pixel where either is common enough to argue about. `wetland` folds
 * in `mangrove` for the same reason.
 */
export interface CoverMix {
  readonly tree: number;
  readonly shrub: number;
  readonly grass: number;
  readonly bare: number;
  readonly water: number;
  readonly wetland: number;
  readonly canopy: number;
  readonly river: number;
}

/** What a mix reads as off the island: open sea. */
export const OPEN_SEA: CoverMix = Object.freeze({
  tree: 0, shrub: 0, grass: 0, bare: 0, water: 1, wetland: 0, canopy: 0, river: 0,
});

/** Pixel `i` sits at `-half + i * PIXEL`: sample 0 on the west/north edge, sample 383 on the east/south. */
const PIXEL = ISLAND_SPAN / (VEG_SIDE - 1);

export class Landcover {
  readonly side: number;
  private readonly kinds: Uint8Array;
  private readonly canopies: Uint8Array;
  private readonly rivers: Uint8Array;

  /**
   * Decode the baked rasters. Throws rather than half-reading them: a
   * truncated download is a file that says nothing, not one that says
   * the island is bare.
   */
  constructor(buffer: ArrayBuffer) {
    if (buffer.byteLength < VEG_HEADER_BYTES) {
      throw new Error(`kauai-veg.bin is ${buffer.byteLength} bytes, not a file`);
    }
    const head = new DataView(buffer);
    if (head.getUint32(0, true) !== VEG_MAGIC) {
      throw new Error('kauai-veg.bin does not start with TMBV');
    }
    const version = head.getUint16(4, true);
    if (version !== VEG_VERSION) {
      throw new Error(`kauai-veg.bin is version ${version}, expected ${VEG_VERSION}`);
    }
    const side = head.getUint32(8, true);
    if (side !== VEG_SIDE) {
      throw new Error(`kauai-veg.bin is ${side} pixels a side, expected ${VEG_SIDE}`);
    }
    const plane = side * side;
    if (buffer.byteLength !== VEG_HEADER_BYTES + plane * 3) {
      throw new Error(`kauai-veg.bin holds ${buffer.byteLength} bytes, not ${VEG_HEADER_BYTES + plane * 3}`);
    }
    this.side = side;
    // COPIED, not viewed: a view keeps the whole download alive and ties
    // three planes to one buffer somebody else may transfer away.
    this.kinds = new Uint8Array(buffer.slice(VEG_HEADER_BYTES, VEG_HEADER_BYTES + plane));
    this.canopies = new Uint8Array(buffer.slice(VEG_HEADER_BYTES + plane, VEG_HEADER_BYTES + plane * 2));
    this.rivers = new Uint8Array(buffer.slice(VEG_HEADER_BYTES + plane * 2, VEG_HEADER_BYTES + plane * 3));
  }

  /** One pixel, by column (east) and row (south). Out of range reads as open sea. */
  pixel(col: number, row: number): Cover {
    if (!(col >= 0 && col < this.side && row >= 0 && row < this.side)) {
      return { kind: WATER, canopy: 0, river: 0 };
    }
    const at = row * this.side + col;
    return { kind: this.kinds[at], canopy: this.canopies[at] / 255, river: this.rivers[at] / 255 };
  }

  /**
   * The class at a world point, NEAREST pixel: one word for the place.
   * Off the grid — which for a 56 km square means out at sea — reads as
   * water, so nothing grows there.
   */
  classAt(at: WorldPoint): Cover {
    const col = Math.round((at.wx + ISLAND_HALF_SPAN) / PIXEL);
    const row = Math.round((at.wz + ISLAND_HALF_SPAN) / PIXEL);
    return this.pixel(col, row);
  }

  /**
   * The cover around a world point as weights, bilinear over the four
   * pixels the point lies between. See the header for why a habitat
   * wants this and not `classAt`.
   */
  mixAt(at: WorldPoint): CoverMix {
    if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return OPEN_SEA;
    const fx = (at.wx + ISLAND_HALF_SPAN) / PIXEL;
    const fz = (at.wz + ISLAND_HALF_SPAN) / PIXEL;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fz);
    const tx = fx - c0;
    const tz = fz - r0;
    let tree = 0, shrub = 0, grass = 0, bare = 0, water = 0, wetland = 0, canopy = 0, river = 0;
    for (let dz = 0; dz <= 1; dz += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const w = (dx === 0 ? 1 - tx : tx) * (dz === 0 ? 1 - tz : tz);
        if (w === 0) continue;
        const p = this.pixel(c0 + dx, r0 + dz);
        switch (p.kind) {
          case TREE: tree += w; break;
          case SHRUB: shrub += w; break;
          case GRASS: case CROP: case BUILT: grass += w; break;
          case BARE: bare += w; break;
          case WETLAND: case MANGROVE: wetland += w; break;
          default: water += w; break;
        }
        canopy += w * p.canopy;
        river += w * p.river;
      }
    }
    return { tree, shrub, grass, bare, water, wetland, canopy, river };
  }

  /** How much of the whole raster is each class — what the test pins against the survey's own numbers. */
  shares(): Readonly<Record<number, number>> {
    const counts: Record<number, number> = {};
    for (let i = 0; i < this.kinds.length; i += 1) counts[this.kinds[i]] = (counts[this.kinds[i]] ?? 0) + 1;
    const shares: Record<number, number> = {};
    for (const key of Object.keys(counts)) shares[Number(key)] = counts[Number(key)] / this.kinds.length;
    return shares;
  }
}

/** Decode the baked rasters into a `Landcover`. */
export function decodeVeg(buffer: ArrayBuffer): Landcover {
  return new Landcover(buffer);
}
