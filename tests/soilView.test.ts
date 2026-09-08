import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { distanceSquared, local, world } from '../src/world/coords';
import { SparseSoil } from '../src/world/SparseSoil';
import { SOIL_TILE, soilTileCentre } from '../src/world/soilTypes';
import { SoilView } from '../src/terrain/SoilView';

type SoilMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
const mesh = (view: SoilView) => view.group.children as SoilMesh[];
/** The staged set: built, in the group, and not yet shown. */
const hidden = (view: SoilView) => mesh(view).filter(m => !m.visible);
const visible = (view: SoilView) => mesh(view).filter(m => m.visible);
const byName = (view: SoilView, name: string) => mesh(view).find(m => m.name === `soil:${name}`)!;
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
const settle = (view: SoilView, depth = 1, revision = 0, halfTiles?: number, frames = 20) => {
  for (let i = 0; i < frames; i++) view.update(world(0, 0), depth, revision, halfTiles);
};
function dig(soil: SparseSoil, x: number, y = 9, z = 1.6) {
  const p = { at: world(x, z), height: y };
  soil.dig('burrower', p, p, .2);
}
/** The highest point of a column's surface straight under geometry-local (x, z), in world height. */
function topUnder(m: SoilMesh, x: number, z: number): number {
  const positions = m.geometry.getAttribute('position');
  const ray = new THREE.Ray(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  let top = -Infinity;
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
    if (ray.intersectTriangle(a, b, c, false, hit)) top = Math.max(top, hit.y + m.position.y);
  }
  return top;
}
/** The highest vertex of a column on the geometry-local line x = at (or z = at), away from the corners. */
function highestAt(m: SoilMesh, at: number, axis: 'x' | 'z' = 'x'): number {
  const attr = m.geometry.getAttribute('position');
  let height = -Infinity;
  for (let i = 0; i < attr.count; i++) {
    const on = axis === 'x' ? attr.getX(i) : attr.getZ(i), along = axis === 'x' ? attr.getZ(i) : attr.getX(i);
    if (Math.abs(on - at) < 1e-6 && along > .2 && along < 3) height = Math.max(height, attr.getY(i) + m.position.y);
  }
  return height;
}

