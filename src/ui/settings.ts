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
  /**
   * How far toward the blurred island to go. 0 is real Kauai. Separate
   * from the height dial because they do different things: height makes
   * a crease shallower in proportion, smoothing removes it.
   */
  terrainSmoothing: number;
  /**
   * Whole-model flight tempo. 1 is the tuned baseline; the dial exists
   * because the right number is a thing you feel on a phone, not a
   * thing anyone derives at a keyboard.
   */
  flightSpeed: number;
  /**
   * How much of the real wind actually reaches her in flight, 0 to 1.
   *
   * ONE is the honest answer and the default: the measured wind, added
   * to her air velocity, exactly as the physics says. It is on a dial
   * because the honest answer may not be a playable one, and that is a
   * judgement to make on a phone rather than at a keyboard.
   *
   * The arithmetic behind the worry: her best powered airspeed is
   * 0.70 m/s, and Kauaʻi's ordinary trade winds run 15–25 km/h, which
   * is 4.2–6.9 m/s — six to ten times what she can fly. At 1.0 a queen
   * who takes off in normal weather is a leaf, every time, everywhere.
   * That is real, and it is also why fire ants hold their nuptial
   * flights on still evenings rather than in the trades.
   *
   * Lower it and the wind still does everything it should — headwind,
   * tailwind, crosswind drift, the lot — at a share of its true
   * strength. Nothing else about the model changes.
   */
  windInfluence: number;
  invertLookX: boolean;
  /** False is the shipped feel: dragging DOWN lifts the view. */
  invertLookY: boolean;
  invertStickY: boolean;
  /**
   * Whether to use the real island's current weather.
   *
   * Off is the offline model — no network, plausible Kauaʻi conditions
   * built on the same orographic gradient. It is here as a CHOICE and
   * not only as a fallback: on a plane, on a bad connection, or when
   * someone would simply rather the sky did not depend on a third
   * party, "simulated" should be a thing you can ask for rather than a
   * thing that happens to you.
   */
  liveWeather: boolean;
  /**
   * How far the full-detail ground texture reaches, as a multiple of
   * the tuned baseline. Distance goes with the square root: 4x here is
   * 2x the radius. At 1 the detail holds to roughly 7 cm around her
   * and is gone by 17 from the default camera.
   */
  detailRange: number;
}

export const DEFAULTS: Readonly<Settings> = {
  turnRate: TURN_RATE,
  turnStart: REST_DEADZONE,
  turnEase: REST_EASE,
  fov: 58,
  cameraDistance: 7.8,
  // FOUND BY ACCIDENT, KEPT ON PURPOSE. Joshua left the height dial at
  // 150% while testing smoothing and the pair read better than either
  // alone. Measured on the drawn surface within 400 units of the spawn:
  //
  //   0% / 100% (was)   mean crease 3.24deg  worst 46.1deg  peak 53u
  //   100% / 100%       mean 1.52deg         worst 20.5deg  peak 49u
  //   100% / 150%       mean 2.24deg         worst 30.2deg  peak 74u
  //
  // Better than the old default on BOTH counts: a third gentler on
  // average, worst fold cut from 46 to 30 degrees, and 40% taller.
  // Smoothing takes the drama away with the creases; the height dial
  // puts the drama back, and being proportional it cannot put the
  // creases back with it.
  //
  // The height is game TUNING, not the island: 150% makes this Kauai
  // steeper than the real one, whose relief ratio is 2.84%.
  terrainRelief: 1.5,
  terrainSmoothing: 1,
  flightSpeed: 1,
  windInfluence: 1,
  invertLookX: false,
  invertLookY: false,
  invertStickY: false,
  liveWeather: true,
  detailRange: 1,
};

/** What a slider may ask for. Anything outside is clamped, not refused. */
export const LIMITS = {
  turnRate: { min: 4, max: 30, step: 1 },
  turnStart: { min: 0, max: (75 * Math.PI) / 180, step: (5 * Math.PI) / 180 },
  turnEase: { min: 1, max: 14, step: 0.5 },
  fov: { min: 40, max: 100, step: 1 },
  cameraDistance: { min: 3.5, max: 16, step: 0.2 },
  terrainRelief: { min: 0.1, max: 1.5, step: 0.05 },
  terrainSmoothing: { min: 0, max: 1, step: 0.05 },
  flightSpeed: { min: 0.25, max: 2, step: 0.05 },
  windInfluence: { min: 0, max: 1, step: 0.05 },
  detailRange: { min: 0.5, max: 4, step: 0.25 },
} as const;

export type Dial = keyof typeof LIMITS;
export type Toggle = 'invertLookX' | 'invertLookY' | 'invertStickY'
  | 'liveWeather';

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
