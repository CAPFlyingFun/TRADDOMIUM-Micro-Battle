/**
 * The settings document: the few numbers a player can feel and disagree
 * about, persisted through `persistence/store` so a meddled-with file costs
 * a bad camera angle, not a boot failure.
 *
 * Pure (no DOM): the panel renders it, other modules READ it. The readers
 * are listed on each field. The Performance World honours all of them
 * through a hook built in app/registerScenes.ts.
 *
 * Every number is GAME TUNING, not measured biology.
 */
import { finiteNumber, type StoreSpec, type Store, type Versioned } from '../persistence/store';
import type { StorageRoot } from '../persistence/StorageRoot';

export type Quality = 'low' | 'medium' | 'high';

/**
 * How fast the move stick flies the camera. Its own union rather than
 * `Quality`, because it is not a quality: nothing about it costs the
 * machine anything, and a player who wants low textures and a fast
 * camera is asking for two unrelated things.
 */
export type CameraSpeed = 'slow' | 'medium' | 'fast';

export const CAMERA_SPEED_LEVELS: readonly CameraSpeed[] = ['slow', 'medium', 'fast'];

export const QUALITY_LEVELS: readonly Quality[] = ['low', 'medium', 'high'];

export interface Settings extends Versioned {
  /** Camera field of view in degrees. Reader: the follow / free-fly camera. */
  readonly fov: number;
  /** Multiplier on look-drag turn rate; 1 is the tuned feel. Reader: the camera drag. */
  readonly lookSensitivity: number;
  /** False is the shipped feel: dragging DOWN lifts the view. Reader: the camera drag. */
  readonly invertY: boolean;
  /**
   * TEXTURE size and filtering. Reader: `assets/textureQuality.tierFor`,
   * through the Performance World.
   */
  readonly textures: Quality;
  /**
   * RENDERING DETAIL — how far the waves reach, how many ripple octaves
   * run. Reader: `assets/detailQuality.detailFor`, same route.
   *
   * SEPARATE FROM `textures` SINCE 2026-09-05, on Joshua's instruction:
   * "Probably separate the two like rendering details vs textures. So
   * could do a random combination." They cost different parts of the
   * machine — texture size is GPU memory and fails as a killed tab, wave
   * radius is vertices a frame and fails as a slow one — so one control
   * over both could only ever be tuned for whichever bit first.
   */
  readonly detail: Quality;
  /** The frame-rate readout. Reader: perf/PerfHud. */
  readonly showFps: boolean;
  /**
   * The frame-rate readout folded to its one row. Written when the player
   * taps the sheet's corner (`PerfHud.onCollapse`), read back when the
   * world opens. Reader: perf/PerfHud, through the Performance World.
   */
  readonly hudCollapsed: boolean;
  /**
   * The creature finder: pins over the animals the simulation is holding
   * (Joshua, 2026-09-08, "make a simple 3D finder I can turn on to find
   * them better"). An INSTRUMENT, so it is off by default and nothing in
   * the game reads it — only the Performance World, which draws the pins
   * and offers the GO button. Written when the player flips the switch on
   * the stat sheet. Reader: perf/PerformanceWorldScene.
   */
  readonly finderOn: boolean;
  /**
   * The ceiling a full push of the move stick reaches: 5, 10 or 30 m/s
   * (`perf/FreeFlyCamera.CAMERA_SPEEDS`). Every rung starts at the same
   * 1 m/s, so the setting is the top of the range and not the whole of
   * it. Joshua, 2026-09-08: "I am moving too fast to see them."
   * Reader: perf/PerformanceWorldScene, through the Performance World.
   */
  readonly cameraSpeed: CameraSpeed;
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
  // The phone is the target device; start both in the middle so a device
  // pass can move either axis on its own.
  textures: 'medium',
  detail: 'medium',
  // On while the game is being built: the only machine whose frame rate
  // matters is the one in Joshua's hand, and judging a change without the
  // readout is guessing.
  showFps: true,
  // Open: the sheet is a stat sheet first and a fold second; the fold is
  // the player's to choose and keep.
  hudCollapsed: false,
  // OFF. The pins are an instrument laid over the island, not part of
  // it: nobody's first launch should open on a field of markers.
  finderOn: false,
  // MEDIUM, 1-10 m/s. `fast` is what the camera flew at until now and is
  // still one tap away, but it is a speed for crossing the island, and
  // the island is no longer what there is to look at: at 30 m/s a worm
  // is past before it is seen. This is the answer to "I am moving too
  // fast to see them" for a player who never opens Settings.
  cameraSpeed: 'medium',
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
    // MIGRATED, NOT RESET. Until 2026-09-05 one field named `quality`
    // drove both axes; a document written then still carries it, and a
    // player who chose "low" to save their phone should not silently be
    // put back on medium for having updated. Both axes inherit it, which
    // is exactly what that one setting used to mean.
    textures: isQuality(r.textures) ? r.textures : (isQuality(r.quality) ? r.quality : defaults.textures),
    detail: isQuality(r.detail) ? r.detail : (isQuality(r.quality) ? r.quality : defaults.detail),
    showFps: typeof r.showFps === 'boolean' ? r.showFps : defaults.showFps,
    // No SETTINGS_VERSION bump: a new field with a default reads an older document as it was, plus the default.
    hudCollapsed: typeof r.hudCollapsed === 'boolean' ? r.hudCollapsed : defaults.hudCollapsed,
    finderOn: typeof r.finderOn === 'boolean' ? r.finderOn : defaults.finderOn,
    cameraSpeed: isCameraSpeed(r.cameraSpeed) ? r.cameraSpeed : defaults.cameraSpeed,
  };
}

export function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITY_LEVELS as readonly string[]).includes(value);
}

/** Is this one of the three camera speeds? */
export function isCameraSpeed(value: unknown): value is CameraSpeed {
  return typeof value === 'string' && (CAMERA_SPEED_LEVELS as readonly string[]).includes(value);
}

/** The settings store on the app's storage — what the panel edits and consumers read. */
export function openSettings(storage: StorageRoot): Store<Settings> {
  return storage.open(SETTINGS_SPEC);
}
