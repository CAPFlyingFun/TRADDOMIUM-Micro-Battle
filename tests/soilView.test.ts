import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { distanceSquared, local, world } from '../src/world/coords';
import { SparseSoil } from '../src/world/SparseSoil';
import { soilTileCentre } from '../src/world/soilTypes';
import { SoilView } from '../src/terrain/SoilView';

const mesh = (view: SoilView) => view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[];
/**
 * A clock that charges a stated cost to every column built, so what the
 * 4 ms budget affords is the same number on a fast machine and a slow
 * one. Two milliseconds a column is two columns a frame.
 */
const clock = (perColumn: number) => costing(perColumn);
/**
 * The same clock with a stated cost for each column in turn, the last
 * one standing for every column after it.
 */
const costing = (...perColumn: number[]) => {
  let elapsed = 0, column = 0;
  return (): number => {
    const at = elapsed;
    elapsed += perColumn[Math.min(column++, perColumn.length - 1)];
    return at;
  };
};
const settle = (view: SoilView, depth = 1, revision = 0) => { for (let i = 0; i < 20; i++) view.update(world(0, 0), depth, revision); };
function dig(soil: SparseSoil, x: number, y = 9) {
  const p = { at: world(x, 1.6), height: y };
  soil.dig('burrower', p, p, .2);
}
describe('bounded soil residency', () => {
  it('reuses unchanged buffers, repositions at the render boundary and uses scene-lit brown material', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    let offset = 0;
    const view = new SoilView({ soil, toLocal: at => local(at.wx - offset, at.wz), now: clock(2) });
    settle(view, 1);
    const first = mesh(view).find(m => m.name === 'soil:0,0')!;
    const positions = first.geometry.getAttribute('position');
    offset = 1024; view.update(world(0, 0), 1, 0);
    expect(mesh(view).find(m => m.name === 'soil:0,0')).toBe(first);
    expect(first.geometry.getAttribute('position')).toBe(positions);
    expect(first.position.x).toBe(-1024);
    expect(first.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(first.material.emissive.getHex()).toBe(0);
    expect(first.material.vertexColors).toBe(true);
    expect(view.cost.pending).toBe(0);
    view.dispose();
  });
  it('spends its stated budget on complete columns and bounds a cutaway to a stable six-by-six rectangle', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) });
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
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1);
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
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1);
    const stable = mesh(view).find(m => m.name === 'soil:1,0')!;
    const dirty = mesh(view).find(m => m.name === 'soil:0,0')!;
    let disposed = false; dirty.geometry.addEventListener('dispose', () => { disposed = true; });
    dig(soil, 1.6, 8); view.update(world(0, 0), 1, 0);
    expect(mesh(view)).toContain(stable); expect(disposed).toBe(true);
    dig(soil, 1.6, -20); view.update(world(0, 0), 1, 0);
    expect(view.readyTiles.some(t => t.tx === 0 && t.tz === 0)).toBe(false);
    expect(view.readyTiles).toHaveLength(35);
    expect(view.cost.pending).toBe(0);
    view.dispose();
  });
});

describe('the shut section', () => {
  it('meshes nothing, holds nothing and reads no clock while SOIL is closed', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    let reads = 0;
    const spend = clock(2);
    const view = new SoilView({ soil, now: () => { reads++; return spend(); } });
    for (let frame = 0; frame < 20; frame++) view.update(world(0, 0), 0, 0);
    // Not one column was even considered: the budget's clock is read
    // once a frame, and only by a build pass that never ran.
    expect(reads).toBe(0);
    expect(view.group.children).toHaveLength(0);
    expect(view.readyTiles).toHaveLength(0);
    expect(view.cost).toEqual({ tiles: 0, triangles: 0, pending: 0 });
    // The same soil under the same observer does mesh once it is opened,
    // so the silence above is the shut window and not an empty world.
    settle(view, 1);
    expect(view.readyTiles).toHaveLength(36);
    expect(view.cost.triangles).toBeGreaterThan(0);
    expect(reads).toBeGreaterThan(0);
    view.dispose();
  });
  it('releases every held column on the frame the window closes', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1);
    let disposed = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { disposed++; }));
    view.update(world(0, 0), 0, 0);
    expect(disposed).toBe(36);
    expect(view.group.children).toHaveLength(0);
    expect(view.readyTiles).toHaveLength(0);
    expect(view.cost).toEqual({ tiles: 0, triangles: 0, pending: 0 });
    // Reopening rebuilds from nothing rather than resurrecting a buffer.
    settle(view, 1);
    expect(view.readyTiles).toHaveLength(36);
    expect(view.group.children).toHaveLength(36);
    view.dispose();
  });
});

