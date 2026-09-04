/**
 * The name over a capsule's head: a canvas painted once per change,
 * shown as a sprite so it always faces the camera.
 *
 * A canvas sprite rather than a DOM element because a DOM label would
 * need projecting through the camera every frame and would float over
 * the wrong thing during a fade; a sprite is just another object in the
 * scene graph and the renderer places it. Painted only when the text or
 * colour changes — never per frame — because a canvas upload is the
 * expensive part and a name changes about once a session.
 *
 * Styled like the perf HUD (dark panel, parchment text) with a swatch
 * of the capsule's colour at the left edge, so a player who cannot see
 * the capsule behind another one still knows whose label it is.
 *
 * Under jsdom `getContext('2d')` is null; the sprite still exists,
 * unpainted, so the scene graph is the same in a test as on a phone.
 */
import * as THREE from 'three';
import { PARCHMENT } from './CapsuleLook';

/** Canvas texels. The sprite's world size comes from the look; this is only how crisp the text is. */
const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 96;
const PANEL = 'rgba(6, 9, 12, 0.78)';
const SWATCH_WIDTH = 18;
const PADDING = 22;
const FONT_PX = 44;
const MIN_FONT_PX = 18;

const font = (px: number): string => `bold ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;

export class NameLabel {
  readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private painted: { readonly name: string; readonly color: string } | null = null;

  constructor(name: string, color: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true });
    this.sprite = new THREE.Sprite(this.material);
    this.paint(name, color);
  }

  /** Repaints only when something on the label actually changed. Returns whether it did. */
  paint(name: string, color: string): boolean {
    if (this.painted !== null && this.painted.name === name && this.painted.color === color) return false;
    this.painted = { name, color };
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return true;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = PANEL;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SWATCH_WIDTH, CANVAS_HEIGHT);

    // Shrink the type until a long name fits rather than clipping it: a
    // player's name cut in half reads as somebody else's.
    const maxWidth = CANVAS_WIDTH - SWATCH_WIDTH - PADDING * 2;
    let px = FONT_PX;
    ctx.font = font(px);
    let width = ctx.measureText(name).width;
    while (width > maxWidth && px > MIN_FONT_PX) {
      px = Math.max(MIN_FONT_PX, Math.floor((px * maxWidth) / width));
      ctx.font = font(px);
      width = ctx.measureText(name).width;
    }
    ctx.fillStyle = PARCHMENT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, SWATCH_WIDTH + (CANVAS_WIDTH - SWATCH_WIDTH) / 2, CANVAS_HEIGHT / 2, maxWidth);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
  }
}
