/**
 * WHERE THE ISLAND SITS UNDER THE VIEWPORT — pan, zoom, nothing else.
 *
 * The full-screen map answers two questions all day: where on the glass
 * does this world point land, and what world point did that thumb just
 * touch. They are one answer read in opposite directions, and when they
 * disagree the map draws the queen in one place and drops the waypoint
 * in another. Nothing on screen says so. The mistake surfaces later, as
 * a flight to a coast she never chose.
 *
 * So the transform lives out here, apart from the component, as pure
 * functions of numbers. There is no DOM in this repo's test run, so a
 * rule left inside a class that owns a canvas cannot be checked at all
 * — and a rule that cannot be checked is one that quietly drifts.
 *
 * IT IS NOT A SECOND TRANSFORM. `worldToMap`/`mapToWorld` in
 * islandMap.ts already turn world coordinates into pixels of a square
 * island image, and they take that square's SIZE — which is the whole
 * trick. Hand them the island's size ON SCREEN and the map pixel they
 * hand back already IS the screen pixel, bar where the viewport happens
 * to be looking. Writing the arithmetic out again here would be a
 * second opinion about where Kauaʻi is, and the first time one of them
 * changed the other would start lying.
 *
 * NORTH IS UP ALREADY. `+wz` is SOUTH and `worldToMap` carries no
 * y-flip, so a larger `wz` is a larger y is further down the glass.
 * Adding a flip to "make north up" mirrors the island east for west.
 *
 * ZOOM 1 IS THE WHOLE ISLAND, and the island is square where the phone
 * is not. At 932x430 the short side is the HEIGHT, so the island is
 * fitted to the height and open sea fills the ends; fitting to the
 * width would run the north and south coasts off the top and bottom at
 * the one zoom whose entire job is to show everything at once. A tall
 * narrow window wants the mirror of that, which is why the rule is
 * written as the SMALLER side rather than as the height.
 *
 * Every value that leaves here and outlives the frame is a WorldPoint.
 * Pixels are presentation and are recomputed; see coords.ts.
 */
import { mapToWorld, worldToMap } from './islandMap';
import { world, type WorldPoint } from '../world/coords';
import { ISLAND_SPAN } from '../world/heightfield';

/** Zoom steps. 1 fits the whole island in the viewport. */
export const ZOOM_STEPS: readonly number[] = [1, 2, 4];

/**
 * How far a thumb must travel before it is panning rather than tapping.
 *
 * A tap places the waypoint preview, so every pixel of slop below this
 * is a pan that ends up moving the pin. Twelve px is about a millimetre
 * and a half of glass — under the wobble of a thumb held still, over
 * the wobble of one that has decided to move.
 */
export const DRAG_SLOP = 12;

export interface MapView {
  /** World point at the centre of the viewport. */
  readonly centre: WorldPoint;
  /** Index into ZOOM_STEPS. */
  readonly zoom: number;
}

export interface Viewport { readonly width: number; readonly height: number; }

/** The island's own bounds, both axes: it is centred on zero. */
const EDGE = ISLAND_SPAN / 2;

/** Fold a zoom index onto a step that exists. */
function heldZoom(step: number): number {
  return Math.max(0, Math.min(ZOOM_STEPS.length - 1, Math.round(step)));
}

/**
 * Hold a centre inside the island.
 *
 * The world point under the middle of the viewport is the one thing the
 * player cannot lose sight of, so it is the thing that is clamped. Let
 * it wander and a determined thumb slides Kauaʻi off the glass and
 * leaves an empty blue screen with nothing to steer back by.
 */
function heldCentre(at: WorldPoint): WorldPoint {
  return world(
    Math.max(-EDGE, Math.min(EDGE, at.wx)),
    Math.max(-EDGE, Math.min(EDGE, at.wz)),
  );
}

/** The multiplier this view is drawn at. */
export function zoomFactor(view: MapView): number {
  return ZOOM_STEPS[heldZoom(view.zoom)];
}

/**
 * The island's side length in screen pixels, at this view.
 *
 * The SMALLER side of the viewport, so zoom 1 shows all of it — see the
 * header. The floor of one pixel is for the frame before layout has
 * happened, where a zero-sized port would otherwise divide the whole
 * transform into infinities.
 */
export function islandPixels(view: MapView, port: Viewport): number {
  return Math.max(1, Math.min(port.width, port.height)) * zoomFactor(view);
}

/** World units per screen pixel — for a scale bar, and for a pan. */
export function worldPerPixel(view: MapView, port: Viewport): number {
  return ISLAND_SPAN / islandPixels(view, port);
}

