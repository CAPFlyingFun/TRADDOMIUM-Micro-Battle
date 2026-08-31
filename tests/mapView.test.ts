import { describe, expect, it } from 'vitest';
import {
  DRAG_SLOP, ZOOM_STEPS, initialView, isDrag, islandOrigin, islandPixels,
  panBy, recentre, screenToWorld, worldPerPixel, worldToScreen, zoomBy,
  type MapView, type Viewport,
} from '../src/ui/mapView';
import { world, type WorldPoint } from '../src/world/coords';
import { ISLAND_SPAN } from '../src/world/heightfield';

// The device this is drawn on, and the shapes it can be held in. 932x430
// is the design canvas; 667x375 is the smallest supported landscape; the
// tall one is a desktop window turned on its side, where the island has
// to fit to the WIDTH instead.
const PHONE: Viewport = { width: 932, height: 430 };
const SMALL: Viewport = { width: 667, height: 375 };
const TALL: Viewport = { width: 360, height: 780 };
const SQUARE: Viewport = { width: 512, height: 512 };
const PORTS = [PHONE, SMALL, TALL, SQUARE];

const EDGE = ISLAND_SPAN / 2;

// Somewhere off Kauaʻi's north shore, the middle, and a far corner.
const CENTRES: WorldPoint[] = [
  world(0, 0),
  world(-1_200_000, -900_000),
  world(2_100_000, 1_750_000),
  world(EDGE, -EDGE),
];

// A world unit is a centimetre, so 1e-3 units is ten microns. One map
// pixel covers about 130 m of ground at zoom 1, and float64 round-off at
// +/-2,800,000 is nearer 1e-9 units, so this tolerance is loose enough
// never to flake and tight enough that any real error in the transform —
// an off-by-a-pixel, a dropped half-viewport — is thousands of times
// larger than it.
const TIGHT = 3;

function viewAt(centre: WorldPoint, zoom: number): MapView {
  return { centre, zoom };
}

describe('the map transform reads the same in both directions', () => {
  it('round-trips world -> screen -> world at every zoom, centre and shape', () => {
    for (const port of PORTS) {
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        for (const centre of CENTRES) {
          const view = viewAt(centre, zoom);
          for (const at of CENTRES) {
            const screen = worldToScreen(view, port, at);
            const back = screenToWorld(view, port, screen.x, screen.y);
            expect(back.wx).toBeCloseTo(at.wx, TIGHT);
            expect(back.wz).toBeCloseTo(at.wz, TIGHT);
          }
        }
      }
    }
  });

  it('round-trips screen -> world -> screen, including off the edges', () => {
    // The pin can sit outside the viewport, so the transform has to stay
    // honest past the corners rather than only within them.
    const taps = [[0, 0], [932, 430], [466, 215], [-140, 60], [1400, 900]];
    for (const port of PORTS) {
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        const view = viewAt(CENTRES[1], zoom);
        for (const [sx, sy] of taps) {
          const back = worldToScreen(view, port, screenToWorld(view, port, sx, sy));
          expect(back.x).toBeCloseTo(sx, TIGHT);
          expect(back.y).toBeCloseTo(sy, TIGHT);
        }
      }
    }
  });

  it('never divides by a viewport that has not been laid out yet', () => {
    const view = initialView(world(0, 0));
    const nothing: Viewport = { width: 0, height: 0 };
    const at = screenToWorld(view, nothing, 0, 0);
    expect(Number.isFinite(at.wx)).toBe(true);
    expect(Number.isFinite(at.wz)).toBe(true);
    const back = worldToScreen(view, nothing, world(0, 0));
    expect(Number.isFinite(back.x)).toBe(true);
    expect(Number.isFinite(back.y)).toBe(true);
  });
});

