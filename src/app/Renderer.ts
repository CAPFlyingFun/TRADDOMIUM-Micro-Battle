/**
 * The one WebGLRenderer, sized to its host element. A leaf: it imports
 * three and reads the DOM, and it is the only module that knows a canvas
 * exists. Scenes hand it a THREE.Scene and a camera; nothing else.
 */
import * as THREE from 'three';

/** Above 2 the extra fragments cost battery and buy nothing a phone can show. */
const MAX_PIXEL_RATIO = 2;

export type ResizeListener = (width: number, height: number) => void;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly observer: ResizeObserver | null;
  private width = 0;
  private height = 0;
  private readonly listeners = new Set<ResizeListener>();

  constructor(private readonly host: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.gl.domElement.style.display = 'block';
    host.appendChild(this.gl.domElement);
    this.fit();
    // Observe the host rather than the window: on a phone the browser
    // toolbar can change the host's box without a window resize event.
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fit());
    this.observer?.observe(host);
  }

  /**
   * The shadow-map switch (the lighting polish, 2026-09-07): ONE place,
   * so a scene never configures the renderer itself — the scene test rig
   * withholds the renderer on purpose, and a scene that reached for it
   * would fail there. Enabled with no light casting costs nothing: three
   * compiles the lookup only for lights whose `castShadow` is on.
   */
  setShadows(enabled: boolean): void {
    this.gl.shadowMap.enabled = enabled;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  onResize(cb: ResizeListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.gl.render(scene, camera);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.listeners.clear();
    this.gl.dispose();
    this.gl.domElement.remove();
  }

  private fit(): void {
    const width = Math.max(1, Math.floor(this.host.clientWidth));
    const height = Math.max(1, Math.floor(this.host.clientHeight));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    // false: CSS owns the canvas box (index.html); only the drawing buffer changes.
    this.gl.setSize(width, height, false);
    for (const cb of this.listeners) cb(width, height);
  }
}
