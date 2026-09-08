/**
 * THE FINDER'S PINS, without a GPU: three's scene graph and the creature
 * state the simulation would hand it.
 *
 *   a pin stands over every creature, tip at the animal
 *   a buried worm gets a pin on the GROUND above it, dimmed — the case
 *     the instrument exists for
 *   a pin holds the same size on screen: twice as far, twice as big
 *   off costs nothing and draws nothing
 *   nearest first when the cap bites
 *   it draws through everything and is not lit — it is an instrument
 *   an origin shift moves the pins with the world
 *   dispose lets go of everything
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { UNDER_GROUND, newCreature, type CreatureId, type CreatureState } from '../src/creatures';
import { FinderView, PIN_CAP, PIN_LOOK, PIN_PIXELS, type FinderLens } from '../src/fauna/FinderView';
import { world, type LocalPoint, type WorldPoint } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';

const FOCUS = world(0, 0);
const GROUND = 1000;

/** A lens 60° tall on a 430-pixel phone screen, at the origin. */
function lens(at = new THREE.Vector3(0, GROUND, 0), heightPx = 430): FinderLens {
  return { fovRadians: (60 * Math.PI) / 180, heightPx, at };
}

function creature(id: string, species: CreatureId, wx: number, wz: number, height = GROUND): CreatureState {
  return newCreature({ id, species, cellKey: '0,0', at: world(wx, wz), height, heading: 0, phase: 0 });
}

/** The world position a pin's matrix puts it at, and the size it was drawn. */
function pinAt(view: FinderView, i: number): { pos: THREE.Vector3; scale: number; colour: THREE.Color } {
  const mesh = view.group.children[0] as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, q, scale);
  const colour = new THREE.Color();
  mesh.getColorAt(i, colour);
  return { pos, scale: scale.y, colour };
}

const drawn = (view: FinderView): number => (view.group.children[0] as THREE.InstancedMesh).count;

afterEach(() => {
  setOrigin(world(0, 0));
});