describe('zoom 1 shows the whole island', () => {
  it('fits a landscape phone to its height, coast to coast north and south', () => {
    const view = initialView(world(0, 0));
    const corners = [
      screenToWorld(view, PHONE, 0, 0),
      screenToWorld(view, PHONE, PHONE.width, 0),
      screenToWorld(view, PHONE, 0, PHONE.height),
      screenToWorld(view, PHONE, PHONE.width, PHONE.height),
    ];
    const north = Math.min(...corners.map((c) => c.wz));
    const south = Math.max(...corners.map((c) => c.wz));
    expect(north).toBeCloseTo(-EDGE, TIGHT);
    expect(south).toBeCloseTo(EDGE, TIGHT);
    // Fitted to the height, so the long side is open sea either end and
    // the whole island is inside the frame rather than clipped by it.
    const west = Math.min(...corners.map((c) => c.wx));
    const east = Math.max(...corners.map((c) => c.wx));
    expect(west).toBeLessThan(-EDGE);
    expect(east).toBeGreaterThan(EDGE);
    expect(islandPixels(view, PHONE)).toBe(PHONE.height);
  });

  it('fits a tall narrow window to its width instead', () => {
    const view = initialView(world(0, 0));
    const left = screenToWorld(view, TALL, 0, TALL.height / 2);
    const right = screenToWorld(view, TALL, TALL.width, TALL.height / 2);
    expect(left.wx).toBeCloseTo(-EDGE, TIGHT);
    expect(right.wx).toBeCloseTo(EDGE, TIGHT);
    expect(islandPixels(view, TALL)).toBe(TALL.width);
  });

  it('hands the component an island origin that agrees with the transform', () => {
    // The component draws the baked island with these two numbers alone;
    // if they drifted from worldToScreen the picture and the pins would
    // slide apart.
    for (const port of PORTS) {
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        const view = viewAt(CENTRES[2], zoom);
        const origin = islandOrigin(view, port);
        const size = islandPixels(view, port);
        const corner = worldToScreen(view, port, world(-EDGE, -EDGE));
        const far = worldToScreen(view, port, world(EDGE, EDGE));
        expect(origin.x).toBeCloseTo(corner.x, TIGHT);
        expect(origin.y).toBeCloseTo(corner.y, TIGHT);
        expect(far.x - origin.x).toBeCloseTo(size, TIGHT);
        expect(far.y - origin.y).toBeCloseTo(size, TIGHT);
      }
    }
  });
});

describe('zooming in shows less ground', () => {
  it('shrinks the world across the viewport by exactly the step ratio', () => {
    for (const port of PORTS) {
      let previous = Number.POSITIVE_INFINITY;
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        const view = viewAt(world(0, 0), zoom);
        const left = screenToWorld(view, port, 0, port.height / 2);
        const right = screenToWorld(view, port, port.width, port.height / 2);
        const across = right.wx - left.wx;
        expect(across).toBeCloseTo(port.width * worldPerPixel(view, port), TIGHT);
        if (Number.isFinite(previous)) {
          const step = ZOOM_STEPS[zoom] / ZOOM_STEPS[zoom - 1];
          expect(previous / across).toBeCloseTo(step, 9);
        }
        previous = across;
      }
    }
  });

  it('holds the viewport centre still while it does', () => {
    const start = viewAt(CENTRES[1], 0);
    for (const steps of [1, 1, -1, 5, -9]) {
      const after = zoomBy(start, steps);
      expect(after.centre.wx).toBe(start.centre.wx);
      expect(after.centre.wz).toBe(start.centre.wz);
      const middle = screenToWorld(after, PHONE, PHONE.width / 2, PHONE.height / 2);
      expect(middle.wx).toBeCloseTo(start.centre.wx, TIGHT);
      expect(middle.wz).toBeCloseTo(start.centre.wz, TIGHT);
    }
  });

  it('clamps at both ends and never leaves the step table', () => {
    const start = initialView(world(0, 0));
    expect(zoomBy(start, -1).zoom).toBe(0);
    expect(zoomBy(start, -50).zoom).toBe(0);
    expect(zoomBy(start, 50).zoom).toBe(ZOOM_STEPS.length - 1);
    let view = start;
    for (const steps of [1, 1, 1, 1, -1, -1, -1, -1, 3, -3, 99, -99]) {
      view = zoomBy(view, steps);
      expect(view.zoom).toBeGreaterThanOrEqual(0);
      expect(view.zoom).toBeLessThan(ZOOM_STEPS.length);
      expect(ZOOM_STEPS[view.zoom]).toBeDefined();
    }
  });
});

describe('recentring', () => {
  it('puts the given world point exactly at the middle of the viewport', () => {
    for (const port of PORTS) {
      for (const at of CENTRES) {
        const view = recentre(viewAt(world(0, 0), 2), at);
        expect(view.zoom).toBe(2);
        const middle = screenToWorld(view, port, port.width / 2, port.height / 2);
        expect(middle.wx).toBeCloseTo(at.wx, TIGHT);
        expect(middle.wz).toBeCloseTo(at.wz, TIGHT);
      }
    }
  });

  it('will not centre on somewhere that is not on the island', () => {
    const view = recentre(initialView(world(0, 0)), world(EDGE * 3, -EDGE * 3));
    expect(view.centre.wx).toBe(EDGE);
    expect(view.centre.wz).toBe(-EDGE);
  });
});

