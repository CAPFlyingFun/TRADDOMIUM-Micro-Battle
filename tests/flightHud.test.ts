import { describe, expect, it } from 'vitest';
import { ladderFade, windCall } from '../src/ui/FlightHud';
import { MAX_POWERED_SPEED } from '../src/ant/flight';

describe('the pitch ladder giving way', () => {
  it('is fully drawn while the horizon is near the middle', () => {
    expect(ladderFade(0, 215)).toBe(1);
    expect(ladderFade(60, 215)).toBe(1);
    expect(ladderFade(-60, 215)).toBe(1);
  });

  it('is gone once the horizon has left the useful part of the screen', () => {
    // Hung off the TRUE horizon the ladder is correct at every camera
    // angle — and at a steep one that means it climbs into the compass
    // strip to tell you something you can see out of the window.
    expect(ladderFade(200, 215)).toBe(0);
    expect(ladderFade(-200, 215)).toBe(0);
  });

  it('gives way gradually rather than blinking out', () => {
    const middle = ladderFade(130, 215);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    // And only ever in one direction as the horizon climbs away.
    let last = 1;
    for (let px = 0; px <= 215; px += 5) {
      const now = ladderFade(px, 215);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      last = now;
    }
  });

  it('does not divide by a screen of no height', () => {
    expect(Number.isFinite(ladderFade(40, 0))).toBe(true);
  });
});

describe('what to say about the wind', () => {
  const gentle = MAX_POWERED_SPEED * 0.2;
  const brisk = MAX_POWERED_SPEED * 0.8;

  it('says nothing about air she can fly in', () => {
    expect(windCall(gentle, gentle)).toBeNull();
    expect(windCall(gentle, -gentle)).toBeNull();
  });

  it('warns once drift becomes the story', () => {
    expect(windCall(brisk, 0)).toBe('STRONG WIND');
  });

  it('is blunt when the wind is faster than she is', () => {
    // Across her, so it is drift and not a wall.
    expect(windCall(MAX_POWERED_SPEED * 1.2, 0)).toBe('WIND OVER AIRSPEED');
  });

  it('calls a headwind she cannot beat, and reaches that branch at all', () => {
    // THE REGRESSION. The component along her nose can never exceed the
    // wind's own speed, so checking "is the wind faster than she is"
    // first made this unreachable — dead code that said in its own
    // comment that it was the more useful of the two warnings.
    const felt = MAX_POWERED_SPEED * 1.2;
    expect(windCall(felt, -felt)).toBe('HEADWIND OVER AIRSPEED');
    // The same wind behind her is only ever good news, and gets the
    // milder call.
    expect(windCall(felt, felt)).toBe('WIND OVER AIRSPEED');
  });

  it('does not cry headwind at a breeze she can out-fly', () => {
    const felt = MAX_POWERED_SPEED * 0.5;
    expect(windCall(felt, -felt)).toBeNull();
  });
});