describe('FinderView', () => {
  it('is off until it is switched on, and draws nothing while off', () => {
    const view = new FinderView();
    expect(view.enabled).toBe(false);
    view.update([creature('w1', 'earthworm', 100, 0)], FOCUS, lens());
    expect(drawn(view)).toBe(0);
    expect(view.cost.pins).toBe(0);
    view.dispose();
  });

  it('stands a pin over every creature, with its tip at the animal', () => {
    const view = new FinderView();
    view.setEnabled(true);
    const list = [
      creature('w1', 'earthworm', 100, 0),
      creature('a1', 'aphid', 0, 250, GROUND + 30),
      creature('f1', 'housefly', -400, 0, GROUND + 120),
    ];
    view.update(list, FOCUS, lens());
    expect(drawn(view)).toBe(3);
    expect(view.cost.pins).toBe(3);
    // In the order given — under the cap there is nothing to choose
    // between, and the sort is only paid when the cap bites (below).
    expect(pinAt(view, 0).pos.x).toBeCloseTo(100, 4);
    expect(pinAt(view, 0).pos.y).toBeCloseTo(GROUND, 4);
    expect(pinAt(view, 1).pos.z).toBeCloseTo(250, 4);
    expect(pinAt(view, 1).pos.y).toBeCloseTo(GROUND + 30, 4);
    expect(pinAt(view, 2).pos.y).toBeCloseTo(GROUND + 120, 4);
    view.dispose();
  });

  it('colours a pin by species', () => {
    const view = new FinderView();
    view.setEnabled(true);
    view.update([creature('w1', 'earthworm', 100, 0), creature('a1', 'aphid', 200, 0)], FOCUS, lens());
    expect(pinAt(view, 0).colour.getHex()).toBe(new THREE.Color().setHex(PIN_LOOK.earthworm.colour).getHex());
    expect(pinAt(view, 1).colour.getHex()).toBe(new THREE.Color().setHex(PIN_LOOK.aphid.colour).getHex());
    view.dispose();
  });

  it('THE POINT OF IT: a buried worm gets its own pin standing on the ground above it', () => {
    const view = new FinderView({ groundAt: () => GROUND });
    view.setEnabled(true);
    // 12 mm down, where FaunaView correctly draws nothing at all.
    const worm = creature('w1', 'earthworm', 100, 0, GROUND - 1.2);
    view.update([worm], FOCUS, lens());
    const pin = pinAt(view, 0);
    expect(pin.pos.y).toBeCloseTo(GROUND, 4);
    expect(pin.colour.getHex()).toBe(new THREE.Color().setHex(PIN_LOOK.earthworm.buried).getHex());
    view.dispose();
  });

  it('a worm at the surface is not called buried, and its pin sits on its body', () => {
    const view = new FinderView({ groundAt: () => GROUND });
    view.setEnabled(true);
    const shallow = creature('w1', 'earthworm', 100, 0, GROUND - UNDER_GROUND * 0.5);
    view.update([shallow], FOCUS, lens());
    const pin = pinAt(view, 0);
    expect(pin.pos.y).toBeCloseTo(GROUND - UNDER_GROUND * 0.5, 4);
    expect(pin.colour.getHex()).toBe(new THREE.Color().setHex(PIN_LOOK.earthworm.colour).getHex());
    view.dispose();
  });

  it('draws a buried animal BRIGHT, not dim: it is the common case, on the darkest ground', () => {
    // The dim version was tried first and was the wrong way round — a
    // worm is underground most of its life, so this is the marker that
    // matters most, standing on a forest floor.
    for (const id of ['earthworm', 'aphid', 'housefly'] as const) {
      const look = PIN_LOOK[id];
      expect(look.buried).not.toBe(look.colour);
      const c = new THREE.Color().setHex(look.buried);
      const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const solid = new THREE.Color().setHex(look.colour);
      expect(luminance).toBeGreaterThan(0.5);
      expect(luminance).toBeGreaterThan(0.2126 * solid.r + 0.7152 * solid.g + 0.0722 * solid.b);
    }
  });

  it('cannot claim a worm is buried when nothing knows where the ground is', () => {
    const view = new FinderView();
    view.setEnabled(true);
    view.update([creature('w1', 'earthworm', 100, 0, GROUND - 50)], FOCUS, lens());
    expect(pinAt(view, 0).colour.getHex()).toBe(new THREE.Color().setHex(PIN_LOOK.earthworm.colour).getHex());
    view.dispose();
  });

  it('holds the same size on screen: twice as far away is twice as big in world units', () => {
    const view = new FinderView();
    view.setEnabled(true);
    view.update([creature('w1', 'earthworm', 300, 0), creature('w2', 'earthworm', 600, 0)], FOCUS, lens());
    const near = pinAt(view, 0).scale;
    const far = pinAt(view, 1).scale;
    expect(far / near).toBeCloseTo(2, 4);

    // And the size is the pixels asked for: a pin 300 units away on a
    // 430-pixel 60° screen is PIN_PIXELS tall.
    const perPixel = (2 * Math.tan(((60 * Math.PI) / 180) / 2)) / 430;
    expect(near).toBeCloseTo(300 * perPixel * PIN_PIXELS, 4);
    view.dispose();
  });

  it('a taller viewport draws a pin smaller in the world, because a pixel is smaller', () => {
    const view = new FinderView();
    view.setEnabled(true);
    view.update([creature('w1', 'earthworm', 300, 0)], FOCUS, lens(new THREE.Vector3(0, GROUND, 0), 430));
    const phone = pinAt(view, 0).scale;
    view.update([creature('w1', 'earthworm', 300, 0)], FOCUS, lens(new THREE.Vector3(0, GROUND, 0), 860));
    expect(pinAt(view, 0).scale).toBeCloseTo(phone / 2, 4);
    view.dispose();
  });

  it('keeps the nearest when there are more creatures than pins', () => {
    const view = new FinderView();
    view.setEnabled(true);
    const many: CreatureState[] = [];
    // Furthest first, so an unsorted slice would keep exactly the wrong ones.
    for (let i = PIN_CAP + 40; i > 0; i -= 1) many.push(creature(`w${i}`, 'earthworm', i * 10, 0));
    view.update(many, FOCUS, lens());
    expect(drawn(view)).toBe(PIN_CAP);
    // The nearest is 10 units out; the pin drawn first must be it.
    expect(pinAt(view, 0).pos.x).toBeCloseTo(10, 4);
    view.dispose();
  });

  it('draws through everything and is never lit: it is an instrument, not scenery', () => {
    const view = new FinderView();
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    // MeshBasicMaterial: no light reaches it, by construction.
    expect(material.type).toBe('MeshBasicMaterial');
    expect(mesh.renderOrder).toBeGreaterThan(1000);
    expect(mesh.frustumCulled).toBe(false);
    view.dispose();
  });

  it('moves its pins with the world when the origin shifts', () => {
    const view = new FinderView({ origin: { toLocal: (at: WorldPoint): LocalPoint => toLocal(at) } });
    view.setEnabled(true);
    const worm = creature('w1', 'earthworm', 5_000, 0);
    view.update([worm], FOCUS, lens());
    expect(pinAt(view, 0).pos.x).toBeCloseTo(5_000, 3);
    // The origin snaps to a chunk, so the pin is asked to agree with
    // `toLocal` rather than with arithmetic done here — the point is
    // that it re-converts every frame, not what the chunk grid is.
    setOrigin(world(4_000, 0));
    view.update([worm], FOCUS, lens());
    expect(pinAt(view, 0).pos.x).toBeCloseTo(toLocal(worm.at).lx, 3);
    expect(pinAt(view, 0).pos.x).toBeLessThan(5_000);
    view.dispose();
  });

  it('switching off clears the pins rather than leaving the last frame standing', () => {
    const view = new FinderView();
    view.setEnabled(true);
    view.update([creature('w1', 'earthworm', 100, 0)], FOCUS, lens());
    expect(drawn(view)).toBe(1);
    view.setEnabled(false);
    expect(drawn(view)).toBe(0);
    expect(view.cost.pins).toBe(0);
    view.dispose();
  });

  it('the pin points down at what it marks: nothing of it hangs below the tip', () => {
    const view = new FinderView();
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(1, 5);
    view.dispose();
  });

  it('dispose lets go of the mesh, its geometry and its material', () => {
    const view = new FinderView();
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    let freed = 0;
    mesh.geometry.addEventListener('dispose', () => { freed += 1; });
    (mesh.material as THREE.Material).addEventListener('dispose', () => { freed += 1; });
    view.dispose();
    expect(freed).toBe(2);
    expect(view.group.children).toHaveLength(0);
    // And it stops answering after that.
    view.update([creature('w1', 'earthworm', 100, 0)], FOCUS, lens());
    expect(view.cost.pins).toBe(0);
  });

  it('is cheap: 240 pins, the high rung\'s whole population, cost one pass and no allocation per creature', () => {
    const view = new FinderView({ groundAt: () => GROUND });
    view.setEnabled(true);
    const many: CreatureState[] = [];
    for (let i = 0; i < 240; i += 1) many.push(creature(`w${i}`, 'earthworm', (i % 40) * 100, Math.floor(i / 40) * 100));
    const started = performance.now();
    for (let f = 0; f < 60; f += 1) view.update(many, FOCUS, lens());
    const perFrame = (performance.now() - started) / 60;
    expect(drawn(view)).toBe(240);
    // Generous for a slow box; it is a matrix and a colour per pin.
    expect(perFrame).toBeLessThan(2);
    view.dispose();
  });
});

describe('the local-point rule', () => {
  it('reads no world coordinate at all: distance is `coords`, position is `toLocal`', () => {
    // The renderer directories' standing rule (`tests/viewBoundary.test.ts`
    // holds the whole of fauna/ to it): a renderer converts at the
    // boundary and never takes a WorldPoint apart.
    const source = new URL('../src/fauna/FinderView.ts', import.meta.url);
    const text = readFileSync(source, 'utf8');
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).not.toMatch(/\.w[xz]\b/);
    expect(body).toContain('distanceSquared(');
    expect(body).toContain('this.toLocal(c.at)');
  });
});