/**
 * Where the island's north-west corner lands on the glass.
 *
 * Exported so the component can `drawImage(baked, x, y, size, size)`
 * and hold no arithmetic of its own. It is `worldToScreen` of the
 * corner and nothing more, which is why the two cannot come apart.
 */
export function islandOrigin(
  view: MapView, port: Viewport,
): { x: number; y: number } {
  return worldToScreen(view, port, world(-EDGE, -EDGE));
}

/** Open on her, showing the whole island. */
export function initialView(at: WorldPoint): MapView {
  return { centre: heldCentre(at), zoom: 0 };
}

/** Screen pixel -> world. */
export function screenToWorld(
  view: MapView, port: Viewport, sx: number, sy: number,
): WorldPoint {
  const size = islandPixels(view, port);
  const middle = worldToMap(view.centre.wx, view.centre.wz, size);
  return mapToWorld(
    middle.x + (sx - port.width / 2),
    middle.y + (sy - port.height / 2),
    size,
  );
}

/** World -> screen pixel. May fall outside the viewport. */
export function worldToScreen(
  view: MapView, port: Viewport, at: WorldPoint,
): { x: number; y: number } {
  const size = islandPixels(view, port);
  const middle = worldToMap(view.centre.wx, view.centre.wz, size);
  const here = worldToMap(at.wx, at.wz, size);
  return {
    x: port.width / 2 + (here.x - middle.x),
    y: port.height / 2 + (here.y - middle.y),
  };
}

/**
 * Drag by a screen delta, clamped so the island cannot be lost.
 *
 * THE SIGN, pinned once here so no call site has to decide it: `dx` and
 * `dy` are the FINGER's travel in screen pixels. Dragging RIGHT pulls
 * the island right under the thumb, so the viewport centre moves WEST —
 * it becomes whatever world point was sitting `dx` pixels to its left.
 * Backwards, this behaves like a scrollbar instead of a sheet of paper,
 * and that is the sort of wrong that survives a review because it still
 * moves when you push it.
 */
export function panBy(
  view: MapView, port: Viewport, dx: number, dy: number,
): MapView {
  const moved = screenToWorld(
    view, port, port.width / 2 - dx, port.height / 2 - dy,
  );
  return { centre: heldCentre(moved), zoom: view.zoom };
}

/**
 * Step the zoom, keeping the viewport centre fixed.
 *
 * The centre is what the whole transform is hung from, so holding it is
 * simply not moving it: zooming in on the middle of the screen is the
 * behaviour a map is expected to have, and it is what makes the buttons
 * usable with one thumb on a phone.
 */
export function zoomBy(view: MapView, steps: number): MapView {
  const now = heldZoom(view.zoom) + Math.round(steps);
  return { centre: view.centre, zoom: heldZoom(now) };
}

/** Put a world point at the middle of the viewport, at the same zoom. */
export function recentre(view: MapView, at: WorldPoint): MapView {
  return { centre: heldCentre(at), zoom: view.zoom };
}

/**
 * True when a pointer moved far enough to be a pan rather than a tap.
 *
 * Radially, not per axis: a thumb that slid seven px along each of them
 * has travelled ten, and reading that as a tap drops a waypoint at the
 * end of a drag. Reaching the threshold counts as a drag, because the
 * cost of the two mistakes is not the same — a pan misread as a tap
 * moves the pin somewhere the player never pointed at, while a tap
 * misread as a pan merely does nothing and invites a second tap.
 */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_SLOP;
}

/**
 * WHAT THE TWO MAP SURFACES DRAW, and why it is one declaration.
 *
 * The minimap and the full screen show the same three things, so they
 * were written against two structurally identical interfaces — which
 * TypeScript happily accepts and which would have drifted the first
 * time one of them gained a field. One name, in the module they both
 * already import for the transform.
 *
 * `heading` is her RAW radians, not a compass bearing. The conversion
 * belongs to whoever draws, through `bearingFromHeading`, because
 * open-coding it once cost this repo 142 degrees.
 */
export interface MapMarks {
  /** Where she is. WORLD, because it outlives the frame. */
  readonly at: WorldPoint;
  /** Her heading in radians — she travels along `(sin h, cos h)`. */
  readonly heading: number;
  /**
   * The ACTIVE PRIMARY mission, or none.
   *
   * From `brain.primaryMission`, never from `intent().target` or
   * `debug().target`: those follow `detour ?? primary`, so a thirsty
   * queen would watch her destination jump to a puddle.
   */
  readonly primary: WorldPoint | null;
}
