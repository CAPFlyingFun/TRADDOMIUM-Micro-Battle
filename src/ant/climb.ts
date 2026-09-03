/**
 * IS SHE ON BARK, AND WHERE DOES THAT PUT HER?
 *
 * The decision half of climbing, kept out of `PlayerAnt` so it can be
 * measured without a renderer — and kept out of `solidField` because
 * that module answers questions about the WORLD and this one answers a
 * question about HER.
 *
 * WHY THERE IS NO CLIMB BUTTON, AND NO CLIMB MODE. She grips whatever
 * is under her. The field in world/solidField.ts makes bark and ground
 * the same kind of thing, so walking into a trunk rolls her onto it the
 * way walking onto a slope tips her — and walking back down rolls her
 * off. Joshua asked for trees she can "climb/walk", and those are the
 * same verb here.
 *
 * WHY THE GROUND IS NOT DONE THIS WAY TOO. It could be: the union
 * field describes the terrain perfectly well, and reading her attitude
 * off it everywhere would be less code than this. It would also change
 * how she sits on every hillside in the game — the terrain normal
 * would ROLL her, where today the slope only pitches her body, eased,
 * off samples a body-length fore and aft. That is a visual change to
 * something nobody asked about, on ground the player looks at
 * constantly, and it is not what "make the trees climbable" is. So the
 * ground keeps its own seat exactly as it was, and only wood claims
 * her.
 *
 * THE RATE LIMIT IS THE TRANSITION. There is no blend function between
 * "on the ground" and "on bark" and there does not need to be one: the
 * attitude goal switches outright, and `gripUp` turns that into a
 * three-quarter-second roll. The join is a movement because a body
 * cannot snap, not because anything here interpolates.
 */
import { groundHeight } from '../world/heightfield';
import { castFor, normalAt, type Solid, type Spot } from '../world/solidField';
import type { Way } from './surfaceGrip';

export const WORLD_UP: Way = { x: 0, y: 1, z: 0 };

/**
 * How far off the bark she can be and still be holding on, world units.
 *
 * A SKIN, NOT A REACH, and it used to be the other thing. It was 22 —
 * past her own body radius — because the collision held her 18 clear
 * of the bark and a grip that could not span that gap could never take
 * hold of a trunk she had just walked into. But a 22-unit reach also
 * grabs a trunk she is merely STANDING BESIDE, on flat ground, which
 * is what "something when on the ground and trying to fly, it starts
 * to and fails" was: she was holding a tree she was not on.
 *
 * The collision now stops a WALKER at the bark itself rather than a
 * body-radius off it (see PlayerAnt.settle), so touching is touching
 * and this only has to cover the float in the arithmetic.
 */
export const GRIP_REACH = 4;

/**
 * HOW LONG SHE STAYS OFF A SURFACE AFTER LETTING GO, seconds.
 *
 * Joshua: "when flying off the tree it snaps right back to the tree
 * (needs like a 1s protection so it can get off without snapping
 * back)." Exactly right, and the reason is that a takeoff begins with
 * her still against the bark: `letGo` releases her, the next frame
 * finds the same trunk a centimetre away, and she is back on it before
 * the wings have done anything. A second of her own clock is enough to
 * be gone.
 */
export const LET_GO_SECONDS = 1;

/**
 * How far the seating cast looks, world units.
 *
 * From a lift off her back, down through where she is, and out the
 * other side far enough to find bark that has curved away as she came
 * round it.
 */
export const SEAT_REACH = 60;

/**
 * How far under the ground a perch may still be, world units.
 *
 * A few centimetres of slack, because the drawn ground and the queried
 * ground disagree by a little on a slope and the foot of a trunk is
 * exactly where that matters — she has to be able to take hold at
 * ground level, and refusing on a millimetre would make the bottom of
 * every tree ungrippable.
 */
export const FOOTING = 8;

/** Where she is holding on, and which way that surface faces. */
export interface Perch {
  /** Seated on the surface — her origin, the same convention as ground. */
  readonly at: Spot;
  /** The surface's outward normal there: her attitude GOAL, unlimited. */
  readonly up: Way;
}

