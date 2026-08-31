/**
 * WHERE SHE IS, AND WHERE SHE SAID SHE WAS GOING.
 *
 * Kauaʻi is 56 km across and she is four millimetres long. The compass
 * strip says which way she is pointed and the flight panel says how
 * fast; neither of them can say WHERE, and at true scale "where" is
 * the question a player without an answer gives up over. Without this
 * the only way to ask it is to open the full map — which in solo stops
 * the world — so the answer costs a pause every single time it is
 * wanted. A hundred pixels in the corner is cheaper than that.
 *
 * IT IS THE FULL MAP AT ZOOM 1, drawn smaller, and nothing else: the
 * same baked island, the same fog mask, the same transform out of
 * mapView.ts. That is why tapping it does not feel like a jump — what
 * opens is what was already there, larger. It is also why there is no
 * arithmetic below. Every pixel comes from `worldToScreen` and
 * `islandOrigin`, so the corner widget and the full-screen map cannot
 * come apart about where the island is.
 *
 * THE WHOLE ISLAND RATHER THAN A WINDOW AROUND HER. The obvious
 * minimap scrolls a few kilometres of ground under a fixed dot, and
 * here that is wrong twice over. Her dot would be pinned in the middle
 * while a destination thirty kilometres away sat off the edge as a rim
 * marker — which is a bearing, and the compass strip already draws
 * bearings better than a 104-pixel square ever will. And the fog IS
 * the progress readout of this whole game: watching the known patch
 * stay small against the island is the point, and a window that always
 * fills itself with her own 2 km disc can never show it. The price is
 * that her marker moves about one pixel per 540 m of walking. She is
 * genuinely that small; what visibly changes is the fog, and that is
 * the honest reading.
 *
 * THE COMPOSITE IS CACHED, and that is the part that has to stay true.
 * Cutting the island down to what she has seen costs a 147,456-cell
 * mask and two full-face draws, and `update()` is called every frame
 * by the scene — so doing it there would be a per-frame bill for an
 * image that changes only when the fog moves. It is rebuilt on a
 * change of `Discovery.revision` and on nothing else. A steady frame
 * is one `drawImage` and two markers; a frame in which she has not
 * crossed half a pixel or turned a degree is no work at all. That last
 * rule lives out here as `worthRedrawing`, a pure function, because
 * there is no DOM in this repo's test run and a rule that cannot be
 * tested is one that quietly stops holding.
 *
 * NOTHING ELSE GOES ON IT. Not food, not the nest, not the weather.
 * It is a hundred pixels across; a second thing on it is a first thing
 * you can no longer read.
 */
import { bakeIsland } from './islandMap';
import {
  enclosing, fitTo, islandOrigin, islandPixels, worldPerPixel, worldToScreen,
  type MapMarks, type MapView, type Viewport,
} from './mapView';
import { bearingFromHeading, wrap180 } from './compassMath';
import { ISLAND_SPAN } from '../world/heightfield';
import { knownBounds, type Discovery } from '../game/discovery';
import { world, type WorldPoint } from '../world/coords';

/** The face of the widget, CSS pixels a side. */
export const MINIMAP_PX = 104;

/**
 * The frame a run ends on: the whole island, dead centre.
 *
 * Also the frame it uses before anything is known, though nothing is
 * drawn then anyway — see `frameFor`.
 */
const WHOLE_ISLAND: MapView = { centre: world(0, 0), zoom: 0 };

/**
 * THE FRAME FOLLOWS WHAT SHE KNOWS, and the first device frame is why.
 *
 * This drew the whole island always, on the argument in the header:
 * the fog receding IS the progress readout of the game, and a window
 * that keeps refilling itself with her own 2 km disc can never show
 * it. That argument is still right and the frame still ends there.
 *
 * What it missed is the FIRST few hours. A 2 km reveal on a 56 km
 * island is 3.6% of its width, so a new run's minimap was a black
 * square with a single lit cell in it — correct, and indistinguishable
 * from a broken widget. Joshua saw exactly that in the first probe
 * frame and called it: fit what she has seen, and open out as she
 * explores.
 *
 * So the frame is the box she has discovered, grown to hold her and
 * her destination, clamped between MAX_FIT and the whole island. Early
 * on that is a close view of her own patch; by the time she has
 * crossed Kauaʻi it has opened to the island and stays there. The fog
 * still tells the story — it is simply never the ONLY thing on screen.
 *
 * Pure, exported and tested, because it is a rule rather than a
 * drawing and there is no DOM in this repo's test run.
 */
