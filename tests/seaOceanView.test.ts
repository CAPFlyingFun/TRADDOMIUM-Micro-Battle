/**
 * THE TWO SHEETS: what they cost, where they sit, and what they let go
 * of when the scene ends.
 *
 * Four things this has to hold, and each is a v0 fault or a v0 number:
 *
 *  1. THE VERTEX COUNT IS A CHOICE NOW. v0 submitted 257² + 241² =
 *     124,130 vertices every frame at every setting. That is the CPU/GPU
 *     imbalance Joshua suspected in his own words, and the tier is the
 *     dial. High and above still reproduce v0's geometry exactly, because
 *     that is the geometry the look was accepted at.
 *  2. THE DEPTH ATTRIBUTE IS SIGNED, and the sign is the shoreline.
 *     Clamping land vertices to zero moved the interpolated zero-crossing
 *     a whole cell inland of the true waterline (v0.0.75).
 *  3. THE SHEETS FOLLOW THE GROUND'S REVISION, not just the camera. A
 *     high-detail tile landing changes the bathymetry under a sheet that
 *     has not moved, and without the check the sea keeps colouring itself
 *     from coarse data until the player happens to travel far enough. The
 *     terrain clipmap learned this the same way.
 *  4. DISPOSE RELEASES WHAT IT OWNS AND NOT WHAT IT BORROWS. v0's
 *     `Ocean.dispose()` freed the geometry and the material and could not
 *     reach the textures, which were closure-captured — so every scene
 *     change leaked about 52 MiB. Here the textures are shared and
 *     survive; the meshes do not.
 *
 * Run against the real coarse survey, because "the depth attribute is
 * minus the ground" is only worth checking against ground somebody
 * surveyed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { COARSE_STEP, decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield } from '../src/world/heightfield';
import { SeaSwell } from '../src/world/sea/swell';
import { OceanView, SHEET_VERTICES, TIER_OCTAVES, farCellFor, sheetVertexCount } from '../src/sea/OceanView';
import type { SeaTextures } from '../src/sea/SeaTextures';
import { TEXTURE_TIERS, type TextureTier } from '../src/assets/textureQuality';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let field: Heightfield;
beforeAll(() => {
  const bytes = readFileSync(path.join(ROOT, 'public', 'kauai-1025.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  field = new Heightfield(repairGrid(decodeCoarse(buffer)).grid);
});

/** Stand-in for the shared loader: two texture slots this test owns. */
function textures(): SeaTextures {
  return {
    ripple: { value: new THREE.Texture() },
    foam: { value: new THREE.Texture() },
    anisotropy: 4,
    tier: 'medium',
    dispose: () => { /* the view must not call this */ },
  } as unknown as SeaTextures;
}

function ocean(tier: TextureTier = 'medium'): { view: OceanView; swell: SeaSwell; tex: SeaTextures } {
  const swell = new SeaSwell({ groundAt: (at) => field.heightAt(at) });
  const tex = textures();
  return { view: new OceanView({ field, swell, textures: tex, tier }), swell, tex };
}

/** Somewhere with real water under it: due west of the island, well offshore. */
const OFFSHORE: WorldPoint = world(-2_400_000, 0);

