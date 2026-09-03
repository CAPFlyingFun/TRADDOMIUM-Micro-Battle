/**
 * WHAT IS IN HER WAY RIGHT NOW — a forward march, not a route.
 *
 * Joshua, after watching her clip trunks on a routed flight: "Can you
 * not have it scan ahead 10-20 meters and will alter the trajectory
 * left or right basically having its own first person camera view and
 * if anything is like in the center one third grid camera rule, will
 * try and make it out of it and if not, will slow down, descend and
 * make an effort to avoid it? I forgot the name but there is something
 * we used in TCS for like digging that is like a projector."
 *
 * He means `biteCentre` — Thronemound's dig stroke marches a ray out
 * along her aim, sampling until it finds something solid, and draws a
 * ghost where it lands. Same idea, and the only thing taken: a short
 * ray forward and the first thing on it. None of that code fits here
 * (it walks a voxel field for soil) and none of it is needed: at TMB's
 * scale the things in her way are circles on a plane, so the march is
 * arithmetic.
 *
 * WHY THIS AND NOT THE ROUTE PLANNER. Because a forest cannot be routed
 * around and the readout said so: `trees 8/338`. The visibility graph
 * is bounded at 160 vertices, which affords eight octagons, and in real
 * jungle three hundred trunks straddle a single leg. Eight is two per
 * cent of the problem and she flies through the rest.
 *
 * So trees are now what TERRAIN has always been in this project — see
 * the note at the top of routePlanner.ts: "the ground is not in the
 * hazard list, because the autopilot already climbs over it reactively
 * every frame, which is finer than anything a route could carry." A
 * trunk is the same kind of fact. The route stays for things that are
 * genuinely no-go regions; what is simply in front of her is dodged in
 * front of her.
 *
 * AND NOT BY FLYING OVER. That was the other option and Joshua turned
 * it down for a good reason: "flying over if the winds are pushing you
 * were you need to go will work otherwise will take you in the wrong
 * direction." He is right — altitude in this game is a WIND choice
 * (see bestBand), so spending it on obstacle clearance takes the band
 * search's only lever away.
 *
 * PURE. Trunks come in as values, so a test hands it a plantation
 * without a world.
 */
import type { WorldPoint } from '../world/coords';

/** Something standing in her way. A circle, because that is all it is. */
export interface Trunk {
  readonly id: string;
  readonly at: WorldPoint;
  /** Footprint radius, world units. */
  readonly radius: number;
}

/** The one thing worth doing something about, and what to do. */
export interface Threat {
  readonly id: string;
  /** How far ahead along her track, world units. */
  readonly range: number;
  /**
   * Signed lateral offset of its CENTRE from the track line, world
   * units. Positive is to her right.
   */
  readonly off: number;
  /**
   * HOW MUCH OF THE LANE IT TAKES, 0 to 1 — Joshua's centre third.
   *
   * One when it is dead on the line, nought at the lane's edge. The
   * lane is her own width plus the margin, so this is "how far into the
   * middle of the frame is it" without a camera to ask.
   */
  readonly squeeze: number;
  /** Which way round: +1 to pass it on her right, -1 on her left. */
  readonly way: 1 | -1;
  /** The bearing change that opens the gap, degrees. Signed. */
  readonly swerve: number;
  /**
   * NEITHER SIDE HAS ROOM. The swerve is still the best of a bad pair,
   * and this is what tells the controller to slow down and get low
   * rather than to trust it.
   */
  readonly pinched: boolean;
}

/** Compass bearing to a unit vector. North is -Z, east is +X. */
function along(bearing: number): { fx: number; fz: number; rx: number; rz: number } {
  const b = (bearing * Math.PI) / 180;
  // Forward, and ninety degrees clockwise from it.
  return { fx: Math.sin(b), fz: -Math.cos(b), rx: Math.cos(b), rz: Math.sin(b) };
}

/**
 * MARCH THE LANE AND REPORT THE FIRST THING IN IT.
 *
 * @param from where she is
 * @param track the bearing she is actually MAKING GOOD, not her nose —
 *   the same distinction the whole autopilot turns on. A crabbing queen
 *   is carried sideways, and it is the carried line that hits the tree.
 * @param reach how far ahead to look, world units
 * @param lane half the width she needs to pass through, world units
 * @param trunks everything nearby; this decides what is relevant
 */
export function lookout(
  from: WorldPoint, track: number, reach: number, lane: number,
  trunks: readonly Trunk[],
): Threat | null {
  if (!(reach > 0)) return null;
  const { fx, fz, rx, rz } = along(track);
  // Everything ahead, with its lane geometry worked out once.
  const seen: { t: Trunk; range: number; off: number; need: number }[] = [];
  for (const t of trunks) {
    const dx = t.at.wx - from.wx;
    const dz = t.at.wz - from.wz;
    const range = dx * fx + dz * fz;
    if (range <= 0 || range > reach) continue;
    seen.push({ t, range, off: dx * rx + dz * rz, need: t.radius + lane });
  }
  // THE NEAREST ONE IN THE LANE IS THE ONE THAT MATTERS. Not the worst,
  // not the average: she is about to reach this one, and whatever is
  // behind it will still be there when she has.
  let first: typeof seen[number] | null = null;
  for (const one of seen) {
    if (Math.abs(one.off) >= one.need) continue;
    if (first === null || one.range < first.range) first = one;
  }
  if (first === null) return null;

  // WHICH WAY ROUND: the side it is NOT on. A trunk dead centre is a
  // coin toss, and a stable one — its own position breaks the tie, so
  // she does not dither between two equally good answers frame to
  // frame.
  const prefer: 1 | -1 = first.off > 0 ? -1 : 1;
  // ...and where she would have to be, laterally, to clear it.
  const gapAt = (way: 1 | -1): number => first!.off + way * first!.need;
  /** Would going this way put her into something else? */
  const blocked = (way: 1 | -1): boolean => {
    const want = gapAt(way);
    return seen.some((other) => other.t.id !== first!.t.id
      // Only things she would meet at about the same moment.
      && Math.abs(other.range - first!.range) < other.need * 2
      && Math.abs(other.off - want) < other.need);
  };
  const way: 1 | -1 = blocked(prefer) && !blocked(prefer === 1 ? -1 : 1)
    ? (prefer === 1 ? -1 : 1)
    : prefer;
  const pinched = blocked(way);
  return {
    id: first.t.id,
    range: first.range,
    off: first.off,
    squeeze: 1 - Math.abs(first.off) / first.need,
    way,
    // The angle off her track that puts her at the gap by the time she
    // arrives. Small when the thing is far, urgent when it is close —
    // which is the whole behaviour, and it needs no gain to tune.
    swerve: (Math.atan2(gapAt(way), Math.max(1, first.range)) * 180) / Math.PI,
    pinched,
  };
}

/**
 * HOW FAR AHEAD TO LOOK, world units.
 *
 * Joshua asked for ten to twenty metres, and that is the range at the
 * speed he was flying: the boosted autopilot makes good about seven
 * metres a second, so twenty metres is under three seconds of warning.
 * Scaled by the speed she is actually making so the WARNING TIME stays
 * constant — a queen crawling at 70 cm/s does not need to watch the
 * next twenty metres, and one at ten times that needs every centimetre
 * of it.
 */
export function reachFor(groundSpeed: number, seconds = 2.4): number {
  return Math.max(800, Math.min(2_000, Math.abs(groundSpeed) * seconds));
}