describe('bounded soil residency', () => {
  it('reuses unchanged buffers, repositions at the render boundary and uses scene-lit brown material', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    let offset = 0;
    const view = new SoilView({ soil, toLocal: at => local(at.wx - offset, at.wz), now: clock(2) });
    settle(view, 1);
    const first = byName(view, '0,0');
    const positions = first.geometry.getAttribute('position');
    offset = 1024; view.update(world(0, 0), 1, 0);
    expect(byName(view, '0,0')).toBe(first);
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
    // Two columns built, both staged: nothing is published until the
    // window is whole.
    expect(hidden(view)).toHaveLength(2);
    expect(view.readyTiles).toHaveLength(0);
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
  it('keeps obsolete depth/survey clipping on screen until its replacement is whole, then disposes replaced and evicted GPU buffers', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1);
    let disposed = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { disposed++; }));
    view.update(world(0, 0), 2, 0);
    // The old pit stands, whole and published, while the new one is built beside it.
    expect(view.readyTiles).toHaveLength(36);
    expect(visible(view)).toHaveLength(36);
    expect(hidden(view)).toHaveLength(2);
    expect(disposed).toBe(0);
    expect(view.cost.pending).toBe(34);
    settle(view, 2);
    expect(disposed).toBe(36);
    expect(view.readyTiles).toHaveLength(36);
    expect(hidden(view)).toHaveLength(0);
    // A survey revision is the same kind of change as a depth: every column is a lens on it.
    view.update(world(0, 0), 2, 1);
    expect(view.readyTiles).toHaveLength(36);
    expect(hidden(view)).toHaveLength(2);
    let materialDisposed = false;
    mesh(view)[0].material.addEventListener('dispose', () => { materialDisposed = true; });
    let evicted = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { evicted++; }));
    // Shutting the section releases BOTH sets at once: the shown pit and the two staged replacements.
    view.update(world(1000, 1000), 0, 1);
    expect(evicted).toBe(38);
    expect(view.readyTiles).toHaveLength(0);
    expect(view.group.children).toHaveLength(0);
    view.dispose(); expect(materialDisposed).toBe(true);
  });
  it('rebuilds dirty columns only and never clips a skipped incomplete column', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6); dig(soil, 4.8);
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1);
    const stable = byName(view, '1,0');
    const dirty = byName(view, '0,0');
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
    expect(hidden(cheap)).toHaveLength(4);
    expect(cheap.cost.pending).toBe(32);
    cheap.dispose();
    // One column here overruns the whole frame's budget by itself. It
    // still builds — the alternative is a window that never arrives —
    // and it is the ONLY one that frame.
    const dear = new SoilView({ soil, now: clock(9) });
    dear.update(world(0, 0), 1, 0);
    expect(hidden(dear)).toHaveLength(1);
    expect(dear.cost.pending).toBe(35);
    dear.update(world(0, 0), 1, 0);
    expect(hidden(dear)).toHaveLength(2);
    expect(dear.cost.pending).toBe(34);
    for (let frame = 0; frame < 33; frame++) dear.update(world(0, 0), 1, 0);
    expect(dear.readyTiles).toHaveLength(0);
    expect(dear.cost.pending).toBe(1);
    dear.update(world(0, 0), 1, 0);
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
    expect(hidden(view)).toHaveLength(1);
    expect(view.cost.pending).toBe(35);
    view.update(world(0, 0), 1, 0);
    expect(hidden(view)).toHaveLength(2);
    expect(view.cost.pending).toBe(34);
    view.dispose();
  });
  it('builds the columns nearest the observer first', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const focus = soilTileCentre({ tx: 0, tz: 0 });
    const view = new SoilView({ soil, now: clock(2) });
    const range = (tile: { tx: number; tz: number }): number => distanceSquared(soilTileCentre(tile), focus);
    const tileOf = (m: SoilMesh): { tx: number; tz: number } => {
      const [tx, tz] = m.name.slice('soil:'.length).split(',').map(Number);
      return { tx, tz };
    };
    for (let frame = 0; frame < 17; frame++) {
      view.update(focus, 1, 0);
      // The staged set is the build order made visible to a test: every
      // column built so far is nearer than every column still to build.
      const staged = hidden(view).map(tileOf);
      expect(staged).toHaveLength(2 * (frame + 1));
      const built = new Set(staged.map(t => `${t.tx},${t.tz}`));
      let nearestUnbuilt = Infinity;
      for (let tz = -3; tz < 3; tz++) for (let tx = -3; tx < 3; tx++) {
        if (!built.has(`${tx},${tz}`)) nearestUnbuilt = Math.min(nearestUnbuilt, range({ tx, tz }));
      }
      for (const tile of staged) expect(range(tile)).toBeLessThanOrEqual(nearestUnbuilt);
    }
    view.update(focus, 1, 0);
    expect(view.readyTiles).toHaveLength(36);
    view.dispose();
  });
});

describe("the window's half-width", () => {
  it('defaults to three tiles and takes a half-width from the caller', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) });
    settle(view, 1);
    expect(view.readyTiles).toHaveLength(36);
    settle(view, 1, 0, 1);
    expect(view.readyTiles).toHaveLength(4);
    expect(new Set(view.readyTiles.map(t => t.tx)).size).toBe(2);
    expect(new Set(view.readyTiles.map(t => t.tz)).size).toBe(2);
    settle(view, 1, 0, 2);
    expect(view.readyTiles).toHaveLength(16);
    view.dispose();
  });
  it('rounds the half-width, floors it at one, caps it at eight and falls back to three when it is not a number', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) });
    settle(view, 1, 0, 0);
    expect(view.readyTiles).toHaveLength(4);
    settle(view, 1, 0, 1.4);
    expect(view.readyTiles).toHaveLength(4);
    settle(view, 1, 0, 1.6);
    expect(view.readyTiles).toHaveLength(16);
    settle(view, 1, 0, NaN);
    expect(view.readyTiles).toHaveLength(36);
    settle(view, 1, 0, 50, 130);
    expect(view.readyTiles).toHaveLength(256);
    expect(new Set(view.readyTiles.map(t => t.tx)).size).toBe(16);
    settle(view, 1, 0, 8, 5);
    expect(view.readyTiles).toHaveLength(256);
    expect(view.cost.pending).toBe(0);
    // Not a number at all is not a request for the widest window: it is the default.
    settle(view, 1, 0, Infinity, 15);
    expect(view.readyTiles).toHaveLength(36);
    view.dispose();
  });
  it('keeps the narrower pit on screen until the wider one is whole, then rebuilds only the columns whose rim role changed', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) });
    settle(view, 1.2);
    const interior = byName(view, '0,0'), oldRim = byName(view, '-3,0');
    let disposed = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { disposed++; }));
    view.update(world(0, 0), 1.2, 0, 4);
    expect(view.readyTiles).toHaveLength(36);
    expect(visible(view)).toHaveLength(36);
    expect(disposed).toBe(0);
    // 28 entering columns, and the 20 old rim columns that are interior now.
    expect(view.cost.pending).toBe(48 - 2);
    settle(view, 1.2, 0, 4, 30);
    expect(view.readyTiles).toHaveLength(64);
    expect(disposed).toBe(20);
    expect(mesh(view)).toContain(interior);
    expect(mesh(view)).not.toContain(oldRim);
    expect(highestAt(byName(view, '-3,0'), 0)).toBeCloseTo(8.8, 5);
    expect(highestAt(byName(view, '-4,0'), 0)).toBeCloseTo(10, 5);
    view.dispose();
  });
});

