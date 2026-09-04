// @vitest-environment jsdom
/**
 * The one place actor state meets a mesh. three's scene graph builds
 * without WebGL; the canvas 2D context does not exist under jsdom, so a
 * recording stand-in is installed to see what the label paints.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { step } from '../src/actor/Transform';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { NEUTRAL_INTENT } from '../src/input/Intent';
import { DEBUG_CAPSULE_LOOK, INK, PARCHMENT, luminanceOf, markerColorFor } from '../src/view/CapsuleLook';
import { CapsuleView } from '../src/view/CapsuleView';
import { REBASE_AT, originAt, rebaseFor, setOrigin, toLocal } from '../src/world/origin';
import { translate, world } from '../src/world/coords';

interface Painted {
  readonly texts: string[];
  readonly fills: string[];
}

const painted: Painted = { texts: [], fills: [] };

/** Enough of CanvasRenderingContext2D for the label to paint; records what it painted. */
function fakeContext(): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect: () => {},
    fillRect: () => {
      painted.fills.push(String(ctx.fillStyle));
    },
    measureText: (text: string) => ({ width: text.length * 26 }),
    fillText: (text: string) => {
      painted.texts.push(text);
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  setOrigin(world(0, 0));
  painted.texts.length = 0;
  painted.fills.length = 0;
});

const state = (parts: Partial<ActorState> = {}): ActorState => ({
  id: actorId('a1'),
  kind: 'capsule',
  owner: playerId('device-1'),
  at: world(0, 0),
  height: 0,
  heading: 0,
  color: '#2f8fff',
  name: 'Ant',
  ...parts,
});

function meshes(view: CapsuleView): THREE.Mesh[] {
  return view.object.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
}

function body(view: CapsuleView): THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshLambertMaterial> {
  const found = meshes(view).find((m) => m.geometry instanceof THREE.CapsuleGeometry);
  if (!found) throw new Error('no capsule body');
  return found as THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshLambertMaterial>;
}

function marker(view: CapsuleView): THREE.Mesh<THREE.ConeGeometry, THREE.MeshLambertMaterial> {
  const found = meshes(view).find((m) => m.geometry instanceof THREE.ConeGeometry);
  if (!found) throw new Error('no heading marker');
  return found as THREE.Mesh<THREE.ConeGeometry, THREE.MeshLambertMaterial>;
}

function label(view: CapsuleView): THREE.Sprite {
  const found = view.object.children.find((o): o is THREE.Sprite => o instanceof THREE.Sprite);
  if (!found) throw new Error('no name label');
  return found;
}

