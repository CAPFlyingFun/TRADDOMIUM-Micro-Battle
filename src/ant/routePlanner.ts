/**
 * ONE DESTINATION IN, A LIST OF LEGS OUT.
 *
 * The missing middle of TMB's navigation. What existed before this was
 * a brain that decided WHERE she was going and an autopilot that flew
 * STRAIGHT AT IT, which is fine on an empty island and is exactly as
 * good as a straight line ever is.
 *
 *   MissionBrain     where she needs to go, and why
 *   RoutePlanner     this — one destination becomes a list of legs
 *   Autopilot        fly ONE leg: track, band, arrival
 *   Flight           the only thing in the game that moves her
 *
 * IT PLANS ON A PLANE, in centimetres, and that is a deliberate
 * departure from the drone stations this borrows from. Every distance
 * in CanaryGC runs through `EARTH_M_PER_DEG_LAT` and a longitude
 * cosine; TMB is a flat 5,600,000-unit square addressed by `WorldPoint`
 * and porting the geodesy would have imported a coordinate bug and made
 * the code slower for it. On a plane the visibility graph is simpler
 * than theirs, not harder.
 *
 * THE TWO ANSWERS, and which one it gives is decided entirely by
 * `hazards.clearable`:
 *
 *   RAISE     a leg crossing something with a top flies higher.
 *   ROUND     a leg crossing something without one goes around.
 *
 * HOW IT GOES AROUND: a visibility graph over the corners of the
 * buffered footprints, and Dijkstra across it. Not A* over a grid, and
 * the reason is scale — the island is 5,600,000 units across and a rock
 * is a few hundred wide, so a grid fine enough to see the rock has
 * billions of cells. A corner graph only ever holds the corners that
 * exist.
 *
 * AND IT IS BOUNDED, which matters more than optimality on a phone.
 * `maxVertices` caps the graph, and a hazard field too dense to route
 * through honestly returns `blocked` rather than spending a second of
 * somebody's frame budget proving it. CanaryGC caps at 160 for the same
 * reason and says so in the same words: a dense field must not stall
 * the click.
 *
 * IT NEVER REORDERS ANYTHING. The destination is the player's, and a
 * planner that decided to visit it from the other side would be
 * disagreeing with them rather than helping. It may only insert legs
 * between the two ends, raise a leg's floor, and — when the destination
 * itself is inside something she must not enter — move that destination
 * to the nearest point outside it and SAY SO.
 *
 * IT REPORTS A DIFF, for the same reason. A machine that quietly
 * rewrites a plan is a machine nobody trusts twice; `RouteReport` is
 * what the map prints so the change is the player's to see.
 *
 * WHAT IT DOES NOT DO, and deliberately: terrain. The ground is not in
 * the hazard list, because the autopilot already climbs over it
 * reactively every frame against the live heightfield, which is finer
 * than anything a route could carry. A ridge she cannot outclimb is a
 * real gap and it is a route problem, but it needs terrain represented
 * as a region rather than as a circle — that is its own piece of work
 * and inventing half of it here would be worse than leaving the seam
 * visible.
 */
import {
  clearable, ringAround, topFor, type Hazard,
} from './hazards';
import type { WorldPoint } from '../world/coords';

export interface RouteConfig {
  /** Extra room left outside a hazard she must go around, world units. */
  readonly margin: number;
  /**
   * Air kept above the top of something she flies over, world units.
   *
   * Her own floor, 55 cm, and the same number for the same reason: it
   * is the least air the game ever lets her have underneath her, so it
   * is the least she should have over a branch.
   */
  readonly clearance: number;
  /** The most AGL the planner will ask for to clear something. */
  readonly ceilingAgl: number;
  /** Corners per hazard footprint. */
  readonly sides: number;
  /** The graph bound. Past this the route is refused, not laboured over. */
  readonly maxVertices: number;
}

export const ROUTE_DEFAULTS: RouteConfig = {
  // Three metres — about two of her body lengths clear of the edge, and
  // wide enough that the track-hold's own wander cannot wash it out.
  margin: 300,
  clearance: 55,
  // The same ceiling the band search will not look above. A planner
  // that asked for an altitude the executor refuses to fly is a planner
  // that produces plans nobody follows.
  ceilingAgl: 3_000,
  sides: 8,
  maxVertices: 160,
};