describe('no partial reveal', () => {
  /**
   * The far-rim hole of shots/cutaway-outside.png: a published column
   * bordering one still in the queue had neither wall nor bridge on that
   * side, and the twelve millimetres under the neighbour's unclipped
   * sheet read as sky. With nothing published before the window is
   * whole, there is no frame in which such a pair exists.
   */
  it('publishes nothing until the update in which pending reaches zero, then the whole window at once', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    const view = new SoilView({ soil, drawnHeightAt: () => 10.6, now: clock(3) });
    let swapped = -1;
    for (let frame = 0; frame < 40; frame++) {
      view.update(world(0, 0), 1.2, 0);
      if (view.cost.pending > 0) {
        expect(view.readyTiles).toHaveLength(0);
        expect(visible(view)).toHaveLength(0);
        expect(view.cost.tiles).toBe(0);
      } else if (swapped < 0) {
        swapped = frame;
        expect(view.readyTiles).toHaveLength(36);
        expect(visible(view)).toHaveLength(36);
        expect(hidden(view)).toHaveLength(0);
      }
    }
    // Three milliseconds a column is one column a frame: the window took
    // thirty-six updates, and the reveal happened on the thirty-sixth.
    expect(swapped).toBe(35);
    // Every published column borders soil on every side: a built
    // neighbour, or a bridge to the sheet where the window ends.
    for (const tile of view.readyTiles) {
      const m = byName(view, `${tile.tx},${tile.tz}`);
      expect(highestAt(m, 0)).toBeCloseTo(tile.tx === -3 ? 10.6 : 8.8, 5);
      expect(highestAt(m, SOIL_TILE)).toBeCloseTo(tile.tx === 2 ? 10.6 : 8.8, 5);
    }
    view.dispose();
  });
  it('keeps the old pit, at its old depth, on screen until the new depth is whole', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(9) });
    settle(view, 1, 0, 3, 36);
    expect(view.readyTiles).toHaveLength(36);
    const before = view.readyTiles;
    for (let frame = 0; frame < 35; frame++) {
      view.update(world(0, 0), 2, 0);
      expect(view.readyTiles).toBe(before);
      expect(view.cost.pending).toBe(35 - frame);
      for (const m of visible(view)) expect(topUnder(m, 1.6, 1.6)).toBeCloseTo(9, 5);
      expect(hidden(view)).toHaveLength(frame + 1);
    }
    view.update(world(0, 0), 2, 0);
    expect(view.cost.pending).toBe(0);
    expect(view.readyTiles).not.toBe(before);
    expect(visible(view)).toHaveLength(36);
    expect(hidden(view)).toHaveLength(0);
    for (const m of visible(view)) expect(topUnder(m, 1.6, 1.6)).toBeCloseTo(8, 5);
    view.dispose();
  });
  it('keeps a bitten column on screen until its replacement is built, then swaps in the same update', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(9) });
    settle(view, 1, 0, 3, 36);
    // One bite across a tile boundary dirties two columns; nine
    // milliseconds a column means one replacement a frame.
    const oldWest = byName(view, '0,0'), oldEast = byName(view, '1,0');
    let disposed = 0;
    oldWest.geometry.addEventListener('dispose', () => { disposed++; });
    oldEast.geometry.addEventListener('dispose', () => { disposed++; });
    dig(soil, 3.2, 8.5);
    view.update(world(0, 0), 1, 0);
    expect(view.cost.pending).toBe(1);
    expect(disposed).toBe(0);
    expect(oldWest.visible && oldEast.visible).toBe(true);
    expect(view.readyTiles).toHaveLength(36);
    expect(hidden(view)).toHaveLength(1);
    view.update(world(0, 0), 1, 0);
    expect(view.cost.pending).toBe(0);
    expect(disposed).toBe(2);
    expect(hidden(view)).toHaveLength(0);
    expect(visible(view)).toHaveLength(36);
    expect(byName(view, '0,0')).not.toBe(oldWest);
    view.dispose();
  });
  it('drops a staged column the window has moved away from without touching what is shown', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) });
    settle(view, 1);
    let disposed = 0;
    mesh(view).forEach(m => m.geometry.addEventListener('dispose', () => { disposed++; }));
    // Stage two columns for a window to the east, then move the window
    // west: they were never shown and now never will be.
    view.update(world(3.3, 0), 1, 0);
    const staged = hidden(view);
    expect(staged).toHaveLength(2);
    let droppedStaged = 0;
    staged.forEach(m => m.geometry.addEventListener('dispose', () => { droppedStaged++; }));
    view.update(world(-3.3, 0), 1, 0);
    expect(droppedStaged).toBe(2);
    expect(disposed).toBe(0);
    expect(view.readyTiles).toHaveLength(36);
    expect(visible(view)).toHaveLength(36);
    view.dispose();
  });
  it('replaces a staged column the soil has moved past, and keeps the shown one until the window is whole again', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(9) });
    settle(view, 1, 0, 3, 36);
    expect(view.cost.pending).toBe(0);
    // Two columns dirtied, one replacement a frame: the first is staged
    // and then bitten again before the second is built.
    const shown = byName(view, '0,0');
    dig(soil, 1.6, 8); dig(soil, 4.8, 8);
    view.update(world(0, 0), 1, 0);
    const first = hidden(view)[0];
    expect(first.name).toBe('soil:0,0');
    expect(view.cost.pending).toBe(1);
    let replacedStale = false; first.geometry.addEventListener('dispose', () => { replacedStale = true; });
    dig(soil, 1.6, 7.5);
    view.update(world(0, 0), 1, 0);
    expect(replacedStale).toBe(true);
    expect(hidden(view)).toHaveLength(1);
    expect(hidden(view)[0].name).toBe('soil:0,0');
    expect(hidden(view)[0]).not.toBe(first);
    expect(view.cost.pending).toBe(1);
    // The column on screen is the one built before either bite.
    expect(shown.visible).toBe(true);
    expect(mesh(view)).toContain(shown);
    expect(view.readyTiles).toHaveLength(36);
    view.update(world(0, 0), 1, 0);
    expect(view.cost.pending).toBe(0);
    expect(hidden(view)).toHaveLength(0);
    expect(mesh(view)).not.toContain(shown);
    expect(topUnder(byName(view, '0,0'), 1.6, 1.6)).toBeCloseTo(9, 5);
    view.dispose();
  });
});

