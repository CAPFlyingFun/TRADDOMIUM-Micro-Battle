import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { local, world } from '../src/world/coords';
import { SparseSoil } from '../src/world/SparseSoil';
import { SoilView } from '../src/terrain/SoilView';

const mesh = (view: SoilView) => view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[];
const settle = (view: SoilView, depth = 0, revision = 0) => { for (let i = 0; i < 20; i++) view.update(world(0, 0), depth, revision); };
function dig(soil: SparseSoil, x: number, y = 9) {
  const p = { at: world(x, 1.6), height: y };
  soil.dig('burrower', p, p, .2);
}
describe('bounded soil residency', () => {
  it('reuses unchanged buffers, repositions at the render boundary and uses scene-lit brown material', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    let offset = 0;
    const view = new SoilView({ soil, toLocal: at => local(at.wx - offset, at.wz) });
    view.update(world(0, 0), 0, 0);
    const first = mesh(view)[0], positions = first.geometry.getAttribute('position');
    offset = 1024; view.update(world(0, 0), 0, 0);
    expect(mesh(view)[0]).toBe(first);
    expect(first.geometry.getAttribute('position')).toBe(positions);
    expect(first.position.x).toBe(-1024);
    expect(first.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(first.material.emissive.getHex()).toBe(0);
    expect(first.material.vertexColors).toBe(true);
    expect(view.cost.pending).toBe(0);
    view.dispose();
  });
  it('builds at most two complete columns per update and bounds a cutaway to a stable six-by-six rectangle', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil });
    view.update(world(0, 0), 1, 0);
    expect(view.readyTiles).toHaveLength(2);
    expect(view.cost.pending).toBe(34);
    settle(view, 1);
    expect(view.readyTiles).toHaveLength(36);
    expect(new Set(view.readyTiles.map(t => t.tx)).size).toBe(6);
    expect(new Set(view.readyTiles.map(t => t.tz)).size).toBe(6);
    expect(view.cost.triangles).toBeGreaterThan(0);
    const previous = mesh(view).map(m => m.geometry);
    view.update(world(.1, .1), 1, 0);
    expect(mesh(view).map(m => m.geometry)).toEqual(previous);
    view.dispose();
  });
  it('immediately retires obsolete depth/survey clipping and disposes replaced and evicted GPU buffers', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil }); settle(view, 1);
    let disposed = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { disposed++; }));
    view.update(world(0, 0), 2, 0);
    expect(view.readyTiles).toHaveLength(2);
    expect(disposed).toBe(36);
    settle(view, 2);
    view.update(world(0, 0), 2, 1);
    expect(view.readyTiles).toHaveLength(2);
    let materialDisposed = false;
    mesh(view)[0].material.addEventListener('dispose', () => { materialDisposed = true; });
    let evicted = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { evicted++; }));
    view.update(world(1000, 1000), 0, 1);
    expect(evicted).toBe(2);
    expect(view.readyTiles).toHaveLength(0);
    expect(view.group.children).toHaveLength(0);
    view.dispose(); expect(materialDisposed).toBe(true);
  });
  it('rebuilds dirty columns only and never clips a skipped incomplete column', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6); dig(soil, 4.8);
    const view = new SoilView({ soil }); settle(view);
    const stable = mesh(view).find(m => m.position.x > 3)!;
    const dirty = mesh(view).find(m => m.position.x === 0)!;
    let disposed = false; dirty.geometry.addEventListener('dispose', () => { disposed = true; });
    dig(soil, 1.6, 8); view.update(world(0, 0), 0, 0);
    expect(mesh(view)).toContain(stable); expect(disposed).toBe(true);
    dig(soil, 1.6, -20); view.update(world(0, 0), 0, 0);
    expect(view.readyTiles.map(t => t.tx)).toEqual([1]);
    expect(view.cost.pending).toBe(0);
    view.dispose();
  });
});

