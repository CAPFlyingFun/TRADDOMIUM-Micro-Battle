/**
 * THE CHARACTER ROOM'S CAMERA: a PHOTO of what is on screen, and a THUMBNAIL of her for the outfit and character cards.
 *
 * Both are pictures read out of the app's own WebGL canvas, and the renderer was made with the default
 * `preserveDrawingBuffer: false` (keeping the buffer costs every frame, on a phone, for a picture taken now and then).
 * A canvas like that may be blank to anyone who reads it after the task that drew it has returned, so a picture is
 * RENDERED AND COPIED IN ONE SYNCHRONOUS CALL (`shoot`): render into the canvas, `drawImage` it onto a fresh 2D canvas,
 * return. Encoding (`toDataURL`, `toBlob`) and handing the file over (`savePicture`) work from that copy, and may take
 * as long as they like.
 *
 * The two pictures differ in what they frame:
 * - A PHOTO is the view the person is looking at, at the drawing buffer's full size: no crop, no scaling.
 * - A THUMBNAIL is her from a fixed front-three-quarter, whatever the person has done to the view. `frameBox` stands a
 *   camera off her bounding box at the distance that fits every corner of it (`fitDistance`, exact for the eight
 *   corners rather than a bounding sphere, which would leave a tall figure small in a wide frame), and `shoot` centre-
 *   crops the canvas to the card's shape and scales it down. The fit is made for the CROP, not the canvas: the canvas
 *   is whatever shape the phone is held in, the card is not.
 *
 * Handing a picture over is the share sheet where the browser can share files, because on an iPhone home-screen app
 * a download link does very little, and a plain `<a download>` everywhere else.
 */
import * as THREE from 'three';

export interface CropRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Room left around the box by default: 8% on every extent, so a hand or a hem is not cut by the card's edge. */
const DEFAULT_MARGIN = 1.08;
/** How close to the camera the near plane may come, as a share of the distance, so the depth buffer keeps its precision. */
const NEAR_SHARE = 1e-3;
/** Float noise allowed when a crop's size is floored, so an exact aspect does not lose a pixel to 1919.9999999. */
const FLOOR_SLACK = 1e-6;
/** How long a download's object URL is kept: long enough for every browser to have started reading it. */
const REVOKE_AFTER_MS = 60_000;

/** The largest rect of aspect `aspect` (w/h) centred in a `width`×`height` image, in whole pixels (floor sizes, centre with Math.floor). */
export function centreCrop(width: number, height: number, aspect: number): CropRect {
  const W = Math.max(0, Math.floor(width));
  const H = Math.max(0, Math.floor(height));
  // No shape to crop to, or nothing to crop: the whole image.
  if (!(aspect > 0) || !Number.isFinite(aspect) || W === 0 || H === 0) return { x: 0, y: 0, w: W, h: H };
  let w = W;
  let h = H;
  if (H * aspect <= W) w = Math.min(W, Math.floor(H * aspect + FLOOR_SLACK)); // the image is wider: keep its height
  else h = Math.min(H, Math.floor(W / aspect + FLOOR_SLACK)); // the image is taller: keep its width
  return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
}

/**
 * How far from the CENTRE of a box of extents `size` a camera with vertical field of view `fovDeg` must stand so that
 * every corner of the box is inside the view, when the visible part of the picture has aspect `aspect` (w/h). The
 * camera looks at the box centre from direction (yaw, pitch): its position is centre + d * (cos(pitch)*sin(yaw),
 * sin(pitch), cos(pitch)*cos(yaw)) — yaw 0 stands on +z looking toward -z, positive pitch looks down from above.
 * `margin` (default 1.08) scales the box extents before fitting. Exact for the 8 corners: in the camera basis, a corner
 * at (cx, cy, cz) with cz its offset TOWARD the camera needs d >= cz + max(|cx| / tanH, |cy| / tanV), where
 * tanV = tan(fov/2) and tanH = tanV * aspect. Return the max over corners. Pure arithmetic: no THREE objects needed.
 */
