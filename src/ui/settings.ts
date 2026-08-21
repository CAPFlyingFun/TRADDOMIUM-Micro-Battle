/**
 * SETTINGS — the numbers that were arguments.
 *
 * Every constant this session has been tuned by pushing a new build and
 * waiting for Pages: change a number, deploy, test on the phone, repeat.
 * That loop is the expensive part, and it is the reason this exists
 * ahead of its milestone. Anything the player can feel and disagree
 * about belongs here, where it can be moved on the device.
 *
 * The DEFAULTS are the values already tuned, so the game out of the box
 * is exactly the game before this file existed. Settings widen what is
 * possible; they do not decide what is good.
 */
import {
  REST_DEADZONE, REST_EASE, TURN_RATE,
} from '../ant/pace';

export interface Settings {
  /** How fast her body comes onto the view while she is driven. */
  turnRate: number;
  /** How far the view may stray at rest before she turns, in RADIANS. */
  turnStart: number;
  /** How briskly she closes that gap. Higher is quicker. */
  turnEase: number;
  /** Camera field of view, in degrees. */
  fov: number;
  /** How far behind her the camera sits, in world units. */
  cameraDistance: number;
  /**
   * How tall the island is, as a multiple. 1 is real Kauai, which is
   * one of the steepest landscapes on Earth and reads rough at ant
   * scale; lower flattens every slope by the same factor.
   */
  terrainRelief: number;
  invertLookX: boolean;
  /** False is the shipped feel: dragging DOWN lifts the view. */
  invertLookY: boolean;
  invertStickY: boolean;
}

export const DEFAULTS: Readonly<Settings> = {
  turnRate: TURN_RATE,
  turnStart: REST_DEADZONE,
  turnEase: REST_EASE,
  fov: 58,
  cameraDistance: 7.8,
  terrainRelief: 1,
  invertLookX: false,
  invertLookY: false,
  invertStickY: false,
};

/** What a slider may ask for. Anything outside is clamped, not refused. */
export const LIMITS = {
  turnRate: { min: 4, max: 30, step: 1 },
  turnStart: { min: 0, max: (75 * Math.PI) / 180, step: (5 * Math.PI) / 180 },
  turnEase: { min: 1, max: 14, step: 0.5 },
  fov: { min: 40, max: 100, step: 1 },
  cameraDistance: { min: 3.5, max: 16, step: 0.2 },
  terrainRelief: { min: 0.1, max: 1.5, step: 0.05 },
} as const;

export type Dial = keyof typeof LIMITS;
export type Toggle = 'invertLookX' | 'invertLookY' | 'invertStickY';

const STORE = 'traddomium.settings';

let current: Settings = { ...DEFAULTS };
const listeners = new Set<(s: Settings) => void>();

/** The settings in force. Read every frame; never mutate the result. */
export function settings(): Readonly<Settings> {
  return current;
}

export function clamp(dial: Dial, value: number): number {
  const { min, max } = LIMITS[dial];
  if (!Number.isFinite(value)) return DEFAULTS[dial];
  return Math.min(max, Math.max(min, value));
}

export function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const next = typeof value === 'number'
    ? clamp(key as Dial, value) as Settings[K]
    : value;
  if (current[key] === next) return;
  current = { ...current, [key]: next };
  save();
  for (const tell of listeners) tell(current);
}

export function reset(): void {
  current = { ...DEFAULTS };
  save();
  for (const tell of listeners) tell(current);
}

export function onChange(tell: (s: Settings) => void): () => void {
  listeners.add(tell);
  return () => listeners.delete(tell);
}

/**
 * Read what was saved, keeping anything unrecognised out.
 *
 * A stored file is not trustworthy input: it can be from an older build
 * with keys that have since changed meaning, or hand-edited. Only known
 * keys of the right type are taken, and every number is clamped, so a
 * bad store degrades to the defaults rather than to an unplayable game.
 */
export function load(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE);
  } catch {
    return; // Private windows and blocked storage: defaults are fine.
  }
  if (!raw) return;

  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof saved !== 'object' || saved === null) return;

  const next = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
    const value = (saved as Record<string, unknown>)[key];
    if (typeof DEFAULTS[key] === 'number') {
      if (typeof value === 'number') {
        (next[key] as number) = clamp(key as Dial, value);
      }
    } else if (typeof value === 'boolean') {
      (next[key] as boolean) = value;
    }
  }
  current = next;
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(current));
  } catch {
    // Nothing to be done, and nothing worth interrupting play for.
  }
}