describe('moving cutaway rim', () => {
  it('retires overlapping tiles with changed rim roles before clipping and reuses unchanged interior geometry', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil }); settle(view, 1.2);
    const byName = (name: string) => mesh(view).find(m => m.name === `soil:${name}`)!;
    const interior = byName('0,0'), oldEast = byName('2,0'), nextWest = byName('-2,0');
    let disposed = 0;
    oldEast.geometry.addEventListener('dispose', () => { disposed++; });
    nextWest.geometry.addEventListener('dispose', () => { disposed++; });
    view.update(world(3.3, 0), 1.2, 0);
    expect(disposed).toBe(2);
    expect(mesh(view)).toContain(interior);
    expect(mesh(view)).not.toContain(oldEast);
    expect(mesh(view)).not.toContain(nextWest);
    expect(view.readyTiles.length).toBeLessThanOrEqual(20);
    expect(view.cost.pending).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) view.update(world(3.3, 0), 1.2, 0);
    expect(view.readyTiles).toHaveLength(36);
    const highestAt = (m: ReturnType<typeof byName>, x: number): number => {
      const attr = m.geometry.getAttribute('position');
      let height = -Infinity;
      for (let i = 0; i < attr.count; i++) {
        if (Math.abs(attr.getX(i) - x) < 1e-6 && attr.getZ(i) > .2 && attr.getZ(i) < 3) height = Math.max(height, attr.getY(i) + m.position.y);
      }
      return height;
    };
    expect(highestAt(byName('-2,0'), 0)).toBeCloseTo(10, 5);
    expect(highestAt(byName('2,0'), 3.2)).toBeCloseTo(8.8, 5);
    expect(highestAt(byName('3,0'), 3.2)).toBeCloseTo(10, 5);
    view.dispose();
  });
});

describe('the selected patch frontier', () => {
  it('bridges exposed edges only and rebuilds frontier roles when an adjacent edited tile enters or leaves', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    const view = new SoilView({ soil, drawnHeightAt: () => 10.6 });
    const atEdge = (m: THREE.Mesh, x: number): number => {
      const positions = m.geometry.getAttribute('position');
      let max = -Infinity;
      for (let i = 0; i < positions.count; i++) if (Math.abs(positions.getX(i) - x) < 1e-6 && positions.getZ(i) > .2 && positions.getZ(i) < 3) {
        max = Math.max(max, positions.getY(i) + m.position.y);
      }
      return max;
    };
    view.update(world(0, 0), 0, 0);
    const only = mesh(view)[0];
    expect(atEdge(only, 3.2)).toBeCloseTo(10.6, 5);
    let replaced = false; only.geometry.addEventListener('dispose', () => { replaced = true; });
    dig(soil, 4.8); view.update(world(0, 0), 0, 0);
    expect(replaced).toBe(true);
    const west = mesh(view).find(m => m.name === 'soil:0,0')!;
    const east = mesh(view).find(m => m.name === 'soil:1,0')!;
    expect(atEdge(west, 3.2)).toBeCloseTo(10, 5);
    expect(atEdge(east, 0)).toBeCloseTo(10, 5);
    let frontierChanged = false; east.geometry.addEventListener('dispose', () => { frontierChanged = true; });
    view.update(world(28.3, 0), 0, 0);
    expect(frontierChanged).toBe(true);
    expect(view.readyTiles.map(t => t.tx)).toEqual([1]);
    expect(atEdge(mesh(view)[0], 0)).toBeCloseTo(10.6, 5);
    view.dispose();
  });
});

describe('the retained coarse column inside a voxel window', () => {
  it('bridges to a known skipped neighbor after the queue settles and retires obsolete neighbors before clipping', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, drawnHeightAt: () => 10 });
    settle(view, 1);
    const oldNeighbor = mesh(view).find(m => m.name === 'soil:1,0')!;
    let disposed = false; oldNeighbor.geometry.addEventListener('dispose', () => { disposed = true; });
    dig(soil, 1.6, -20);
    view.update(world(0, 0), 1, 0);
    expect(view.readyTiles.some(t => t.tx === 0 && t.tz === 0)).toBe(false);
    expect(disposed).toBe(true);
    expect(mesh(view)).not.toContain(oldNeighbor);
    expect(view.readyTiles.some(t => t.tx === 1 && t.tz === 0)).toBe(false);
    expect(view.cost.pending).toBeGreaterThan(0);
    for (let frame = 0; frame < 20; frame++) {
      const previous = new Set(mesh(view));
      view.update(world(0, 0), 1, 0);
      expect(mesh(view).filter(m => !previous.has(m)).length).toBeLessThanOrEqual(2);
    }
    expect(view.cost.pending).toBe(0);
    expect(view.readyTiles).toHaveLength(35);
    const neighbor = mesh(view).find(m => m.name === 'soil:1,0')!;
    const positions = neighbor.geometry.getAttribute('position');
    let westTop = -Infinity, eastTop = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getZ(i) <= .2 || positions.getZ(i) >= 3) continue;
      if (Math.abs(positions.getX(i)) < 1e-6) westTop = Math.max(westTop, positions.getY(i) + neighbor.position.y);
      if (Math.abs(positions.getX(i) - 3.2) < 1e-6) eastTop = Math.max(eastTop, positions.getY(i) + neighbor.position.y);
    }
    expect(westTop).toBeCloseTo(10, 5);
    expect(eastTop).toBeCloseTo(9, 5);
    view.update(world(0, 0), 1, 0);
    expect(mesh(view)).toContain(neighbor);
    expect(view.cost.pending).toBe(0);
    view.dispose();
  });
});
