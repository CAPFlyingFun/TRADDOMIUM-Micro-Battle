/**
 * WINGS — folded on the ground, opened for the air, beating while up.
 *
 * Two rigs, two opposite rest poses, one rule. The housefly's pair is
 * baked FOLDED back along the abdomen (yaw ±8° from −Z, measured on
 * `Bone_022`/`Bone_024`); the queen's four are baked SPREAD, straight
 * out to the sides and raised ten degrees (yaw ±85–91°, rigs.md §3.4),
 * because v0 shipped her in her flight pose. The old poser yawed each
 * wing OUT from its rest by a constant times the air lever, which is
 * right for a folded rest and wrong for a spread one: applied to the
 * queen it would have swung her wings forward past her head in flight
 * and left them held out sideways while she walked.
 *
 * So the rest is MEASURED and the pose is a TARGET. `WingSpec.restYaw`
 * is the yaw the file baked, ψ_rest = atan2(dir.x, −dir.z) of root→tip
 * in the rig's frame; the wing is turned about the body's up so that its
 * yaw becomes `lerp(ψ_folded, WING_SPREAD_YAW, air)` whatever it started
 * at. For the queen that folds the wings back over the gaster by about
 * 80° while she walks — her chains are 1.86 units long and her gaster
 * tip 1.4 behind the roots, so the folded wings reach a little past it,
 * which is what an alate's do — and lets them open to within 13° of the
 * bind pose as she takes off, which the skinning tolerates.
 *
 * ψ_folded IS THE FILE'S OWN ANSWER WHERE THE FILE HAS ONE. A wing baked
 * within `WING_FOLDED_MAX` of −Z was baked folded, and its fold is its
 * rest — the pose the skin was bound in, which no target can improve on
 * — so a landed fly sits exactly in its bind pose, as it always did. A
 * wing baked out past that was baked spread, and folds to
 * `WING_FOLDED_YAW`, the housefly's measured ±8°. One rule, two rests,
 * and the test holds both.
 *
 * ─── the stroke ─────────────────────────────────────────────────────
 *
 * The flap is a roll about the BODY'S FORWARD axis, mirrored per side
 * so both wings rise together, applied to a wing that has already been
 * yawed out to the side; on a sideways wing that is a stroke up and
 * down. Do NOT copy v0's `queenModel.ts` beat, which rotated each wing
 * root about its own local +Y: on these chains a bone's local +Y is the
 * direction of its own length (the measured root local +Y in the rig's
 * frame is (±0.996, 0.09, 0)), so v0 was twisting the wing about its
 * long axis — a feathering, not a stroke. It looked like movement at
 * 2 MB from a phone; it was not a wingbeat.
 *
 * The queen's fore and hind pairs beat AS ONE with the hind a hair
 * behind and sweeping further: hymenopteran fore and hind wings are
 * hooked into a single surface by the hamuli in flight (BIOLOGICAL
 * SHAPE), and Gui et al. 2010 measured the hindwing's stroke at 135.3°
 * against the forewing's 114.3° on a *S. richteri* female — the 1.18
 * of `HIND_STROKE_RATIO` (MEASURED, congener). The lag is GAME TUNING,
 * a few percent of a cycle, there so the two surfaces read as coupled
 * rather than as one rigid plate.
 *
 * ─── the rate is the species', and it aliases ───────────────────────
 *
 * `WINGBEAT_HZ` is per species. The queen's is the one measured fire
 * ant alate beat, 96 Hz (MEASURED: Gui, Fink, Cao, Sun, Seiner &
 * Streett 2010, *J. Insect Sci.* 10:19 — a *Solenopsis richteri*
 * female, n = 1, a CONGENER of the *S. invicta* the table describes;
 * SUMMARY.md and queen.md ask for exactly this relabel). The
 * housefly's is 170 Hz (MEASURED: Pinto, Magni, O'Brien & Dadour 2022,
 * *Insects* 13(9):822, Table 1, which compiles *Musca domestica* at 130
 * free-flight by Sotavalta 1947, 160–162 tethered by Rockstein &
 * Bhatnagar 1966, and 180 free-flight by optical tachometer, Unwin &
 * Corbet 1984 — 170 is the middle of the measured 130–180, and the
 * older "commonly 150–250" claim is dropped, housefly.md D2). At sixty
 * frames a second both alias — a beat and a half of the queen's and
 * nearly three of the fly's pass between frames — and the brief
 * accepts it: what is drawn reads as the blur real wings are at these
 * rates, and a renderer insisting on the true rate would produce a
 * worse lie than one that strobes. The truth and the picture are kept
 * apart: the number here is the beat, and the aliasing is what a
 * display does to it.
 *
 * ─── the opening ────────────────────────────────────────────────────
 *
 * The wings open as the AIR lever rises (`motion.ts`, `AIR_EASE_S`):
 * the first air word is `takeoff`, so the wings begin to open and beat
 * the moment the body is asked for the air and before it has climbed —
 * queen.md: wing activation precedes launch — and they close again on
 * `land` as the lever falls, with nothing told to fold them. The lever's
 * time constant puts the opening at about a third of a second
 * (`WING_OPEN_S`, GAME TUNING, the brief's ~0.3 s), and the test holds
 * the lever's ease to that.
 *
 * Reads no world coordinate: every rotation is a bone's local quaternion.
 */
