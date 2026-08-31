import { describe, expect, it } from 'vitest';
import {
  MINIMAP_PX, frameFor, sameView, worthRedrawing, type MinimapFrame,
} from '../src/ui/Minimap';
import { MAX_FIT, worldPerPixel, worldToScreen, zoomFactor } from '../src/ui/mapView';
import { REVEAL_RADIUS } from '../src/game/discovery';
import { world, type WorldPoint } from '../src/world/coords';
import { ISLAND_SPAN } from '../src/world/heightfield';

// The face at the scale a phone actually draws it: 104 CSS px at the
// capped device ratio of 2. One of those pixels covers about 27 km of
// world, which is the number every threshold below is measured in.
const FACE = MINIMAP_PX * 2;
const PIXEL = ISLAND_SPAN / FACE;

const HER = world(-1_200_000, -900_000);

function frame(over: Partial<MinimapFrame> = {}): MinimapFrame {
  return { at: HER, bearing: 90, pin: null, revision: 3, ...over };
}

describe('the minimap deciding whether to paint at all', () => {
  it('paints the first frame, having nothing to compare against', () => {
    expect(worthRedrawing(null, frame(), PIXEL)).toBe(true);
  });

  it('does nothing at all when nothing has changed', () => {
    expect(worthRedrawing(frame(), frame(), PIXEL)).toBe(false);
  });

  it('repaints when the fog has moved and she has not', () => {
    // The whole point of the revision: the island under her changed
    // shape without a single marker moving a millimetre.
    expect(worthRedrawing(frame(), frame({ revision: 4 }), PIXEL)).toBe(true);
  });

  it('ignores travel too small to land on a different pixel', () => {
    const crept = world(HER.wx + PIXEL * 0.2, HER.wz - PIXEL * 0.2);
    expect(worthRedrawing(frame(), frame({ at: crept }), PIXEL)).toBe(false);
  });

  it('repaints once she has crossed one', () => {
    expect(worthRedrawing(
      frame(), frame({ at: world(HER.wx + PIXEL, HER.wz) }), PIXEL,
    )).toBe(true);
    expect(worthRedrawing(
      frame(), frame({ at: world(HER.wx, HER.wz - PIXEL) }), PIXEL,
    )).toBe(true);
  });

  it('repaints when a pin appears, and again when it goes', () => {
    const pin = world(400_000, 250_000);
    expect(worthRedrawing(frame(), frame({ pin }), PIXEL)).toBe(true);
    expect(worthRedrawing(frame({ pin }), frame(), PIXEL)).toBe(true);
  });

  it('follows a pin that is moved, but not one that is nudged', () => {
    const pin = world(400_000, 250_000);
    const far = world(pin.wx + PIXEL * 3, pin.wz);
    const near = world(pin.wx + PIXEL * 0.1, pin.wz);
    const held = frame({ pin });
    expect(worthRedrawing(held, frame({ pin: far }), PIXEL)).toBe(true);
    expect(worthRedrawing(held, frame({ pin: near }), PIXEL)).toBe(false);
  });

  it('ignores a turn too small to show on a seven-pixel dart', () => {
    const nudged = frame({ bearing: 90.4 });
    expect(worthRedrawing(frame(), nudged, PIXEL)).toBe(false);
  });

  it('repaints on a turn that would', () => {
    expect(worthRedrawing(frame(), frame({ bearing: 92 }), PIXEL)).toBe(true);
    expect(worthRedrawing(frame(), frame({ bearing: 88 }), PIXEL)).toBe(true);
  });

  it('reads a turn through north the short way round', () => {
    // 359.8 to 0.1 is a fifth of a degree of tremor. Subtracting the
    // raw numbers calls it 359.7 and repaints the map every frame she
    // flies north.
    const north = frame({ bearing: 359.8 });
    expect(worthRedrawing(north, frame({ bearing: 0.1 }), PIXEL)).toBe(false);
    // And a real turn across the same seam is still a real turn.
    expect(worthRedrawing(north, frame({ bearing: 2 }), PIXEL)).toBe(true);
  });
});

describe('the minimap refusing to draw a queen who is nowhere', () => {
  it('leaves the last good frame standing rather than drawing a NaN', () => {
    const was = frame();
    expect(worthRedrawing(was, frame({ at: world(NaN, 0) }), PIXEL))
      .toBe(false);
    expect(worthRedrawing(was, frame({ at: world(0, Infinity) }), PIXEL))
      .toBe(false);
    expect(worthRedrawing(was, frame({ bearing: NaN }), PIXEL)).toBe(false);
    expect(worthRedrawing(
      frame(), frame({ pin: world(NaN, NaN) }), PIXEL,
    )).toBe(false);
  });

  it('catches up by itself once she is real again', () => {
    // The caller only records what it PAINTED, so the frame held for
    // comparison is still the last good one — and the gap to a queen
    // who kept moving through the bad frames is large.
    const shown = frame();
    const back = frame({ at: world(HER.wx + PIXEL * 40, HER.wz) });
    expect(worthRedrawing(shown, back, PIXEL)).toBe(true);
  });

  it('does not wedge when handed a scale that is not a number', () => {
    const stepped = frame({ at: world(HER.wx + 1, HER.wz) });
    expect(worthRedrawing(frame(), stepped, NaN)).toBe(true);
    expect(worthRedrawing(frame(), stepped, 0)).toBe(true);
  });
});

