/**
 * CHAPTER 1'S LABORATORY, AS A SET — where the picture's camera stood,
 * where the chair and the two people are, and the shots. Pure numbers in
 * METRES in the ROOM FRAME the bake measured (`scripts/bakeStoryLab.py`):
 * x to the right, y up, z toward the camera that took the picture, the
 * floor at y = 0 and that camera at (0, 1.43, 0).
 *
 * WHERE THE ROOM CAME FROM. Not the floor plan in `world/tombs` — that is
 * the game's building, walked at eye height. This is the story's
 * laboratory: the painted picture the visual story uses for Jack's lab
 * (`art/story/lab-night.jpg`, Joshua's Bazaart outpaint of it, 2026-09-29),
 * with its camera recovered from the picture's own lines and the room
 * rebuilt as boxes so the picture could be baked back onto them. Seen from
 * that camera the 3D room IS the picture (mean difference 2.2 levels of
 * 255); moved away from it, the shapes are real and the painting stays on
 * them. What the picture never saw — the wall behind the camera, with its
 * sliding door — comes from ChatGPT's blueprint of the room.
 *
 * WHERE THE PEOPLE CAME FROM. The 2D storybook's own staging
 * (`TMB-Story/visual/scenes/ch01-opening.js`): its stage coordinates are
 * the same picture's pixels, so a floor point there is a floor point here
 * through the same camera. Jack starts asleep at stage (720, 1200), which
 * is room (−0.43, −3.05), turned toward his monitor on the back desk.
 *
 * Pure: no three, no DOM, so the set can be checked in node.
 */

export type Vec3M = readonly [number, number, number];

/** The picture's camera: where the 2D story's every frame was painted from. */
export const PICTURE_CAMERA = Object.freeze({
  position: [0, 1.43, 0] as Vec3M,
  /**
   * Turned 5.2° to the right of the room's long axis: the room's depth
   * lines meet 119 px left of the picture's centre at a 1300 px focal
   * length. three's `rotation.y` is anticlockwise from above, so it is −.
   */
  yawDeg: 5.22,
  /**
   * The original painting's field of view, 76.4° across 2048 px at a 1300
   * px focal length. The night outpaint adds room around it but the
   * story's wide shot frames the original, so the shot does too.
   */
  horizontalFovDeg: 76.4,
});

/** The room's inside, for keeping a free camera and a placement honest. */
export const ROOM = Object.freeze({ xl: -1.45, xr: 2.15, zBack: -3.91, zSouth: 1.1, ceiling: 2.62 });

/** A task chair (EN 1335-1 / BIFMA G1 proportions), sized to the one in the 2D sprites. */
export const CHAIR = Object.freeze({
  seatWidth: 0.48, seatDepth: 0.46, seatThickness: 0.07,
  /** Seat top: the pose decides the final height (`seatFor`); this is the fallback. */
  seatHeight: 0.47,
  backWidth: 0.44, backHeight: 0.52, backGap: 0.08, backTiltDeg: 10,
  armHeight: 0.2, baseRadius: 0.32, casterRadius: 0.028, columnRadius: 0.025,
});

export interface Placement {
  /** Floor point, metres. */
  readonly at: Vec3M;
  /** Which way the body faces, as three's `rotation.y` (the masters face +z). */
  readonly yaw: number;
}

/** Facing from one floor point toward another, as three's rotation.y (`atan2(dx, dz)`). */
export function yawToward(from: Vec3M, to: Vec3M): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

/** Jack's monitor on the back desk: the 2D story's `jack-monitor`, measured on the picture. */
export const JACK_MONITOR: Vec3M = [0.8, 1.21, -3.8];

/** Jack, asleep in his chair at the story's opening (stage (720, 1200)). */
export const JACK_CHAIR: Placement = Object.freeze({
  at: [-0.43, 0, -3.05] as Vec3M,
  yaw: yawToward([-0.43, 0, -3.05], [JACK_MONITOR[0], 0, JACK_MONITOR[2]]),
});

/**
 * Sarah, standing in the aisle a little behind him and turned toward
 * him — where she stops in the 2D story when she first speaks to him.
 */
export const SARAH_STAND: Placement = Object.freeze({
  at: [0.42, 0, -2.25] as Vec3M,
  yaw: yawToward([0.42, 0, -2.25], [-0.43, 0, -3.05]),
});

/** Where Jack's head is when he is asleep in the chair, for a camera to look at. */
export const JACK_HEAD_SEATED: Vec3M = [-0.40, 1.2, -3.02];

export interface Shot {
  readonly id: string;
  readonly label: string;
  readonly position: Vec3M;
  /** Point the camera looks at, or null to use `yawDeg`/`pitchDeg`. */
  readonly target: Vec3M | null;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  /** Horizontal field of view, degrees: framing is by WIDTH, so a phone and a tablet see the same sides. */
  readonly hfovDeg: number;
}

/** The story's wide: the picture exactly, from the doorway. */
export const WIDE: Shot = Object.freeze({
  id: 'wide', label: 'WIDE',
  position: PICTURE_CAMERA.position, target: null,
  yawDeg: -PICTURE_CAMERA.yawDeg, pitchDeg: 0, hfovDeg: PICTURE_CAMERA.horizontalFovDeg,
});

/** The end of the push-in: over the aisle, close on Jack asleep at his desk. */
export const CLOSE_ON_JACK: Shot = Object.freeze({
  id: 'close', label: 'PUSH IN',
  position: [0.05, 1.42, -1.75] as Vec3M, target: JACK_HEAD_SEATED,
  yawDeg: 0, pitchDeg: 0, hfovDeg: 52,
});

/** How long the push-in takes, seconds: the 2D story's slow drift toward Jack asleep. */
export const PUSH_SECONDS = 9;

/** Smoothstep, for the push: starts and ends at rest. */
export function ease(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}
