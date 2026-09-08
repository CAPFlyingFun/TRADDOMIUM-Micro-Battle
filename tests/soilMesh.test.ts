import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { world } from '../src/world/coords';
import { SparseSoil } from '../src/world/SparseSoil';
import { meshSoilTile } from '../src/terrain/soilMesh';

const flat = (height = 10) => new SparseSoil({ heightAt: () => height });
const dig = (soil: SparseSoil, x: number, y: number, z: number, radius: number) => {
  const p = { at: world(x, z), height: y };
  expect(soil.dig('burrower', p, p, radius)).toBe(true);
};
type Data = NonNullable<ReturnType<typeof meshSoilTile>>;
function hits(data: Data, x: number, z: number): { height: number; normal: number }[] {
  const ray = new THREE.Ray(new THREE.Vector3(x - data.origin.at.wx, 100, z - data.origin.at.wz), new THREE.Vector3(0, -1, 0));
  const out: { height: number; normal: number }[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  for (let i = 0; i < data.positions.length; i += 9) {
    a.fromArray(data.positions, i); b.fromArray(data.positions, i + 3); c.fromArray(data.positions, i + 6);
    if (ray.intersectTriangle(a, b, c, false, hit)) out.push({ height: hit.y + data.origin.height, normal: data.normals[i + 1] });
  }
  return out.sort((a, b) => b.height - a.height).filter((p, i, arr) => i === 0 || Math.abs(arr[i - 1].height - p.height) > 1e-5);
}
function edge(data: Data, x: number): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (let i = 0; i < data.positions.length; i += 3) {
    if (Math.abs(data.positions[i] - x) > 1e-5) continue;
    const y = data.positions[i + 1] + data.origin.height, z = data.positions[i + 2] + data.origin.at.wz;
    out.set(`${y},${z}`, [y, z]);
  }
  return [...out.values()];
}

describe('the 1 mm soil surface', () => {
  it('draws a sealed cavity roof and floor underneath the complete surveyed surface, with air-facing normals', () => {
    const soil = flat(); dig(soil, 1.6, 8.6, 1.6, .6);
    const data = meshSoilTile(soil, 0, 0)!;
    const crossing = hits(data, 1.613, 1.627);
    expect(crossing).toHaveLength(3);
    expect(crossing[0].height).toBeCloseTo(10, 5);
    expect(crossing[1].height).toBeCloseTo(9.2, 1);
    expect(crossing[2].height).toBeCloseTo(8, 1);
    expect(crossing.map(p => Math.sign(p.normal))).toEqual([1, -1, 1]);
    expect(hits(data, .013, .027)[0].height).toBeCloseTo(10, 5);
  });
  it('has a real surface opening with no cap over removed soil', () => {
    const soil = flat(); dig(soil, 1.6, 9.8, 1.6, .6);
    const crossing = hits(meshSoilTile(soil, 0, 0)!, 1.613, 1.627);
    expect(crossing).toHaveLength(1);
    expect(crossing[0].height).toBeCloseTo(9.2, 1);
  });
  it.each([0, -2, 700000])('matches adjoining global lattice boundaries at tile %s despite different column bottoms', (tx) => {
    const x = (tx + 1) * 3.2;
    const soil = new SparseSoil({ heightAt: at => 12.034 + .06 * (at.wx - x) + .03 * at.wz });
    dig(soil, x, 11.6, 1.6, .55);
    dig(soil, x - 1.6, 9.5, 1.6, .2);
    const left = meshSoilTile(soil, tx, 0)!, right = meshSoilTile(soil, tx + 1, 0)!;
    const boundary = edge(left, 3.2);
    expect(boundary.length).toBeGreaterThan(30);
    const other = edge(right, 0);
    // Different local height origins produce sub-micron Float32 rounding.
    // Compare geometric distances, not decimal buckets with discontinuous edges.
    expect(other).toHaveLength(boundary.length);
    for (const [y, z] of boundary) {
      expect(Math.min(...other.map(([oy, oz]) => Math.hypot(y - oy, z - oz)))).toBeLessThan(1e-6);
    }
    expect(Math.max(...left.positions.map(Math.abs))).toBeLessThan(6);
  });
  it('lowers only the visible ceiling and leaves the complete soil snapshot unchanged', () => {
    const soil = flat(); dig(soil, 1.6, 8.6, 1.6, .6);
    const before = soil.snapshot();
    const cut = meshSoilTile(soil, 0, 0, 1.5)!;
    expect(hits(cut, .013, .027)[0].height).toBeCloseTo(8.5, 5);
    expect(hits(cut, 1.613, 1.627)[0].height).toBeCloseTo(8, 1);
    expect(soil.snapshot()).toEqual(before);
    expect(soil.solidAt(world(.013, .027), 9)).toBe(true);
  });
  it('samples survey once per horizontal lattice column and refuses spans over 256 cells', () => {
    let reads = 0;
    const soil = new SparseSoil({ heightAt: () => { reads++; return 10; } });
    dig(soil, 1.6, 8.6, 1.6, .6); reads = 0;
    expect(meshSoilTile(soil, 0, 0)).not.toBeNull();
    expect(reads).toBe(33 * 33);
    dig(soil, 1.6, -20, 1.6, .6);
    expect(meshSoilTile(soil, 0, 0)).toBeNull();
  });
});