/**
 * THE FRAME FOLLOWS WHAT SHE KNOWS.
 *
 * The widget drew the whole island always, which is right at the end
 * of a run and wrong at the start of one: a 2 km reveal is 3.6% of a
 * 56 km island, so a new player's minimap was a black square with one
 * lit cell — correct, and indistinguishable from a broken widget.
 * Joshua saw it in the first probe frame and called it.
 */
describe('how the minimap frames itself', () => {
  const box = (
    minX: number, minZ: number, maxX: number, maxZ: number,
  ): { min: WorldPoint; max: WorldPoint } => ({
    min: world(minX, minZ), max: world(maxX, maxZ),
  });
  const HER = world(0, 0);

  it('shows the whole island before anything is known', () => {
    // Nothing to fit, and nothing to draw either — but the frame has
    // to be a real one rather than a divide by zero.
    expect(zoomFactor(frameFor(null, HER, null))).toBe(1);
  });

  it('closes in on a first reveal instead of leaving a black square', () => {
    // One 2 km disc, the state of every brand-new run.
    const first = frameFor(box(-REVEAL_RADIUS, -REVEAL_RADIUS,
      REVEAL_RADIUS, REVEAL_RADIUS), HER, null);
    expect(zoomFactor(first)).toBeGreaterThan(1);
    // And it fills the widget: the known box covers a real share of
    // the face rather than a pixel of it.
    const port = { width: 208, height: 208 };
    const across = (REVEAL_RADIUS * 2) / worldPerPixel(first, port);
    expect(across).toBeGreaterThan(port.width * 0.5);
  });

  it('opens out as she explores, and never past the whole island', () => {
    const small = zoomFactor(frameFor(box(-200_000, -200_000, 200_000, 200_000), HER, null));
    const bigger = zoomFactor(frameFor(box(-900_000, -900_000, 900_000, 900_000), HER, null));
    const huge = zoomFactor(frameFor(box(-2_700_000, -2_700_000, 2_700_000, 2_700_000), HER, null));
    expect(small).toBeGreaterThan(bigger);
    expect(bigger).toBeGreaterThan(huge);
    // The end state is the frame it always used to have.
    expect(huge).toBe(1);
  });

  it('never closes tighter than the relief it is drawn from', () => {
    // A single cell would otherwise fit to an enormous magnification
    // of a 72.9 m-per-pixel bake — inventing detail the picture does
    // not hold.
    const oneCell = frameFor(box(0, 0, 14_583, 14_583), HER, null);
    expect(zoomFactor(oneCell)).toBeLessThanOrEqual(MAX_FIT);
  });

  it('keeps her in frame even when the fog is somewhere else', () => {
    // She can fly out of what she has discovered — the reveal follows
    // her, but a loaded save drops her wherever she logged out. A map
    // that can lose the player is not a map.
    const far = world(1_500_000, 1_500_000);
    const view = frameFor(box(-200_000, -200_000, 200_000, 200_000), far, null);
    const port = { width: 208, height: 208 };
    const on = worldToScreen(view, port, far);
    expect(on.x).toBeGreaterThanOrEqual(0);
    expect(on.x).toBeLessThanOrEqual(port.width);
    expect(on.y).toBeGreaterThanOrEqual(0);
    expect(on.y).toBeLessThanOrEqual(port.height);
  });

  it('and keeps the destination in frame too', () => {
    // A pin off the edge is a bearing, and the compass strip already
    // draws bearings better than 104 pixels ever will.
    const pin = world(-1_800_000, 900_000);
    const view = frameFor(box(-200_000, -200_000, 200_000, 200_000), HER, pin);
    const port = { width: 208, height: 208 };
    const on = worldToScreen(view, port, pin);
    expect(on.x).toBeGreaterThanOrEqual(0);
    expect(on.x).toBeLessThanOrEqual(port.width);
    expect(on.y).toBeGreaterThanOrEqual(0);
    expect(on.y).toBeLessThanOrEqual(port.height);
  });

  it('does not recut the island for a frame that has not moved', () => {
    const a = frameFor(box(-200_000, -200_000, 200_000, 200_000), HER, null);
    expect(sameView(a, a)).toBe(true);
    // One more cell revealed at the rim is not a new picture.
    const b = frameFor(box(-200_000, -200_000, 200_010, 200_000), HER, null);
    expect(sameView(a, b)).toBe(true);
    // A real change is.
    const c = frameFor(box(-900_000, -900_000, 900_000, 900_000), HER, null);
    expect(sameView(a, c)).toBe(false);
  });
});