describe('what a tier actually costs', () => {
  it('reproduces v0’s geometry exactly at high and above', () => {
    // The look was accepted at these numbers. A tier is allowed to spend
    // less; it is not allowed to quietly redefine the top.
    expect(SHEET_VERTICES.high).toEqual({ far: 257, near: 241 });
    expect(SHEET_VERTICES['ultra-high']).toEqual({ far: 257, near: 241 });
    expect(sheetVertexCount('high')).toBe(257 * 257 + 241 * 241);
    expect(sheetVertexCount('high')).toBe(124_130);
    expect(TIER_OCTAVES.high).toBe(4);
    expect(TIER_OCTAVES.medium).toBe(4);
  });

  it('never spends more as the tier goes down', () => {
    let last = Infinity;
    for (const tier of [...TEXTURE_TIERS].reverse()) {
      const cost = sheetVertexCount(tier);
      expect(cost, tier).toBeLessThanOrEqual(last);
      last = cost;
      expect(TIER_OCTAVES[tier]).toBeGreaterThanOrEqual(1);
      expect(TIER_OCTAVES[tier]).toBeLessThanOrEqual(4);
    }
  });

  it('gives a struggling phone a fifth of the vertices, which is the point', () => {
    expect(sheetVertexCount('ultra-low') * 5).toBeLessThan(sheetVertexCount('high'));
  });

  it('builds what the table says, and says what it built', () => {
    for (const tier of TEXTURE_TIERS) {
      const { view } = ocean(tier);
      expect(view.vertexCount, tier).toBe(sheetVertexCount(tier));
      expect(view.tier).toBe(tier);
      view.dispose();
    }
  });

  it('keeps the near sheet’s cell fixed, so the tier never aliases the waves', () => {
    // Six samples to a 4.2 m wavelength is what makes a swell a wave
    // rather than the aliased suggestion of one. What shrinks is the
    // sheet's REACH, not its resolution.
    const spans = TEXTURE_TIERS.map((tier) => SHEET_VERTICES[tier].near * 70);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]).toBeGreaterThanOrEqual(spans[i - 1]);
    expect(SHEET_VERTICES.high.near * 70).toBe(16_870); // v0's own span
  });
});

describe('the water column under every vertex', () => {
  it('is minus the ground, and negative over land', () => {
    // SIGNED, and the sign is the shoreline: negative depth over land
    // interpolates through zero exactly where the ground crosses sea
    // level. Clamping it to zero moved the waterline a whole cell inland.
    // ON THE WATERLINE, FOUND RATHER THAN NAMED. The ultra-low near
    // sheet is 121 x 70 = 8,470 units across — 85 m — so a coordinate
    // picked by eye puts it entirely in water or entirely on land, and
    // the straddle check below then passes or fails for the wrong
    // reason. This walks in from open sea until the ground crosses zero.
    let shore: WorldPoint | null = null;
    for (let wx = -2_600_000; wx < 0 && shore === null; wx += 5_000) {
      if (field.heightAt(world(wx, 0)) > 0) shore = world(wx - 2_500, 0);
    }
    expect(shore, 'no coast found walking east along wz = 0').not.toBeNull();

    const { view } = ocean('ultra-low');
    view.update(shore as WorldPoint);
    const near = view.group.children[1] as THREE.Mesh;
    const depth = near.geometry.getAttribute('depth') as THREE.BufferAttribute;
    const position = near.geometry.getAttribute('position') as THREE.BufferAttribute;
    const centre = near.position;
    let sawWater = false;
    let sawLand = false;
    for (let i = 0; i < depth.count; i += 7) {
      // The sheet is seated at its own centre, so a vertex's world
      // position is that centre plus its local offset — and with no
      // origin rebase in this test the seat IS the world centre.
      const at = world(centre.x + position.getX(i), centre.z + position.getZ(i));
      // EXACT, through `fround`, not an absolute tolerance. The attribute
      // is Float32 and the sea floor reaches -380,000: at that magnitude
      // float32 resolves about 0.03, so any fixed epsilon is either
      // meaningless offshore or false in the shallows. The real claim is
      // that the stored value is the float32 nearest to minus the ground,
      // and that is checkable without picking a number.
      expect(depth.getX(i)).toBe(Math.fround(-field.heightAt(at)));
      if (depth.getX(i) > 0) sawWater = true;
      if (depth.getX(i) < 0) sawLand = true;
    }
    // A coastal sheet must straddle the line, or the assertion above is
    // only ever checking open ocean.
    expect(sawWater).toBe(true);
    expect(sawLand).toBe(true);
    view.dispose();
  });
});

