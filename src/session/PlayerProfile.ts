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
