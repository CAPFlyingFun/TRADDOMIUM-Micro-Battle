// @vitest-environment jsdom
/**
 * The character room's camera (src/sarahlab/snapshot.ts): a centre crop keeps the largest rect of the card's shape in
 * whole pixels; the fitted distance is the hand formula, grows and shrinks the way it must, and every corner of the box
 * lands inside a real three camera's view with one touching the edge; `frameBox` stands the camera there, clears what
 * a view offset would skew, and keeps the box between near and far, the room held upright included; a shot hides,
 * swaps the background and restores all of it and the render target even when the render throws; and a picture goes
 * to the share sheet where files can be shared, to a download link elsewhere, and nowhere at all when the person
 * dismisses the sheet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { centreCrop, fitDistance, frameBox, savePicture, shoot, shootBlob, shootDataUrl } from '../src/sarahlab/snapshot';

const deg = (d: number) => d * Math.PI / 180;
/** Her bounding box, near enough: 0.4 m wide, 1.7 m tall, 0.3 m deep. */
const SARAH = { x: 0.4, y: 1.7, z: 0.3 };

/** The eight corners of a box of `size` about `centre`, each extent scaled by `scale`. */
function corners(centre: THREE.Vector3, size: { x: number; y: number; z: number }, scale = 1): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(new THREE.Vector3(
      centre.x + (i & 1 ? 1 : -1) * size.x * scale / 2,
      centre.y + (i & 2 ? 1 : -1) * size.y * scale / 2,
      centre.z + (i & 4 ? 1 : -1) * size.z * scale / 2,
    ));
  }
  return out;
}

/** Where `fitDistance` says the camera stands. */
function standAt(centre: THREE.Vector3, d: number, yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(
    centre.x + d * Math.cos(pitch) * Math.sin(yaw),
    centre.y + d * Math.sin(pitch),
    centre.z + d * Math.cos(pitch) * Math.cos(yaw),
  );
}