describe('following the camera, and following the ground', () => {
  it('refills once and then stays put while the camera loiters', () => {
    const { view, swell } = ocean('ultra-low');
    let reads = 0;
    const real = field.heightAt.bind(field);
    (field as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = (at) => {
      reads += 1;
      return real(at);
    };
    try {
      view.update(OFFSHORE);
      const first = reads;
      expect(first).toBeGreaterThan(sheetVertexCount('ultra-low') - 1);
      reads = 0;
      // A hundred frames of standing still cost nothing. v0's sheets
      // refilled on a travel test rather than a lattice comparison, and
      // this is the property that keeps a 24,050-read refill off the
      // frame budget.
      for (let i = 0; i < 100; i += 1) view.update(OFFSHORE);
      expect(reads).toBe(0);
      // A short walk is still inside the same window.
      view.update(world(OFFSHORE.wx + 60, OFFSHORE.wz + 60));
      expect(reads).toBe(0);
      void swell;
    } finally {
      (field as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = real;
      view.dispose();
    }
  });

  it('refills when the camera crosses a window, and moves both sheets’ centres', () => {
    const { view } = ocean('ultra-low');
    view.update(OFFSHORE);
    const near = view.group.children[1] as THREE.Mesh;
    const far = view.group.children[0] as THREE.Mesh;
    const wasNear = near.position.clone();
    const wasFar = far.position.clone();
    // Far enough to cross even the far sheet's window.
    view.update(world(OFFSHORE.wx + 300_000, OFFSHORE.wz));
    expect(near.position.equals(wasNear)).toBe(false);
    expect(far.position.equals(wasFar)).toBe(false);
    view.dispose();
  });

  it('refills when a high-detail tile lands under a sheet that has not moved', () => {
    // The clipmap's lesson: a cache that only notices the camera is
    // silently wrong the moment the ground itself changes. Without this
    // the sea keeps colouring from coarse bathymetry until the player
    // happens to travel far enough.
    const { view } = ocean('ultra-low');
    view.update(OFFSHORE);
    let reads = 0;
    const real = field.heightAt.bind(field);
    (field as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = (at) => {
      reads += 1;
      return real(at);
    };
    const bumpRevision = field as unknown as { rev: number };
    try {
      view.update(OFFSHORE);
      expect(reads).toBe(0);
      bumpRevision.rev += 1; // what addTile/dropTile does
      view.update(OFFSHORE);
      expect(reads).toBeGreaterThan(sheetVertexCount('ultra-low') - 1);
    } finally {
      (field as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = real;
      bumpRevision.rev -= 1;
      view.dispose();
    }
  });

  it('registers the near sheet’s lattice with the swell, so gameplay samples the drawn chords', () => {
    // The sheet is drawn as flat chords between its vertices and the
    // analytic curve is not; floating on the curve while the sheet is
    // drawn on the chords is exactly why a queen "seems too low in the
    // wave". Only the near sheet carries the swell, so only its grid
    // counts.
    const { view, swell } = ocean('ultra-low');
    const lattice: unknown[] = [];
    const realSet = swell.setLattice.bind(swell);
    swell.setLattice = (l) => {
      lattice.push(l);
      realSet(l);
    };
    view.update(OFFSHORE);
    expect(lattice).toHaveLength(1);
    const only = lattice[0] as { ox: number; oz: number; cell: number };
    expect(only.cell).toBe(70);
    // Its corner is half a span from the near sheet's centre.
    const near = view.group.children[1] as THREE.Mesh;
    const span = SHEET_VERTICES['ultra-low'].near * 70;
    expect(only.ox).toBeCloseTo(near.position.x - span / 2, 6);
    expect(only.oz).toBeCloseTo(near.position.z - span / 2, 6);
    view.dispose();
  });
});

describe('one clock', () => {
  it('advances the swell exactly once and hands the same instant to both sheets', () => {
    // The invariant the whole sea rests on: both sheets' uTime and every
    // gameplay query read the same now, so the GPU can never be on a
    // different instant from the CPU.
    const { view, swell } = ocean('ultra-low');
    let ticks = 0;
    const realTick = swell.tick.bind(swell);
    swell.tick = (dt) => {
      ticks += 1;
      return realTick(dt);
    };
    view.update(OFFSHORE);
    view.tick(0.25);
    expect(ticks).toBe(1);
    expect(swell.now()).toBeCloseTo(0.25, 9);
    const materials = view.group.children.map((c) => (c as THREE.Mesh).material as THREE.Material);
    expect(materials).toHaveLength(2);
    view.dispose();
  });

  it('does not advance the clock from update()', () => {
    const { view, swell } = ocean('ultra-low');
    view.update(OFFSHORE);
    view.update(world(OFFSHORE.wx + 300_000, OFFSHORE.wz));
    expect(swell.now()).toBe(0);
    view.dispose();
  });
});

describe('what dispose lets go of', () => {
  it('frees the meshes it made and the lattice it registered', () => {
    const { view, swell } = ocean('ultra-low');
    view.update(OFFSHORE);
    const meshes = view.group.children.map((c) => c as THREE.Mesh);
    let geometriesFreed = 0;
    let materialsFreed = 0;
    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => { geometriesFreed += 1; });
      (mesh.material as THREE.Material).addEventListener('dispose', () => { materialsFreed += 1; });
    }
    let latticeCleared = 0;
    const realClear = swell.clearLattice.bind(swell);
    swell.clearLattice = () => {
      latticeCleared += 1;
      realClear();
    };

    view.dispose();

    expect(geometriesFreed).toBe(2);
    expect(materialsFreed).toBe(2);
    expect(view.group.children).toHaveLength(0);
    // The lattice pointed at a mesh that no longer exists; leaving it set
    // would have the gameplay query sampling chords of a sheet nobody is
    // drawing.
    expect(latticeCleared).toBe(1);
  });

  it('does NOT dispose the shared textures', () => {
    // They are injected precisely so that two sheets — and later the
    // inland water — hold one copy. Freeing them here would pull the
    // rug from a sibling, which is the mirror of v0's leak.
    const { view, tex } = ocean('ultra-low');
    let freed = 0;
    (tex as unknown as { dispose: () => void }).dispose = () => { freed += 1; };
    view.update(OFFSHORE);
    view.dispose();
    expect(freed).toBe(0);
  });
});

describe('the sheets sink, and the far one sinks further', () => {
  it('keeps the ocean under near-coplanar shore terrain', () => {
    const { view } = ocean('ultra-low');
    const [far, near] = view.group.children.map((c) => (c as THREE.Mesh).material as THREE.MeshStandardMaterial);
    expect(near.polygonOffset).toBe(true);
    expect(far.polygonOffsetUnits).toBeGreaterThan(near.polygonOffsetUnits);
    // Two transparent sheets sharing one offset fought for the depth
    // buffer across the whole crossfade band ("I did see some
    // Z-Fighting as well"), and the sheet underneath must not write
    // depth or it rejects the one in front.
    expect(far.depthWrite).toBe(false);
    view.dispose();
  });

  it('draws the near sheet after the far one', () => {
    const { view } = ocean('ultra-low');
    const [far, near] = view.group.children.map((c) => c as THREE.Mesh);
    expect(near.renderOrder).toBeGreaterThan(far.renderOrder);
    // Both are centred on the camera, so a frustum test could never
    // reject them; skipping it is the cheaper honest answer.
    expect(far.frustumCulled).toBe(false);
    expect(near.frustumCulled).toBe(false);
    view.dispose();
  });
});

describe('the far sheet still reaches the horizon at every tier', () => {
  it('keeps its span and grows its cell', () => {
    // The span is the horizon and the horizon is not negotiable; the
    // cell only has to resolve a colour ramp at kilometres of distance.
    for (const tier of TEXTURE_TIERS) {
      const { view } = ocean(tier);
      const far = view.group.children[0] as THREE.Mesh;
      const position = far.geometry.getAttribute('position') as THREE.BufferAttribute;
      let widest = 0;
      for (let i = 0; i < position.count; i += 1) widest = Math.max(widest, Math.abs(position.getX(i)));
      // 8.2 km across, within a cell, at every rung.
      expect(widest * 2, tier).toBeGreaterThan(822_400 - 2 * COARSE_STEP);
      view.dispose();
    }
  });
});

/**
 * THE DEFECT THE PROBE FOUND, AND THE FIX, PINNED.
 *
 * v0's ocean was 8.2 km across because v0's player was an ant on a beach,
 * for whom that IS the horizon. This build's camera starts 1.5 km above
 * the middle of Kauaʻi, twenty-four kilometres from the nearest coast, so
 * both camera-following sheets were buried inside the island: the probe
 * measured the ocean costing four times the frame and changing NOT ONE
 * PIXEL of the world — every difference between the on and off shots was
 * in the HUD.
 *
 * So the far sheet's span rides the camera's view distance, on a
 * power-of-two ladder. At ant height it lands on v0's number exactly.
 */
describe('the far sheet reaches as far as the camera can see', () => {
  const N = SHEET_VERTICES.medium.far;

  it('is v0’s 8.2 km when the camera cannot see further', () => {
    // An ant's view distance, and the floor. Nothing about the near-shore
    // look changes from what was accepted.
    expect(N * farCellFor(N, 0)).toBe(822_400);
    expect(N * farCellFor(N, 60_000)).toBe(822_400);
  });

  it('covers twice the view distance once the camera climbs', () => {
    // Twice, because the sheet is centred on the camera and has to reach
    // that far in BOTH directions.
    for (const reach of [500_000, 2_000_000, 7_200_000]) {
      const span = N * farCellFor(N, reach);
      expect(span, `reach ${reach}`).toBeGreaterThanOrEqual(2 * reach);
    }
  });

  it('climbs by doublings, so the sheet is rebuilt rarely and never by a whisker', () => {
    const base = farCellFor(N, 0);
    for (const reach of [0, 1, 500_000, 2_000_000, 7_200_000, 1e9]) {
      const ratio = farCellFor(N, reach) / base;
      expect(Number.isInteger(Math.log2(ratio)), `reach ${reach} gave ${ratio}x`).toBe(true);
    }
  });

  it('never grows without bound, whatever nonsense it is handed', () => {
    const capped = farCellFor(N, 1e9);
    for (const reach of [1e12, Infinity, NaN, -5]) {
      expect(farCellFor(N, reach), String(reach)).toBeLessThanOrEqual(capped);
      expect(farCellFor(N, reach)).toBeGreaterThan(0);
    }
    // A NaN or a negative reach is the floor, not the ceiling: a broken
    // altitude must not silently buy the largest sheet there is.
    expect(farCellFor(N, NaN)).toBe(farCellFor(N, 0));
    expect(farCellFor(N, -5)).toBe(farCellFor(N, 0));
  });

  it('re-spaces the sheet in place rather than rebuilding it', () => {
    // A new cell must not mean a new geometry, a new material or a
    // recompiled program: it is a rewrite of the position attribute, and
    // the depths follow on the same call.
    const { view } = ocean('ultra-low');
    view.update(OFFSHORE, 0);
    const far = view.group.children[0] as THREE.Mesh;
    const geometry = far.geometry;
    const material = far.material;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = position.getX(0);

    view.update(OFFSHORE, 7_200_000);

    expect(far.geometry).toBe(geometry);
    expect(far.material).toBe(material);
    expect(geometry.getAttribute('position')).toBe(position);
    expect(Math.abs(position.getX(0))).toBeGreaterThan(Math.abs(before));
    view.dispose();
  });

  it('refills the depths at the new spacing, not at the old', () => {
    const { view } = ocean('ultra-low');
    view.update(OFFSHORE, 0);
    view.update(OFFSHORE, 7_200_000);
    const far = view.group.children[0] as THREE.Mesh;
    const depth = far.geometry.getAttribute('depth') as THREE.BufferAttribute;
    const position = far.geometry.getAttribute('position') as THREE.BufferAttribute;
    const centre = far.position;
    // NOT `fround`-exact here, and the reason is the reach itself. The
    // grown sheet's vertices run to ±4,000,000, where Float32 resolves a
    // quarter of a unit — so the position this test reads back is not
    // quite the double-precision one the fill sampled at, and the seabed
    // slope turns that quarter unit into a fraction of a unit of depth
    // (worst measured: 0.024). A centimetre of tolerance against depths
    // of hundreds of thousands still catches a sheet refilled at the old
    // spacing, which is what the test is for. The NEAR sheet's positions
    // stay under ±4,300 and its check above is exact.
    for (let i = 0; i < depth.count; i += 11) {
      const at = world(centre.x + position.getX(i), centre.z + position.getZ(i));
      expect(Math.abs(depth.getX(i) - -field.heightAt(at))).toBeLessThan(1);
    }
    view.dispose();
  });

  it('leaves the NEAR sheet alone, because it carries the swell', () => {
    // Its 70-unit cell is what gives a 3.6 m wave six samples; growing it
    // with the camera would alias the waves the moment anyone climbed.
    // From a kilometre up there is no such wave to see, and that is the
    // honest picture rather than a missing one.
    const { view } = ocean('ultra-low');
    view.update(OFFSHORE, 0);
    const near = view.group.children[1] as THREE.Mesh;
    const position = near.geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = position.getX(0);
    view.update(OFFSHORE, 7_200_000);
    expect(position.getX(0)).toBe(before);
  });
});
