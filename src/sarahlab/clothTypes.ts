/**
 * THE CLOTH EXPERIMENT'S CONTRACT (Joshua, 2026-10-23: "create another copy of that same shirt, but make that one a true
 * soft body/cloth with simulation over the whole thing and I want to be able to see how much or little having a full
 * soft body cloth fabric would be… if it's not a big performance loss, I'd say, do the soft body cloth as there would
 * be no more trying to sync and match to each point to another point… it would naturally adjust and look better in the
 * game").
 *
 * Three parts meet here and nowhere else:
 * - `clothSim.ts` moves the cloth: particles, its stretch and bend, gravity, and her skin as a floor under each one.
 * - `clothSkin.ts` reads her posed body each frame and says where that floor is under every particle.
 * - The room (`SarahLabScene.ts`) loads the cloth (`public/models/sarah-v2-spandex-cloth.glb`, written by
 *   `scripts/sarahV2Recovery/shirt-cloth.mjs`), runs the two, and draws the result.
 *
 * Every position here is in WORLD units (the room's, `UNITS_PER_METRE` to the metre) unless it says body-local.
 */

/**
 * Where her skin is under each cloth particle this frame, where each pinned particle is held, and where the spot of her
 * skin each particle touched last frame has been carried to.
 */
export interface SkinContacts {
  /** The point on her skin nearest each particle, world (count × 3). */
  readonly point: Float32Array;
  /** Her skin's outward normal at that point, unit length (count × 3). */
  readonly normal: Float32Array;
  /** The least distance off her skin along that normal each particle keeps: the cloth's thickness (count). */
  readonly standOff: Float32Array;
  /**
   * Where each pinned particle is held (count × 3): its own fixed place on her skin, carried by her pose and shape,
   * plus its rest offset along her normal there. Unpinned particles' entries are written too and simply not used.
   */
  readonly pinTarget: Float32Array;
  /**
   * Where LAST frame's contact point on her skin is now (count × 3, world): the same spot of her skin -- the triangle
   * and the barycentric place on it that last frame's `point` was -- posed as she stands this frame. So
   * `carried - before.point` is how far her SKIN moved under the particle, and nothing else.
   *
   * Why it is its own field (Joshua, 2026-10-24, GRIP at its top: the tee "starts ripping up the outfit and does weird
   * stuff about 3s after I adjust the slider"): `point` is the nearest skin to the particle, so it moves when the
   * PARTICLE slides as well as when she does. Friction measured against `after.point - before.point` was told the skin
   * itself had made last frame's slide, and at friction 1 made the particle repeat it, every frame, undamped: stuck
   * cloth walked across her and tore within seconds. The material point is what moves with her, so friction holds to it.
   *
   * On the first update after `ClothSkin.initial` (or a new ClothSkin) there is no last frame's contact; it is `point`
   * then, so a caller that starts with `before` a copy of `after` sees no skin motion at all.
   */
  readonly carried: Float32Array;
}

export function createContacts(count: number): SkinContacts {
  return { point: new Float32Array(count * 3), normal: new Float32Array(count * 3), standOff: new Float32Array(count), pinTarget: new Float32Array(count * 3), carried: new Float32Array(count * 3) };
}

/** Copy every field of `from` into `to` (same count). */
export function copyContacts(from: SkinContacts, to: SkinContacts): void {
  to.point.set(from.point); to.normal.set(from.normal); to.standOff.set(from.standOff); to.pinTarget.set(from.pinTarget); to.carried.set(from.carried);
}

/** Where each cloth particle sat on her body at rest (her approved body at 100%), as the cloth file records it. */
export interface ClothBinding {
  readonly count: number;
  /** The body triangle under each particle at rest, as its three body vertex indices (count × 3). */
  readonly tri: Uint32Array;
  /** Where on that triangle, barycentric (count × 3). */
  readonly bary: Float32Array;
  /** How far the particle stood off her skin there at rest, along her normal, BODY-LOCAL units (count). */
  readonly offset: Float32Array;
}
