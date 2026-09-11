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

/**
 * The kinds of thing an ant will one day eat or drink. Named in full now
 * so a switch is exhaustive from the start.
 *
 * Each line names the UNIT `amount` is counted in and what `above` means
 * for the kind, because a number without its unit is the seed of the
 * next "is this metres or centimetres" bug. The rules that produce them
 * are in `derive.ts`; the units are pinned here so that a consumer that
 * reads only this file reads the right ones.
 */
export type ResourceKind =
  | 'nectar'        // a flower: carbohydrate. amount µl; above = the flower head's height (the plant's size)
  | 'seed'          // a grass or plant head: carbohydrate, carried. amount = seeds; above = the head's height
  | 'sap'           // a wound in a stem or trunk: carbohydrate. amount µl; above = the wound's height on the trunk
  | 'fruit'         // fallen fruit or a fragment, where the habitat has it. LATER
  | 'litter'        // decaying leaf matter: what a worm eats, and cover. amount cm² of cover; above 0
  | 'honeydew-host' // a plant an aphid colony can sit on: honeydew LATER. amount = cm of stem; above = where the colony sits
  | 'carrion'       // a dead animal: protein. LATER
  | 'water-edge';   // an accessible edge of real fresh water. amount mm of frontage; above 0

/** Every kind, in the union's order — the shape a per-kind count is built over. */
export const RESOURCE_KINDS: readonly ResourceKind[] = Object.freeze([
  'nectar', 'seed', 'sap', 'fruit', 'litter', 'honeydew-host', 'carrion', 'water-edge',
]);

/** The kinds a site can offer TODAY. The rest are named, not offered (the honesty rule). */
export const OFFERED_KINDS: readonly ResourceKind[] = Object.freeze(['nectar', 'seed', 'sap', 'litter', 'honeydew-host', 'water-edge']);

/**
 * The plant families an aphid colony can sit on — the families that get a
 * `honeydew-host` site. The SAME list as the aphid's `population.hosts`
 * in `creatures/species.ts`, and a test holds the two together: a host
 * the creatures place an aphid on that the resource layer does not name
 * would be an aphid feeding on nothing. Families are strings because the
 * plant families are a sibling module's and arrive in parallel; the
 * layer matches names, never imports the table.
 */
export const HONEYDEW_HOST_FAMILIES: readonly string[] = Object.freeze(['shrub', 'broadleaf', 'flower', 'fern', 'grass', 'tree']);

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
  /**
   * Shape inputs shared with the object renderer. They are optional so a
   * source saved before plant attachment existed remains a valid source; the
   * surface helper supplies the same family defaults in that case.
   */
  readonly girth?: number;
  readonly spin?: number;
  readonly lean?: number;
  readonly leanDir?: number;
}

/** The nearest edge of fresh water to a point: where it is, and how far, world units on the plane. */
export interface NearestWater {
  readonly at: WorldPoint;
  readonly distance: number;
}

/** The water, as the resource layer asks it: is there accessible fresh water here, and how far to its edge. */
export interface WaterQuery {
  /** Depth of standing fresh water at a point, world units; 0 where the ground is dry. Reads the water system, writes nothing. */
  freshDepthAt(at: WorldPoint): number;
  /** Whether the point is at sea. Salt is not a drink. */
  isSeaAt(at: WorldPoint): boolean;
  /**
   * The nearest point on a fresh-water shoreline within `radius` world
   * units of `at`, else null — which is also the answer where the water
   * system keeps no shoreline, so a creature asking a router that has
   * none is told "none in reach", not handed a second code path.
   *
   * The edge, not the depth underfoot: an animal that wants to know
   * whether the flood is coming asks this, and asks it again, and reads
   * the difference (`creatures/intent.ts`, `senseFlood`).
   */
  nearestWater(at: WorldPoint, radius: number): NearestWater | null;
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
