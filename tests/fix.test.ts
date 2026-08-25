/**
 * A FIX IS ONLY WORTH PRINTING IF IT COMES BACK.
 *
 * The whole value of the line under the compass is that a number read
 * off a phone screenshot puts the camera back where the picture was
 * taken. So the property that matters is not "the string looks right",
 * it is "format then parse then place lands within a body length of
 * where it started" — measured in world units, at the scale she is.
 */
import { describe, expect, it } from 'vitest';
import { fixAt, fixToWorld, formatFix, parseFix, PLACES } from '../src/ui/fix';
import { geoToWorld, ISLAND_CENTRE, worldToGeo } from '../src/world/geo';
import {
  bearingFromHeading, headingFromBearing, wrap360,
} from '../src/ui/compassMath';
import { world } from '../src/world/coords';
import { UNITS_PER_METRE } from '../src/world/kauai';

/** A queen at founding is 5.5 mm; grown, 10. One unit is a centimetre. */
const BODY = 1;

const SPOTS = [
  world(0, 0),
  world(79_297, -8_203),
  world(-412_345.67, 238_901.23),
  world(1_204_500.5, -1_998_320.75),
];

describe('the position fix round-trips', () => {
  it('to well under a body length, everywhere on the island', () => {
    for (const at of SPOTS) {
      const line = formatFix(fixAt(at, 1_281, 125.34, -4.2, 1.5));
      const back = parseFix(line);
      expect(back).not.toBeNull();
      const there = fixToWorld(back!);
      expect(Math.hypot(there.wx - at.wx, there.wz - at.wz)).toBeLessThan(BODY);
    }
  });

  it('and eight places is what buys that', () => {
    // The claim in fix.ts's header, checked rather than asserted: one
    // step of the last printed digit has to be smaller than she is.
    const at = world(0, 0);
    const geo = worldToGeo(at);
    const nudged = geoToWorld({ lat: geo.lat + 10 ** -PLACES, lon: geo.lon });
    const step = Math.abs(nudged.wz - at.wz);
    expect(step).toBeLessThan(BODY);
    // And seven would not have: a body length, exactly the error we
    // are trying not to have.
    const coarse = geoToWorld({ lat: geo.lat + 10 ** -(PLACES - 1), lon: geo.lon });
    expect(Math.abs(coarse.wz - at.wz)).toBeGreaterThan(BODY);
  });

  it('keeps the altitude to a centimetre', () => {
    const back = parseFix(formatFix(fixAt(world(0, 0), 1_281, 0, 0, 1.5)));
    expect(back!.msl).toBeCloseTo(1_281, 0);
  });

  it('carries the attitude, and no longer the heading', () => {
    const line = formatFix(fixAt(world(0, 0), 0, 125.34, -4.24, 1.5));
    // THE HEADING IS GONE FROM THE LINE ON PURPOSE. The compass ribbon
    // prints it directly above, and one number on screen twice is one
    // too many — Joshua: "there are two headings and can drop the one
    // in the stat numbers."
    expect(line).not.toContain('125.3');
    const back = parseFix(line);
    expect(back!.pitch).toBeCloseTo(-4.2, 1);
    // Absent rather than wrong. goTo reads this and leaves the camera
    // facing where it already is; a zero here would snap it to north
    // and call that a reproduction.
    expect(Number.isFinite(back!.bearing)).toBe(false);
  });
});

/**
 * EVERY SHAPE THIS GAME HAS EVER PRINTED STILL READS.
 *
 * The fix line is an address typed off a photograph, so the ones in
 * Joshua's camera roll and in old cards outlive any change to the
 * format. Dropping the bearing made the five-number case ambiguous —
 * five numbers is `lat lon msl bearing pitch` in the old shape and
 * `lat lon msl pitch dial` in the new — and the `×` on the dial is
 * what tells them apart. These are the four shapes and the rule.
 */
