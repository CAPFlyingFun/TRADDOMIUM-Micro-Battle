/**
 * WHAT AN ACTOR IS, as one plain value.
 *
 * Every field is a number, a string or a brand over one, so the same
 * object is what the transform steps, what the save writes, what the
 * snapshot carries across the wire and what `view/` turns into a mesh —
 * without a conversion at any of those seams. Position is a WorldPoint
 * because an actor outlives a frame (coords.ts, THE RULE); nothing here
 * knows about render space.
 *
 * `kind` is `'capsule'` alone until the player shell (Phase 7) adds an
 * ant. A capsule is the honest first actor: the two-browser milestone
 * (ARCHITECTURE §5) is two coloured capsules seeing each other move.
 *
 * Pure: no three. The guard reads untrusted input — a snapshot from a
 * peer is exactly as trustworthy as a save file that has been meddled
 * with — so every number is checked finite and every string bounded.
 */
import { ISLAND_SPAN, world, type WorldPoint } from '../world/coords';
import { isActorId, type ActorId } from './ActorId';
import { isPlayerId, type PlayerId } from './PlayerId';

export type ActorKind = 'capsule';

export const ACTOR_KINDS: readonly ActorKind[] = ['capsule'];

export interface ActorState {
  readonly id: ActorId;
  readonly kind: ActorKind;
  readonly owner: PlayerId;
  /** Where she is, on the ground plane. Authoritative, persistent. */
  readonly at: WorldPoint;
  /** Height above the ground plane, world units. Zero when standing on it. */
  readonly height: number;
  /**
   * Radians, v0's convention carried forward: she travels along
   * (sin heading, cos heading) in (wx, wz), so heading 0 faces +wz and
   * a positive turn is clockwise seen from above. Kept in (−π, π].
   */
  readonly heading: number;
  /** `#rrggbb`, lower case. The one thing that tells two capsules apart on screen. */
  readonly color: string;
  /** The owner's display name, bounded like the profile's. */
  readonly name: string;
}

export const MAX_ACTOR_NAME = 24;
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Half the island: a position past this is not on Kauaʻi and is refused. */
const HALF_SPAN = ISLAND_SPAN / 2;
/** The sky has a ceiling too; a claimed height beyond the island's own width is nonsense. */
const MAX_HEIGHT = ISLAND_SPAN;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function isActorKind(value: unknown): value is ActorKind {
  return typeof value === 'string' && (ACTOR_KINDS as readonly string[]).includes(value);
}

/** A `{wx, wz}` on the island. The brand is applied by `actorStateFrom`, not here: a guard cannot mint. */
export function isWorldPointLike(value: unknown): value is { readonly wx: number; readonly wz: number } {
  return isRecord(value) && finiteWithin(value.wx, -HALF_SPAN, HALF_SPAN) && finiteWithin(value.wz, -HALF_SPAN, HALF_SPAN);
}

/** True when `value` has the exact shape of an ActorState, every number finite and in range. */
export function isActorState(value: unknown): value is ActorState {
  if (!isRecord(value)) return false;
  return (
    isActorId(value.id) &&
    isActorKind(value.kind) &&
    isPlayerId(value.owner) &&
    isWorldPointLike(value.at) &&
    finiteWithin(value.height, 0, MAX_HEIGHT) &&
    finiteWithin(value.heading, -Math.PI, Math.PI) &&
    typeof value.color === 'string' &&
    HEX_COLOR.test(value.color) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= MAX_ACTOR_NAME
  );
}

/**
 * A fresh ActorState from parts that have already passed the guard,
 * rebuilt field by field so nothing a peer sent rides along unread.
 */
export function actorStateFrom(checked: ActorState): ActorState {
  return {
    id: checked.id,
    kind: checked.kind,
    owner: checked.owner,
    at: world(checked.at.wx, checked.at.wz),
    height: checked.height,
    heading: checked.heading,
    color: checked.color,
    name: checked.name,
  };
}
