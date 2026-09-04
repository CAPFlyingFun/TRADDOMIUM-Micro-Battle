/**
 * WHAT A CLIENT HOLDS of the authority's world: the last few states of
 * every actor, and a way to read them smoothly.
 *
 * Snapshots arrive in bursts, twenty times a second at best and never
 * evenly. Drawn as they land, a remote capsule stutters; drawn a little
 * behind, with the position read BETWEEN the two snapshots that bracket
 * the moment, it glides. That "little behind" is `interpolationMs`:
 * 100 ms by default, twice the 50 ms snapshot interval, which is the
 * rule of thumb Valve's Source engine settled on (cl_interp = 2 ×
 * the update interval) so that one lost snapshot still leaves a pair to
 * read between. GAME TUNING derived from the snapshot rate, not
 * measured biology.
 *
 * NEVER AHEAD OF THE TRUTH. Past the newest snapshot the replica holds
 * still rather than guessing where the actor went: an extrapolated
 * capsule walks into a wall the authority never saw, then snaps back.
 * A newly joined actor appears where it was first known; nothing is
 * invented before that either. Only `leave` removes an actor — a
 * snapshot that omits one has merely not mentioned it, so a correction
 * for a single actor does not empty the world.
 *
 * Sample times are RECEIVE times on the client's clock: the authority's
 * clock is never assumed to be the client's. Pure: time is passed in.
 */
import type { ActorId } from '../actor/ActorId';
import { actorStateFrom, type ActorState } from '../actor/ActorState';
import type { PlayerId } from '../actor/PlayerId';
import { wrapHeading } from '../actor/Transform';
import { world } from '../world/coords';
import type { Snapshot } from './protocol';

export interface ReplicaOptions {
  /** How far behind receipt the replica is read. See the module comment for the default. */
  readonly interpolationMs?: number;
}

export const INTERPOLATION_MS = 100;

/**
 * Samples are dropped once they can no longer be the older half of a
 * bracketing pair; this cap only matters when a clock stalls so that
 * nothing ever ages out, and it is generous enough never to bite at a
 * real rate.
 */
const MAX_SAMPLES = 64;

/** A `join` carries no tick; it is older than any snapshot and yields to one. */
const JOIN_TICK = -1;

interface Sample {
  readonly tick: number;
  readonly atMs: number;
  readonly state: ActorState;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest arc, so a heading crossing ±π turns the short way round. */
function lerpHeading(a: number, b: number, t: number): number {
  return wrapHeading(a + wrapHeading(b - a) * t);
}

export class Replica {
  readonly interpolationMs: number;
  private readonly tracks = new Map<ActorId, Sample[]>();

  constructor(options: ReplicaOptions = {}) {
    const wanted = options.interpolationMs ?? INTERPOLATION_MS;
    this.interpolationMs = Number.isFinite(wanted) && wanted >= 0 ? wanted : INTERPOLATION_MS;
  }

  get size(): number {
    return this.tracks.size;
  }

  ids(): ActorId[] {
    return [...this.tracks.keys()];
  }

  has(id: ActorId): boolean {
    return this.tracks.has(id);
  }

  /** The latest state received for an actor, uninterpolated; null when unknown. */
  newest(id: ActorId): ActorState | null {
    const track = this.tracks.get(id);
    const last = track?.[track.length - 1];
    return last ? last.state : null;
  }

  /** Every actor the snapshot lists gets a sample; a stale tick for an actor is ignored. */
  apply(snapshot: Snapshot, receivedAtMs: number): void {
    for (const actor of snapshot.actors) this.push(actor, snapshot.tick, receivedAtMs);
  }

  /** An actor announced by `join` appears at the state it was announced with. */
  join(actor: ActorState, receivedAtMs: number): void {
    this.push(actor, JOIN_TICK, receivedAtMs);
  }

  /** Every actor the player owned is gone. Returns how many were removed. */
  leave(playerId: PlayerId): number {
    let removed = 0;
    for (const [id, track] of this.tracks) {
      const last = track[track.length - 1];
      if (last !== undefined && last.state.owner === playerId) {
        this.tracks.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Forget everything: what a `welcome` does before its snapshot is applied. */
  clear(): void {
    this.tracks.clear();
  }

  /**
   * Every actor as of `nowMs - interpolationMs`, read between the two
   * samples that bracket that moment; held at the newest sample when the
   * moment is past it, and at the oldest when it is before.
   */
  states(nowMs: number): ActorState[] {
    const renderAt = nowMs - this.interpolationMs;
    const out: ActorState[] = [];
    for (const track of this.tracks.values()) {
      const state = this.sampleAt(track, renderAt);
      if (state !== null) out.push(state);
    }
    return out;
  }

  private push(actor: ActorState, tick: number, receivedAtMs: number): void {
    const state = actorStateFrom(actor);
    let track = this.tracks.get(state.id);
    if (track === undefined) {
      track = [];
      this.tracks.set(state.id, track);
    }
    const last = track[track.length - 1];
    if (last !== undefined) {
      if (tick <= last.tick) return; // late or repeated: the newer truth stands
      // A clock cannot run backwards between two receipts; if the caller's did, the sample lands with the last.
      receivedAtMs = Math.max(receivedAtMs, last.atMs);
    }
    track.push({ tick, atMs: receivedAtMs, state });
    this.trim(track);
  }

  /**
   * Drop what can no longer be the older half of a bracketing pair. At
   * the moment a sample lands the read cursor is at most
   * `interpolationMs` behind it, so anything older than the newest
   * sample at or before that cursor is dead.
   */
  private trim(track: Sample[]): void {
    const newest = track[track.length - 1];
    if (newest === undefined) return;
    const cursor = newest.atMs - this.interpolationMs;
    while (track.length > 1) {
      const second = track[1];
      if (second === undefined || second.atMs > cursor) break;
      track.shift();
    }
    while (track.length > MAX_SAMPLES) track.shift();
  }

  private sampleAt(track: Sample[], renderAt: number): ActorState | null {
    const last = track[track.length - 1];
    const first = track[0];
    if (last === undefined || first === undefined) return null;
    if (renderAt >= last.atMs) return last.state;
    if (renderAt <= first.atMs) return first.state;
    // Between: walk back from the newest, since the cursor is usually near it.
    for (let i = track.length - 2; i >= 0; i -= 1) {
      const a = track[i];
      const b = track[i + 1];
      if (a === undefined || b === undefined || a.atMs > renderAt) continue;
      const t = (renderAt - a.atMs) / (b.atMs - a.atMs);
      return {
        ...b.state,
        at: world(lerp(a.state.at.wx, b.state.at.wx, t), lerp(a.state.at.wz, b.state.at.wz, t)),
        height: lerp(a.state.height, b.state.height, t),
        heading: lerpHeading(a.state.heading, b.state.heading, t),
      };
    }
    return first.state;
  }
}