/** One straight run. The autopilot flies exactly one of these at a time. */
export interface RouteLeg {
  /** Where this leg ends, in WORLD coordinates. */
  readonly to: WorldPoint;
  /**
   * The least AGL this leg may be flown at, world units.
   *
   * A FLOOR AND NOT A HEIGHT. The band search still chooses where in the
   * air she actually flies — this only says how low it may look. Two
   * systems both entitled to name her altitude would fight; one naming a
   * minimum and the other choosing above it does not.
   */
  readonly floorAgl: number;
  /** True when the planner inserted this, rather than the player. */
  readonly detour: boolean;
}

/** What the planner did to the plan. */
export interface RouteReport {
  /**
   * HAZARDS THE STRAIGHT LINE WOULD HAVE HIT.
   *
   * What the player cares about — how many things she is going around —
   * and not the same number as `detours`. One circular no-go takes two
   * corner waypoints to pass, so the first cut of this said "round 2
   * hazards" for one hazard, which is a readout lying about the world
   * rather than about itself.
   */
  readonly avoided: number;
  /** Corner waypoints inserted to get around them. */
  readonly detours: number;
  /** Legs given a floor above the default, to get over something. */
  readonly raised: number;
  /** The destination was inside a no-go and had to be moved. */
  readonly moved: boolean;
  /** No route was found. The legs are the straight line, flown honestly. */
  readonly blocked: boolean;
  readonly changed: boolean;
}

export interface RoutePlan {
  readonly legs: readonly RouteLeg[];
  readonly report: RouteReport;
}

type Ring = readonly WorldPoint[];

const NOTHING: RouteReport = {
  avoided: 0, detours: 0, raised: 0, moved: false, blocked: false, changed: false,
};

function apart(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.wx - a.wx, b.wz - a.wz);
}

/** Is the point inside the ring? Ray casting, and the ring is closed. */
export function inside(p: WorldPoint, ring: Ring): boolean {
  let win = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.wz > p.wz) !== (b.wz > p.wz)
      && p.wx < ((b.wx - a.wx) * (p.wz - a.wz)) / (b.wz - a.wz) + a.wx) {
      win = !win;
    }
  }
  return win;
}

/**
 * Does the segment go into the ring at all?
 *
 * EXACT, BY CLIPPING, and it took two bugs to get here — both of them
 * found by tests that turned out to be right when I assumed they were
 * wrong.
 *
 * The obvious implementation is "do any edges cross, or is the midpoint
 * inside". It is wrong twice over, and both failures put a queen
 * through the middle of the thing she is avoiding:
 *
 *   ALONG AN EDGE. The router's own nodes are ring CORNERS, so the
 *   segment between two ADJACENT corners IS the ring's edge. A midpoint
 *   test at a point sitting exactly on the boundary answers whichever
 *   way the arithmetic falls, and where it fell "inside", neighbouring
 *   corners could not see each other and she could only ever go the
 *   LONG way round. Measured: a zone 30 m off her line drew an 83 m
 *   northward dog-leg when a 23 m southward one was open.
 *
 *   CORNER TO CORNER. A segment entering at one vertex and leaving by
 *   the opposite one crosses no edge PROPERLY — every crossing is at a
 *   shared endpoint — and on a long leg the midpoint is nowhere near
 *   the ring. So it reads as clear while passing straight through the
 *   centre. Rings on a circle, all the same shape, produce exactly that
 *   alignment constantly: the test that caught it was a pen of sixteen
 *   overlapping hazards that she strolled out of.
 *
 * So: clip the segment against the polygon's half-planes (Cyrus-Beck)
 * and ask whether any INTERVAL of it is strictly inside. Strictly, so
 * running along an edge and touching a corner both come out clear —
 * which is what they are — while any real passage through has positive
 * length and is caught. No epsilon fudge, no orientation convention,
 * and it needs the ring to be convex, which is exactly what
 * `ringAround` builds and the only thing that ever builds one.
 */
