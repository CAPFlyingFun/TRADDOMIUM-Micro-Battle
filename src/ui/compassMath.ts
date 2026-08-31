/**
 * WHERE THINGS ARE, IN DEGREES — the compass without the pixels.
 *
 * Everything here is a pure function of world positions and angles.
 * Nothing touches the DOM, nothing knows how wide the strip is on a
 * phone, and nothing knows what a marker looks like. That separation is
 * the point: bearings are the part that can be wrong in a way nobody
 * notices for weeks, and they are testable only if they are not tangled
 * up with a `translateX`.
 *
 * THE ONE CONVENTION, stated once. This world has north at −Z and east
 * at +X, and a compass bearing counts CLOCKWISE FROM NORTH. Everything
 * below is in that frame, in DEGREES, and the game's own headings —
 * which are radians measured the other way — are converted at the edge
 * by `bearingFromHeading` and never mixed in between.
 */
import type { WorldPoint } from '../world/coords';

/** Fold any angle into 0..360. */
export function wrap360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Fold any angle into −180..180 — the SHORT way round. */
export function wrap180(degrees: number): number {
  return wrap360(degrees + 180) - 180;
}

/**
 * The compass bearing of a direction vector in world space.
 *
 * North is −Z, so a vector pointing that way must read 0 and not 180.
 */
export function bearingOf(x: number, z: number): number {
  return wrap360((Math.atan2(x, -z) * 180) / Math.PI);
}

/**
 * How far above the horizon a direction vector looks, in degrees.
 *
 * Positive is up, matching the pitch convention everything else here
 * uses. The vector is expected normalised — it comes from three's
 * `getWorldDirection` — but the clamp costs nothing and a rounding
 * error of 1.0000001 would otherwise be NaN rather than 90.
 */
export function pitchOf(y: number): number {
  return (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
}

/**
 * A game heading (radians, travel along `(sin h, cos h)`) as a bearing.
 *
 * The two systems disagree twice over — one is radians and one degrees,
 * one counts from +Z and one from −Z — and doing that conversion in
 * place, at each call site, is how a compass ends up correct while
 * walking and mirrored while flying.
 */
export function bearingFromHeading(radians: number): number {
  return bearingOf(Math.sin(radians), Math.cos(radians));
}

/**
 * And back again — a compass bearing in DEGREES to a game heading in
 * RADIANS.
 *
 * The transform is its own inverse, which is a pleasant accident of
 * north being −Z and not a licence to skip it: a fix restored with
 * `bearing * PI / 180` instead of this put the camera 142 degrees off
 * the frame it was meant to be reproducing, and looked plausible
 * enough doing it that only a rendered comparison caught it.
 */
export function headingFromBearing(degrees: number): number {
  const at = (degrees * Math.PI) / 180;
  return Math.atan2(Math.sin(at), -Math.cos(at));
}

/** The bearing from one global point to another. */
export function bearingTo(from: WorldPoint, to: WorldPoint): number {
  return bearingOf(to.wx - from.wx, to.wz - from.wz);
}

/** How far apart two global points are, in world units. */
export function apart(from: WorldPoint, to: WorldPoint): number {
  return Math.hypot(to.wx - from.wx, to.wz - from.wz);
}

/**
 * Ease a shown bearing toward a true one, the short way round.
 *
 * The short way matters: turning from 350° to 10° is twenty degrees,
 * and easing the raw numbers would send the strip whipping backwards
 * through south to get there. Exponential rather than a fixed step per
 * frame, so a phone at 30 fps and one at 120 settle at the same rate.
 *
 * @param tau seconds to close about 63% of the gap
 */
export function easeBearing(
  shown: number, target: number, dt: number, tau: number,
): number {
  const gap = wrap180(target - shown);
  return wrap360(shown + gap * (1 - Math.exp(-dt / Math.max(1e-6, tau))));
}

/** Sixteen points, because "NNE" is what people actually say. */
const POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export function cardinalOf(bearing: number): string {
  return POINTS[Math.round(wrap360(bearing) / 22.5) % 16];
}

/**
 * Something worth pointing at, anywhere on the island.
 *
 * A marker is a GLOBAL position and nothing else — no screen position,
 * no cached bearing. Where it lands on the strip is recomputed from
 * where she is standing every frame, which is the only way it stays
 * right when she walks around it, and the only way it survives the
 * floating origin moving underneath her.
 */
export interface CompassMarker {
  readonly id: string;
  /** Two or three characters. The strip is 30 pixels tall. */
  readonly label: string;
  readonly at: WorldPoint;
  readonly colour: string;
}

/** A marker worked out into something the strip can draw. */
export interface PlacedMarker extends CompassMarker {
  /** Degrees left (−) or right (+) of where she is looking. */
  readonly offset: number;
  /** True when it is off the strip and pinned to an edge. */
  readonly pinned: boolean;
  /** −1 pinned left, +1 pinned right, 0 in view. */
  readonly side: -1 | 0 | 1;
  /** World units away. */
  readonly range: number;
}

/**
 * Put a marker on the strip, or pin it to whichever edge is nearer.
 *
 * BEHIND HER IS THE INTERESTING CASE. A target at 179° and one at
 * −179° are almost the same direction, and both are behind — but the
 * short way to the first is right and to the second is left, so they
 * must pin to opposite edges. Signed relative bearing gives that for
 * free; taking an absolute value first is the version that has both
 * pinning to the same side and looking broken.
 *
 * @param half how many degrees the strip shows either side of centre
 */
export function place(
  marker: CompassMarker, from: WorldPoint, heading: number, half: number,
): PlacedMarker {
  const offset = wrap180(bearingTo(from, marker.at) - heading);
  const pinned = Math.abs(offset) > half;
  return {
    ...marker,
    offset: pinned ? Math.sign(offset) * half : offset,
    pinned,
    side: pinned ? (Math.sign(offset) as -1 | 1) : 0,
    range: apart(from, marker.at),
  };
}

/** Metres, or kilometres once it stops fitting. One unit is a cm. */
export function rangeWords(units: number): string {
  const metres = units / 100;
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)}km`;
  if (metres >= 10) return `${Math.round(metres)}m`;
  return `${metres.toFixed(1)}m`;
}

/**
 * HOW FAST SHE IS ACTUALLY CROSSING THE ISLAND, and what she is flying.
 *
 * Joshua, 2026-08-31, having tried boosted travel: "I couldn't tell if
 * it was x10 times as fast yet." He could not, and the readout was the
 * reason rather than the boost. Her AIRSPEED does not change under it —
 * she still flies at 70 cm/s through the air — and what changes is that
 * her simulation runs ten times for every second the player waits. So
 * the number on the panel sat at 70 cm/s while she covered seven metres
 * of Kauaʻi a second, and there was nothing on screen that said so.
 *
 * Both numbers matter and neither replaces the other, so both are
 * shown: what the world sees her do, and what she is actually flying.
 * `RAL` is Joshua's label — real air speed.
 *
 * At real time it collapses to the old single number, because a
 * parenthesis that always says the same thing as the number in front of
 * it is noise on a line that has already been off the side of a phone
 * once.
 */
export function speedWords(unitsPerSecond: number, travel = 1): string {
  const real = `${unitsPerSecond.toFixed(1)} cm/s`;
  if (!(travel > 1.001)) return real;
  const over = (unitsPerSecond * travel) / 100;
  return `${over.toFixed(1)} m/s (RAL ${unitsPerSecond.toFixed(0)} cm/s)`;
}
