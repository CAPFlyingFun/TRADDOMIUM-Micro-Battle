import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bandFor, groundDetail, groundHeight, hasGrid, ISLAND_SPAN, SAMPLE_STEP,
  terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeGrid, heightAt, UNITS_PER_METRE, type HeightGrid } from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));

let grid: HeightGrid;

beforeAll(() => {
  const file = readFileSync(ASSET);
  grid = decodeGrid(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  useGrid(grid);
});

describe('the ground everyone shares', () => {
  it('is loaded', () => {
    expect(hasGrid()).toBe(true);
  });

  it('is deterministic', () => {
    for (const [x, z] of [
      [0, 0],
      [137.5, -820.25],
      [-2100.1, 640.5],
    ]) {
      expect(groundHeight(x, z)).toBe(groundHeight(x, z));
    }
  });

  it('leaves the sea alone', () => {
    // Relief must not pimple the water into islands, so anywhere the
    // baked grid is at or below the waterline the height passes through.
    //
    // Asked of the SOURCE, because that is where the relief is added.
    // The drawn surface flattens each quad to a plane, which moves a
    // seabed sample by a hair without any relief being involved.
    let checked = 0;
    // Stepped as a FRACTION of the span rather than in fixed units.
    // These were 137 and 149 when the island was 5,600 units across; at
    // true scale that is 5.6 million and the same loop runs a billion
    // and a half times, which is how a passing suite became a hang.
    const acrossX = ISLAND_SPAN / 137;
    const acrossZ = ISLAND_SPAN / 149;
    for (let x = -ISLAND_SPAN / 2; x < ISLAND_SPAN / 2; x += acrossX) {
      for (let z = -ISLAND_SPAN / 2; z < ISLAND_SPAN / 2; z += acrossZ) {
        const base = heightAt(grid, x, z);
        if (base > 0) continue;
        expect(terrainHeight(x, z)).toBe(base);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('adds relief on land, but stays close to the real elevation', () => {
    // This was written to keep the ant near the drawn surface, and it
    // could never have done that. Bounding the RELIEF says nothing
    // about the gap, because the larger term was the baked terrain
    // itself being sampled at 10.94 units by a mesh drawing flat
    // triangles between those samples — she sank 3.36 units with the
    // relief comfortably inside this bound the whole time.
    //
    // standsOnDrawn.test.ts holds the real invariant. What is left
    // here is the honest, narrower claim: the relief does not wander
    // far from real Kauai.
    let moved = 0;
    let worst = 0;
    // A patch near the island's middle, sized to the world it is in.
    const reach = ISLAND_SPAN / 4;
    for (let x = -reach; x <= reach; x += reach / 22) {
      for (let z = -reach; z <= reach; z += reach / 19) {
        const base = heightAt(grid, x, z);
        if (base <= 10) continue;
        const drift = Math.abs(terrainHeight(x, z) - base);
        worst = Math.max(worst, drift);
        if (drift > 1e-6) moved++;
      }
    }
    expect(moved).toBeGreaterThan(100);
    // Two metres of synthesised surface on top of a 16-kilometre-tall
    // island. The bound was 1.6 units when a unit meant 10 metres of
    // Kauai, which made it 16 metres of invented terrain; at true scale
    // a unit is a centimetre and this is ground roughness.
    expect(worst).toBeLessThan(200);
  });

  it('keeps the shading mottle inside its range', () => {
    for (let i = 0; i < 400; i++) {
      const d = groundDetail(i * 13.7, i * -7.3);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('runs on ONE ruler — a world unit is a centimetre to everything', () => {
    // The scale change, as an assertion. The island used to be 1:1000,
    // so a unit was 1 cm to the Queen and 10 m to the ground. Now 56 km
    // is 5,600,000 units and both agree.
    expect(ISLAND_SPAN).toBe(5_600_000);
    // She is 1.0 unit long and walks 7 units a second, so crossing the
    // island on foot is about nine days. That is the point of it.
    const walkingDays = ISLAND_SPAN / 7 / 60 / 60 / 24;
    expect(walkingDays).toBeGreaterThan(5);
  });

  it('has landform data far coarser than the ant, on purpose', () => {
    // The baked grid is 1025 samples across all 56 km, which at true
    // scale is one sample every 5,469 units. It carries the island and
    // nothing an ant could see; everything finer is synthesised. A test
    // that expected samples a few body lengths apart was describing the
    // old 1:1000 world, where they were.
    expect(SAMPLE_STEP).toBeGreaterThan(1000);
    // And the synthesised detail must stay well inside that, or it is
    // inventing landforms rather than dressing them.
    expect(SAMPLE_STEP).toBeGreaterThan(2048 * 2);
  });
});

describe('elevation bands', () => {
  /**
   * Written in METRES, deliberately.
   *
   * These were world-unit literals, which silently encoded the 1:1000
   * scale: a beach was "0.6" and a summit "150". At true scale those
   * are 6 mm and 1.5 m, so the whole test read as a slice of one
   * beach, and it agreed with a `bandFor` that had the same mistake
   * baked into it. Going through the conversion means the numbers say
   * what they mean and cannot drift with the scale again.
   */
  const at = (metres: number) => bandFor(metres * UNITS_PER_METRE);

  it('runs sea to summit in order as the ground rises', () => {
    expect(at(-400)).toBe('seabed');
    expect(at(-3)).toBe('reef');
    expect(at(6)).toBe('sand');
    expect(at(120)).toBe('lowland');
    expect(at(450)).toBe('jungle');
    expect(at(1000)).toBe('cliff');
    expect(at(1500)).toBe('peak');
  });

  it('puts an ant on a beach on the BEACH', () => {
    // The bug the conversion existed to prevent: she spawned 78 units
    // above the sea — 78 centimetres — and stood on jungle, because
    // every threshold was a thousandth of what it should have been.
    expect(bandFor(78)).toBe('sand');
  });

  it('never leaves a height unbanded', () => {
    for (let m = -800; m < 2000; m += 3.7) {
      expect(at(m)).toBeTruthy();
    }
  });
});
