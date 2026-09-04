/**
 * An actor's identity: one string, branded so a player id, a chunk key
 * or any other string cannot be handed over in its place. Minted by
 * whoever spawns the actor (the authority, in multiplayer) and stable
 * for the actor's whole life, across every snapshot and every client.
 */
declare const ACTOR_ID_BRAND: unique symbol;

export type ActorId = string & { readonly [ACTOR_ID_BRAND]: 'actor' };

/** The one door into ActorId. Refuses the empty string: an actor with no name cannot be addressed. */
export function actorId(raw: string): ActorId {
  if (raw.length === 0) throw new Error('ActorId: empty');
  return raw as ActorId;
}

export function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string' && value.length > 0;
}
