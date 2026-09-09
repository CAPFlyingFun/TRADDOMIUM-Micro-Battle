/**
 * TAP-TO-POSSESS — which creature a tap on the screen means.
 *
 * Joshua's Creature Lab brief, §7 C: "raycast from camera/touch onto
 * creature", and §4's rule that gives the answer its shape: the row of
 * name buttons exists because "tiny 2.5 mm aphids" would otherwise be
 * "impossible to tap accurately". A ray against the animals' geometry
 * would have exactly that problem — an aphid is a few pixels, a thumb
 * is forty — so this is not a ray. It is the SCREEN test: each
 * creature's drawn centre is projected, and the tap takes the nearest
 * centre that lies within the LARGER of the creature's own projected
 * body radius and a thumb (`minPixels`, `TAP_PIXELS`). A queen filling
 * the screen is picked anywhere on her body; an aphid four pixels wide
 * is picked from twenty-two pixels away. Nearest CENTRE among those in
 * reach, not nearest by fraction of reach, because the case that
 * matters is the small animal beside the big one — a worker walking
 * past the queen the camera is on: a tap on the worker's body is nearer
 * its centre than the queen's, and the worker is what was meant.
 *
 * PURE OVER THE READERS IT IS HANDED. It never touches a scene, a mesh
 * or a creature: `positionOf` says where an id is drawn (render
 * coordinates — the rendered centre is what the tap is measured against,
 * and it is a renderer that answers) or null for one not drawn this
 * frame; `radiusOf` its body radius in world units. So the same function
 * picks from a `FaunaView`, from a test's table of points, and from
 * whatever draws the next five creatures.
 *
 * READS THE CAMERA, NEVER UPDATES IT. `camera.matrixWorldInverse` and
 * `camera.projectionMatrix` are used as they stand: a tap arrives
 * between frames, after a render that brought both up to date, and a
 * module mutates only state it owns. A caller with a camera that has
 * not rendered calls `updateMatrixWorld()` itself, as the test does.
 *
 * Allocation-free per call: four module-level vectors and an index
 * loop.
 */
import * as THREE from 'three';

/** A point on the screen in normalised device coordinates: −1..1 on both axes, y up. */
export interface Ndc {
  readonly x: number;
  readonly y: number;
}

/** The screen's size in pixels, which is what turns an NDC distance into a thumb's. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * A thumb's reach, pixels: half of the 44-point touch target the
 * platform guidelines ask for. GAME TUNING — the radius inside which a
 * creature of no size at all is still tapped.
 */
export const TAP_PIXELS = 22;

const view = new THREE.Vector3();
const ndc = new THREE.Vector3();
const right = new THREE.Vector3();
const edge = new THREE.Vector3();

/**
 * Where a render-space point lands on the screen, pixels from the
 * centre with y up, or false when it is behind the eye — a point behind
 * a perspective camera projects MIRRORED onto the screen, and a tap must
 * never pick a creature at the player's back.
 */
function toScreen(point: THREE.Vector3, camera: THREE.Camera, halfW: number, halfH: number, out: THREE.Vector3): boolean {
  view.copy(point).applyMatrix4(camera.matrixWorldInverse);
  if (!(view.z < 0)) return false;
  ndc.copy(view).applyMatrix4(camera.projectionMatrix);
  out.set(ndc.x * halfW, ndc.y * halfH, 0);
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

const centre = new THREE.Vector3();
const rim = new THREE.Vector3();

/**
 * The creature under a tap, or null when none is in reach.
 *
 * @param tap        the tap in NDC (−1..1, y up).
 * @param camera     the camera the frame was drawn with, matrices current.
 * @param ids        the creatures that may be picked — the caller's list,
 *                   which is how a scene leaves out what it likes.
 * @param positionOf a creature's drawn centre in render coordinates, or
 *                   null when it is not drawn.
 * @param radiusOf   its body radius, world units; zero or less is a point.
 * @param minPixels  a thumb: the reach every creature gets at least.
 * @param viewport   the screen in pixels, which `minPixels` is measured in.
 */
export function pickCreature(
  tap: Ndc,
  camera: THREE.Camera,
  ids: readonly string[],
  positionOf: (id: string) => THREE.Vector3 | null,
  radiusOf: (id: string) => number,
  minPixels: number,
  viewport: Viewport,
): string | null {
  if (!Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  if (!(halfW > 0) || !(halfH > 0)) return null;
  const tapX = tap.x * halfW;
  const tapY = tap.y * halfH;
  const thumb = Number.isFinite(minPixels) && minPixels > 0 ? minPixels : 0;
  // The camera's right, for measuring a body radius on the screen.
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

  let best: string | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const at = positionOf(id);
    if (at === null) continue;
    if (!toScreen(at, camera, halfW, halfH, centre)) continue;
    const distance = Math.hypot(centre.x - tapX, centre.y - tapY);
    if (distance >= bestDistance) continue;

    // The body's radius as drawn: the centre to a point one radius off
    // to the camera's right, on the screen.
    let reach = thumb;
    const radius = radiusOf(id);
    if (Number.isFinite(radius) && radius > 0) {
      edge.copy(at).addScaledVector(right, radius);
      if (toScreen(edge, camera, halfW, halfH, rim)) {
        reach = Math.max(reach, Math.hypot(rim.x - centre.x, rim.y - centre.y));
      }
    }
    if (distance > reach) continue;
    best = id;
    bestDistance = distance;
  }
  return best;
}
