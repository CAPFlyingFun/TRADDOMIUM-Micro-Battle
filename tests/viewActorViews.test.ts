// @vitest-environment jsdom
/**
 * The scene derived from a list of actors: one view per actor, gone when
 * the actor is.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { colorFor } from '../src/actor/playerColor';
import { spawnCapsule } from '../src/actor/spawnCapsule';
import { ActorViews } from '../src/view/ActorViews';
import { CapsuleView } from '../src/view/CapsuleView';
import { setOrigin, toLocal } from '../src/world/origin';
import { translate, world } from '../src/world/coords';

/** jsdom has no 2D context; a silent stand-in keeps the label from logging "not implemented". */
const quietContext = (): CanvasRenderingContext2D =>
  ({
    font: '',
    fillStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect: () => {},
    fillRect: () => {},
    measureText: (text: string) => ({ width: text.length * 26 }),
    fillText: () => {},
  }) as unknown as CanvasRenderingContext2D;

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => quietContext());
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => setOrigin(world(0, 0)));

const alice = playerId('alice-device');
const bob = playerId('bob-device');
const a = spawnCapsule(alice, 'Alice', colorFor(alice), world(10, 0), actorId('a'));
const b = spawnCapsule(bob, 'Bob', colorFor(bob), world(-10, 0), actorId('b'));

function capsulesIn(scene: THREE.Object3D): THREE.Group[] {
  return scene.children.filter((o): o is THREE.Group => o instanceof THREE.Group && o.name.startsWith('capsule:'));
}

describe('ActorViews', () => {
  it('creates one view per actor in the list and adds it to the parent', () => {
    const scene = new THREE.Scene();
    const views = new ActorViews(scene);
    views.sync([a, b]);
    expect(views.size).toBe(2);
    expect(capsulesIn(scene).map((g) => g.name).sort()).toEqual(['capsule:a', 'capsule:b']);
    expect(views.get(a.id)).toBeInstanceOf(CapsuleView);
    expect(views.has(b.id)).toBe(true);
    expect(views.get(a.id)?.object.position.x).toBe(10);
    expect(views.get(b.id)?.object.position.x).toBe(-10);
  });

  it('updates a known actor in place rather than rebuilding it', () => {
    const scene = new THREE.Scene();
    const views = new ActorViews(scene);
    views.sync([a]);
    const first = views.get(a.id);
    const moved: ActorState = { ...a, at: translate(a.at, 5, 7), heading: 1.1 };
    views.sync([moved]);
    expect(views.get(a.id)).toBe(first);
    expect(first?.object.position.x).toBe(toLocal(moved.at).lx);
    expect(first?.object.position.z).toBe(toLocal(moved.at).lz);
    expect(first?.object.rotation.y).toBe(1.1);
    expect(capsulesIn(scene)).toHaveLength(1);
  });

  it('removes and disposes the view of an actor that has left', () => {
    const scene = new THREE.Scene();
    const views = new ActorViews(scene);
    views.sync([a, b]);
    const gone = views.get(b.id);
    if (!gone) throw new Error('expected a view for b');
    let disposed = 0;
    gone.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.addEventListener('dispose', () => (disposed += 1));
    });

    views.sync([a]);
    expect(views.size).toBe(1);
    expect(views.has(b.id)).toBe(false);
    expect(capsulesIn(scene).map((g) => g.name)).toEqual(['capsule:a']);
    expect(gone.object.parent).toBeNull();
    expect(disposed).toBe(2);

    // And back again: a rejoin is a fresh view, not a resurrected one.
    views.sync([a, b]);
    expect(views.get(b.id)).not.toBe(gone);
    expect(capsulesIn(scene)).toHaveLength(2);
  });

  it('treats a repeated id in one list as one actor', () => {
    const scene = new THREE.Scene();
    const views = new ActorViews(scene);
    views.sync([a, { ...a, at: world(99, 0) }]);
    expect(views.size).toBe(1);
    expect(views.get(a.id)?.object.position.x).toBe(99);
  });

  it('empties on an empty list and on dispose', () => {
    const scene = new THREE.Scene();
    const views = new ActorViews(scene);
    views.sync([a, b]);
    views.sync([]);
    expect(views.size).toBe(0);
    expect(capsulesIn(scene)).toHaveLength(0);

    views.sync([a, b]);
    views.dispose();
    expect(views.size).toBe(0);
    expect(capsulesIn(scene)).toHaveLength(0);
  });
});
