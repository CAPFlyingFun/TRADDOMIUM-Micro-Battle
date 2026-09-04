/**
 * The settings document: the few numbers a player can feel and disagree
 * about, persisted through `persistence/store` so a meddled-with file costs
 * a bad camera angle, not a boot failure.
 *
 * Pure (no DOM): the panel renders it, other modules READ it. The readers
 * are listed on each field. In Phase 0 the Performance World honours fov,
 * lookSensitivity, invertY and showFps (through a hook built in
 * app/registerScenes.ts); nothing reads quality yet, and the panel says so.
 *
 * Every number is GAME TUNING, not measured biology.
 */
import { finiteNumber, type StoreSpec, type Store, type Versioned } from '../persistence/store';
import type { StorageRoot } from '../persistence/StorageRoot';

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: readonly Quality[] = ['low', 'medium', 'high'];

export interface Settings extends Versioned {
  /** Camera field of view in degrees. Reader: the follow / free-fly camera. */
  readonly fov: number;
  /** Multiplier on look-drag turn rate; 1 is the tuned feel. Reader: the camera drag. */
  readonly lookSensitivity: number;
  /** False is the shipped feel: dragging DOWN lifts the view. Reader: the camera drag. */
  readonly invertY: boolean;
  /** Render cost tier. Reader: the renderer / LOD when there is terrain to draw. */
  readonly quality: Quality;
  /** The frame-rate readout. Reader: perf/PerfHud. */
  readonly showFps: boolean;
}

/** Bumped when a field changes meaning; an older document reads as defaults. */
export const SETTINGS_VERSION = 1;

/** What a slider may ask for. Anything outside is clamped, never refused. */
export const SETTINGS_LIMITS = {
  fov: { min: 60, max: 110, step: 1 },
  lookSensitivity: { min: 0.25, max: 3, step: 0.05 },
} as const;

export const SETTINGS_DEFAULTS: Settings = {
  version: SETTINGS_VERSION,
  // v0 shipped and tuned its follow camera at 60°; kept until a v1 camera
  // exists to argue with it.
  fov: 60,
  lookSensitivity: 1,
  invertY: false,
  // The phone is the target device and nothing is measured yet; start in
  // the middle so a first device pass can move either way.
  quality: 'medium',
  // On while the game is being built: the only machine whose frame rate
  // matters is the one in Joshua's hand, and judging a change without the
  // readout is guessing.
  showFps: true,
};

/**
 * Key. Prefixed like the Core's own documents (`traddomium.v1.*`) rather
 * than bare `settings`: GitHub Pages serves every one of Joshua's projects
 * from the same origin, so a bare key would share one localStorage slot
 * with the other games deployed there.
 */
export const SETTINGS_KEY = 'traddomium.v1.settings';

export const SETTINGS_SPEC: StoreSpec<Settings> = {
  key: SETTINGS_KEY,
  version: SETTINGS_VERSION,
  defaults: SETTINGS_DEFAULTS,
  sanitize: sanitizeSettings,
};

/** Known keys only, every number finite and clamped, every enum a member. Always a fresh object. */
export function sanitizeSettings(raw: unknown, defaults: Settings = SETTINGS_DEFAULTS): Settings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    version: SETTINGS_VERSION,
    fov: finiteNumber(r.fov, defaults.fov, SETTINGS_LIMITS.fov.min, SETTINGS_LIMITS.fov.max),
    lookSensitivity: finiteNumber(
      r.lookSensitivity,
      defaults.lookSensitivity,
      SETTINGS_LIMITS.lookSensitivity.min,
      SETTINGS_LIMITS.lookSensitivity.max,
    ),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : defaults.invertY,
    quality: isQuality(r.quality) ? r.quality : defaults.quality,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : defaults.showFps,
  };
}

export function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITY_LEVELS as readonly string[]).includes(value);
}

/** The settings store on the app's storage — what the panel edits and consumers read. */
export function openSettings(storage: StorageRoot): Store<Settings> {
  return storage.open(SETTINGS_SPEC);
}