describe('the frame budget', () => {
  it('stops when the budget is gone and delivers the rest on later frames, however dear one column is', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    // Four cheap columns fit inside the 4 ms budget; the fifth does not.
    const cheap = new SoilView({ soil, now: clock(1) });
    cheap.update(world(0, 0), 1, 0);
    expect(cheap.readyTiles).toHaveLength(4);
    expect(cheap.cost.pending).toBe(32);
    cheap.dispose();
    // One column here overruns the whole frame's budget by itself. It
    // still builds — the alternative is a window that never arrives —
    // and it is the ONLY one that frame.
    const dear = new SoilView({ soil, now: clock(9) });
    dear.update(world(0, 0), 1, 0);
    expect(dear.readyTiles).toHaveLength(1);
    expect(dear.cost.pending).toBe(35);
    dear.update(world(0, 0), 1, 0);
    expect(dear.readyTiles).toHaveLength(2);
    for (let frame = 0; frame < 34; frame++) dear.update(world(0, 0), 1, 0);
    expect(dear.readyTiles).toHaveLength(36);
    expect(dear.cost.pending).toBe(0);
    dear.dispose();
  });
  it('does not let a cheap column drag a dear one into the same frame', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    // Three milliseconds leaves a millisecond of the budget unspent, and
    // the column after it costs a tenth of a second. Starting it because
    // the budget was not quite gone is the dropped frame this guards.
    const view = new SoilView({ soil, now: costing(3, 150) });
    view.update(world(0, 0), 1, 0);
    expect(view.readyTiles).toHaveLength(1);
    view.update(world(0, 0), 1, 0);
    expect(view.readyTiles).toHaveLength(2);
    view.dispose();
  });
  it('builds the columns nearest the observer first', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const focus = soilTileCentre({ tx: 0, tz: 0 });
    const view = new SoilView({ soil, now: clock(2) });
    const range = (tile: { tx: number; tz: number }): number => distanceSquared(soilTileCentre(tile), focus);
    for (let frame = 0; frame < 18; frame++) {
      view.update(focus, 1, 0);
      const built = new Set(view.readyTiles.map(t => `${t.tx},${t.tz}`));
      let nearestUnbuilt = Infinity;
      for (let tz = -3; tz < 3; tz++) for (let tx = -3; tx < 3; tx++) {
        if (!built.has(`${tx},${tz}`)) nearestUnbuilt = Math.min(nearestUnbuilt, range({ tx, tz }));
      }
      for (const tile of view.readyTiles) expect(range(tile)).toBeLessThanOrEqual(nearestUnbuilt);
    }
    expect(view.readyTiles).toHaveLength(36);
    view.dispose();
  });
});

describe('moving cutaway rim', () => {
  it('retires overlapping tiles with changed rim roles before clipping and reuses unchanged interior geometry', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1.2);
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
  it('bridges the exposed window edge only and rebuilds frontier roles when the window moves', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    const view = new SoilView({ soil, drawnHeightAt: () => 10.6, now: clock(2) });
    const atEdge = (m: THREE.Mesh, x: number): number => {
      const positions = m.geometry.getAttribute('position');
      let max = -Infinity;
      for (let i = 0; i < positions.count; i++) if (Math.abs(positions.getX(i) - x) < 1e-6 && positions.getZ(i) > .2 && positions.getZ(i) < 3) {
        max = Math.max(max, positions.getY(i) + m.position.y);
      }
      return max;
    };
    const byName = (name: string) => mesh(view).find(m => m.name === `soil:${name}`)!;
    settle(view, 1.2);
    // The window's east column meets coarse terrain and bridges to the
    // drawn sheet; its neighbour inland shares that edge and must not
    // grow a fence through the continuous cut surface.
    const oldEast = byName('2,0');
    expect(atEdge(oldEast, 3.2)).toBeCloseTo(10.6, 5);
    expect(atEdge(byName('0,0'), 3.2)).toBeCloseTo(8.8, 5);
    let replaced = false; oldEast.geometry.addEventListener('dispose', () => { replaced = true; });
    view.update(world(3.3, 0), 1.2, 0);
    expect(replaced).toBe(true);
    for (let i = 0; i < 20; i++) view.update(world(3.3, 0), 1.2, 0);
    expect(view.readyTiles).toHaveLength(36);
    expect(atEdge(byName('2,0'), 3.2)).toBeCloseTo(8.8, 5);
    expect(atEdge(byName('3,0'), 3.2)).toBeCloseTo(10.6, 5);
    view.dispose();
  });
});

describe('the retained coarse column inside a voxel window', () => {
  it('bridges to a known skipped neighbor after the queue settles and retires obsolete neighbors before clipping', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, drawnHeightAt: () => 10, now: clock(2) });
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