describe('the cutaway rim meets intact surveyed terrain', () => {
  it('joins all outside edges to survey height with a continuous one-cell ramp and no open edge below ground', () => {
    const soil = flat();
    const before = soil.snapshot();
    const data = meshSoilTile(soil, 0, 0, 1.2, { minTx: 0, maxTx: 1, minTz: 0, maxTz: 1 })!;
    for (const [x, height] of [[0, 10], [.025, 9.7], [.075, 9.1], [.2, 8.8], [3.2, 10]]) {
      expect(hits(data, x, 1.637)[0].height).toBeCloseTo(height, 5);
    }
    // A single tile's only unpaired triangle edges must be the intact outer
    // boundary at survey height. An open ramp/floor seam fails this too.
    const edges = new Map<string, { count: number; heights: number[] }>();
    for (let i = 0; i < data.positions.length; i += 9) {
      for (let side = 0; side < 3; side++) {
        const a = i + side * 3, b = i + ((side + 1) % 3) * 3;
        const vertexKey = (n: number) => [...data.positions.slice(n, n + 3)].map(v => v.toFixed(5)).join(',');
        const key = [vertexKey(a), vertexKey(b)].sort().join('|');
        const edge = edges.get(key) ?? { count: 0, heights: [data.positions[a + 1] + data.origin.height, data.positions[b + 1] + data.origin.height] };
        edge.count++; edges.set(key, edge);
      }
    }
    const open = [...edges.values()].filter(e => e.count === 1);
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) for (const height of e.heights) expect(height).toBeCloseTo(10, 5);
    expect([...edges.values()].every(e => e.count <= 2)).toBe(true);
    expect(soil.snapshot()).toEqual(before);
  });

  it('shares the same rim vertices across adjoining negative-addressed tiles while leaving normal meshes unchanged', () => {
    const soil = flat();
    const bounds = { minTx: -2, maxTx: 0, minTz: -1, maxTz: 0 };
    const left = meshSoilTile(soil, -2, -1, 1.2, bounds)!;
    const right = meshSoilTile(soil, -1, -1, 1.2, bounds)!;
    const boundary = edge(left, 3.2), other = edge(right, 0);
    expect(Math.max(...boundary.map(([height]) => height))).toBeCloseTo(10, 5);
    expect(Math.min(...boundary.map(([height]) => height))).toBeCloseTo(8.8, 5);
    expect(boundary).toHaveLength(other.length);
    for (const [y, z] of boundary) expect(Math.min(...other.map(([oy, oz]) => Math.hypot(y - oy, z - oz)))).toBeLessThan(1e-6);
    expect(meshSoilTile(soil, -2, -1, 0, bounds)).toEqual(meshSoilTile(soil, -2, -1));
  });
});

