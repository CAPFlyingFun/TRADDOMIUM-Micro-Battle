/**
 * TWO OWNERS, AND NEITHER CAN REACH THE OTHER.
 *
 * `docs/research/WATER_SYSTEM_AUDIT.md` §13 B1-B2 and §15 name the
 * router as the first piece of architecture cleanup the water needs,
 * and `docs/ARCHITECTURE.md` puts it in Phase 3 "from day one" — before
 * there is a second owner to get it wrong, rather than after.
 *
 * The audit's three findings are three tests here:
 *
 *  1. Disposing the FRESH window un-registered the sea (§13 B1). The
 *     ocean is not the river window's to remove.
 *  2. The sea's query lived in fresh-owned code, so a fresh-side edit
 *     could move the ocean (§12's coupling table).
 *  3. `WaterSpot.salt` was an OPTIONAL boolean, so a consumer that
 *     forgot it read pond behaviour in the Pacific (F12, "delivered but
 *     unread").
 *
 * The third is mostly the type system's job now, and a test cannot
 * assert a compile error — so what is asserted here is the runtime half
 * of it: every spot that comes out carries a kind, and the kind is the
 * one whose owner produced it.
 */
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { SEA_LEVEL } from '../src/world/heightfield';
import { SeaSurf } from '../src/world/sea/surf';
import { KEEL, SeaSwell } from '../src/world/sea/swell';
import { SeaWater } from '../src/world/sea/water';
import { WaterRouter, type WaterSource, type WaterSpot } from '../src/world/water/router';

/** A beach rising toward -x: sea for wx > 0, land for wx < 0. */
const SLOPE = 0.02;
const bed = (at: WorldPoint): number => -at.wx * SLOPE;
const atDepth = (depth: number): WorldPoint => world(depth / SLOPE, 0);
const ashore = world(-100_000, 0);

/** A stand-in river window that counts what it was asked. */
class FakeFresh implements WaterSource<'fresh'> {
  asked = 0;
  constructor(private readonly depth = 12) {}
  spotAt(): (WaterSpot & { readonly kind: 'fresh' }) | null {
    this.asked += 1;
    return { kind: 'fresh', surface: 0, depth: this.depth, flowX: 1, flowZ: 0 };
  }
}

const seaOf = (): { swell: SeaSwell; sea: SeaWater } => {
  const swell = new SeaSwell({ groundAt: bed });
  return { swell, sea: new SeaWater(swell, new SeaSurf(swell)) };
};

describe('the router classifies by the bed and delegates', () => {
  it('sends water below sea level to the sea and water above it to the river', () => {
    const router = new WaterRouter(bed);
    const fresh = new FakeFresh();
    router.useSea(seaOf().sea);
    router.useFresh(fresh);
    expect(router.spotAt(atDepth(400))?.kind).toBe('sea');
    expect(router.spotAt(ashore)?.kind).toBe('fresh');
    // And each owner was asked exactly once, for its own side only.
    expect(fresh.asked).toBe(1);
  });

  it('computes no water of its own — an unregistered side answers null', () => {
    // "None here" and "not loaded yet" are the same answer on purpose:
    // there is no second code path for a world that is still loading.
    const router = new WaterRouter(bed);
    expect(router.spotAt(atDepth(400))).toBeNull();
    expect(router.spotAt(ashore)).toBeNull();
    expect(router.hasSea()).toBe(false);
    expect(router.hasFresh()).toBe(false);
  });

  it('classifies on the bed, not on whether a source happens to exist', () => {
    // The trap: with only the fresh window registered, a naive router
    // that falls through would hand out pond readings in the Pacific.
    const router = new WaterRouter(bed);
    router.useFresh(new FakeFresh());
    expect(router.spotAt(atDepth(400))).toBeNull();
    expect(router.spotAt(ashore)?.kind).toBe('fresh');
  });
});

describe('neither owner can remove the other', () => {
  it('keeps the ocean when the river window is disposed — the v0 defect', () => {
    // §13 B1: in v0 the router lived in IslandWater's constructor, so
    // `IslandWater.dispose()` un-registered the sea. The audit calls it
    // latent only because the world built its water once per scene.
    const router = new WaterRouter(bed);
    router.useSea(seaOf().sea);
    router.useFresh(new FakeFresh());

    router.useFresh(null);

    expect(router.hasFresh()).toBe(false);
    expect(router.hasSea()).toBe(true);
    expect(router.spotAt(atDepth(400))?.kind).toBe('sea');
    expect(router.spotAt(ashore)).toBeNull();
  });

  it('keeps the river when the ocean is disposed', () => {
    const router = new WaterRouter(bed);
    router.useSea(seaOf().sea);
    router.useFresh(new FakeFresh());

    router.useSea(null);

    expect(router.hasSea()).toBe(false);
    expect(router.spotAt(ashore)?.kind).toBe('fresh');
    expect(router.spotAt(atDepth(400))).toBeNull();
  });

  it('never asks the fresh side about the sea, so a fresh edit cannot move the ocean', () => {
    // §12's coupling table: in v0 the ocean's gameplay query was
    // reached from a fresh-owned closure. Here the fresh source is
    // never even consulted below sea level.
    const router = new WaterRouter(bed);
    const fresh = new FakeFresh();
    router.useSea(seaOf().sea);
    router.useFresh(fresh);
    for (const depth of [10, 100, 1000, 10_000]) router.spotAt(atDepth(depth));
    expect(fresh.asked).toBe(0);
  });
});

