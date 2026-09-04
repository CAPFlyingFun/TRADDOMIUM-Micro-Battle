/**
 * A new capsule, standing on the ground plane, facing +wz.
 *
 * The one constructor for a capsule's ActorState, so the invariants the
 * snapshot guard enforces on the way IN (`isActorState`) hold from the
 * moment an actor exists rather than from its first trip over the wire.
 * It THROWS on a bad name, colour or off-island position instead of
 * mending them: every caller already holds sanitised input (the profile
 * bounds the display name, `colorFor` yields palette hex) so a failure
 * here is a wiring bug, and a wiring bug should be loud, not a capsule
 * quietly called something else.
 *
 * The id defaults to a fresh UUID because an actor id must be unique
 * across a whole session — a player may own several capsules over time
 * (ARCHITECTURE §5: ants die, the colony continues) — and passing one
 * in lets a test, or an authority handing out its own ids, pin it.
 *
 * Pure: no three, no DOM. `crypto.randomUUID` is the same platform
 * source the device profile mints from.
 */
import { world, type WorldPoint } from '../world/coords';
import { actorId, type ActorId } from './ActorId';
import { HEX_COLOR, MAX_ACTOR_NAME, isActorState, type ActorState } from './ActorState';
import type { PlayerId } from './PlayerId';

/** A fresh, unique id. Separate so a caller can mint before it spawns (an authority announcing a join). */
export function mintActorId(): ActorId {
  return actorId(crypto.randomUUID());
}

export function spawnCapsule(
  owner: PlayerId,
  name: string,
  color: string,
  at: WorldPoint,
  id: ActorId = mintActorId(),
): ActorState {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ACTOR_NAME) {
    throw new Error(`spawnCapsule: name must be 1..${MAX_ACTOR_NAME} characters, got ${JSON.stringify(name)}`);
  }
  // `#FF8800` is the same colour as `#ff8800`; lower-casing is normalisation, not guessing.
  const hex = color.toLowerCase();
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`spawnCapsule: colour must be #rrggbb, got ${JSON.stringify(color)}`);
  }
  const state: ActorState = {
    id,
    kind: 'capsule',
    owner,
    // A fresh point, so the caller's spawn marker and the actor never share an object.
    at: world(at.wx, at.wz),
    height: 0,
    heading: 0,
    color: hex,
    name: trimmed,
  };
  if (!isActorState(state)) {
    throw new Error(`spawnCapsule: position (${at.wx}, ${at.wz}) is not on the island`);
  }
  return state;
}
