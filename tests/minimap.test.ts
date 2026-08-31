import { describe, expect, it } from 'vitest';
import {
  MINIMAP_PX, worthRedrawing, type MinimapFrame,
} from '../src/ui/Minimap';
import { world } from '../src/world/coords';
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
