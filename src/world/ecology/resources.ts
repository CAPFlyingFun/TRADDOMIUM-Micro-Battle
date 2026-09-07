/**
 * WHAT THE ISLAND OFFERS TO EAT AND DRINK — the resource layer's contract.
 *
 * Joshua, 2026-09-07 (the ecology pass): "Begin giving the ecosystem
 * actual resources before the Queen arrives. Do NOT build the complete
 * ant survival economy yet. Establish a clean, extensible resource
 * layer." This file is that seam: the kinds a resource can be, what one
 * looks like, and the one query everything downstream asks.
 *
 * A RESOURCE IS DERIVED, NOT PLACED. Nectar is a flower's; sap is a tree's;
 * seeds are a grass head's; leaf litter is the forest floor's; a
 * honeydew host is a plant an aphid colony sits on. So the sites come
 * from the SAME deterministic population the objects come from
 * (`world/objects/populate.ts`) — a resource stands where its plant
 * stands, carries the plant's id where the plant has one, and is the
 * same resource for everyone — and the water comes from the water
 * system, never from a decorative pond: "Water is a WORLD SYSTEM, not an
 * object quota." A resource layer that invented its own puddles would be
 * the second copy of the water's truth.
 *
 * AMOUNTS ARE NOT SIMULATED YET. `amount` is a capacity and a rate the
 * species data can read; nothing depletes or regrows a site in this
 * milestone. The seam is shaped so that a later pass can (an aphid
 * colony's honeydew, a fruit that falls and rots), without changing what
 * a site IS.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import type { WorldPoint } from '../coords';
import type { HabitatKind } from '../habitat';

/** The kinds of thing an ant will one day eat or drink. Named in full now so a switch is exhaustive from the start. */
export type ResourceKind =
  | 'nectar'        // a flower: carbohydrate
  | 'seed'          // a grass or plant head: carbohydrate, carried
  | 'sap'           // a wound in a stem or trunk: carbohydrate
  | 'fruit'         // fallen fruit or a fragment, where the habitat has it
  | 'litter'        // decaying leaf matter: what a worm eats, and cover
  | 'honeydew-host' // a plant an aphid colony can sit on: honeydew LATER
  | 'carrion'       // a dead animal: protein, LATER
  | 'water-edge';   // an accessible edge of real fresh water

/** The kinds a site can offer TODAY. The rest are named, not offered (the honesty rule). */
export const OFFERED_KINDS: readonly ResourceKind[] = Object.freeze(['nectar', 'seed', 'sap', 'litter', 'honeydew-host', 'water-edge']);

export interface ResourceSite {
  /** `kind:cx,cz:site`, or the plant's own id where it has one — stable for the same world. */
  readonly id: string;
  readonly kind: ResourceKind;
  /** Where it is, on the plane. The height is the ground's, or the plant's, read by whoever draws or visits it. */
  readonly at: WorldPoint;
  /** Height above the ground it sits at, world units: a flower head's, a sap wound's; 0 for litter and water. */
  readonly above: number;
  /** How much it holds, in the kind's own unit (nectar µl, seeds, mm of water frontage…). A capacity, not a live level, yet. */
  readonly amount: number;
  /** The plant or object this belongs to, when it belongs to one (`tree:cx,cz:site`, `flower:cx,cz:site`). */
  readonly ownerId: string | null;
}

/**
 * One plant, as the resource layer needs to see it: enough to derive a
 * site from, no more. The objects' populator produces these; the layer
 * never reads a renderer.
 */
export interface PlantSource {
  readonly family: string;
  readonly at: WorldPoint;
  /** Size in world units (a blade's height, a tree's height, a flower's stem). */
  readonly size: number;
  /** The plant's stable id where its family carries one, else null. */
  readonly id: string | null;
  readonly variant: number;
}

/** The water, as the resource layer asks it: is there accessible fresh water here, and how far to its edge. */
export interface WaterQuery {
  /** Depth of standing fresh water at a point, world units; 0 where the ground is dry. Reads the water system, writes nothing. */
  freshDepthAt(at: WorldPoint): number;
  /** Whether the point is at sea. Salt is not a drink. */
  isSeaAt(at: WorldPoint): boolean;
}

/** Everything the resource layer reads. Read-only by construction: nothing here mutates the world. */
export interface EcologyWorld {
  habitatAt(at: WorldPoint): { readonly kind: HabitatKind; readonly wet: number; readonly forest: number; readonly grass: number };
  /** The plants of a cell, by cell address. Null for a cell that is not generated. */
  plantsOf(cx: number, cz: number): readonly PlantSource[] | null;
  readonly water: WaterQuery | null;
}

/** Cell-sized like the objects: resources are derived per 16 m cell and cached per cell. */
export interface CellResources {
  readonly cx: number;
  readonly cz: number;
  readonly sites: readonly ResourceSite[];
}