describe('centreCrop', () => {
  it('keeps the full height of a wide image for a tall shape, centred across', () => {
    expect(centreCrop(1000, 500, 3 / 4)).toEqual({ x: 312, y: 0, w: 375, h: 500 });
  });

  it('keeps the full width of a tall image for a wide shape, centred down', () => {
    // 500 / (16/9) = 281.25 -> 281; (1000 - 281) / 2 = 359.5 -> 359.
    expect(centreCrop(500, 1000, 16 / 9)).toEqual({ x: 0, y: 359, w: 500, h: 281 });
  });

  it('is the whole image at its own aspect, float noise included', () => {
    expect(centreCrop(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(centreCrop(1170, 2532, 1170 / 2532)).toEqual({ x: 0, y: 0, w: 1170, h: 2532 });
    expect(centreCrop(300, 300, 1)).toEqual({ x: 0, y: 0, w: 300, h: 300 });
  });

  it('floors fractional sizes and offsets', () => {
    // 100 / 3 = 33.33 -> 33; (100 - 33) / 2 = 33.5 -> 33.
    expect(centreCrop(100, 100, 3)).toEqual({ x: 0, y: 33, w: 100, h: 33 });
    // 101 * 0.5 = 50.5 -> 50; (101 - 50) / 2 = 25.5 -> 25.
    expect(centreCrop(101, 101, 0.5)).toEqual({ x: 25, y: 0, w: 50, h: 101 });
  });
});

describe('fitDistance', () => {
  const tanV = Math.tan(deg(35) / 2);

  it('fits a tall thin box seen from the front in a wide frame by its height', () => {
    const d = fitDistance(SARAH, 35, 16 / 9, 0, 0, 1);
    expect(d).toBeCloseTo(0.15 + 0.85 / tanV, 12);
  });

  it('fits it by its width once the frame is narrower than the box, and stands further back', () => {
    // The box is 0.4 / 1.7 = 0.235 wide for its height: a 0.3 frame is still height-limited, a 0.2 one is not.
    const wide = fitDistance(SARAH, 35, 16 / 9, 0, 0, 1);
    expect(fitDistance(SARAH, 35, 0.3, 0, 0, 1)).toBeCloseTo(wide, 12);
    const narrow = fitDistance(SARAH, 35, 0.2, 0, 0, 1);
    expect(narrow).toBeCloseTo(0.15 + 0.2 / (tanV * 0.2), 12);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('uses the z extent as the width from the side', () => {
    const side = fitDistance(SARAH, 35, 0.1, Math.PI / 2, 0, 1);
    // From +x: depth toward the camera is the x half extent, across is the z half extent.
    expect(side).toBeCloseTo(0.2 + 0.15 / (tanV * 0.1), 9);
    expect(fitDistance(SARAH, 35, 0.1, 0, 0, 1)).toBeCloseTo(0.15 + 0.2 / (tanV * 0.1), 9);
  });

  it('stands further back for a bigger margin, and defaults to 1.08', () => {
    expect(fitDistance(SARAH, 35, 0.75, 0.6, 0.2, 1.2)).toBeGreaterThan(fitDistance(SARAH, 35, 0.75, 0.6, 0.2, 1.0));
    expect(fitDistance(SARAH, 35, 0.75, 0.6, 0.2)).toBe(fitDistance(SARAH, 35, 0.75, 0.6, 0.2, 1.08));
  });

  it('stands closer with a wider lens', () => {
    expect(fitDistance(SARAH, 50, 0.75, 0.6, 0.2)).toBeLessThan(fitDistance(SARAH, 35, 0.75, 0.6, 0.2));
  });

  it('puts every corner inside a real camera, one of them on the edge', () => {
    const centre = new THREE.Vector3(0.3, 0.85, -1.2);
    const views = [
      { fov: 35, aspect: 16 / 9, yaw: 0, pitch: 0 },
      { fov: 35, aspect: 3 / 4, yaw: deg(30), pitch: deg(10) },
      { fov: 50, aspect: 0.2, yaw: deg(-40), pitch: deg(25) },
      { fov: 28, aspect: 1, yaw: deg(160), pitch: deg(-15) },
    ];
    for (const v of views) {
      for (const margin of [1, 1.08]) {
        const d = fitDistance(SARAH, v.fov, v.aspect, v.yaw, v.pitch, margin);
        const camera = new THREE.PerspectiveCamera(v.fov, v.aspect, 0.01, 100);
        camera.position.copy(standAt(centre, d, v.yaw, v.pitch));
        camera.lookAt(centre);
        camera.updateMatrixWorld();
        let reach = 0;
        for (const c of corners(centre, SARAH)) {
          const ndc = c.clone().project(camera);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-6);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-6);
          reach = Math.max(reach, Math.abs(ndc.x), Math.abs(ndc.y));
        }
        if (margin === 1) expect(reach).toBeCloseTo(1, 9);
        else expect(Math.abs(reach - 1 / margin) / (1 / margin)).toBeLessThan(0.02);
      }
    }
  });
});

describe('frameBox', () => {
  const box = () => new THREE.Box3(new THREE.Vector3(0.8, 0, -2.15), new THREE.Vector3(1.2, 1.7, -1.85));
  const centre = new THREE.Vector3(1, 0.85, -2);

  /** A camera with everything frameBox must reset set wrong. */
  function skewed(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(35, 1, 5, 6);
    camera.setViewOffset(2000, 1000, 400, 100, 1000, 500);
    camera.position.set(9, 9, 9);
    return camera;
  }

  it('stands at the fitted distance on the stated direction, looking at the centre', () => {
    const camera = skewed();
    const yaw = deg(35), pitch = deg(8);
    frameBox(camera, box(), { yaw, pitch, renderAspect: 16 / 9, fitAspect: 3 / 4 });
    const d = fitDistance(SARAH, 35, 3 / 4, yaw, pitch);
    const want = standAt(centre, d, yaw, pitch);
    expect(camera.position.distanceTo(want)).toBeLessThan(1e-9);
    expect(camera.fov).toBe(35);
    const look = camera.getWorldDirection(new THREE.Vector3());
    expect(look.dot(centre.clone().sub(camera.position).normalize())).toBeCloseTo(1, 12);
  });

  it('takes the render aspect, clears the view offset and keeps the box between near and far', () => {
    const camera = skewed();
    frameBox(camera, box(), { yaw: deg(-25), pitch: deg(12), renderAspect: 16 / 9, fitAspect: 3 / 4, margin: 1.1 });
    expect(camera.aspect).toBe(16 / 9);
    expect(camera.view === null || !camera.view.enabled).toBe(true);
    const d = camera.position.distanceTo(centre);
    expect(camera.near).toBeGreaterThanOrEqual(d * 1e-3);
    expect(camera.far).toBeGreaterThan(camera.near);
    for (const c of corners(centre, SARAH)) {
      const depth = -c.clone().applyMatrix4(camera.matrixWorldInverse).z;
      expect(depth).toBeGreaterThanOrEqual(camera.near);
      expect(depth).toBeLessThanOrEqual(camera.far);
    }
    // And the projection is the one those numbers make: no stale view offset left in it.
    const fresh = new THREE.PerspectiveCamera(35, 16 / 9, camera.near, camera.far);
    expect(camera.projectionMatrix.elements).toEqual(fresh.projectionMatrix.elements);
  });

  it('fits the box inside the centred crop, the room held upright included', () => {
    const cases = [
      { renderAspect: 16 / 9, fitAspect: 3 / 4 }, // landscape canvas, portrait card: the crop keeps the height
      { renderAspect: 9 / 16, fitAspect: 3 / 4 }, // upright canvas, portrait card that is still wider than it
      { renderAspect: 9 / 19.5, fitAspect: 4 / 3 }, // upright phone, landscape card
    ];
    for (const { renderAspect, fitAspect } of cases) {
      const camera = skewed();
      frameBox(camera, box(), { yaw: deg(30), pitch: deg(10), renderAspect, fitAspect, margin: 1 });
      // The crop, in the canvas's NDC.
      const xMax = fitAspect <= renderAspect ? fitAspect / renderAspect : 1;
      const yMax = fitAspect <= renderAspect ? 1 : renderAspect / fitAspect;
      let reach = 0;
      for (const c of corners(centre, SARAH)) {
        const ndc = c.clone().project(camera);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(xMax + 1e-6);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(yMax + 1e-6);
        reach = Math.max(reach, Math.abs(ndc.x) / xMax, Math.abs(ndc.y) / yMax);
      }
      expect(reach).toBeCloseTo(1, 9);
    }
  });

  it('leaves the camera alone for a box with nothing in it', () => {
    const camera = skewed();
    const before = camera.position.clone();
    frameBox(camera, new THREE.Box3(), { yaw: 0, pitch: 0, renderAspect: 1, fitAspect: 1 });
    frameBox(camera, new THREE.Box3(centre.clone(), centre.clone()), { yaw: 0, pitch: 0, renderAspect: 1, fitAspect: 1 });
    expect(camera.position.equals(before)).toBe(true);
  });
});

describe('shoot', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** A stand-in renderer: the canvas, the render target it holds, and whatever `render` does. */
  function fakeRenderer(render: () => void) {
    const domElement = document.createElement('canvas');
    domElement.width = 1600;
    domElement.height = 900;
    const offscreen = { name: 'offscreen target' };
    let target: unknown = offscreen;
    const set: unknown[] = [];
    const renderer = {
      domElement,
      render,
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { set.push(t); target = t; },
    } as unknown as THREE.WebGLRenderer;
    return { renderer, offscreen, set, target: () => target };
  }

  function stage() {
    const scene = new THREE.Scene();
    const own = new THREE.Color(0x203040);
    scene.background = own;
    const grid = new THREE.Object3D();
    const gizmo = new THREE.Object3D();
    const hiddenAlready = new THREE.Object3D();
    hiddenAlready.visible = false;
    return { scene, own, hide: [grid, gizmo, hiddenAlready], camera: new THREE.PerspectiveCamera() };
  }

  it('restores visibility, the background and the render target when the render throws', () => {
    const { scene, own, hide, camera } = stage();
    const white = new THREE.Color(0xffffff);
    let seen: { visible: boolean[]; background: unknown; target: unknown } | null = null;
    const fake = fakeRenderer(() => {
      seen = { visible: hide.map((o) => o.visible), background: scene.background, target: fake.target() };
      throw new Error('context lost');
    });
    expect(() => shoot(fake.renderer, scene, camera, { hide, background: white })).toThrow('context lost');
    // During the render: everything hidden, the shot's background, the canvas's own framebuffer.
    expect(seen).toEqual({ visible: [false, false, false], background: white, target: null });
    expect(hide.map((o) => o.visible)).toEqual([true, true, false]);
    expect(scene.background).toBe(own);
    expect(fake.set).toEqual([null, fake.offscreen]);
    expect(fake.target()).toBe(fake.offscreen);
  });

  it('returns null without a 2D context, and still restores everything', () => {
    const { scene, own, hide, camera } = stage();
    let renders = 0;
    const fake = fakeRenderer(() => { renders++; });
    // jsdom without the canvas package has no 2D context; say so without its "not implemented" noise.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    expect(shoot(fake.renderer, scene, camera, { hide, background: null, width: 300, height: 400 })).toBeNull();
    expect(renders).toBe(1);
    expect(hide.map((o) => o.visible)).toEqual([true, true, false]);
    expect(scene.background).toBe(own);
    expect(fake.target()).toBe(fake.offscreen);
  });

  it('copies in the same call: the whole buffer for a photo, a centre crop scaled down for a thumbnail', () => {
    const { scene, camera } = stage();
    const order: string[] = [];
    const fake = fakeRenderer(() => { order.push('render'); });
    const ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: vi.fn(() => { order.push('copy'); }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);

    const photo = shoot(fake.renderer, scene, camera)!;
    expect([photo.width, photo.height]).toEqual([1600, 900]);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(fake.renderer.domElement, 0, 0, 1600, 900, 0, 0, 1600, 900);

    const thumb = shoot(fake.renderer, scene, camera, { width: 240, height: 320 })!;
    expect([thumb.width, thumb.height]).toEqual([240, 320]);
    // 900 * 3/4 = 675 wide, centred: (1600 - 675) / 2 = 462.5 -> 462.
    expect(ctx.drawImage).toHaveBeenLastCalledWith(fake.renderer.domElement, 462, 0, 675, 900, 0, 0, 240, 320);
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(order).toEqual(['render', 'copy', 'render', 'copy']);
  });

  it('encodes the copy: a JPEG data URL for a card, a PNG blob for a photo, null when the canvas refuses', async () => {
    const { scene, camera } = stage();
    const fake = fakeRenderer(() => {});
    const ctx = { drawImage: () => {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/jpeg;base64,AAAA');
    expect(shootDataUrl(fake.renderer, scene, camera, { width: 240, height: 320 })).toBe('data:image/jpeg;base64,AAAA');
    expect(toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.8);

    const png = new Blob(['png'], { type: 'image/png' });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => { cb(png); });
    await expect(shootBlob(fake.renderer, scene, camera)).resolves.toBe(png);
    expect(toBlob.mock.calls[0][1]).toBe('image/png');

    toDataURL.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    expect(shootDataUrl(fake.renderer, scene, camera)).toBeNull();
    toBlob.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    await expect(shootBlob(fake.renderer, scene, camera)).resolves.toBeNull();
    const broken = fakeRenderer(() => { throw new Error('context lost'); });
    expect(shootDataUrl(broken.renderer, scene, camera)).toBeNull();
    await expect(shootBlob(broken.renderer, scene, camera)).resolves.toBeNull();
  });
});

describe('savePicture', () => {
  const blob = new Blob(['picture'], { type: 'image/png' });
  const added: [object, string][] = [];

  /** Give `on` a property for this test only. */
  function define(on: object, key: string, value: unknown): void {
    Object.defineProperty(on, key, { value, configurable: true, writable: true });
    added.push([on, key]);
  }

  afterEach(() => {
    for (const [on, key] of added.splice(0)) delete (on as Record<string, unknown>)[key];
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the share sheet when the browser can share the file', async () => {
    const share = vi.fn(async (_: ShareData) => {});
    const canShare = vi.fn((_: ShareData) => true);
    define(navigator, 'share', share);
    define(navigator, 'canShare', canShare);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(savePicture(blob, 'sarah-2026-10-23.png')).resolves.toBe('shared');
    const files = share.mock.calls[0][0].files!;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sarah-2026-10-23.png');
    expect(files[0].type).toBe('image/png');
    expect(canShare.mock.calls[0][0].files![0]).toBe(files[0]);
    expect(click).not.toHaveBeenCalled();
  });

  it('is cancelled, and downloads nothing, when the person dismisses the sheet', async () => {
    define(navigator, 'share', vi.fn(async () => { throw new DOMException('Share canceled', 'AbortError'); }));
    define(navigator, 'canShare', () => true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(savePicture(blob, 'sarah.png')).resolves.toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
  });

  it('fails, without throwing, on any other share error', async () => {
    define(navigator, 'share', vi.fn(async () => { throw new DOMException('no gesture', 'NotAllowedError'); }));
    define(navigator, 'canShare', () => true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(savePicture(blob, 'sarah.png')).resolves.toBe('failed');
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads through a link when files cannot be shared, and revokes the URL later', async () => {
    vi.useFakeTimers();
    const create = vi.fn((_: Blob | MediaSource) => 'blob:sarah-lab/1');
    const revoke = vi.fn((_: string) => {});
    define(URL, 'createObjectURL', create);
    define(URL, 'revokeObjectURL', revoke);
    let clicked: { href: string; download: string; inDocument: boolean } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { href: this.href, download: this.download, inDocument: document.body.contains(this) };
    });

    // No share at all (jsdom's own navigator), then a share that cannot take files.
    await expect(savePicture(blob, 'sarah.png')).resolves.toBe('downloaded');
    expect(clicked).toEqual({ href: 'blob:sarah-lab/1', download: 'sarah.png', inDocument: true });
    expect(create).toHaveBeenCalledWith(blob);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:sarah-lab/1');

    const share = vi.fn(async () => {});
    define(navigator, 'share', share);
    define(navigator, 'canShare', () => false);
    await expect(savePicture(blob, 'sarah.png')).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
  });

  it('fails, without throwing, when even the download cannot be made', async () => {
    define(URL, 'createObjectURL', () => { throw new Error('no blob URLs here'); });
    await expect(savePicture(blob, 'sarah.png')).resolves.toBe('failed');
  });
});