/**
 * Are two frames the same picture?
 *
 * The fitted zoom is a continuous number, so it moves by a hair every
 * time a cell flips. Comparing it exactly would recut the island on
 * frames where nothing visibly changed; comparing it loosely would
 * leave the cut behind a frame that has genuinely moved. A part in a
 * thousand is well under one pixel of a 104-pixel face.
 */
export function sameView(a: MapView, b: MapView): boolean {
  const fa = a.fit ?? 0;
  const fb = b.fit ?? 0;
  if (Math.abs(fa - fb) > Math.max(fa, fb) / 1000) return false;
  const grain = ISLAND_SPAN / Math.max(1, fa) / 1000;
  return Math.abs(a.centre.wx - b.centre.wx) <= grain
    && Math.abs(a.centre.wz - b.centre.wz) <= grain;
}

export function frameFor(
  known: { min: WorldPoint; max: WorldPoint } | null,
  at: WorldPoint,
  pin: WorldPoint | null,
): MapView {
  if (!known) return WHOLE_ISLAND;
  // Her own position and the pin belong in frame whatever the fog has
  // done: a map that can lose the player is not a map, and a
  // destination off the edge is a bearing the compass already gives
  // better.
  let box = enclosing(known, at);
  if (pin) box = enclosing(box, pin);
  return fitTo(box.min, box.max);
}

/** Card gold and the ink of the unknown — palette, not invention. */
const GOLD = 'rgba(255, 216, 130, .85)';
const GOLD_SOLID = 'rgb(255, 216, 130)';
const FOG = 'rgba(9, 13, 20, .93)';
/** Markers are outlined in the fog's own colour so they read on sand. */
const OUTLINE = 'rgba(9, 13, 20, .85)';

/**
 * Backing-store scale. Capped at 2 exactly where the renderer caps it
 * (`IslandScene.ts:481`): past two the extra pixels are invisible and
 * the composite rebuild is four times the work.
 */
const MAX_SCALE = 2;

/** Marker sizes, CSS pixels, multiplied up by the backing scale. */
const QUEEN_TIP = 5.4;
const QUEEN_TAIL = 3.2;
const QUEEN_HALF = 3.3;
const PIN_RADIUS = 3.1;

/**
 * How far she must travel before the dot lands on a different pixel.
 *
 * Half a device pixel. Below it the repaint would put every mark back
 * exactly where it already is, which is a frame's work to change
 * nothing.
 */
const MOVE_PIXELS = 0.5;

/** And how far she must turn for a seven-pixel dart to look different. */
const TURN_DEGREES = 1;

/**
 * Everything a painted frame depended on.
 *
 * The bearing is stored already CONVERTED, in degrees, rather than as
 * her raw heading — partly so the comparison can be a `wrap180` like
 * every other angle in this repo, and partly because the conversion is
 * the one step that must not be skipped or re-derived. See below.
 */
export interface MinimapFrame {
  readonly at: WorldPoint;
  /** Compass degrees, out of `bearingFromHeading`. */
  readonly bearing: number;
  readonly pin: WorldPoint | null;
  readonly revision: number;
}

/**
 * Is this frame different enough from the last one to be worth paint?
 *
 * The early-out is the whole reason a 56 km island can sit on the HUD
 * of a phone. `update()` runs every frame; almost every one of them
 * shows a queen who has moved a few centimetres across an island where
 * one pixel is half a kilometre, so almost every one of them can do
 * nothing at all.
 *
 * IT ERRS TOWARD PAINTING. A missed repaint is a marker frozen at a
 * place she has left, which looks like a bug in the map and cannot be
 * distinguished from one; a needless repaint is one `drawImage` of a
 * cached image. The two mistakes do not cost the same, so the
 * thresholds are sub-pixel and the unknowns — a fresh widget, a
 * revision that moved, a pin that appeared — all say yes without
 * measuring anything.
 *
 * A NON-FINITE POSITION SAYS NO, deliberately. A NaN would draw the
 * queen nowhere, so the last good frame is left standing and the
 * caller, which only records what it painted, keeps the old frame to
 * compare against — meaning the moment she is real again the
 * comparison is large and the map catches up on its own.
 *
 * @param worldPerPixel world units covered by one device pixel
 */
