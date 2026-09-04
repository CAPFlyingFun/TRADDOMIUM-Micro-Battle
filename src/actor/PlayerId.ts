/**
 * A player's stable identity — who OWNS an actor, as distinct from
 * which actor it is. One player may own several actors over a session
 * (ants die; the colony continues), and the same actor must belong to
 * the same player on every client, so ownership is a separate branded
 * string rather than "the actor id, but for people".
 *
 * Derived from the device-local profile's `deviceId` for now
 * (`session/PlayerProfile.playerIdOf`); when accounts exist the
 * derivation changes and nothing that holds a PlayerId does.
 */
declare const PLAYER_ID_BRAND: unique symbol;

export type PlayerId = string & { readonly [PLAYER_ID_BRAND]: 'player' };

/** The one door into PlayerId. Refuses the empty string: nobody can own an actor. */
export function playerId(raw: string): PlayerId {
  if (raw.length === 0) throw new Error('PlayerId: empty');
  return raw as PlayerId;
}

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === 'string' && value.length > 0;
}