describe('CapsuleView', () => {
  it('builds a coloured capsule body, a contrasting nose cone and a painted name label', () => {
    const view = new CapsuleView(state({ color: '#ffb400', name: 'Queen' }));
    expect(view.id).toBe('a1');
    expect(view.object.children).toHaveLength(3);

    const b = body(view);
    expect(b.geometry.parameters.radius).toBe(DEBUG_CAPSULE_LOOK.radius);
    expect(b.geometry.parameters.height).toBe(DEBUG_CAPSULE_LOOK.length);
    expect(b.material.color.getHexString()).toBe('ffb400');
    expect(b.material.emissive.getHexString()).toBe('ffb400');
    // Standing on the plane: the lowest point of the body is at the group's origin.
    expect(b.position.y - DEBUG_CAPSULE_LOOK.length / 2 - DEBUG_CAPSULE_LOOK.radius).toBeCloseTo(0, 9);

    // Amber is light, so the marker is ink.
    expect(markerColorFor('#ffb400')).toBe(INK);
    expect(marker(view).material.color.getHexString()).toBe(INK.slice(1));

    const sprite = label(view);
    expect(sprite.material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(sprite.position.y).toBeGreaterThan(DEBUG_CAPSULE_LOOK.length + 2 * DEBUG_CAPSULE_LOOK.radius);
    expect(sprite.scale.x).toBe(DEBUG_CAPSULE_LOOK.labelWidth);
    expect(painted.texts).toEqual(['Queen']);
    expect(painted.fills).toContain('#ffb400');
  });

  it('converts WorldPoint → LocalPoint at the render boundary, so three never sees a raw world coordinate', () => {
    setOrigin(world(1_000_000, -2_000_000));
    const origin = originAt();
    const view = new CapsuleView(state({ at: translate(origin, 10, -20), height: 3, heading: 0.7 }));
    expect(view.object.position.x).toBe(10);
    expect(view.object.position.y).toBe(3);
    expect(view.object.position.z).toBe(-20);
    expect(view.object.rotation.y).toBe(0.7);
    // Nothing in the graph carries a five-million-unit number.
    view.object.updateMatrixWorld(true);
    view.object.traverse((o) => {
      const p = o.getWorldPosition(new THREE.Vector3());
      expect(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))).toBeLessThan(1000);
    });
  });

  it('follows a floating-origin rebase on the next update with no special handling', () => {
    const at = world(REBASE_AT + 700, 0);
    const view = new CapsuleView(state({ at }));
    const before = view.object.position.clone();
    const shift = rebaseFor(at);
    expect(shift).not.toBeNull();
    view.update(state({ at }));
    expect(before.x - view.object.position.x).toBe(shift?.dx);
    expect(before.z - view.object.position.z).toBe(shift?.dz);
    const local = toLocal(at);
    expect(view.object.position.x).toBe(local.lx);
    expect(view.object.position.z).toBe(local.lz);
  });

  it('points its nose the way Transform.step walks', () => {
    for (const heading of [0, Math.PI / 2, -2.2, Math.PI]) {
      const s = state({ at: world(50, 50), heading });
      const view = new CapsuleView(s);
      view.object.updateMatrixWorld(true);
      const nose = marker(view).getWorldPosition(new THREE.Vector3()).sub(view.object.position);
      const walked = step(s, { ...NEUTRAL_INTENT, forward: 1 }, 1, DEBUG_CAPSULE_TUNING);
      const dir = { x: walked.at.wx - s.at.wx, z: walked.at.wz - s.at.wz };
      const noseLength = Math.hypot(nose.x, nose.z);
      const dirLength = Math.hypot(dir.x, dir.z);
      expect(nose.x / noseLength).toBeCloseTo(dir.x / dirLength, 9);
      expect(nose.z / noseLength).toBeCloseTo(dir.z / dirLength, 9);
    }
  });

  it('repaints the label and recolours the body only when name or colour change', () => {
    const view = new CapsuleView(state());
    expect(painted.texts).toEqual(['Ant']);
    view.update(state({ at: world(1, 2), heading: 0.3 }));
    view.update(state({ at: world(3, 4), heading: 0.6 }));
    expect(painted.texts).toEqual(['Ant']);

    view.update(state({ name: 'Renamed' }));
    expect(painted.texts).toEqual(['Ant', 'Renamed']);
    expect(body(view).material.color.getHexString()).toBe('2f8fff');
    expect(marker(view).material.color.getHexString()).toBe(PARCHMENT.slice(1));

    view.update(state({ name: 'Renamed', color: '#f4f1de' }));
    expect(painted.texts).toEqual(['Ant', 'Renamed', 'Renamed']);
    expect(body(view).material.color.getHexString()).toBe('f4f1de');
    expect(body(view).material.emissive.getHexString()).toBe('f4f1de');
    expect(marker(view).material.color.getHexString()).toBe(INK.slice(1));
  });

  it('disposes its geometry, materials and texture and leaves its parent', () => {
    const scene = new THREE.Scene();
    const view = new CapsuleView(state());
    scene.add(view.object);
    const disposed: string[] = [];
    body(view).geometry.addEventListener('dispose', () => disposed.push('body-geometry'));
    body(view).material.addEventListener('dispose', () => disposed.push('body-material'));
    marker(view).geometry.addEventListener('dispose', () => disposed.push('marker-geometry'));
    marker(view).material.addEventListener('dispose', () => disposed.push('marker-material'));
    label(view).material.addEventListener('dispose', () => disposed.push('label-material'));
    label(view).material.map?.addEventListener('dispose', () => disposed.push('label-texture'));
    view.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed.sort()).toEqual(
      ['body-geometry', 'body-material', 'label-material', 'label-texture', 'marker-geometry', 'marker-material'].sort(),
    );
  });
});

describe('CapsuleLook contrast', () => {
  it('measures luminance the WCAG way and picks ink for light capsules, parchment for dark', () => {
    expect(luminanceOf('#000000')).toBe(0);
    expect(luminanceOf('#ffffff')).toBeCloseTo(1, 9);
    expect(luminanceOf('#ff0000')).toBeCloseTo(0.2126, 4);
    expect(markerColorFor('#f4f1de')).toBe(INK);
    expect(markerColorFor('#ffb400')).toBe(INK);
    expect(markerColorFor('#2f8fff')).toBe(PARCHMENT);
    expect(markerColorFor('#e4572e')).toBe(PARCHMENT);
  });
});