export function fitDistance(size: { x: number; y: number; z: number }, fovDeg: number, aspect: number, yaw: number, pitch: number, margin = DEFAULT_MARGIN): number {
  const tanV = Math.tan(fovDeg * Math.PI / 360);
  const tanH = tanV * aspect;
  // The camera's basis, as three's lookAt builds it with up = +y: back (toward the camera), right = up x back
  // normalised, which comes out free of pitch, and up = back x right. Written out so this stays plain arithmetic.
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
  const bx = cp * syaw, by = sp, bz = cp * cyaw;
  const rx = cyaw, rz = -syaw;
  const ux = -sp * syaw, uy = cp, uz = -sp * cyaw;
  const hx = size.x * margin / 2, hy = size.y * margin / 2, hz = size.z * margin / 2;
  let d = 0;
  for (let i = 0; i < 8; i++) {
    const ox = i & 1 ? hx : -hx;
    const oy = i & 2 ? hy : -hy;
    const oz = i & 4 ? hz : -hz;
    const cx = ox * rx + oz * rz;
    const cy = ox * ux + oy * uy + oz * uz;
    const cz = ox * bx + oy * by + oz * bz;
    d = Math.max(d, cz + Math.max(Math.abs(cx) / tanH, Math.abs(cy) / tanV));
  }
  return d;
}

/**
 * Point `camera` (fov kept) at the centre of `box` from (yaw, pitch) at fitDistance(box size, camera.fov, fitAspect,
 * yaw, pitch, margin). Set camera.aspect = renderAspect, clear any view offset, set near/far sensibly so the
 * box is never clipped (near <= distance minus the half diagonal, but at least 1e-3 * distance; far >= distance plus the half diagonal),
 * then updateProjectionMatrix() and lookAt the centre.
 *
 * The crop the fit is for is the centred `fitAspect` part of a `renderAspect` canvas (what `shoot` keeps). When the
 * crop is WIDER than the canvas -- the room held upright, a landscape card -- it keeps the canvas's width and only part
 * of its height, so the field of view the fit uses is narrowed to the part of the height that survives. Otherwise
 * the camera's own fov is used, as above.
 *
 * The camera is taken to sit in world space (no transformed parent) with three's default up, +y, which is the basis
 * `fitDistance` assumes. A box with no extent (empty, or a single point) gives no distance to stand at, and leaves the
 * camera as it was.
 */
export function frameBox(camera: THREE.PerspectiveCamera, box: THREE.Box3, opts: { readonly yaw: number; readonly pitch: number; readonly renderAspect: number; readonly fitAspect: number; readonly margin?: number }): void {
  const { yaw, pitch, renderAspect, fitAspect } = opts;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  let fov = camera.fov;
  if (fitAspect > renderAspect) fov = Math.atan(Math.tan(fov * Math.PI / 360) * renderAspect / fitAspect) * 360 / Math.PI;
  const d = fitDistance(size, fov, fitAspect, yaw, pitch, margin);
  if (!(d > 0) || !Number.isFinite(d)) return;

  const halfDiagonal = size.length() / 2;
  camera.aspect = renderAspect;
  camera.clearViewOffset();
  camera.near = Math.max(d - halfDiagonal, d * NEAR_SHARE);
  camera.far = d + halfDiagonal;
  camera.updateProjectionMatrix();
  const cp = Math.cos(pitch);
  camera.position.set(centre.x + d * cp * Math.sin(yaw), centre.y + d * Math.sin(pitch), centre.z + d * cp * Math.cos(yaw));
  camera.lookAt(centre);
  // Up to date now, not at the next render, so the caller can project with it straight away.
  camera.updateMatrixWorld();
}

export interface ShotOptions {
  /** Output size in pixels. When omitted, the drawing buffer's own size is used, with no crop and no scaling. When both are given, the drawing buffer is centre-cropped to width/height's aspect and scaled to width×height with imageSmoothingQuality 'high'. */
  readonly width?: number;
  readonly height?: number;
  /** Objects hidden for the shot. Their .visible is restored afterwards, even if rendering throws. */
  readonly hide?: readonly THREE.Object3D[];
  /** A background for the shot only. scene.background is restored afterwards, even if rendering throws. Undefined leaves the scene's own background. */
  readonly background?: THREE.Color | THREE.Texture | null;
}