describe('the kind is required, and it is the owner’s', () => {
  it('stamps every spot with the owner that produced it', () => {
    const router = new WaterRouter(bed);
    router.useSea(seaOf().sea);
    router.useFresh(new FakeFresh());
    // F12 was a flag delivered and not read. A required discriminant is
    // read by the type system whether the consumer remembers or not;
    // what a test can still check is that it is never absent.
    for (const at of [atDepth(30), atDepth(4000), ashore]) {
      const spot = router.spotAt(at);
      expect(spot).not.toBeNull();
      expect(spot!.kind === 'fresh' || spot!.kind === 'sea').toBe(true);
    }
    expect(router.spotAt(atDepth(4000))!.kind).toBe('sea');
    expect(router.spotAt(ashore)!.kind).toBe('fresh');
  });
});

describe('the sea answers for itself', () => {
  it('reports the surface as well as the depth, so nobody re-derives it', () => {
    // v0 returned depth alone, and anything wanting the water line had
    // to find the bed and add it back — the same question asked twice.
    // F15 is that mistake with a name.
    const { swell, sea } = seaOf();
    swell.tick(0.4);
    const at = atDepth(400);
    const spot = sea.spotAt(at)!;
    expect(spot.surface).toBeCloseTo(swell.heightAt(at, 400), 9);
    expect(spot.depth).toBeCloseTo(400 + spot.surface, 9);
    // The surface really does move, or the assertion above is vacuous.
    expect(Math.abs(spot.surface)).toBeGreaterThan(0.01);
  });

  it('carries the sea’s own current, not a flat zero', () => {
    // The whole reason surf.ts exists: v0's salt branch answered
    // flowX: 0, flowZ: 0, and a queen floating in it never went
    // anywhere.
    const { swell, sea } = seaOf();
    let peak = 0;
    for (let i = 0; i < 200; i += 1) {
      swell.tick(1 / 60);
      const spot = sea.spotAt(atDepth(30))!;
      peak = Math.max(peak, Math.hypot(spot.flowX, spot.flowZ));
    }
    // Her paddle afloat is 2.6 units a second.
    expect(peak).toBeGreaterThan(50);
  });

  it('never hands out a depth the trough has cut below the bed — the KEEL, pinned at the seam', () => {
    // WHY THIS TEST IS HERE AND NOT IN THE SWELL'S FILE. `SeaWater`
    // returns `stillDepth + surface` with no guard, because the swell
    // clamps its own trough (`swell.ts`: max(y * shoal, -(depth - KEEL)))
    // and a negative depth is therefore impossible. That is a real
    // invariant and it belongs to a DIFFERENT module — so this is the
    // seam where its removal would first hurt, and this is where it is
    // pinned. Take the keel out and this fails, instead of a negative
    // depth reaching wading.
    //
    // Swept under a deliberately hostile peak source as well as the
    // shipped one: `setPeakSource` exists so a sea running two wave
    // generations can under-report its peak mid-crossfade, and
    // under-reporting is what lets the breaker envelope grow past the
    // depth. The keel is what still holds.
    for (const peak of [null, 5, 1]) {
      const { swell, sea } = seaOf();
      if (peak !== null) swell.setPeakSource(() => peak);
      for (let i = 0; i < 300; i += 1) {
        swell.tick(1 / 60);
        for (const still of [0.02, 1, 3, 5, 8, 12, 20, 30, 45, 60, 100]) {
          const at = world(still / SLOPE, i * 13);
          const spot = sea.spotAt(at);
          expect(spot, `peak ${peak}, ${still} units of still water`).not.toBeNull();
          expect(spot!.depth, `peak ${peak}, ${still} units of still water`)
            .toBeGreaterThanOrEqual(Math.min(still, KEEL) - 1e-9);
        }
      }
    }
  });

  it('lets the sea reach the keel and no further, so the clamp is doing work', () => {
    // The assertion above would also pass if the surface never swung at
    // all. It swings: under an under-reported peak the trough is driven
    // hard onto the keel and sits exactly there.
    const { swell, sea } = seaOf();
    swell.setPeakSource(() => 1);
    const at = world(30 / SLOPE, 0);
    let thinnest = Infinity;
    let deepest = 0;
    for (let i = 0; i < 600; i += 1) {
      swell.tick(1 / 60);
      const spot = sea.spotAt(at)!;
      thinnest = Math.min(thinnest, spot.depth);
      deepest = Math.max(deepest, spot.depth);
    }
    expect(thinnest).toBeCloseTo(KEEL, 6);
    // And the crest side is not clamped — the water really is moving.
    expect(deepest).toBeGreaterThan(30);
  });

  it('is null on dry land, whatever the router would have done', () => {
    // The router does not ask above the datum, but the sea does not
    // rely on that: asked directly, it declines.
    const { sea } = seaOf();
    expect(sea.spotAt(ashore)).toBeNull();
    expect(SEA_LEVEL).toBe(0);
  });
});