import * as THREE from 'three';
import type { CreatureId } from '../creatures';
import { AIR_EASE_S, type RigMotion } from './motion';
import type { WingSpec } from './rig';

/** The wingbeat, cycles a second, per species — see the header for each source. Aliasing accepted. */
export const WINGBEAT_HZ: Readonly<Partial<Record<CreatureId, number>>> = Object.freeze({
  // MEASURED, congener: Gui et al. 2010, S. richteri female, n = 1.
  queen: 96,
  // MEASURED: Pinto et al. 2022 Table 1 — 130 / 160–162 / 180 by method; the middle of the range.
  housefly: 170,
});

/** The beat for a species the table does not name: a rig that turns out to have wings still beats them. GAME TUNING. */
export const WINGBEAT_HZ_DEFAULT = 170;

export function wingbeatHzOf(species: CreatureId): number {
  return WINGBEAT_HZ[species] ?? WINGBEAT_HZ_DEFAULT;
}

/** Flap amplitude about the body's forward axis, radians. GAME TUNING (the brief's ~0.6). */
export const WING_FLAP = 0.6;

/** The hindwing's stroke over the forewing's. MEASURED, congener: 135.3° / 114.3°, Gui et al. 2010. */
export const HIND_STROKE_RATIO = 1.18;

/** How far behind the fore pair the hind pair beats, as a fraction of a cycle. GAME TUNING: coupled, not rigid. */
export const HIND_LAG = 0.04;

/**
 * How much wider each pair behind the fore folds, radians. GAME TUNING:
 * the queen's fore and hind roots sit 0.13 units apart at the same
 * elevation, so folded to one yaw the two membranes would lie in one
 * plane and fight for the pixel; a few degrees of fan stacks them the
 * way a resting alate's lie, the hind under the fore.
 */
export const HIND_FOLD_FAN = (3 * Math.PI) / 180;

/** The yaw from −Z a wing baked SPREAD folds to, radians: the housefly's measured ±8°. */
export const WING_FOLDED_YAW = (8 * Math.PI) / 180;

/** A wing resting within this of −Z was baked folded, and its rest is its fold. GAME TUNING: 30°, well clear of both files (8° and 85–91°). */
export const WING_FOLDED_MAX = (30 * Math.PI) / 180;

/** The yaw from −Z a wing is held out at in flight, radians. GAME TUNING: 75°, within 13° of the queen's bind pose. */
export const WING_SPREAD_YAW = (75 * Math.PI) / 180;

/**
 * Seconds a takeoff takes to open the wings — the air lever's 95% rise
 * (three time constants of `AIR_EASE_S`). GAME TUNING at the brief's
 * ~0.3 s; pinned to the lever rather than a second clock so the wings
 * and the body's attitude open on the same signal.
 */
export const WING_OPEN_S = 3 * AIR_EASE_S;

/** A wing's hinge on one clone. */
export interface BoundWing { readonly bone: THREE.Bone; readonly spec: WingSpec }

/**
 * The yaw a wing folds to: its own rest when it was baked folded, the
 * measured fold — fanned by its rank — when it was baked spread. Unsigned.
 */
export function foldedYawOf(restYaw: number, rank = 0): number {
  const rest = Math.abs(restYaw);
  return rest <= WING_FOLDED_MAX ? rest : WING_FOLDED_YAW + rank * HIND_FOLD_FAN;
}

/** The yaw from −Z a wing with this rest and rank is drawn at for a given air lever — what `wingTurn` leaves it at. Unsigned. */
export function wingYawAt(restYaw: number, air: number, rank = 0): number {
  const folded = foldedYawOf(restYaw, rank);
  return folded + (WING_SPREAD_YAW - folded) * air;
}

/**
 * The turn about the body's up that takes a wing from its baked yaw to
 * the yaw the air lever asks for. Positive yaw is toward +X; a turn
 * about +Y by a NEGATIVE angle carries a −Z-pointing wing toward +X, so
 * the +X wing (side +1) is turned by minus the change and the −X wing
 * by plus it — the `−side` the brief writes. Zero, exactly, for a wing
 * baked folded on the ground.
 */
export function wingTurn(restYaw: number, side: number, air: number, rank = 0): number {
  return -side * (wingYawAt(restYaw, air, rank) - Math.abs(restYaw));
}

const _yaw = new THREE.Quaternion();
const _flap = new THREE.Quaternion();

/**
 * Pose the wings: turned to the yaw the air lever asks for, beating
 * while it is up. Every frame from the REST quaternion, premultiplied —
 * the yaw about the body's up in the hinge's parent frame, then the
 * flap about the body's forward, mirrored per side so both rise
 * together; the hind pair a few percent behind the fore and sweeping
 * `HIND_STROKE_RATIO` further.
 */
export function poseWings(wings: readonly BoundWing[], m: RigMotion, phase: number, hz: number): void {
  const cycle = m.alive * hz + phase;
  for (const { bone, spec } of wings) {
    const hind = spec.rank > 0;
    const beat = Math.sin((cycle - (hind ? HIND_LAG : 0)) * Math.PI * 2) * WING_FLAP * (hind ? HIND_STROKE_RATIO : 1) * m.air;
    _yaw.setFromAxisAngle(spec.up, wingTurn(spec.restYaw, spec.side, m.air, spec.rank));
    _flap.setFromAxisAngle(spec.forward, spec.side * beat);
    bone.quaternion.copy(_flap).multiply(_yaw).multiply(spec.rest);
  }
}
