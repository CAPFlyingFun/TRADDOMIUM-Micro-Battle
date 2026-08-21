/**
 * RAIN, AROUND HER AND NOWHERE ELSE.
 *
 * The island is fifty-six kilometres across and the weather field
 * covers all of it, but the field is numbers. Drawing rain over
 * five and a half million units of terrain to render the fraction of it
 * within a metre of the camera would be the same mistake as loading the
 * whole heightfield to walk on one hill. So: a box of drops that
 * follows the camera, wrapping around it, and a global field that says
 * how hard it should be falling THERE. Two future players on opposite
 * coasts each get their own weather this way, and neither pays for the
 * other's.
 *
 * RAIN AT THIS SCALE IS NOT WEATHER, IT IS ARTILLERY. A 2 mm raindrop
 * reaches about 6.5 m/s falling — Gunn and Kinzer measured the curve in
 * still air and it has stood since 1949 [J. Meteor. 6 (1949) 243–248].
 * At one centimetre to the unit that is 650 units a second, past an
 * animal 0.55 units long. A drop is a third of her body wide and
 * crosses the whole visible volume in a fifth of a second. Nothing
 * about that needed exaggerating for effect, so nothing has been.
 *
 * The drop COUNT is real too: about a thousand drops per cubic metre in
 * heavy rain, which is what 1,200 of them in this volume works out to.
 *
 * The box lives in RENDER space, deliberately. Rain is the textbook
 * local effect — it has no identity, nothing refers to it later, and
 * nothing persists. Contrast the stations, which are global forever.
 */
import * as THREE from 'three';
import type { GameWeather } from './gameplay';

/** Drops in the air at the hardest rain. */
const MAX_DROPS = 1_200;

/** Half the width of the volume, in world units — 60 cm each way. */
const SPREAD = 60;
/** Half its height. */
const RISE = 45;

/** Terminal velocity of a 2 mm drop, in units per second. */
const FALL = 650;
/** How much sideways a full-strength wind gives it. */
const DRIFT = 420;

/** Seconds of fall a streak represents. Pure look. */
const SMEAR = 0.011;

export class Rain {
  private readonly line: THREE.LineSegments;
  private readonly points: Float32Array;
  /** Where each drop is RELATIVE TO THE CAMERA. */
  private readonly place: Float32Array;
  private readonly material: THREE.LineBasicMaterial;
  private falling = 0;
  private drops = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.place = new Float32Array(MAX_DROPS * 3);
    this.points = new Float32Array(MAX_DROPS * 6);

    for (let i = 0; i < MAX_DROPS; i += 1) {
      this.place[i * 3] = (Math.random() - 0.5) * 2 * SPREAD;
      this.place[i * 3 + 1] = (Math.random() - 0.5) * 2 * RISE;
      this.place[i * 3 + 2] = (Math.random() - 0.5) * 2 * SPREAD;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.points, 3));
    geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      color: 0xbcd4e8,
      transparent: true,
      opacity: 0,
      // Depth TEST on, so a hill in front of a drop hides it and drops
      // below ground never show. Depth WRITE off, so a near drop does
      // not punch a hole in the drop behind it.
      depthWrite: false,
      fog: true,
    });

    this.line = new THREE.LineSegments(geometry, this.material);
    // The box is rebuilt around the camera every frame, so culling it
    // against a stale bounding sphere only ever hides it wrongly.
    this.line.frustumCulled = false;
    this.line.renderOrder = 2;
    this.line.visible = false;
    scene.add(this.line);
  }

  /**
   * @param at the camera's RENDERED position — this is a local effect.
   * @param dt simulated seconds.
   */
  update(at: THREE.Vector3, now: GameWeather, dt: number): void {
    // Easing the count as well as the field means a shower does not
    // arrive as 1,200 drops appearing in one frame.
    this.falling += (now.rainfall - this.falling)
      * (1 - Math.exp(-dt / 2.5));

    const drops = Math.round(this.falling * MAX_DROPS);
    this.drops = drops;
    if (drops <= 0) {
      this.line.visible = false;
      return;
    }
    this.line.visible = true;
    this.material.opacity = 0.28 + this.falling * 0.42;

    // Heavier rain falls faster: bigger drops, higher terminal velocity.
    const fall = FALL * (0.72 + this.falling * 0.28);
    const gust = now.windStrength * DRIFT;
    const driftX = Math.sin(now.windHeading) * gust;
    const driftZ = Math.cos(now.windHeading) * gust;

    const dy = -fall * dt;
    const dx = driftX * dt;
    const dz = driftZ * dt;

    const tailX = -driftX * SMEAR;
    const tailY = fall * SMEAR;
    const tailZ = -driftZ * SMEAR;

    for (let i = 0; i < drops; i += 1) {
      const p = i * 3;
      let x = this.place[p] + dx;
      let y = this.place[p + 1] + dy;
      let z = this.place[p + 2] + dz;

      // Wrap around the camera. Modulo rather than "if past the edge,
      // reset to the top": at 650 units a second a drop can cross the
      // whole box in a single slow frame, and a single-step reset would
      // leave it stranded outside.
      x = wrap(x, SPREAD);
      y = wrap(y, RISE);
      z = wrap(z, SPREAD);

      this.place[p] = x;
      this.place[p + 1] = y;
      this.place[p + 2] = z;

      const v = i * 6;
      this.points[v] = at.x + x;
      this.points[v + 1] = at.y + y;
      this.points[v + 2] = at.z + z;
      this.points[v + 3] = at.x + x + tailX;
      this.points[v + 4] = at.y + y + tailY;
      this.points[v + 5] = at.z + z + tailZ;
    }

    this.line.geometry.setDrawRange(0, drops * 2);
    const position = this.line.geometry
      .getAttribute('position') as THREE.BufferAttribute;
    // Only the drops actually drawn were written, so only they are
    // sent. In light rain that is a tenth of the buffer.
    position.clearUpdateRanges();
    position.addUpdateRange(0, drops * 6);
    position.needsUpdate = true;
  }

  /** How many drops are in the air. What a probe counts. */
  get drawing(): number {
    return this.drops;
  }

  dispose(): void {
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    this.material.dispose();
  }
}

/** Fold a coordinate back into [-half, half], however far out it is. */
function wrap(value: number, half: number): number {
  const span = half * 2;
  let folded = (value + half) % span;
  if (folded < 0) folded += span;
  return folded - half;
}