describe('the four shapes of a fix', () => {
  it('reads the old six-number line, bearing and all', () => {
    const back = parseFix('22.04768893 -159.37047816 95.99m 199.4° -18.0° ×1.00');
    expect(back).not.toBeNull();
    expect(back!.bearing).toBeCloseTo(199.4, 1);
    expect(back!.pitch).toBeCloseTo(-18, 1);
    expect(back!.relief).toBe(1);
  });

  it('reads the old five-number line, which predates the dial', () => {
    // Unmarked last number, so the five are the OLD shape and the
    // fourth is a bearing.
    const back = parseFix('22.04 -159.53 12.81m 125.3° -4.2°');
    expect(back).not.toBeNull();
    expect(back!.bearing).toBeCloseTo(125.3, 1);
    expect(back!.pitch).toBeCloseTo(-4.2, 1);
    expect(Number.isFinite(back!.relief)).toBe(false);
  });

  it('reads the new five-number line, where the ×dial marks it', () => {
    const back = parseFix('22.04 -159.53 12.81m -4.2° ×1.00');
    expect(back).not.toBeNull();
    // Same count as the line above and a different meaning. The marker
    // is the whole of the difference, which is why formatFix always
    // prints it.
    expect(Number.isFinite(back!.bearing)).toBe(false);
    expect(back!.pitch).toBeCloseTo(-4.2, 1);
    expect(back!.relief).toBe(1);
  });

  it('reads a new line with the dial typed off', () => {
    // Four numbers is unambiguous, and someone copying off a screen
    // drops the tail more often than the head.
    const back = parseFix('22.04 -159.53 12.81m -4.2°');
    expect(back).not.toBeNull();
    expect(back!.pitch).toBeCloseTo(-4.2, 1);
    expect(Number.isFinite(back!.relief)).toBe(false);
  });

  it('still refuses a line that is not a fix', () => {
    expect(parseFix('22.04352187 -159.53850470')).toBeNull();
    expect(parseFix('nothing here at all')).toBeNull();
    // And somewhere that is not Kauaʻi, however well-formed.
    expect(parseFix('27.636363 55.222770 12.81m -4.2° ×1.00')).toBeNull();
  });
});

describe('parsing is liberal about everything but the order', () => {
  const line = formatFix(fixAt(world(1_000, 2_000), 1_281, 125.3, -4.2, 1.5));

  it('reads its own output', () => {
    expect(parseFix(line)).not.toBeNull();
  });

  it('reads it typed out of a photograph', () => {
    const typed = `Lat: ${ISLAND_CENTRE.lat.toFixed(8)} // Lon: ${
      ISLAND_CENTRE.lon.toFixed(8)}, alt 12.81 m, hdg 125.3, pitch -4.2`;
    const back = parseFix(typed);
    expect(back).not.toBeNull();
    expect(back!.lat).toBeCloseTo(ISLAND_CENTRE.lat, 8);
    expect(back!.msl).toBeCloseTo(12.81 * UNITS_PER_METRE, 6);
  });

  it('refuses a line that is short of numbers', () => {
    expect(parseFix('22.04352187 -159.53850470')).toBeNull();
    expect(parseFix('nothing here at all')).toBeNull();
  });

  it('refuses coordinates from somewhere that is not this island', () => {
    // Joshua's worked example was 27.6 / 55.2 — the Persian Gulf. A
    // fix that would teleport her off the map is a typo, not a place.
    expect(parseFix('27.636363 55.222770 12.81m 125.3° -4.2°')).toBeNull();
  });
});

describe('what a rendered comparison caught that the numbers did not', () => {
  it('converts a bearing to her heading rather than to radians', () => {
    // The bug: `bearing * PI / 180`. North is −Z and a heading runs
    // along (sin h, cos h), so the two systems are 180° and a
    // reflection apart — and the wrong one is a plausible-looking
    // angle, which is why four reproduced frames looked merely
    // "drifted" instead of obviously broken.
    for (const bearing of [0, 45, 105.2, 180, 213.2, 300, 359.9]) {
      expect(wrap360(bearingFromHeading(headingFromBearing(bearing))))
        .toBeCloseTo(bearing, 6);
    }
  });

  it('and carries the dial, because altitude is not the island alone', () => {
    // groundHeight is `relief x height`, so the same spot is 192 m up
    // at 1.0 and 288 m at 1.5. A fix restored on the other dial asked
    // for a point inside a hill.
    const line = formatFix(fixAt(world(0, 0), 19_200, 0, 0, 1));
    const back = parseFix(line)!;
    expect(back.relief).toBe(1);
    // What goTo does with it: the same PLACE on a different dial.
    expect((back.msl / back.relief) * 1.5).toBeCloseTo(28_800, 0);
  });

  it('assumes our own dial when a fix predates the field', () => {
    const back = parseFix('22.04 -159.53 12.81m 125.3° -4.2°');
    expect(back).not.toBeNull();
    expect(Number.isFinite(back!.relief)).toBe(false);
  });
});
