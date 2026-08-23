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
      const line = formatFix(fixAt(at, 1_281, 125.34, -4.2));
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
    const back = parseFix(formatFix(fixAt(world(0, 0), 1_281, 0, 0)));
    expect(back!.msl).toBeCloseTo(1_281, 0);
  });

  it('carries the heading and the attitude', () => {
    const back = parseFix(formatFix(fixAt(world(0, 0), 0, 125.34, -4.24)));
    expect(back!.bearing).toBeCloseTo(125.3, 1);
    expect(back!.pitch).toBeCloseTo(-4.2, 1);
  });
});

describe('parsing is liberal about everything but the order', () => {
  const line = formatFix(fixAt(world(1_000, 2_000), 1_281, 125.3, -4.2));

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