describe('the sealed rim', () => {
  /** The first triangle a ray meets, in tile-local coordinates, with its normal. */
  const firstHit = (data: Data, ray: THREE.Ray): { at: THREE.Vector3; normal: THREE.Vector3 } | null => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
    let best: { at: THREE.Vector3; normal: THREE.Vector3 } | null = null;
    for (let i = 0; i < data.positions.length; i += 9) {
      a.fromArray(data.positions, i); b.fromArray(data.positions, i + 3); c.fromArray(data.positions, i + 6);
      if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
      if (best === null || hit.distanceTo(ray.origin) < best.at.distanceTo(ray.origin)) {
        best = { at: hit.clone(), normal: new THREE.Vector3().fromArray(data.normals, i) };
      }
    }
    return best;
  };
  it("walls a tunnel where it reaches the window's rim, one lattice cell thick, and leaves the soil itself open", () => {
    const soil = flat();
    // A level burrow running west out of the window at x = 0, well under
    // a 1.2 cm cut floor, so the only thing that can close it is the rim.
    const from = { at: world(-1.6, 1.6), height: 8 }, to = { at: world(1.6, 1.6), height: 8 };
    expect(soil.dig('burrower', from, to, .3)).toBe(true);
    const before = soil.snapshot();
    const bounds = { minTx: 0, maxTx: 1, minTz: 0, maxTz: 1 };
    const open = meshSoilTile(soil, 0, 0, 1.2)!;
    const sealed = meshSoilTile(soil, 0, 0, 1.2, bounds)!;
    const along = (data: Data) => new THREE.Ray(new THREE.Vector3(1.2, 8 - data.origin.height, 1.6), new THREE.Vector3(-1, 0, 0));
    // With no window the tile boundary is just a boundary: the tunnel
    // runs on into the neighbour, and the ray down its axis meets nothing.
    expect(firstHit(open, along(open))).toBeNull();
    const wall = firstHit(sealed, along(sealed));
    expect(wall).not.toBeNull();
    expect(wall!.at.x).toBeGreaterThanOrEqual(0);
    expect(wall!.at.x).toBeLessThanOrEqual(.1);
    // The wall faces into the tunnel — it is soil seen from the air side.
    expect(wall!.normal.x).toBeGreaterThan(0);
    // Two millimetres in, the tunnel is as open as it ever was.
    const across = (data: Data) => new THREE.Ray(new THREE.Vector3(.2, 8 - data.origin.height, 1.6), new THREE.Vector3(0, 0, 1));
    expect(firstHit(sealed, across(sealed))!.at.z).toBeCloseTo(firstHit(open, across(open))!.at.z, 5);
    // A lens, not an edit: the soil still holds the burrow through the rim.
    expect(soil.snapshot()).toEqual(before);
    expect(soil.solidAt(world(.05, 1.6), 8)).toBe(false);
    expect(soil.solidAt(world(-.5, 1.6), 8)).toBe(false);
  });
  it('seals nothing but the rim line: an interior column is the same mesh with or without the window', () => {
    const soil = flat();
    const from = { at: world(-1.6, 1.6), height: 8 }, to = { at: world(1.6, 1.6), height: 8 };
    expect(soil.dig('burrower', from, to, .3)).toBe(true);
    const bounds = { minTx: -3, maxTx: 3, minTz: -3, maxTz: 3 };
    expect(meshSoilTile(soil, 0, 0, 1.2, bounds)).toEqual(meshSoilTile(soil, 0, 0, 1.2, { minTx: -8, maxTx: 8, minTz: -8, maxTz: 8 }));
    expect(meshSoilTile(soil, -1, 0, 1.2, bounds)).toEqual(meshSoilTile(soil, -1, 0, 1.2, { minTx: -8, maxTx: 8, minTz: -8, maxTz: 8 }));
  });
});

function crosses(data: Data, ray: THREE.Ray): boolean {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), target = new THREE.Vector3();
  for (let i = 0; i < data.positions.length; i += 9) {
    a.fromArray(data.positions, i); b.fromArray(data.positions, i + 3); c.fromArray(data.positions, i + 6);
    if (ray.intersectTriangle(a, b, c, false, target)) return true;
  }
  return false;
}

describe('the narrow outer bridge to drawn coarse triangles', () => {
  it.each([10.6, 9.4])('closes the exposed edge to coarse height %s while preserving every interior voxel triangle', coarse => {
    const soil = flat(); dig(soil, 1.6, 8.6, 1.6, .6);
    const before = soil.snapshot();
    const original = meshSoilTile(soil, 0, 0)!;
    const bridged = meshSoilTile(soil, 0, 0, 0, undefined, { edges: 1, drawnHeightAt: () => coarse })!;
    const ray = new THREE.Ray(new THREE.Vector3(-.1, (10 + coarse) / 2 - bridged.origin.height, 1.637), new THREE.Vector3(1, 0, 0));
    expect(crosses(bridged, ray)).toBe(true);
    expect(bridged.positions.slice(0, original.positions.length)).toEqual(original.positions);
    expect(bridged.normals.slice(0, original.normals.length)).toEqual(original.normals);
    expect(bridged.colors.slice(0, original.colors.length)).toEqual(original.colors);
    // Only the west edge was granted a bridge; no fence at the adjoining east edge.
    for (let i = original.positions.length; i < bridged.positions.length; i += 3) expect(bridged.positions[i]).toBe(0);
    expect(hits(bridged, 1.613, 1.627)).toEqual(hits(original, 1.613, 1.627));
    expect(soil.snapshot()).toEqual(before);
  });

  it('keeps a surveyed seam when a coarse triangle is unavailable', () => {
    const soil = flat();
    expect(meshSoilTile(soil, 0, 0, 0, undefined, { edges: 15, drawnHeightAt: () => null }))
      .toEqual(meshSoilTile(soil, 0, 0));
  });
});