export function entersRing(a: WorldPoint, b: WorldPoint, ring: Ring): boolean {
  let cx = 0;
  let cz = 0;
  for (const c of ring) { cx += c.wx; cz += c.wz; }
  cx /= ring.length;
  cz /= ring.length;

  let lo = 0;
  let hi = 1;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j];
    const q = ring[i];
    // The edge's normal, turned to face OUT — decided against the
    // centroid rather than against a winding order, so the ring may be
    // built either way round without this caring.
    let nx = q.wz - p.wz;
    let nz = -(q.wx - p.wx);
    if (nx * (cx - p.wx) + nz * (cz - p.wz) > 0) { nx = -nx; nz = -nz; }

    const fa = nx * (a.wx - p.wx) + nz * (a.wz - p.wz);
    const fb = nx * (b.wx - p.wx) + nz * (b.wz - p.wz);
    const rate = fb - fa;
    if (Math.abs(rate) < 1e-12) {
      // Parallel to this edge. Either the whole segment is on the inner
      // side of it and the other edges decide, or it is on the line or
      // beyond it — and a segment lying ON a boundary is not inside.
      if (fa >= 0) return false;
      continue;
    }
    const cut = -fa / rate;
    if (rate > 0) hi = Math.min(hi, cut);
    else lo = Math.max(lo, cut);
    if (lo >= hi) return false;
  }
  // A positive length of segment strictly inside. A corner clipped
  // exactly collapses this to a point, which is a touch and not an
  // entry.
  return hi - lo > 1e-9;
}

function clearOf(a: WorldPoint, b: WorldPoint, rings: readonly Ring[]): boolean {
  return !rings.some((ring) => entersRing(a, b, ring));
}

/**
 * The nearest point outside every ring the point is inside.
 *
 * FOR A DESTINATION THAT CANNOT BE FLOWN TO — a pin dropped in the
 * middle of a no-go. Refusing outright would be the strictly correct
 * answer and the wrong product: the player pointed at somewhere, and
 * the useful reply is the closest place to it she can actually be,
 * clearly reported as a move. CanaryGC does the same thing for a
 * waypoint inside restricted airspace, and for the same reason.
 *
 * Pushed straight out from the centre past the ring's own furthest
 * corner, so the result is outside by construction rather than by
 * iteration.
 */
export function pushOut(
  p: WorldPoint, rings: readonly Ring[], margin: number,
): WorldPoint {
  let moved = p;
  for (const ring of rings) {
    if (!inside(moved, ring)) continue;
    let cx = 0;
    let cz = 0;
    for (const c of ring) { cx += c.wx; cz += c.wz; }
    const centre = { wx: cx / ring.length, wz: cz / ring.length };
    let outX = moved.wx - centre.wx;
    let outZ = moved.wz - centre.wz;
    let len = Math.hypot(outX, outZ);
    if (len < 1) {
      // Dead centre has no direction of its own. East is as good as any
      // and it is at least the SAME every time, which a random nudge
      // would not be — a plan that differs between two frames that
      // agree about the world is a plan nobody can debug.
      outX = 1;
      outZ = 0;
      len = 1;
    }
    let reach = 0;
    for (const c of ring) {
      reach = Math.max(reach, apart(centre, c));
    }
    const scale = (reach + margin) / len;
    moved = { wx: centre.wx + outX * scale, wz: centre.wz + outZ * scale };
  }
  return moved;
}

/**
 * The shortest way from `a` to `b` that enters none of the rings.
 *
 * A visibility graph over the ring corners, and Dijkstra across it.
 * Returns the CORNERS TO VISIT — not including the ends — or null when
 * there is no way through.
 *
 * The optimal path around polygonal obstacles bends only at their
 * corners, which is the whole reason this works: the continuous problem
 * has a finite answer and the corners are it.
 */
export function routeAround(
  a: WorldPoint, b: WorldPoint, rings: readonly Ring[], maxVertices: number,
): WorldPoint[] | null {
  const nodes: WorldPoint[] = [a, b];
  for (const ring of rings) {
    for (const corner of ring) {
      if (nodes.length >= maxVertices) break;
      nodes.push(corner);
    }
  }

  const n = nodes.length;
  const best = new Array<number>(n).fill(Infinity);
  const from = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[0] = 0;

  for (let step = 0; step < n; step++) {
    let at = -1;
    let near = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && best[i] < near) { near = best[i]; at = i; }
    }
    if (at === -1) break;
    if (at === 1) break;
    done[at] = true;
    for (let to = 0; to < n; to++) {
      if (done[to] || to === at) continue;
      if (!clearOf(nodes[at], nodes[to], rings)) continue;
      const cost = best[at] + apart(nodes[at], nodes[to]);
      if (cost < best[to]) { best[to] = cost; from[to] = at; }
    }
  }

  if (!Number.isFinite(best[1])) return null;
  const path: WorldPoint[] = [];
  for (let at = from[1]; at > 1; at = from[at]) path.unshift(nodes[at]);
  return path;
}

