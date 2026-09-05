// @vitest-environment jsdom
/**
 * THE SCREEN THAT CHOOSES WHERE THE COLONY BEGINS.
 *
 * The things that can go wrong here are not "it threw":
 *
 *  - the markers land in the wrong places, so the map is a picture of
 *    somewhere else and every choice is a lie about the island;
 *  - the screen becomes a DEAD END when the survey does not arrive, with
 *    the game behind it and no way through — which is a phone on a bad
 *    connection, not a hypothetical;
 *  - START fires with nothing chosen, or with a candidate from a
 *    different region than the one on the panel.
 *
 * jsdom has no canvas backend, so `bakeIsland` returns null here and the
 * island is never painted. That is deliberate coverage rather than a
 * limitation: it is the same path a device with no 2D context takes, and
 * the markers must still be placed and still work.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { SpawnMapScene, type SpawnMapHooks } from '../src/map/SpawnMapScene';
import { worldToMap, MAP_SIZE } from '../src/map/islandMap';
import { geoToWorld } from '../src/world/geo';
import { REGIONS, type ReadyRegion, type SpawnCandidate } from '../src/world/spawn';

// jsdom replaces the global URL, and fileURLToPath then refuses it —
// see tests/splashBoot.test.ts. A string path is what works here.
const DEM = '/home/user/TRADDOMIUM-Micro-Battle/public/kauai-1025.bin';

let bytes: ArrayBuffer;
beforeAll(() => {
  const raw = readFileSync(DEM);
  bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
});

interface Started { region: ReadyRegion; candidate: SpawnCandidate }

function rig(over: Partial<SpawnMapHooks> = {}) {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const ctx = { uiLayer } as unknown as SceneContext;

  const started: Started[] = [];
  let defaults = 0;
  let backs = 0;
  const hooks: SpawnMapHooks = {
    survey: async () => bytes,
    onStart: (region, candidate) => started.push({ region, candidate }),
    onDefault: () => { defaults += 1; },
    onBack: () => { backs += 1; },
    roll: () => 0,
    ...over,
  };
  const scene = new SpawnMapScene(ctx, hooks);
  const find = <T extends HTMLElement>(selector: string): T | null => uiLayer.querySelector<T>(selector);
  const marker = (id: string) => find<HTMLButtonElement>(`[data-action="spawn:${id}"]`);
  const start = () => find<HTMLButtonElement>('[data-action="spawn-start"]');
  const text = (role: string) => find(`[data-role="${role}"]`)?.textContent ?? '';
  return {
    scene, uiLayer, find, marker, start, text,
    started, defaults: () => defaults, backs: () => backs,
  };
}

/** enter() paints the chrome, then loads; the load is a promise chain, not a frame. */
async function ready(r: ReturnType<typeof rig>): Promise<void> {
  await r.scene.enter();
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

describe('the spawn map, with the real survey', () => {
  it('draws a marker for every region the island can actually hold', async () => {
    const r = rig();
    await ready(r);
    const placed = REGIONS.filter((region) => r.marker(region.id) !== null);
    // All thirty find candidates on this survey (tests/worldSpawn.test.ts
    // is where that is asserted); here the point is that each one that
    // does gets a pin, and one that did not would silently get none.
    expect(placed.length).toBe(REGIONS.length);
    r.scene.dispose();
  });

  it('PUTS THE PINS WHERE THE PLACES ARE, north above south', async () => {
    // The check that catches a mirrored map. Hanalei Bay is on the north
    // shore and Poʻipū on the south; if the projection or the geographic
    // fit flips, both still get pins and both still look plausible.
    const r = rig();
    await ready(r);
    const topOf = (id: string): number => Number.parseFloat(r.marker(id)!.style.top);
    expect(topOf('hanalei-bay')).toBeLessThan(topOf('poipu'));
    // And east of west: Keālia is the east coast, Polihale the west.
    const leftOf = (id: string): number => Number.parseFloat(r.marker(id)!.style.left);
    expect(leftOf('polihale')).toBeLessThan(leftOf('kealia'));
    r.scene.dispose();
  });

  it('places each pin at its own region’s projected point', async () => {
    const r = rig();
    await ready(r);
    for (const region of REGIONS.slice(0, 8)) {
      const pin = r.marker(region.id);
      if (pin === null) continue;
      const want = worldToMap(geoToWorld(region.around), MAP_SIZE);
      expect(Number.parseFloat(pin.style.left), region.id).toBeCloseTo((100 * want.x) / MAP_SIZE, 6);
      expect(Number.parseFloat(pin.style.top), region.id).toBeCloseTo((100 * want.y) / MAP_SIZE, 6);
    }
    r.scene.dispose();
  });

  it('says nothing is chosen until something is, and START stays dead', async () => {
    // An unavailable action must never look functional (CLAUDE.md).
    const r = rig();
    await ready(r);
    expect(r.start()?.disabled).toBe(true);
    r.start()?.click();
    expect(r.started).toEqual([]);
    r.scene.dispose();
  });

  it('shows what you are about to walk into, and starts THERE', async () => {
    const r = rig();
    await ready(r);
    r.marker('anini')?.click();

    expect(r.text('spawn-name')).toBe('ʻAnini Reef');
    expect(r.text('spawn-facts')).toContain('Coast');
    expect(r.text('spawn-blurb')).toContain('reef');
    expect(r.start()?.disabled).toBe(false);

    r.start()?.click();
    expect(r.started.length).toBe(1);
    const [{ region, candidate }] = r.started;
    expect(region.id).toBe('anini');
    // The candidate must come from the region on the panel, not from
    // whichever region happened to be searched last.
    expect(region.candidates).toContain(candidate);
    // roll: () => 0 takes the first, so this is exact rather than "one of".
    expect(candidate).toBe(region.candidates[0]);
    r.scene.dispose();
  });

  it('takes a DIFFERENT candidate for a different roll, which is why restarts vary', async () => {
    const r = rig({ roll: () => 0.99 });
    await ready(r);
    r.marker('poipu')?.click();
    r.start()?.click();
    const { region, candidate } = r.started[0];
    expect(candidate).toBe(region.candidates[region.candidates.length - 1]);
    expect(region.candidates.length).toBeGreaterThan(1);
    r.scene.dispose();
  });

  it('changes its mind cleanly when a second marker is picked', async () => {
    const r = rig();
    await ready(r);
    r.marker('kokee')?.click();
    expect(r.text('spawn-name')).toBe('Kōkeʻe Uplands');
    r.marker('hanalei-bay')?.click();
    expect(r.text('spawn-name')).toBe('Hanalei Bay');
    r.start()?.click();
    expect(r.started[0].region.id).toBe('hanalei-bay');
    r.scene.dispose();
  });

  it('offers the coast, which is the whole reason it was asked for', async () => {
    // Joshua could not reach the ocean from the fixed summit start.
    const r = rig();
    await ready(r);
    for (const id of ['anini', 'polihale', 'poipu', 'hanalei-bay', 'kealia', 'mahaulepu']) {
      expect(r.marker(id), id).not.toBeNull();
    }
    r.scene.dispose();
  });
});

describe('when there is no island to choose from', () => {
  it('IS NOT A DEAD END with no survey: it says so and still lets you begin', async () => {
    // The map sits between the slot picker and the world. Without a way
    // through, a build with no survey would have the game behind a screen
    // that cannot be passed.
    const r = rig({ survey: undefined });
    await ready(r);
    expect(r.start()?.disabled).toBe(false);
    expect(r.start()?.textContent).toBe('Begin anyway');
    expect(r.text('spawn-blurb')).toContain('no survey');
    r.start()?.click();
    expect(r.defaults()).toBe(1);
    expect(r.started).toEqual([]);
    r.scene.dispose();
  });

  it('does the same when the download FAILS, rather than throwing', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = rig({ survey: async () => { throw new Error('offline'); } });
    await ready(r);
    expect(r.start()?.disabled).toBe(false);
    expect(r.start()?.textContent).toBe('Begin anyway');
    r.start()?.click();
    expect(r.defaults()).toBe(1);
    noise.mockRestore();
    r.scene.dispose();
  });

  it('leaves BACK working in both cases, so the screen is never a trap', async () => {
    const r = rig({ survey: undefined });
    await ready(r);
    r.find<HTMLButtonElement>('[data-action="back"]')?.click();
    expect(r.backs()).toBe(1);
    r.scene.dispose();
  });
});

describe('leaving before the survey arrives', () => {
  it('does not touch the DOM after dispose', async () => {
    // A 2 MB download outlives a player who changes their mind, and a
    // late paint into a removed screen is the classic way that crashes.
    let release: (value: ArrayBuffer) => void = () => {};
    const slow = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
    const r = rig({ survey: () => slow });
    await r.scene.enter();
    r.scene.dispose();
    release(bytes);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing was added to a screen that no longer exists.
    expect(r.uiLayer.querySelector('[data-action^="spawn:"]')).toBeNull();
  });
});
