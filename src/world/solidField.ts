/**
 * ONE SURFACE, GROUND AND BARK ALIKE.
 *
 * Joshua: "let's make the trees able to climb/walk." The obvious way
 * to build that is a CLIMBING MODE — a state she enters at the foot of
 * a trunk, with its own controls, its own camera and its own way of
 * falling off. Thronemound built the other thing on its block room and
 * it is much better, so this borrows the IDEA and none of the code:
 *
 *   AN ANT DOES NOT HAVE A DOWN. IT HAS A SURFACE, AND THE SURFACE IS
 *   DOWN.
 *
 * Express the world as a signed scalar — positive inside solid — and
 * her up is simply the direction that number falls away fastest. Then
 * there is no mode to enter and no transition to write: walking up a
 * trunk is walking, and the join at its foot is a place where the
 * gradient happens to turn ninety degrees over a couple of
 * centimetres.
 *
 * WHAT THIS IS NOT. Thronemound's `surfaceWalk.ts` is six hundred
 * lines because it walks a VOXEL field that the player is digging away
 * underneath her: it marches for contacts, hunts round convex lips
 * with a fan of arcs, and spends most of its length steadying an
 * attitude goal that genuinely flickers between faces while the soil
 * changes. TMB has exactly two solids, neither of them mutable, and
 * both hand back an EXACT signed depth rather than a yes/no. So the
 * hard parts are not needed here and are deliberately absent. Porting
 * them would have brought a voxel world's problems into a heightfield
 * one.
 *
 * THE UNION IS A MAX, which is what "inside either" means for signed
 * fields. It is not a true distance where the two meet — a max makes a
 * crease, not a fillet — and that is fine at this scale: the crease is
 * at the foot of the trunk, it is a couple of centimetres across, and
 * her up crosses it in a few frames because it is rate-limited anyway.
 */
import { groundHeight } from './heightfield';

/**
 * The sampling arm for the gradient, world units — two centimetres.
 *
 * Small enough to resolve the curve of a trunk: over 2 units of a
 * 56-unit bark radius the surface turns about two degrees, so the
 * normal is a genuine local reading rather than a chord across the
 * whole trunk. Large enough that it is not measuring float residue,
 * and it comfortably exceeds nothing in the terrain, whose drawn
 * triangles are 10.94 units across near her — so a central difference
 * on the ground returns the triangle's own slope, which is the surface
 * she is actually standing on.
 */
export const CELL = 2;

/** A point in the rendered world. Not a WorldPoint: this one has a y. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Anything that can say how deep inside itself a point is. */
export interface Solid {
  depthAt(x: number, y: number, z: number): number;
}

/**
 * THE GROUND, AS A SOLID.
 *
 * Its depth is `groundHeight - y`, the same signed quantity the wood
 * reports and in the same units — which is the property that lets one
 * walker handle both. It is not a Euclidean distance on a slope (it
 * measures straight down rather than perpendicular) and nothing needs
 * it to be: gradients are read from differences, and a consistent
 * overestimate in one direction does not tilt one.
 */
export const GROUND: Solid = {
  depthAt: (x, y, z) => groundHeight(x, z) - y,
};

/**
 * INSIDE EITHER, which for signed fields is a max.
 *
 * WHO UNIONS WHAT IS A REAL DECISION, not plumbing — this used to
 * happen inside `depthAt`, so every query silently included the
 * ground, and taking hold of a trunk became impossible: a queen
 * standing beside one is standing ON the ground, so the ground was
 * always the nearest surface and the cast that should have found bark
 * found her own feet. The composition is the caller's now, because the
 * caller is the only one that knows which question it is asking.
 *
 * The max makes a crease where two solids meet rather than a fillet.
 * At the foot of a trunk that crease is a couple of centimetres across
 * and her attitude is rate-limited anyway, so it is never seen.
 */
export function unionOf(...solids: readonly (Solid | null)[]): Solid {
  return {
    depthAt: (x, y, z) => {
      let best = -Infinity;
      for (const one of solids) {
        if (one === null) continue;
        const deep = one.depthAt(x, y, z);
        if (deep > best) best = deep;
      }
      return best;
    },
  };
}

/** How far inside this solid the point is. Negative outside. */
export function depthAt(at: Spot, solid: Solid | null): number {
  return solid === null ? -Infinity : solid.depthAt(at.x, at.y, at.z);
}

/** Is this point inside it? */
export function solidAt(at: Spot, solid: Solid | null): boolean {
  return depthAt(at, solid) > 0;
}

/**
 * WHICH WAY IS UP HERE — the outward normal, from the field's gradient.
 *
 * Central differences, so where two surfaces meet the answer is the
 * blend between them over a couple of centimetres rather than a jump
 * between two faces. That blend is the whole mechanism: it is what
 * rolls her onto the bark as she reaches the foot of a trunk, instead
 * of her needing to be told that a tree is a different kind of thing
 * to stand on.
 *
 * Falls back to world up in the one case with no gradient at all —
 * deep inside solid, or in open air far from anything — because a zero
 * vector is not an attitude and every caller would have to handle it.
 */
export function normalAt(at: Spot, solid: Solid | null, cell = CELL): Spot {
  const x = depthAt({ x: at.x - cell, y: at.y, z: at.z }, solid)
    - depthAt({ x: at.x + cell, y: at.y, z: at.z }, solid);
  const y = depthAt({ x: at.x, y: at.y - cell, z: at.z }, solid)
    - depthAt({ x: at.x, y: at.y + cell, z: at.z }, solid);
  const z = depthAt({ x: at.x, y: at.y, z: at.z - cell }, solid)
    - depthAt({ x: at.x, y: at.y, z: at.z + cell }, solid);
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

/** Where a cast found the surface, and which way it faces there. */
export interface Contact {
  readonly at: Spot;
  readonly up: Spot;
  /** How far along the cast it was found. */
  readonly range: number;
}

/**
 * CAST FOR THE SURFACE, from a point in the air along a direction.
 *
 * March and then bisect, rather than trusting the depth as a distance
 * and stepping by it: the ground's term is a vertical drop and
 * overshoots badly on a slope, and Newton off a max-union can walk
 * along the crease instead of across it. Marching cannot do either,
 * and the reach here is a few centimetres, so it is cheap.
 *
 * Returns null when the cast finds nothing, which is the honest answer
 * and means she is in the air.
 */
export function castFor(
  from: Spot, dir: Spot, reach: number, solid: Solid | null, cell = CELL,
): Contact | null {
  const step = cell * 0.5;
  const walk = (d: number): Spot => ({
    x: from.x + dir.x * d, y: from.y + dir.y * d, z: from.z + dir.z * d,
  });
  let out = 0;
  for (let d = 0; d <= reach; d += step) {
    if (!solidAt(walk(d), solid)) { out = d; continue; }
    // Found solid. Bisect between the last empty sample and this one.
    let lo = out;
    let hi = d;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) * 0.5;
      if (solidAt(walk(mid), solid)) hi = mid; else lo = mid;
    }
    const at = walk(hi);
    return { at, up: normalAt(at, solid, cell), range: hi };
  }
  return null;
}