/** A whole number of pixels, at least one. */
function pixels(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * Copy `source` onto a new 2D canvas, cropped and scaled per `width`/`height`. Only one of the two given keeps the
 * buffer's own shape and scales it to that one. Null when there is no document, no 2D context, or nothing drawn.
 */
function copyCanvas(source: HTMLCanvasElement, width: number | undefined, height: number | undefined): HTMLCanvasElement | null {
  const sw = source.width, sh = source.height;
  if (typeof document === 'undefined' || sw <= 0 || sh <= 0) return null;
  let crop: CropRect = { x: 0, y: 0, w: sw, h: sh };
  let outW = sw, outH = sh;
  if (width !== undefined && height !== undefined) {
    outW = pixels(width);
    outH = pixels(height);
    crop = centreCrop(sw, sh, outW / outH);
  } else if (width !== undefined) {
    outW = pixels(width);
    outH = pixels(width * sh / sw);
  } else if (height !== undefined) {
    outH = pixels(height);
    outW = pixels(height * sw / sh);
  }
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
  return canvas;
}

/**
 * Render `scene` from `camera` into the renderer's own canvas (the default framebuffer: save getRenderTarget(),
 * setRenderTarget(null), render, restore the target) and copy the result to a NEW 2D canvas synchronously, applying
 * the crop and scale. Returns that 2D canvas, or null when no 2D context is available. Leaves the WebGL canvas
 * holding this shot: the caller renders its own view again.
 */
export function shoot(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: ShotOptions = {}): HTMLCanvasElement | null {
  const hide = opts.hide ?? [];
  // Read before anything is hidden, so an object listed twice still comes back as it was.
  const wasVisible = hide.map((o) => o.visible);
  const background = scene.background;
  const target = renderer.getRenderTarget();
  try {
    for (const o of hide) o.visible = false;
    if (opts.background !== undefined) scene.background = opts.background;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    // In this same call: the drawing buffer is not kept past the task that drew it.
    return copyCanvas(renderer.domElement, opts.width, opts.height);
  } finally {
    hide.forEach((o, i) => { o.visible = wasVisible[i]; });
    scene.background = background;
    renderer.setRenderTarget(target);
  }
}

/** shoot, then canvas.toDataURL(type ?? 'image/jpeg', quality ?? 0.8). Null on any failure (catch: a canvas can refuse to be read). */
export function shootDataUrl(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: ShotOptions & { readonly type?: 'image/jpeg' | 'image/webp' | 'image/png'; readonly quality?: number } = {}): string | null {
  try {
    const canvas = shoot(renderer, scene, camera, opts);
    if (!canvas) return null;
    const url = canvas.toDataURL(opts.type ?? 'image/jpeg', opts.quality ?? 0.8);
    // 'data:,' is a canvas's way of saying it had nothing to give.
    return url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

/**
 * shoot, then canvas.toBlob(type ?? 'image/png', quality). Resolves null on any failure.
 *
 * Not `async`, so that nothing can ever be awaited ahead of the shot: the render and the copy happen in this call,
 * and only the encoding is left for later.
 */
export function shootBlob(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: ShotOptions & { readonly type?: string; readonly quality?: number } = {}): Promise<Blob | null> {
  let canvas: HTMLCanvasElement | null;
  try {
    canvas = shoot(renderer, scene, camera, opts);
  } catch {
    return Promise.resolve(null);
  }
  if (!canvas) return Promise.resolve(null);
  const copy = canvas;
  return new Promise((resolve) => {
    try {
      copy.toBlob((blob) => resolve(blob), opts.type ?? 'image/png', opts.quality);
    } catch {
      resolve(null);
    }
  });
}

/** The person closed the share sheet. Read by name, not class, so a DOMException from another realm still counts. */
function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * Hand a picture to the person.
 * - When the browser can share files (navigator.canShare?.({ files: [file] }) is true), use the share sheet
 *   (navigator.share({ files: [file], title })). This is the right path on an iPhone home-screen app, where a
 *   download link does little.
 * - Otherwise, download it through a temporary <a download> with an object URL. Revoke the URL after a delay.
 * Resolves:
 * - 'shared' when the share sheet was used;
 * - 'downloaded' when the download link was used;
 * - 'cancelled' when the person dismissed the sheet (AbortError). Do NOT fall back to a download in this case;
 * - 'failed' on any other error. Do not throw.
 */
export async function savePicture(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  try {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
    if (nav && typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename.replace(/\.[^.]+$/, '') });
        return 'shared';
      } catch (e) {
        return isAbort(e) ? 'cancelled' : 'failed';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    // In the document while it is clicked: some browsers ignore a click on a detached link.
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    }
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
