/**
 * THE ONE QUESTION EVERYTHING ASKS THE WATER — "what is here, and which
 * way is it going" — and the two owners who may answer it.
 *
 * Wading, drinking, the underwater look, the camera and the HUD all
 * need the same reading, and none of them should hold the sea or the
 * river window: a dev tool has no island, a test has no scene, and the
 * world replaces its water across a reload. They ask the router, and
 * they handle `null` — which is also exactly what "the water has not
 * loaded yet" looks like, so there is no second code path for it.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE, from `docs/research/
 * WATER_SYSTEM_AUDIT.md` §13 B1-B2 and §15. In v0 the router was ten
 * lines inside the FRESH water window's constructor, and the sea's
 * branch body lived there with it. Three things followed, and the audit
 * found all three:
 *
 *  - Disposing the river window UN-REGISTERED THE SEA. The audit lists
 *    it as latent only because the world happened to build its water
 *    once per scene. It is listed as "should be fresh-only".
 *  - The ocean's gameplay query was reached from a fresh-owned closure,
 *    so a fresh-side edit could move the ocean. That is not
 *    hypothetical: §12's table has a column for it, and the live leak
 *    it names — the swell chunks reaching the fresh shader — is the
 *    same shape.
 *  - `WaterSpot.salt` was an OPTIONAL boolean. Optional means a
 *    consumer that forgets it reads fresh-water behaviour in the sea
 *    and nothing complains; F12 is exactly that, a flag "delivered but
 *    unread".
 *
 * So: `kind` is REQUIRED, and each source is typed to the kind it may
 * produce. Handing the river window to `useSea` is a compile error
 * rather than a bug report. That is the whole of the audit's
 * recommendation, and it costs one type parameter.
 *
 * SEPARATE OWNERSHIP, SHARED INTERFACE — not two water engines. The
 * router classifies and delegates; it computes no water of its own, and
 * neither side can see or unregister the other.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core.
 */
import { SEA_LEVEL } from '../heightfield';
import type { WorldPoint } from '../coords';

/**
 * Which water this is.
 *
 * REQUIRED, not an optional `salt?: boolean`. See the header: the
 * optional version is a flag consumers forget, and forgetting it means
 * treating the Pacific as a pond.
 */
export type WaterKind = 'fresh' | 'sea';

export interface WaterSpot {
  /** Which owner answered. Floats her the same; drinks like neither the other. */
  readonly kind: WaterKind;
  /**
   * How high the water's surface stands above mean sea level, world
   * units. A crest is positive.
   *
   * CARRIED IN THE ANSWER rather than left to the caller to re-derive.
   * v0 returned only `depth`, so anything that needed the surface
   * height — the camera's water line, the underwater tint, a probe —
   * had to find the bed and add it back, which is asking the same
   * question twice and risking two answers. The audit's F15 is that
   * failure with a name: a probe hook that "silently validates the
   * wrong surface" offshore.
   */
  readonly surface: number;
  /** Water over the bed at this point, world units. Always > 0 where a spot exists. */
  readonly depth: number;
  /** The current at the surface, world units a second. */
  readonly flowX: number;
  readonly flowZ: number;
}

/**
 * Somewhere water comes from. Typed to the ONE kind it may answer with,
 * so the two owners cannot be swapped by accident.
 */
export interface WaterSource<K extends WaterKind> {
  spotAt(at: WorldPoint): (WaterSpot & { readonly kind: K }) | null;
}

export class WaterRouter {
  private sea: WaterSource<'sea'> | null = null;
  private fresh: WaterSource<'fresh'> | null = null;

  constructor(
    /** The BED — the ground under the water, in world units from MSL. */
    private readonly groundAt: (at: WorldPoint) => number,
  ) {}

  /**
   * Register the sea. Only the sea's owner calls this, and only the sea
   * is removed by `useSea(null)`.
   */
  useSea(source: WaterSource<'sea'> | null): void {
    this.sea = source;
  }

  /** Register the inland water. Disposing it cannot take the ocean with it. */
  useFresh(source: WaterSource<'fresh'> | null): void {
    this.fresh = source;
  }

  hasSea(): boolean {
    return this.sea !== null;
  }

  hasFresh(): boolean {
    return this.fresh !== null;
  }

  /**
   * The water at a world point, or null where there is none — and none
   * yet is the same answer, deliberately.
   *
   * THE CLASSIFICATION IS THE BED, and on this island that is sound
   * rather than convenient: `tests/worldWaterline.test.ts` measured all
   * 17.9 million samples of the survey and found no ground below mean
   * sea level that the ocean does not reach, which is the assumption
   * `ground < 0 means sea` rests on. Hawaiʻi has no Dead Sea. If a
   * world ever does, this is the one line that has to learn about it,
   * because it is the only place the question is asked.
   */
  spotAt(at: WorldPoint): WaterSpot | null {
    return this.groundAt(at) < SEA_LEVEL ? this.sea?.spotAt(at) ?? null : this.fresh?.spotAt(at) ?? null;
  }
}