export function worthRedrawing(
  shown: MinimapFrame | null, next: MinimapFrame, worldPerPixel: number,
): boolean {
  if (!Number.isFinite(next.at.wx)) return false;
  if (!Number.isFinite(next.at.wz)) return false;
  if (!Number.isFinite(next.bearing)) return false;
  if (next.pin !== null && (!Number.isFinite(next.pin.wx)
    || !Number.isFinite(next.pin.wz))) return false;

  if (shown === null) return true;
  if (shown.revision !== next.revision) return true;
  if ((shown.pin === null) !== (next.pin === null)) return true;

  // A scale that is not a number would otherwise make every comparison
  // false and wedge the map on one frame forever. Zero slop repaints
  // on any motion at all, which is the survivable direction to fail in.
  const slop = Number.isFinite(worldPerPixel)
    ? Math.abs(worldPerPixel) * MOVE_PIXELS : 0;
  if (moved(shown.at, next.at, slop)) return true;
  if (shown.pin !== null && next.pin !== null
    && moved(shown.pin, next.pin, slop)) return true;

  // The SHORT way round, so a queen crossing north does not read as a
  // 358-degree turn and repaint on a tenth of a degree of tremor.
  return Math.abs(wrap180(next.bearing - shown.bearing)) >= TURN_DEGREES;
}

/**
 * Per axis rather than radially — a square of slop half a pixel to a
 * side, which is the shape of the pixel it is standing in for.
 */
function moved(from: WorldPoint, to: WorldPoint, slop: number): boolean {
  return Math.abs(to.wx - from.wx) > slop || Math.abs(to.wz - from.wz) > slop;
}

export class Minimap {
  private readonly root: HTMLButtonElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ink: CanvasRenderingContext2D;
  private readonly detach: Array<() => void> = [];

  /**
   * The island already cut down to what she has seen, at face size.
   *
   * This is the expensive thing, and it is expensive exactly once per
   * change of the fog rather than once per frame.
   */
  private composite: HTMLCanvasElement | null = null;
  /** White where seen, transparent where not. Kept to avoid realloc. */
  private mask: HTMLCanvasElement | null = null;
  /** What the composite was built from — both halves of the key. */
  private builtFrom: Discovery | null = null;
  private builtAt = -1;
  /** Backing-store scale in force, so a moved window rebuilds. */
  private scale = 0;
  /** The last frame actually painted, or null when nothing has been. */
  private shown: MinimapFrame | null = null;
  /** The discovered box, and the mask it was scanned from. */
  private bounds: { min: WorldPoint; max: WorldPoint } | null = null;
  private boundsFrom: Discovery | null = null;
  private boundsAt = -1;
  /** The frame the composite was cut at, so a moved frame recuts it. */
  private builtView: MapView | null = null;

