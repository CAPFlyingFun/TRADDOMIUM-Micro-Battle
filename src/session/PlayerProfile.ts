/**
 * The device-local player profile: the first layer of identity, before
 * any account exists. `deviceId` is minted once and kept, so two saves or
 * two capsules in the loopback test can tell each other apart; the display
 * name is whatever the player chooses, defaulting to the plainest honest
 * thing an ant can be called.
 *
 * Pure over a Store: no DOM. The UUID source is injected so tests are
 * deterministic; the default is the platform's `crypto.randomUUID`.
 */
import { playerId, type PlayerId } from '../actor/PlayerId';
import { boundedString, type Store, type StoreSpec, type Versioned } from '../persistence/store';

export interface PlayerProfile extends Versioned {
  /** Empty until minted; `loadProfile` never returns it empty. */
  readonly deviceId: string;
  readonly displayName: string;
}

export const PLAYER_PROFILE_VERSION = 1;
export const DEFAULT_DISPLAY_NAME = 'Ant';
export const MAX_DISPLAY_NAME = 24;

export const PLAYER_PROFILE_SPEC: StoreSpec<PlayerProfile> = {
  key: 'traddomium.v1.profile',
  version: PLAYER_PROFILE_VERSION,
  defaults: { version: PLAYER_PROFILE_VERSION, deviceId: '', displayName: DEFAULT_DISPLAY_NAME },
  sanitize(raw, defaults) {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const name = boundedString(r.displayName, defaults.displayName, MAX_DISPLAY_NAME).trim();
    return {
      version: PLAYER_PROFILE_VERSION,
      deviceId: boundedString(r.deviceId, defaults.deviceId, 64),
      displayName: name.length > 0 ? name : defaults.displayName,
    };
  },
};

/** Read the profile, minting and persisting a device id on first use. */
export function loadProfile(
  store: Store<PlayerProfile>,
  uuid: () => string = () => crypto.randomUUID(),
): PlayerProfile {
  const profile = store.read();
  if (profile.deviceId.length > 0) return profile;
  const minted: PlayerProfile = { ...profile, deviceId: uuid() };
  store.write(minted);
  return minted;
}

export function setDisplayName(store: Store<PlayerProfile>, displayName: string): PlayerProfile {
  const current = store.read();
  const next = PLAYER_PROFILE_SPEC.sanitize({ ...current, displayName }, PLAYER_PROFILE_SPEC.defaults);
  store.write(next);
  return next;
}

/**
 * Who this player is to the rest of the game. The device id IS the
 * player id for now (one device, one player); when accounts arrive the
 * derivation changes here and nothing that holds a PlayerId does.
 * Throws on an unminted profile because `loadProfile` never returns
 * one — reaching this with an empty id is a wiring bug, not a state.
 */
export function playerIdOf(profile: PlayerProfile): PlayerId {
  return playerId(profile.deviceId);
}