describe('moving cutaway rim', () => {
  it('keeps the old window whole until the moved one is ready, then retires tiles with changed rim roles and reuses unchanged interior geometry', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1.2);
    const interior = byName(view, '0,0'), oldEast = byName(view, '2,0'), nextWest = byName(view, '-2,0'), leaving = byName(view, '-3,0');
    let disposed = 0;
    oldEast.geometry.addEventListener('dispose', () => { disposed++; });
    nextWest.geometry.addEventListener('dispose', () => { disposed++; });
    view.update(world(3.3, 0), 1.2, 0);
    expect(disposed).toBe(0);
    expect(view.readyTiles).toHaveLength(36);
    expect(view.readyTiles.some(t => t.tx === -3)).toBe(true);
    expect(view.readyTiles.some(t => t.tx === 3)).toBe(false);
    expect(visible(view)).toEqual(expect.arrayContaining([interior, oldEast, nextWest, leaving]));
    expect(view.cost.pending).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) view.update(world(3.3, 0), 1.2, 0);
    expect(disposed).toBe(2);
    expect(mesh(view)).toContain(interior);
    expect(mesh(view)).not.toContain(oldEast);
    expect(mesh(view)).not.toContain(nextWest);
    expect(mesh(view)).not.toContain(leaving);
    expect(view.readyTiles).toHaveLength(36);
    expect(view.readyTiles.some(t => t.tx === -3)).toBe(false);
    expect(highestAt(byName(view, '-2,0'), 0)).toBeCloseTo(10, 5);
    expect(highestAt(byName(view, '2,0'), 3.2)).toBeCloseTo(8.8, 5);
    expect(highestAt(byName(view, '3,0'), 3.2)).toBeCloseTo(10, 5);
    view.dispose();
  });
  /**
   * The second cause the far-rim hole could have had: a column shown
   * with a rim role from a previous window, so its geometry stops short
   * of a wall the new window needs. After a move every published rim
   * column reaches the survey on its rim line, every interior column
   * sits at the cut, and every column has a top under its centre.
   */
  it('publishes no column whose geometry was built for another window', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, now: clock(2) }); settle(view, 1.2);
    for (const [wx, wz] of [[3.3, 0], [3.3, 6.5], [-6.5, 6.5], [0, 0]]) {
      for (let i = 0; i < 40; i++) view.update(world(wx, wz), 1.2, 0);
      expect(view.cost.pending).toBe(0);
      expect(view.readyTiles).toHaveLength(36);
      const minTx = Math.min(...view.readyTiles.map(t => t.tx)), maxTx = Math.max(...view.readyTiles.map(t => t.tx));
      const minTz = Math.min(...view.readyTiles.map(t => t.tz)), maxTz = Math.max(...view.readyTiles.map(t => t.tz));
      for (const tile of view.readyTiles) {
        const m = byName(view, `${tile.tx},${tile.tz}`);
        expect(m.visible).toBe(true);
        expect(topUnder(m, 1.6, 1.6)).toBeCloseTo(8.8, 5);
        expect(highestAt(m, 0)).toBeCloseTo(tile.tx === minTx ? 10 : 8.8, 5);
        expect(highestAt(m, SOIL_TILE)).toBeCloseTo(tile.tx === maxTx ? 10 : 8.8, 5);
        expect(highestAt(m, 0, 'z')).toBeCloseTo(tile.tz === minTz ? 10 : 8.8, 5);
        expect(highestAt(m, SOIL_TILE, 'z')).toBeCloseTo(tile.tz === maxTz ? 10 : 8.8, 5);
      }
    }
    view.dispose();
  });
});

