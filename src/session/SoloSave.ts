/**
 * THE SOLO SAVE — one portable document, read defensively.
 *
 * Concrete, and everything in it is a number or a string: v0's lesson
 * (`docs/research/SESSION_ARCHITECTURE.md` had `playerState: unknown`
 * in it, and that is how a save format rots). It carries its own
 * version and its own map, and it survives a round trip through text,
 * so the day a save moves from a phone to a desktop that is a transport
 * problem and not a format one.
 *
 * READ AS UNTRUSTED INPUT, the way every store document is, and for the
 * stronger version of the same reason: a settings file that has been
 * meddled with costs a bad camera angle, and a save that has been
 * meddled with is a camera in the sea. Known keys only, every number
 * finite and clamped, wrong version refused, and a map this build does
 * not know refused too — the caller says which maps exist, because this
 * module cannot know and must not guess.
 *
 * Pure over a KeyValueStore: no DOM.
 */
import {
  boundedString, defineStore, finiteNumber, isRecord, type KeyValueStore, type StoreSpec, type Versioned,
} from '../persistence/store';
import { ISLAND_SPAN, world } from '../world/coords';
import type { CameraPose } from './GameSession';

export interface SoloSave extends Versioned {
  /** ISO 8601, or null when nothing has been saved yet. */
  readonly savedAt: string | null;
  readonly mapId: string;
  readonly camera: CameraPose;
}

/**
 * Bumped when a field changes meaning. A save from another version is
 * refused (read as defaults) rather than guessed at — a half-understood
 * save looks like it worked, which is worse than a fresh start.
 *
 *   1  Phase 0: savedAt + mapId only.
 *   2  Phase 1: the camera pose joins, in world coordinates.
 */
export const SOLO_SAVE_VERSION = 2;

/**
 * The key slot 1 lives under. It is Phase 1's ONE-SLOT key, unchanged on
 * purpose: when three slots arrived, the game already on a device became
 * slot 1 rather than a document nothing reads. Slots 2 and 3 suffix it
 * (`SoloSlots.ts`).
 */
export const SOLO_SAVE_KEY = 'traddomium.v1.solo-save';

/** Where a camera goes when the document says nothing: the island's centre, on the ground, level. */
export const DEFAULT_CAMERA_POSE: CameraPose = Object.freeze({ at: world(0, 0), height: 0, yaw: 0, pitch: 0 });

export const SOLO_SAVE_DEFAULTS: SoloSave = Object.freeze({
  version: SOLO_SAVE_VERSION,
  savedAt: null,
  mapId: '',
  camera: DEFAULT_CAMERA_POSE,
});

/** Which map ids this build can load. Supplied by whoever holds the world registry. */
export type KnownMap = (mapId: string) => boolean;

const HALF_SPAN = ISLAND_SPAN / 2;
const TAU = Math.PI * 2;

/** Every number finite and inside the island; a pose that is not is the default pose. */
export function sanitizeCameraPose(raw: unknown, defaults: CameraPose): CameraPose {
  const r = isRecord(raw) ? raw : {};
  const at = isRecord(r.at) ? r.at : {};
  return {
    at: world(finiteNumber(at.wx, defaults.at.wx, -HALF_SPAN, HALF_SPAN), finiteNumber(at.wz, defaults.at.wz, -HALF_SPAN, HALF_SPAN)),
    height: finiteNumber(r.height, defaults.height, 0, ISLAND_SPAN),
    yaw: finiteNumber(r.yaw, defaults.yaw, -TAU, TAU),
    pitch: finiteNumber(r.pitch, defaults.pitch, -Math.PI / 2, Math.PI / 2),
  };
}

/**
 * The spec for a given build's map list. A document naming a map the
 * predicate refuses reads as the defaults — no save — because loading a
 * camera pose into the wrong world is a camera in the sea.
 *
 * `key` is a parameter because the same document shape lives once per
 * save slot; `SoloSlots.ts` names the keys. Sanitising is identical for
 * every slot, so it is written once here rather than per slot.
 */
export function soloSaveSpec(knownMap: KnownMap, key: string = SOLO_SAVE_KEY): StoreSpec<SoloSave> {
  return {
    key,
    version: SOLO_SAVE_VERSION,
    defaults: SOLO_SAVE_DEFAULTS,
    sanitize(raw, defaults) {
      const r = isRecord(raw) ? raw : {};
      const mapId = boundedString(r.mapId, defaults.mapId, 64);
      if (mapId.length > 0 && !knownMap(mapId)) return { ...defaults, camera: sanitizeCameraPose(undefined, defaults.camera) };
      return {
        version: SOLO_SAVE_VERSION,
        savedAt: typeof r.savedAt === 'string' ? r.savedAt : defaults.savedAt,
        mapId,
        camera: sanitizeCameraPose(r.camera, defaults.camera),
      };
    },
  };
}

/**
 * The spec with no map list: accepts any bounded map id. What Phase 0's
 * wiring opens; the integration pass replaces it with
 * `soloSaveSpec(hasWorld)` once the world registry is passed in.
 */
export const SOLO_SAVE_SPEC: StoreSpec<SoloSave> = soloSaveSpec(() => true);

/** True when a save this build can read exists in `kv`. Pure: what a "Continue" button asks. */
export function hasSoloSave(kv: KeyValueStore, spec: StoreSpec<SoloSave> = SOLO_SAVE_SPEC): boolean {
  return defineStore(spec, kv).read().savedAt !== null;
}