/**
 * Find the bark under her, if she is on any.
 *
 * Null means she is not gripping wood, and the caller should seat her
 * on the ground the way it always has.
 *
 * THE CAST GOES ALONG THE FIELD'S NORMAL, not along her own up, and
 * that took a failing test to get right. Her up is where she IS, and
 * on the ground beside a trunk it points at the sky while the bark is
 * sideways — so a cast along it looks for a floor under her feet,
 * finds sixty centimetres of empty air, and reports no perch. She
 * could only ever take hold of a trunk she was already holding.
 *
 * The field's normal is the direction out of the nearest solid, so its
 * reverse points AT that solid whatever she happens to be standing on.
 * That is what lets a queen walking on the ground reach out and take
 * the bark she has just bumped into.
 *
 * AND THE FIELD IS THE WOOD ALONE, with no ground in it. That is the
 * whole reason the first version could not take hold of anything: a
 * queen standing beside a trunk is standing ON the ground, so a union
 * field's nearest surface is always her own feet, the cast went
 * straight down, and it found dirt every time. The ground is not this
 * module's business — it has a seat of its own that works.
 */
export function perchOn(
  spot: Spot, solids: Solid | null,
  grip = GRIP_REACH, reach = SEAT_REACH,
): Perch | null {
  if (solids === null) return null;
  // Cheap reject first: the depth at her centre says whether there is
  // any wood within reach at all, and on open ground there never is.
  // This is also what keeps every ordinary step on the island away
  // from the marching below.
  if (solids.depthAt(spot.x, spot.y, spot.z) < -grip) return null;
  const toward = normalAt(spot, solids);
  const from: Spot = {
    x: spot.x + toward.x * reach * 0.5,
    y: spot.y + toward.y * reach * 0.5,
    z: spot.z + toward.z * reach * 0.5,
  };
  const hit = castFor(
    from, { x: -toward.x, y: -toward.y, z: -toward.z }, reach, solids,
  );
  if (hit === null) return null;
  // NOT BELOW THE GROUND. A trunk is seated with its foot sunk a
  // handspan under the surface so it never stands on air where the
  // drawn mesh dips (LandmarkStand.burial), and that buried stub is
  // still solid to this cast — so a queen walking down a trunk walks
  // into the dirt, and round the bottom cap onto its UNDERSIDE. The
  // probe found her 80 cm under the forest floor with her up pointing
  // at the ground. Wood below the ground is not a surface.
  if (hit.at.y < groundHeight(hit.at.x, hit.at.z) - FOOTING) return null;
  return { at: hit.at, up: hit.up };
}

/**
 * The attitude she should be aiming for, given what she is holding.
 *
 * On wood it is the surface. Off it, WORLD UP — deliberately, and not
 * the terrain's normal: see the note at the top about not re-seating
 * her on every hillside in the game.
 */
export function aimFor(perch: Perch | null): Way {
  return perch === null ? WORLD_UP : perch.up;
}

/**
 * Is she far enough off vertical to be treated as climbing?
 *
 * Used for the readout and for the camera, which has to stop assuming
 * the world's up is hers. The threshold is generous — about eight
 * degrees — because the answer only needs to change once she is
 * genuinely leaning onto something.
 */
export function isClimbing(up: Way): boolean {
  return up.y < 0.99;
}

/**
 * Move her along the surface she is on.
 *
 * The stick is camera-relative and gives a direction in the world's
 * horizontal plane. On flat ground that direction is already in her
 * tangent plane and this returns it untouched — which is why walking
 * about on the island is byte-for-byte what it was. On a trunk it
 * tips the SAME input onto the bark, so pushing forward at a tree
 * walks her up it without the stick meaning anything new.
 */
export function alongSurface(move: Spot, up: Way): Spot {
  const along = move.x * up.x + move.y * up.y + move.z * up.z;
  return {
    x: move.x - up.x * along,
    y: move.y - up.y * along,
    z: move.z - up.z * along,
  };
}