describe('the selected patch frontier', () => {
  it('bridges the exposed window edge only and rebuilds frontier roles when the window moves', () => {
    const soil = new SparseSoil({ heightAt: () => 10 }); dig(soil, 1.6);
    const view = new SoilView({ soil, drawnHeightAt: () => 10.6, now: clock(2) });
    settle(view, 1.2);
    // The window's east column meets coarse terrain and bridges to the
    // drawn sheet; its neighbour inland shares that edge and must not
    // grow a fence through the continuous cut surface.
    const oldEast = byName(view, '2,0');
    expect(highestAt(oldEast, 3.2)).toBeCloseTo(10.6, 5);
    expect(highestAt(byName(view, '0,0'), 3.2)).toBeCloseTo(8.8, 5);
    let replaced = false; oldEast.geometry.addEventListener('dispose', () => { replaced = true; });
    view.update(world(3.3, 0), 1.2, 0);
    // Still the old window's east rim, still bridged, until the moved window is whole.
    expect(replaced).toBe(false);
    expect(oldEast.visible).toBe(true);
    for (let i = 0; i < 20; i++) view.update(world(3.3, 0), 1.2, 0);
    expect(replaced).toBe(true);
    expect(view.readyTiles).toHaveLength(36);
    expect(highestAt(byName(view, '2,0'), 3.2)).toBeCloseTo(8.8, 5);
    expect(highestAt(byName(view, '3,0'), 3.2)).toBeCloseTo(10.6, 5);
    view.dispose();
  });
});

describe('the retained coarse column inside a voxel window', () => {
  it('bridges to a known skipped neighbor after the queue settles and retires obsolete neighbors before clipping', () => {
    const soil = new SparseSoil({ heightAt: () => 10 });
    const view = new SoilView({ soil, drawnHeightAt: () => 10, now: clock(2) });
    settle(view, 1);
    const oldNeighbor = byName(view, '1,0');
    let disposed = false; oldNeighbor.geometry.addEventListener('dispose', () => { disposed = true; });
    dig(soil, 1.6, -20);
    view.update(world(0, 0), 1, 0);
    // The skip is discovered this frame; the shown window stays whole,
    // the skipped column and its four neighbours' bridges included,
    // until the replacements stand.
    expect(view.readyTiles.some(t => t.tx === 0 && t.tz === 0)).toBe(true);
    expect(disposed).toBe(false);
    expect(mesh(view)).toContain(oldNeighbor);
    expect(view.cost.pending).toBeGreaterThan(0);
    for (let frame = 0; frame < 20; frame++) {
      const previous = new Set(mesh(view));
      view.update(world(0, 0), 1, 0);
      expect(mesh(view).filter(m => !previous.has(m)).length).toBeLessThanOrEqual(2);
    }
    expect(view.cost.pending).toBe(0);
    expect(disposed).toBe(true);
    expect(mesh(view)).not.toContain(oldNeighbor);
    expect(view.readyTiles.some(t => t.tx === 0 && t.tz === 0)).toBe(false);
    expect(view.readyTiles).toHaveLength(35);
    const neighbor = byName(view, '1,0');
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