  constructor(host: HTMLElement, onOpen: () => void) {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.dataset.ui = 'minimap';
    this.root.setAttribute('aria-label', 'map');
    Object.assign(this.root.style, {
      position: 'fixed',
      // BELOW THE WEATHER CHIP. The top right above 56px is spoken for
      // — the chip's two lines and the settings gear share it — and
      // the right column below about y 230 belongs to the action pad
      // and the lift lever. This is the gap between them.
      top: 'calc(56px + min(env(safe-area-inset-top), 12px))',
      right: 'calc(10px + min(env(safe-area-inset-right), 14px))',
      width: `${MINIMAP_PX}px`,
      height: `${MINIMAP_PX}px`,
      // Or the 2px card border is added OUTSIDE the 104 and the widget
      // quietly becomes 108 on a screen with 82 pixels to spare.
      boxSizing: 'border-box',
      appearance: 'none',
      padding: '0',
      overflow: 'hidden',
      borderRadius: '13px',
      border: '2px solid rgba(255, 216, 130, .7)',
      background: 'rgba(18, 14, 6, .72)',
      boxShadow: '0 0 0 2px rgba(0,0,0,.32), 0 3px 14px rgba(0,0,0,.42)',
      cursor: 'pointer',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);

    this.canvas = document.createElement('canvas');
    this.canvas.dataset.ui = 'minimap-canvas';
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      // The card owns the pointer; the canvas inside it is a picture.
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.ink = this.canvas.getContext('2d')!;

    this.root.appendChild(this.canvas);
    host.appendChild(this.root);

    // TAKE THE POINTER, the way SettingsPanel takes it for a slider.
    // LookDrag is bound to #app and its pointerdown never looks at the
    // target, so anything that does not stop the event here becomes a
    // place where opening the map also swings the camera behind it —
    // and the swing outlives the tap, because the map that opens over
    // the top never sees the pointerup. Bound to this element, never
    // to the window: a global listener would claim taps meant for
    // every other control on the HUD.
    const onDown = (e: PointerEvent) => {
      onOpen();
      e.stopPropagation();
    };
    this.root.addEventListener('pointerdown', onDown as EventListener);
    this.detach.push(() => this.root.removeEventListener(
      'pointerdown', onDown as EventListener,
    ));
  }

  /**
   * Called each frame from the scene. Cheap: skips work when nothing
   * moved.
   */
  update(marks: MapMarks, known: Discovery): void {
    const asked = Math.max(1, window.devicePixelRatio || 1);
    const scale = Math.min(asked, MAX_SCALE);
    if (scale !== this.scale) {
      this.scale = scale;
      this.canvas.width = Math.round(MINIMAP_PX * scale);
      this.canvas.height = this.canvas.width;
      // A resized backing store is a blank one, and the composite was
      // built for the old size. Both have to go.
      this.composite = null;
      this.builtFrom = null;
      this.shown = null;
    }

    const face = this.canvas.width;
    const port: Viewport = { width: face, height: face };

    // WHAT SHE KNOWS DECIDES THE FRAME. The bounds scan is a pass over
    // the whole mask, so it is keyed to the revision exactly like the
    // composite — once every hundred metres of walking, not per frame.
    if (this.boundsFrom !== known || this.boundsAt !== known.revision) {
      this.bounds = knownBounds(known);
      this.boundsFrom = known;
      this.boundsAt = known.revision;
    }
    const view = frameFor(this.bounds, marks.at, marks.primary);
    // A CHANGED FRAME IS A STALE COMPOSITE. The island is cut to the
    // fog at a particular scale and offset; drawing yesterday's cut at
    // today's zoom would slide the coastline out from under the fog.
    if (this.builtView === null || !sameView(this.builtView, view)) {
      this.composite = null;
      this.builtView = view;
    }

    const next: MinimapFrame = {
      at: marks.at,
      // THE REPO'S OWN CONVERSION, once, here. Her heading is radians
      // measured from +Z; a bearing is degrees clockwise from north.
      // Open-coding that disagreement is what put a previous fix 142
      // degrees out, and it looked plausible the whole time.
      bearing: bearingFromHeading(marks.heading),
      pin: marks.primary,
      revision: known.revision,
    };
    const grain = worldPerPixel(view, port);
    if (!worthRedrawing(this.shown, next, grain)) return;
    this.shown = next;

    if (this.composite === null || this.builtFrom !== known
      || this.builtAt !== known.revision) {
      // The identity as well as the number: two masks can both be at
      // revision 1 — a fresh one and a loaded save — and they are not
      // the same island.
      this.composite = this.compose(known, port, view);
      this.builtFrom = known;
      this.builtAt = known.revision;
    }

    const ink = this.ink;
    ink.clearRect(0, 0, face, face);
    // The unknown is the BACKGROUND, not something drawn over the top:
    // the composite is transparent everywhere she has not been, so the
    // fog is simply what is behind it.
    ink.fillStyle = FOG;
    ink.fillRect(0, 0, face, face);
    ink.drawImage(this.composite, 0, 0);

    if (next.pin !== null) this.drawPin(next.pin, port, scale, view);
    this.drawQueen(next, port, scale, view);
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.root.remove();
    this.composite = null;
    this.mask = null;
    this.builtFrom = null;
  }

  /**
   * The island, cut to the shape of what she has seen.
   *
   * `destination-in` rather than a loop over pixels. The mask is
   * 147,456 cells and the face is up to 208 a side; compositing them
   * is two `drawImage` calls the compositor does in hardware, while
   * the honest-looking version — walk the face, ask `seen()` per pixel
   * — is tens of thousands of function calls for the same picture.
   *
   * The smoothing is not decoration either. The mask is 384 cells over
   * an island drawn at a couple of hundred pixels, so scaling it into
   * place bilinearly is what gives the fog a soft edge instead of a
   * staircase, and it costs nothing because the scaler was going to
   * run regardless.
   */
  private compose(
    known: Discovery, port: Viewport, view: MapView,
  ): HTMLCanvasElement {
    const face = port.width;
    const out = this.composite ?? document.createElement('canvas');
    // Assigning the size also clears it, which is the cheap way to
    // start from nothing and the reason it is done every rebuild.
    out.width = face;
    out.height = face;

    const ink = out.getContext('2d')!;
    ink.imageSmoothingEnabled = true;
    const size = islandPixels(view, port);
    const corner = islandOrigin(view, port);
    ink.drawImage(bakeIsland(), corner.x, corner.y, size, size);
    ink.globalCompositeOperation = 'destination-in';
    ink.drawImage(this.maskOf(known), corner.x, corner.y, size, size);
    ink.globalCompositeOperation = 'source-over';
    return out;
  }

  /**
   * The discovery bytes as an alpha stencil, opaque white where seen.
   *
   * Painted from the mask's own array every time the revision moves,
   * rather than stamping each new reveal disc onto a kept canvas. A
   * disc drawn here would be a SECOND opinion about what has been
   * discovered — discovery.ts already decided, in world units, with a
   * circle test — and the two would drift apart at the edges where
   * nobody would ever notice.
   */
  private maskOf(known: Discovery): HTMLCanvasElement {
    const size = known.size;
    let mask = this.mask;
    if (mask === null || mask.width !== size) {
      mask = document.createElement('canvas');
      mask.width = size;
      mask.height = size;
      this.mask = mask;
    }

    const ink = mask.getContext('2d')!;
    const pixels = ink.createImageData(size, size);
    // A word at a time rather than four bytes: white-opaque is
    // 0xffffffff whichever way round the machine stores it, so this is
    // one pass instead of four and carries no endianness assumption.
    const words = new Uint32Array(pixels.data.buffer);
    const cells = known.cells;
    for (let i = 0; i < words.length; i++) {
      words[i] = i < cells.length && cells[i] !== 0 ? 0xffffffff : 0;
    }
    ink.putImageData(pixels, 0, 0);
    return mask;
  }

  /**
   * A dart pointing where she is pointing.
   *
   * THE ROTATION IS NOT OPEN-CODED. The dart is authored pointing UP,
   * and `bearingFromHeading` is the repo's only sanctioned way to turn
   * one of her headings into an angle to spin it by — the two systems
   * disagree about both units and about which way zero faces, and
   * doing that in place at a call site is how a marker ends up
   * correct on the ground and mirrored in the air.
   */
  private drawQueen(
    frame: MinimapFrame, port: Viewport, scale: number, view: MapView,
  ): void {
    const here = worldToScreen(view, port, frame.at);
    const ink = this.ink;
    ink.save();
    ink.translate(here.x, here.y);
    ink.rotate((frame.bearing * Math.PI) / 180);
    ink.beginPath();
    ink.moveTo(0, -QUEEN_TIP * scale);
    ink.lineTo(QUEEN_HALF * scale, QUEEN_TAIL * scale);
    // The notch in the tail. It is what makes a dart read as a dart at
    // seven pixels rather than as a smudge that might be a triangle.
    ink.lineTo(0, QUEEN_TAIL * 0.45 * scale);
    ink.lineTo(-QUEEN_HALF * scale, QUEEN_TAIL * scale);
    ink.closePath();
    ink.fillStyle = GOLD_SOLID;
    ink.fill();
    ink.lineWidth = 1.1 * scale;
    ink.strokeStyle = OUTLINE;
    ink.stroke();
    ink.restore();
  }

  /**
   * A solid gold disc, because this pin is an ACTIVE mission.
   *
   * The full map draws a hollow ring for a preview the player has not
   * confirmed yet. Nothing unconfirmed reaches this widget — it is
   * handed `brain.primaryMission` and nothing else — so the solid form
   * is the only one it can honestly draw, and the ring keeps meaning
   * "not ordered" everywhere it appears.
   */
  private drawPin(
    at: WorldPoint, port: Viewport, scale: number, view: MapView,
  ): void {
    const here = worldToScreen(view, port, at);
    const ink = this.ink;
    ink.beginPath();
    ink.arc(here.x, here.y, PIN_RADIUS * scale, 0, Math.PI * 2);
    ink.fillStyle = GOLD;
    ink.fill();
    ink.lineWidth = 1.1 * scale;
    ink.strokeStyle = OUTLINE;
    ink.stroke();
  }
}
