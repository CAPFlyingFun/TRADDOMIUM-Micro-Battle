/**
 * One view per actor, kept in step with a list of ActorStates.
 *
 * The list is whatever the session holds this frame — the local
 * authority's actors in solo, the replica's in multiplayer — and
 * `sync` makes the scene match it: a view for every actor in the
 * list, none for any actor that has gone. Spawn, update and removal
 * are all the same call, so nothing else has to remember to add a
 * capsule when a `join` arrives or remove one on `leave`: the truth is
 * the list, and the scene is derived from it (ARCHITECTURE §2.3).
 *
 * Removal is by mark-and-sweep on a generation stamp rather than a
 * per-frame Set, so a frame with two actors allocates nothing.
 */
import type * as THREE from 'three';
import type { ActorId } from '../actor/ActorId';
import type { ActorState } from '../actor/ActorState';
import { DEBUG_CAPSULE_LOOK, type CapsuleLook } from './CapsuleLook';
import { CapsuleView } from './CapsuleView';

interface Entry {
  readonly view: CapsuleView;
  /** The generation this actor was last seen in; anything older is gone. */
  seen: number;
}

export class ActorViews {
  private readonly entries = new Map<ActorId, Entry>();
  private generation = 0;

  constructor(
    /** Where the views live: the scene, or a group the world owns. */
    private readonly parent: THREE.Object3D,
    private readonly look: CapsuleLook = DEBUG_CAPSULE_LOOK,
  ) {}

  /** Make the scene match `actors`: new ones appear, known ones move, absent ones leave. */
  sync(actors: readonly ActorState[]): void {
    this.generation += 1;
    for (const state of actors) {
      let entry = this.entries.get(state.id);
      if (entry === undefined) {
        const view = new CapsuleView(state, this.look);
        this.parent.add(view.object);
        entry = { view, seen: this.generation };
        this.entries.set(state.id, entry);
      } else {
        entry.view.update(state);
        entry.seen = this.generation;
      }
    }
    for (const [id, entry] of this.entries) {
      if (entry.seen === this.generation) continue;
      entry.view.dispose();
      this.entries.delete(id);
    }
  }

  get(id: ActorId): CapsuleView | undefined {
    return this.entries.get(id)?.view;
  }

  has(id: ActorId): boolean {
    return this.entries.has(id);
  }

  /** How many actors are on screen. */
  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.view.dispose();
    this.entries.clear();
  }
}
