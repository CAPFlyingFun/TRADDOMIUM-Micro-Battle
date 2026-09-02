/**
 * NO FRAME PAYS FOR EVERYTHING AT ONCE.
 *
 * The streamed terrain has three jobs and they used to land together.
 * On the frame she crosses a 512-unit chunk it re-cut up to nine near
 * cells (65² each), the transition tier (129²) and — every fifth
 * crossing — the middle tier (129²). Measured on a desktop: 11, 13 and
 * 11 ms, so 35 ms of geometry on top of a frame that already had a
 * world to draw. On a phone, several times that.
 *
 * WALKING, NOBODY COULD HAVE FELT IT. She covers 63 units a second, so
 * a chunk is eight seconds away and the middle tier's 3,125-unit step
 * is fifty. The boosted autopilot moves her at 630 and turns those into
 * 0.8 s and 5 s — and a cadence tuned for a walk started landing every
 * few seconds. Joshua, flying over the ocean: "the camera randomly
 * jumps (every 7-10s) up or down for about 0.25-1s... it has to
 * re-render the ocean and its surroundings."
 *
 * THE CAMERA WAS INNOCENT. A per-frame trace of the camera-to-queen
 * offset held it at exactly zero for every frame of a flight, rebases
 * included. What jumped was the whole world, stalling — which over open
 * water is the only thing there is to look at.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { TerrainStream } from '../src/world/TerrainStream';
import { setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';

beforeAll(() => {
  const g = readFileSync(fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url)));
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  setSmoothing(0);
}, 120000);

/** A stream over real ground, seated where she spawns. */
function stream(): { land: TerrainStream; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  setOrigin(0, 0);
  const paint = (): THREE.Material => new THREE.MeshBasicMaterial();
  const land = new TerrainStream(scene, paint(), paint(), paint(), paint());
  return { land, scene };
}

/** One second of boosted cruise, as the frames a phone would draw. */
const STEP = 63;

describe('the frame that crosses a chunk', () => {
  it('cuts at most ONE distant tier, however far she has moved', () => {
    const { land } = stream();
    land.follow(world(0, 0));
    // A hundred frames of boosted flight — twelve chunk crossings and
    // two middle-tier steps.
    let worst = 0;
    for (let f = 1; f <= 100; f++) {
      const before = land.tierCuts;
      land.follow(world(0, f * STEP));
      worst = Math.max(worst, land.tierCuts - before);
    }
    expect(worst).toBe(1);
    land.dispose();
  }, 120000);

  it('and never cuts a tier on the frame it is cutting near cells', () => {
    // The near ring is the expensive half she cannot wait for — she is
    // standing on it. The tiers can be a frame late; the ground she is
    // about to land on cannot.
    const { land } = stream();
    land.follow(world(0, 0));
    let together = 0;
    let seen = 0;
    for (let f = 1; f <= 200; f++) {
      const before = land.tierCuts;
      const wasAt = land.chunkAtNow;
      land.follow(world(0, f * STEP));
      const crossed = land.chunkAtNow !== wasAt;
      if (crossed) seen++;
      if (crossed && land.tierCuts > before) together++;
    }
    expect(seen).toBeGreaterThan(5);
    expect(together).toBe(0);
    land.dispose();
  }, 120000);

  it('and still catches up — a deferred cut is not a dropped one', () => {
    const { land } = stream();
    land.follow(world(0, 0));
    const start = land.tierCuts;
    // Far enough that both tiers are owed a cut.
    land.follow(world(0, 400_000));
    // Then stand still. The debt has to clear on its own frames.
    for (let f = 0; f < 6; f++) land.follow(world(0, 400_000));
    expect(land.tierCuts - start).toBe(2);
    // And once clear it stops working: standing still costs nothing.
    const settled = land.tierCuts;
    for (let f = 0; f < 20; f++) land.follow(world(0, 400_000));
    expect(land.tierCuts).toBe(settled);
    land.dispose();
  }, 120000);

  it('and the opening frame still builds the whole world at once', () => {
    // Nothing is on screen yet, so there is nothing for the cost to
    // stutter — and a first frame with no distant ground is a hole.
    const { land } = stream();
    land.follow(world(0, 0));
    expect(land.tierCuts).toBe(2);
    land.dispose();
  }, 120000);
});