/**
 * The floor a straight run needs to pass over everything it crosses.
 *
 * The tallest demand wins, and only hazards the run actually enters
 * count — a tree beside the leg is not a tree in it.
 */
export function floorFor(
  a: WorldPoint, b: WorldPoint,
  overflown: readonly { ring: Ring; top: number }[],
  base: number,
): number {
  let floor = base;
  for (const { ring, top } of overflown) {
    if (top > floor && entersRing(a, b, ring)) floor = top;
  }
  return floor;
}

/**
 * PLAN THE ROUTE.
 *
 * @param from where she is
 * @param to where she has been asked to go
 * @param hazards everything known to be in the way
 * @param baseFloor the AGL the autopilot would fly at anyway
 */
export function planRoute(
  from: WorldPoint,
  to: WorldPoint,
  hazards: readonly Hazard[],
  baseFloor: number,
  cfg: RouteConfig = ROUTE_DEFAULTS,
): RoutePlan {
  if (hazards.length === 0) {
    return {
      legs: [{ to, floorAgl: baseFloor, detour: false }],
      report: NOTHING,
    };
  }

  // THE SPLIT. Everything downstream is one of these two lists, and
  // which list a hazard lands in is the only decision this file makes
  // about it.
  const around: Ring[] = [];
  const over: { ring: Ring; top: number }[] = [];
  for (const hazard of hazards) {
    const ring = ringAround(hazard, cfg.margin, cfg.sides);
    if (clearable(hazard, cfg.clearance, cfg.ceilingAgl)) {
      const top = topFor(hazard, cfg.clearance);
      if (top !== null) over.push({ ring, top });
    } else {
      around.push(ring);
    }
  }

  // A DESTINATION SHE CANNOT BE AT is moved to the nearest place she
  // can, before anything tries to route to it.
  const target = pushOut(to, around, cfg.margin);
  const moved = target.wx !== to.wx || target.wz !== to.wz;

  // AND SO IS A START, which is not the same case and must not be
  // treated as one: she is ALREADY there. Nothing can be planned out of
  // it, so the corner she is standing in is simply not allowed to make
  // the route look impossible — the rings she is inside are dropped for
  // the search, and the leg out is flown honestly.
  const trapped = around.filter((ring) => inside(from, ring));
  const blocking = trapped.length > 0
    ? around.filter((ring) => !trapped.includes(ring))
    : around;

  let detours: WorldPoint[] = [];
  let blocked = false;
  const avoided = blocking.filter((ring) => entersRing(from, target, ring)).length;
  if (avoided > 0) {
    const way = routeAround(from, target, blocking, cfg.maxVertices);
    if (way === null) {
      // NO WAY THROUGH. She still flies the straight line — an executor
      // that let go of the controls to announce a problem would turn a
      // bad route into a crash — and the report says it is unrouted so
      // something upstream can decide what to do about it.
      blocked = true;
    } else {
      detours = way;
    }
  }

  const stops = [...detours, target];
  const legs: RouteLeg[] = [];
  let at = from;
  let raised = 0;
  for (let i = 0; i < stops.length; i++) {
    const next = stops[i];
    const floorAgl = floorFor(at, next, over, baseFloor);
    if (floorAgl > baseFloor) raised++;
    legs.push({ to: next, floorAgl, detour: i < stops.length - 1 });
    at = next;
  }

  return {
    legs,
    report: {
      avoided,
      detours: detours.length,
      raised,
      moved,
      blocked,
      changed: detours.length > 0 || raised > 0 || moved || blocked,
    },
  };
}

/**
 * The plan in one line, for the map and the developer register.
 *
 * Empty when the planner did nothing, because a line that says "changed
 * nothing" every time is a line that gets read once.
 */
export function routeWords(report: RouteReport): string {
  if (!report.changed) return '';
  const said: string[] = [];
  if (report.avoided > 0) {
    said.push(`round ${report.avoided} hazard${report.avoided === 1 ? '' : 's'}`);
  }
  if (report.raised > 0) {
    said.push(`over ${report.raised} leg${report.raised === 1 ? '' : 's'}`);
  }
  if (report.moved) said.push('pin moved clear');
  if (report.blocked) said.push('NO CLEAR ROUTE');
  return said.join(' · ');
}