describe('panning', () => {
  // THE SIGN CONVENTION, pinned: dx/dy are the FINGER's travel, so
  // dragging the map RIGHT walks the view WEST, and dragging it DOWN
  // walks the view NORTH. It is the sheet-of-paper feel, not a scrollbar.
  it('drags the map right and moves the view west', () => {
    const view = initialView(world(0, 0));
    const step = worldPerPixel(view, PHONE);
    const west = panBy(view, PHONE, 100, 0);
    expect(west.centre.wx).toBeCloseTo(-100 * step, TIGHT);
    expect(west.centre.wz).toBeCloseTo(0, TIGHT);
    expect(west.centre.wx).toBeLessThan(0);
  });

  it('drags the map left and moves the view east', () => {
    const view = initialView(world(0, 0));
    const step = worldPerPixel(view, PHONE);
    const east = panBy(view, PHONE, -100, 0);
    expect(east.centre.wx).toBeCloseTo(100 * step, TIGHT);
    expect(east.centre.wx).toBeGreaterThan(0);
  });

  it('drags the map down and moves the view north, which is -wz', () => {
    const view = initialView(world(0, 0));
    const step = worldPerPixel(view, PHONE);
    const north = panBy(view, PHONE, 0, 80);
    expect(north.centre.wz).toBeCloseTo(-80 * step, TIGHT);
    expect(north.centre.wz).toBeLessThan(0);
    expect(panBy(view, PHONE, 0, -80).centre.wz).toBeGreaterThan(0);
  });

  it('keeps the same zoom and moves a smaller distance when zoomed in', () => {
    const wide = panBy(viewAt(world(0, 0), 0), PHONE, 120, 0);
    const close = panBy(viewAt(world(0, 0), 2), PHONE, 120, 0);
    expect(close.zoom).toBe(2);
    expect(Math.abs(close.centre.wx)).toBeLessThan(Math.abs(wide.centre.wx));
    expect(Math.abs(wide.centre.wx) / Math.abs(close.centre.wx))
      .toBeCloseTo(ZOOM_STEPS[2] / ZOOM_STEPS[0], 9);
  });

  it('cannot push the centre off the island, however hard it is dragged', () => {
    for (const port of PORTS) {
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        let view = viewAt(world(0, 0), zoom);
        for (const [dx, dy] of [[9e6, 9e6], [-9e6, -9e6], [1e9, -1e9]]) {
          view = panBy(view, port, dx, dy);
          expect(view.centre.wx).toBeGreaterThanOrEqual(-EDGE);
          expect(view.centre.wx).toBeLessThanOrEqual(EDGE);
          expect(view.centre.wz).toBeGreaterThanOrEqual(-EDGE);
          expect(view.centre.wz).toBeLessThanOrEqual(EDGE);
        }
      }
    }
  });

  it('leaves the island still under the middle of the screen after a hard drag', () => {
    // The point of the clamp: whatever the player does, the world point
    // they are looking at is somewhere they could stand.
    let view = initialView(world(0, 0));
    for (let i = 0; i < 40; i++) view = panBy(view, PHONE, 500, 500);
    const middle = screenToWorld(view, PHONE, PHONE.width / 2, PHONE.height / 2);
    expect(Math.abs(middle.wx)).toBeLessThanOrEqual(EDGE + 1);
    expect(Math.abs(middle.wz)).toBeLessThanOrEqual(EDGE + 1);
  });
});

describe('a pan is not a tap', () => {
  it('holds still under the threshold and moves at it', () => {
    expect(DRAG_SLOP).toBe(12);
    for (const sign of [1, -1]) {
      expect(isDrag(11 * sign, 0)).toBe(false);
      expect(isDrag(12 * sign, 0)).toBe(true);
      expect(isDrag(13 * sign, 0)).toBe(true);
      expect(isDrag(0, 11 * sign)).toBe(false);
      expect(isDrag(0, 12 * sign)).toBe(true);
      expect(isDrag(0, 13 * sign)).toBe(true);
    }
    expect(isDrag(0, 0)).toBe(false);
  });

  it('measures the distance travelled, not either axis on its own', () => {
    // 11 px along both axes is 15.6 px of travel. A per-axis test would
    // call that a tap and drop a waypoint at the end of a drag.
    expect(isDrag(11, 11)).toBe(true);
    expect(isDrag(-11, 11)).toBe(true);
    // And just under, just at, just over, on the diagonal.
    const near = (11 / Math.SQRT2);
    const on = (12 / Math.SQRT2);
    const past = (13 / Math.SQRT2);
    expect(isDrag(near, near)).toBe(false);
    expect(isDrag(on, on)).toBe(true);
    expect(isDrag(-past, past)).toBe(true);
  });
});

describe('north is up', () => {
  it('draws a point north of the centre higher on the screen', () => {
    for (const port of PORTS) {
      for (let zoom = 0; zoom < ZOOM_STEPS.length; zoom++) {
        const view = viewAt(world(0, 0), zoom);
        const north = worldToScreen(view, port, world(0, -400_000));
        const south = worldToScreen(view, port, world(0, 400_000));
        expect(north.y).toBeLessThan(south.y);
        // And east is to the right, so nothing has been mirrored either.
        const east = worldToScreen(view, port, world(400_000, 0));
        const west = worldToScreen(view, port, world(-400_000, 0));
        expect(east.x).toBeGreaterThan(west.x);
      }
    }
  });

  it('reads a tap above the middle as somewhere north of the centre', () => {
    const view = initialView(world(0, 0));
    const up = screenToWorld(view, PHONE, PHONE.width / 2, PHONE.height / 2 - 60);
    expect(up.wz).toBeLessThan(0);
  });
});
