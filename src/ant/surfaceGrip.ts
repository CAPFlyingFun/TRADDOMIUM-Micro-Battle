/**
 * HER UP, AND HOW FAST IT IS ALLOWED TO CHANGE.
 *
 * The field in world/solidField.ts says which way the surface faces.
 * This says which way SHE faces, which is not the same thing and must
 * not be: a normal read per frame steps across the crease at the foot
 * of a trunk in one sample, and a body that changes attitude in one
 * frame does not read as an animal. Thronemound measured exactly this
 * and wrote it down — its walker's third rule is "her up has a speed
 * limit", after the phone reported a corner as "jumps around it".
 *
 * ONE FUNCTION, EASED THEN RATE-CAPPED. Thronemound needs a good deal
 * more than this — a two-sample mean and a low-pass ahead of the ease,
 * and a trapezoid on the rate — because it is walking a field the
 * player is DIGGING, where the nearest surface genuinely alternates
 * between faces on alternate frames. TMB's solids do not move. The
 * gradient it reads is smooth and repeatable, so the filtering that
 * exists to steady a flickering sample would only add lag here, and is
 * deliberately not copied.
 *
 * PURE, so the fold can be measured rather than watched.
 */

/** A direction. Assumed unit length. */
export interface Way {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How fast her attitude closes on the surface, per second.
 *
 * An exponential gain, so ordinary terrain — where the goal moves a
 * degree or two — is followed almost exactly, and only a real fold
 * ever reaches the cap below.
 */
export const GRIP_EASE = 8;

/**
 * The ceiling on that, radians a second.
 *
 * 240 degrees a second: the right angle at the foot of a trunk is
 * therefore three quarters of a second of rolling onto the bark, which
 * is a movement the eye can follow. Faster reads as a snap; slower and
 * she is still lying down halfway up the trunk.
 */
export const MOST_TILT = (240 * Math.PI) / 180;

export function dot(a: Way, b: Way): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function unit(x: number, y: number, z: number, fallback: Way): Way {
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return fallback;
  return { x: x / len, y: y / len, z: z / len };
}

/** The angle between two directions, radians. */
export function angleBetween(a: Way, b: Way): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/**
 * Turn `from` toward `to` by at most `most` radians.
 *
 * A rotation about the axis they share, done as a normalised blend
 * along the arc — which is a slerp, written out, because the only
 * quaternion in the neighbourhood would be built and discarded.
 */
export function turnToward(from: Way, to: Way, most: number): Way {
  const swing = angleBetween(from, to);
  // Normalised even on the pass-through: the contract says the inputs
  // are unit vectors, and returning one verbatim is how a caller that
  // got that slightly wrong propagates it into an attitude. Writing
  // these tests produced exactly that mistake twice, which is enough
  // evidence that the assumption should not also be load-bearing.
  if (swing <= most || swing < 1e-9) return unit(to.x, to.y, to.z, from);
  if (Math.PI - swing < 1e-6) {
    // Exactly upside down: every axis is equally valid, so the arc is
    // undefined. Nudge off any perpendicular and let the next frame
    // find the real one. This is unreachable in play — she would have
    // to be on the underside of something — but a NaN attitude is not
    // a thing to leave lying around.
    const side = Math.abs(from.y) < 0.9
      ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const off = dot(side, from);
    return unit(
      side.x - from.x * off, side.y - from.y * off, side.z - from.z * off, from,
    );
  }
  // Gram-Schmidt: the part of `to` square to `from` is the direction
  // she is turning in, and the arc is a step along it.
  const along = dot(from, to);
  const side = unit(
    to.x - from.x * along, to.y - from.y * along, to.z - from.z * along, from,
  );
  const c = Math.cos(most);
  const s = Math.sin(most);
  return unit(
    from.x * c + side.x * s, from.y * c + side.y * s, from.z * c + side.z * s, from,
  );
}

/**
 * One frame of attitude: ease toward the surface, then cap the rate.
 *
 * The cap is applied to the EASED step rather than to the goal, so the
 * two compose the way they read: the ease decides how eagerly she
 * wants to be square with the surface, and the cap decides how fast a
 * body is physically allowed to roll.
 */
export function gripUp(
  up: Way, surface: Way, dt: number,
  ease = GRIP_EASE, most = MOST_TILT,
): Way {
  if (dt <= 0) return up;
  const share = 1 - Math.exp(-ease * dt);
  const wanted = unit(
    up.x + (surface.x - up.x) * share,
    up.y + (surface.y - up.y) * share,
    up.z + (surface.z - up.z) * share,
    up,
  );
  return turnToward(up, wanted, most * dt);
}

/**
 * Keep her nose square to her own up.
 *
 * Her heading is a direction along the surface, and the surface has
 * just turned underneath it. Re-squaring rather than recomputing is
 * what carries her facing round the corner with her: walk at a trunk
 * and she ends up pointing UP it, which is what an ant does, instead
 * of being re-derived from a world-space compass that has no opinion
 * about bark.
 */
export function squareTo(forward: Way, up: Way): Way {
  const along = dot(forward, up);
  return unit(
    forward.x - up.x * along,
    forward.y - up.y * along,
    forward.z - up.z * along,
    // Degenerate only when her nose is exactly along her up, which
    // means the surface rolled a full ninety degrees in one frame —
    // the rate cap exists to make that unreachable.
    { x: up.y, y: -up.x, z: 0 },
  );
}

/**
 * CARRY A DIRECTION FROM ONE UP TO ANOTHER.
 *
 * The minimal rotation taking `from` onto `to`, applied to `v`. Also
 * called parallel transport, and it is the piece that makes climbing
 * feel like anything at all.
 *
 * WHY FLATTENING IS NOT ENOUGH, measured. `alongSurface` — projecting
 * the step onto her tangent plane — is the obvious way to keep her on
 * a surface, and it is right up until the surface is vertical. A queen
 * pressed against a trunk with the stick pushed forward got a step of
 * (-0.73, 0.03, -0.44): the part heading into the bark was removed, as
 * it should be, and what was left pointed AROUND the trunk. She rose
 * 4.8 cm in eight seconds of pushing. A horizontal bearing projected
 * onto a vertical plane is still horizontal; there is no upward
 * component to keep, because there was never one to begin with.
 *
 * Transport instead of projecting and the whole frame tips with her:
 * the direction that was "forward, into the tree" becomes "up the
 * tree", because that is where forward WENT when her up rolled ninety
 * degrees onto the bark. Length is preserved, so she climbs at walking
 * pace rather than at some fraction of it.
 *
 * ON THE GROUND IT IS THE IDENTITY — `from` and `to` are the same
 * vector, the rotation is nothing, and every step she takes on the
 * island is the step she took before any of this existed.
 */
export function transport(v: Way, from: Way, to: Way): Way {
  const cos = dot(from, to);
  // Already there. The common case by a wide margin: she is on the
  // ground, and this is the line that keeps walking about free.
  if (cos > 1 - 1e-9) return v;
  const axis = {
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
  };
  const len = Math.hypot(axis.x, axis.y, axis.z);
  if (len < 1e-9) {
    // Exactly opposed: the rotation is a half turn about an undefined
    // axis. Unreachable while her up is rate-limited off world up, and
    // a silent NaN is not worth the risk.
    return { x: -v.x, y: v.y, z: -v.z };
  }
  const k = { x: axis.x / len, y: axis.y / len, z: axis.z / len };
  const sin = len;
  // Rodrigues. `cos` and `sin` come straight off the dot and cross, so
  // no angle is ever formed and no arccos is taken.
  const cross = {
    x: k.y * v.z - k.z * v.y,
    y: k.z * v.x - k.x * v.z,
    z: k.x * v.y - k.y * v.x,
  };
  const along = dot(k, v) * (1 - cos);
  return {
    x: v.x * cos + cross.x * sin + k.x * along,
    y: v.y * cos + cross.y * sin + k.y * along,
    z: v.z * cos + cross.z * sin + k.z * along,
  };
}

/** Turn a direction about an axis, right-handed, by an angle. */
export function spinAbout(v: Way, axis: Way, radians: number): Way {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const cross = {
    x: axis.y * v.z - axis.z * v.y,
    y: axis.z * v.x - axis.x * v.z,
    z: axis.x * v.y - axis.y * v.x,
  };
  const along = dot(axis, v) * (1 - c);
  return unit(
    v.x * c + cross.x * s + axis.x * along,
    v.y * c + cross.y * s + axis.y * along,
    v.z * c + cross.z * s + axis.z * along,
    v,
  );
}
