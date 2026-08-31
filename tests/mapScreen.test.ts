import { describe, expect, it } from 'vitest';
import {
  NOWHERE, canFly, clearTarget, clearWords, degreeWords, readout,
} from '../src/ui/MapScreen';
import { world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE } from '../src/world/kauai';

// Somewhere off the north shore, and a few places to point at from it.
const HER: WorldPoint = world(0, 0);
const NORTH: WorldPoint = world(0, -100_000);
const EAST: WorldPoint = world(100_000, 0);
const SOUTH: WorldPoint = world(0, 100_000);
const WEST: WorldPoint = world(-100_000, 0);

describe('which pin CLEAR takes', () => {
  it('takes the preview whenever there is one', () => {
    // Even with a mission running. The preview is uncommitted and one
    // tap from being remade; the mission is not.
    expect(clearTarget(NORTH, null)).toBe('preview');
    expect(clearTarget(NORTH, SOUTH)).toBe('preview');
  });

  it('falls through to the mission only when no preview is up', () => {
    expect(clearTarget(null, SOUTH)).toBe('mission');
  });

  it('has nothing to do on an empty map', () => {
    expect(clearTarget(null, null)).toBe('none');
  });

  it('says out loud which one it is about to take', () => {
    // A button reading only "CLEAR" beside two pins is a coin toss, and
    // the losing side of that toss cancels a mission somebody wanted.
    const labels = [
      clearWords(clearTarget(NORTH, SOUTH)),
      clearWords(clearTarget(null, SOUTH)),
      clearWords(clearTarget(null, null)),
    ];
    expect(new Set(labels).size).toBe(3);
    expect(clearWords('preview')).toContain('PIN');
    expect(clearWords('mission')).toContain('MISSION');
  });
});

describe('when FLY HERE may be pressed', () => {
  it('is dead until something has been previewed', () => {
    expect(canFly(null)).toBe(false);
  });

  it('is armed by a preview', () => {
    expect(canFly(NORTH)).toBe(true);
  });

  it('stays dead for a preview that is not a place', () => {
    // A viewport that has not been laid out yet can hand a NaN back
    // through the screen transform, and a NaN destination reaches
    // MissionBrain as somewhere she can never arrive.
    expect(canFly(world(Number.NaN, 0))).toBe(false);
    expect(canFly(world(0, Number.POSITIVE_INFINITY))).toBe(false);
  });
});

describe('printing a bearing', () => {
  it('carries three digits, so 41 and 410 cannot be confused', () => {
    expect(degreeWords(41)).toBe('NE 041°');
    expect(degreeWords(0)).toBe('N 000°');
  });

  it('never prints a bearing that does not exist', () => {
    // 359.7 rounds to 360, which is not a compass bearing.
    expect(degreeWords(359.7)).toBe('N 000°');
    expect(degreeWords(360)).toBe('N 000°');
  });

  it('folds anything it is handed into the circle', () => {
    expect(degreeWords(-90)).toBe(degreeWords(270));
    expect(degreeWords(450)).toBe(degreeWords(90));
  });

  it('refuses rather than printing NaN°', () => {
    expect(degreeWords(Number.NaN)).toBe('—');
  });
});

describe('the destination readout', () => {
  it('says so plainly when there is nowhere to go', () => {
    expect(readout(HER, null, null)).toEqual(NOWHERE);
  });

  it('describes the preview over the mission', () => {
    // The numbers sit beside FLY HERE, so they must describe what FLY
    // HERE would act on — otherwise the range shown and the range about
    // to be flown are two different numbers.
    const said = readout(HER, NORTH, SOUTH);
    expect(said.label).toBe('PREVIEW');
    expect(said.bearing).toBe('N 000°');
  });

  it('describes the mission once the preview is gone', () => {
    const said = readout(HER, null, SOUTH);
    expect(said.label).toBe('MISSION');
    expect(said.bearing).toBe('S 180°');
  });

  it('has east and west the right way round', () => {
    // +wz is SOUTH and north is −Z. Getting this mirrored is the class
    // of mistake nobody notices for weeks.
    expect(readout(HER, EAST, null).bearing).toBe('E 090°');
    expect(readout(HER, WEST, null).bearing).toBe('W 270°');
  });

  it('gives the range in metres, then kilometres', () => {
    // A world unit is a centimetre; UNITS_PER_METRE is 100.
    expect(readout(HER, world(0, 50 * UNITS_PER_METRE), null).range)
      .toBe('50m');
    expect(readout(HER, world(0, 2000 * UNITS_PER_METRE), null).range)
      .toBe('2.0km');
  });

  it('shows no ETA, ever', () => {
    // DELIBERATE. The Phase 1 trip estimator is a straight line at a
    // fixed speed; printed beside a map it would read as a flight plan,
    // and this screen has no flight plan to show.
    const said = readout(HER, NORTH, null);
    expect(Object.keys(said).sort()).toEqual(['bearing', 'label', 'range']);
  });

  it('is still truthful about ground she has never seen', () => {
    // Fog hides the terrain, not the geometry. Range and bearing to an
    // undiscovered place are as true as to a known one, and the readout
    // deliberately does not name the ground — that would hand back the
    // survey the fog exists to withhold, one tap at a time.
    const far = world(-2_400_000, 2_400_000);
    const said = readout(HER, far, null);
    expect(said.range).toBe('33.9km');
    expect(said.bearing).toBe('SW 225°');
  });

  it('says nothing it cannot know when she has no position yet', () => {
    const said = readout(null, NORTH, null);
    expect(said.label).toBe('PREVIEW');
    expect(said.range).toBe('—');
    expect(said.bearing).toBe('—');
  });

  it('does not print NaN for a broken preview', () => {
    const said = readout(HER, world(Number.NaN, 0), null);
    expect(said.range).toBe('—');
    expect(said.bearing).toBe('—');
  });
});
