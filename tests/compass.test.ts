import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  apart, bearingFromHeading, bearingOf, bearingTo, cardinalOf, easeBearing,
  place, rangeWords, wrap180, wrap360, type CompassMarker,
  speedWords,
} from '../src/ui/compassMath';
import { world } from '../src/world/coords';

const here = world(0, 0);
const pin = (at: ReturnType<typeof world>): CompassMarker =>
  ({ id: 'x', label: 'X', at, colour: '#fff' });

describe('bearings', () => {
  it('puts north at zero, because north is minus Z', () => {
    expect(bearingOf(0, -1)).toBeCloseTo(0, 9);
    expect(bearingOf(1, 0)).toBeCloseTo(90, 9);
    expect(bearingOf(0, 1)).toBeCloseTo(180, 9);
    expect(bearingOf(-1, 0)).toBeCloseTo(270, 9);
  });

  /**
   * The game's headings are radians measured from +Z; a bearing is
   * degrees from −Z. Two disagreements at once, which is exactly the
   * shape of bug that leaves a compass right on foot and mirrored in
   * the air.
   */
  it('converts a game heading without mirroring it', () => {
    expect(bearingFromHeading(0)).toBeCloseTo(180, 9); // +Z is south
    expect(bearingFromHeading(Math.PI)).toBeCloseTo(0, 9); // −Z is north
    expect(bearingFromHeading(Math.PI / 2)).toBeCloseTo(90, 9); // +X east
    expect(bearingFromHeading(-Math.PI / 2)).toBeCloseTo(270, 9);
  });

  it('reads a bearing between two global points', () => {
    expect(bearingTo(here, world(0, -100))).toBeCloseTo(0, 9);
    expect(bearingTo(here, world(100, 0))).toBeCloseTo(90, 9);
    expect(bearingTo(world(50, 50), world(50, -50))).toBeCloseTo(0, 9);
  });

  it('folds angles both ways', () => {
    expect(wrap360(-10)).toBeCloseTo(350, 9);
    expect(wrap360(730)).toBeCloseTo(10, 9);
    expect(wrap180(350)).toBeCloseTo(-10, 9);
    expect(wrap180(-350)).toBeCloseTo(10, 9);
    expect(wrap180(180)).toBeCloseTo(-180, 9);
  });

  it('names the sixteen points', () => {
    expect(cardinalOf(0)).toBe('N');
    expect(cardinalOf(45)).toBe('NE');
    expect(cardinalOf(67.5)).toBe('ENE');
    expect(cardinalOf(180)).toBe('S');
    expect(cardinalOf(359)).toBe('N');
  });
});

describe('easing the strip', () => {
  /** Turning 350 to 10 is twenty degrees, not three hundred and forty. */
  it('takes the short way across north', () => {
    let shown = 350;
    for (let i = 0; i < 200; i += 1) shown = easeBearing(shown, 10, 1 / 60, 0.09);
    expect(shown).toBeCloseTo(10, 3);
    // And never swung out through the south to get there.
    let worst = 0;
    let track = 350;
    for (let i = 0; i < 200; i += 1) {
      track = easeBearing(track, 10, 1 / 60, 0.09);
      worst = Math.max(worst, Math.abs(wrap180(track - 0)));
    }
    expect(worst).toBeLessThan(20);
  });

  it('settles at the same rate whatever the frame rate', () => {
    const reached = [120, 60, 30, 10].map((fps) => {
      let shown = 0;
      for (let f = 0; f < fps * 1; f += 1) shown = easeBearing(shown, 90, 1 / fps, 0.09);
      return shown;
    });
    expect(Math.max(...reached) - Math.min(...reached)).toBeLessThan(0.5);
  });

  it('stays put when it is already there', () => {
    expect(easeBearing(123, 123, 1 / 60, 0.09)).toBeCloseTo(123, 9);
  });
});

describe('placing markers', () => {
  const HALF = 60;

  it('centres a marker dead ahead', () => {
    const set = place(pin(world(0, -500)), here, 0, HALF);
    expect(set.offset).toBeCloseTo(0, 9);
    expect(set.pinned).toBe(false);
    expect(set.side).toBe(0);
  });

  it('puts a target to her right on the right', () => {
    const set = place(pin(world(500, 0)), here, 0, HALF);
    expect(set.offset).toBeCloseTo(90 > HALF ? HALF : 90, 9);
    expect(set.pinned).toBe(true);
    expect(set.side).toBe(1);
  });

  it('places one inside the window at its true angle', () => {
    // 30 degrees right of north, well inside a 60 degree half-window.
    const set = place(pin(world(500, -866)), here, 0, HALF);
    expect(set.offset).toBeCloseTo(30, 0);
    expect(set.pinned).toBe(false);
  });

  it('follows her as she turns', () => {
    const north = pin(world(0, -500));
    expect(place(north, here, 0, HALF).offset).toBeCloseTo(0, 6);
    // Look east and north is now ninety degrees to the LEFT.
    const looking = place(north, here, 90, HALF);
    expect(looking.side).toBe(-1);
    expect(looking.offset).toBeCloseTo(-HALF, 9);
  });

  /**
   * THE CASE THAT BREAKS A NAIVE VERSION. Two targets almost directly
   * behind her, a hair either side of dead astern, must pin to
   * OPPOSITE edges — the short way to one is left and to the other is
   * right. Taking an absolute value first sends both the same way.
   */
  it('pins the two sides of dead astern to opposite edges', () => {
    const justLeft = place(pin(world(-1, 500)), here, 0, HALF);
    const justRight = place(pin(world(1, 500)), here, 0, HALF);
    expect(justLeft.side).toBe(-1);
    expect(justRight.side).toBe(1);
    expect(justLeft.offset).toBeCloseTo(-HALF, 9);
    expect(justRight.offset).toBeCloseTo(HALF, 9);
  });

  it('never places anything outside the window', () => {
    for (let angle = 0; angle < 360; angle += 7) {
      const rad = (angle * Math.PI) / 180;
      const target = world(Math.sin(rad) * 400, -Math.cos(rad) * 400);
      for (let look = 0; look < 360; look += 11) {
        const set = place(pin(target), here, look, HALF);
        expect(Math.abs(set.offset)).toBeLessThanOrEqual(HALF + 1e-9);
      }
    }
  });

  it('carries how far away it is', () => {
    const set = place(pin(world(300, -400)), here, 0, HALF);
    expect(set.range).toBeCloseTo(500, 6);
    expect(apart(here, world(0, -250))).toBeCloseTo(250, 9);
  });
});

describe('reading a range', () => {
  it('speaks metres and kilometres, not world units', () => {
    expect(rangeWords(50)).toBe('0.5m');
    expect(rangeWords(1500)).toBe('15m');
    expect(rangeWords(250_000)).toBe('2.5km');
  });
});

/**
 * WHAT THE WORLD SEES HER DO, against what she is flying.
 *
 * Joshua tried boosted travel and could not tell it was on. The boost
 * was working; the READOUT could not show it. Her airspeed is unchanged
 * under it — she still flies 70 cm/s through the air — and what changes
 * is that her simulation runs ten times for every second the player
 * waits, so she crosses seven metres of Kauaʻi a second while the panel
 * sits at 70 cm/s.
 */
describe('speed, when her clock is not the world\'s', () => {
  it('is the plain number at real time', () => {
    expect(speedWords(70)).toBe('70.0 cm/s');
    expect(speedWords(70, 1)).toBe('70.0 cm/s');
  });

  it('and both numbers under boost, the way Joshua asked for it', () => {
    expect(speedWords(70, 10)).toBe('7.0 m/s (RAL 70 cm/s)');
  });

  it('scales what the world sees, never what she is flying', () => {
    // The parenthesis is the invariant: it is her real airspeed and it
    // does not move, whatever her clock is doing.
    for (const travel of [2, 5, 10]) {
      expect(speedWords(70, travel)).toContain('RAL 70 cm/s');
    }
    expect(speedWords(70, 5)).toBe('3.5 m/s (RAL 70 cm/s)');
  });

  it('and says nothing extra while the ramp is still near real time', () => {
    // A parenthesis that repeats the number in front of it is noise on
    // a line that has already run off the side of a phone once.
    expect(speedWords(70, 1.0005)).toBe('70.0 cm/s');
    expect(speedWords(70, 1.02)).toContain('RAL');
  });

  it('and all three speeds under the tape are on the same clock', () => {
    // AIR, GND and WND stack one above the other and tell one story
    // together — this is where she points, this is where she goes, this
    // is the difference and it is the wind. A wind in real cm/s beside
    // a ground speed in boosted m/s is two clocks in one paragraph, and
    // the difference between the rows stops being the wind.
    const src = readFileSync('src/ui/Compass.ts', 'utf8');
    expect(src.match(/speedWords\(/g) ?? []).toHaveLength(3);
    const wind = src.slice(src.indexOf('const wind = under?.wind ?? null;'));
    expect(wind.slice(0, 400)).toContain('speedWords(wind.speed, wind.travel)');
    // The WARNING is not scaled: a headwind she cannot out-fly is a
    // fact about the air and her wings, true at any playback speed.
    expect(wind.slice(0, 400)).toContain('wind.call');
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    const wired = scene.slice(scene.indexOf('wind: hudUp &&'));
    expect(wired.slice(0, 600)).toContain('travel: this.travel.scale');
    expect(wired.slice(0, 600)).toContain('windCall(');
    expect(wired.slice(0, 600).indexOf('windCall('))
      .toBeGreaterThan(wired.slice(0, 600).indexOf('travel: this.travel.scale'));
  });
});

/**
 * THE DEVELOPER REGISTER IS AN INSTRUMENT, NOT PART OF THE COCKPIT.
 *
 * Joshua, on the Phase 2 screenshots: "all the UI text getting
 * cluttered and that last line from the screenshots go outside of
 * view." The overflow was one half of that and is fixed by wrapping;
 * this is the other half. Six centred rows in the same mint as the
 * speeds, stacked directly under them, made the busiest thing on the
 * screen indistinguishable from the three rows a player actually flies
 * by.
 */
describe('the developer block', () => {
  const src = readFileSync('src/ui/Compass.ts', 'utf8');

  it('holds every developer register and nothing else', () => {
    // The three speeds stay on the compass root: they are the flight
    // display and they are for the player.
    for (const row of ['fpsLine', 'fixLine', 'lodLine', 'waterLine', 'aiLine', 'navLine']) {
      expect(src, row).toContain(`this.dev.appendChild(this.${row});`);
      expect(src, row).not.toContain(`this.root.appendChild(this.${row});`);
    }
    for (const row of ['airLine', 'groundLine', 'windLine']) {
      expect(src, row).toContain(`this.root.appendChild(this.${row});`);
    }
  });

  it('and is not there at all when there is nothing in it', () => {
    // An empty bordered rectangle under the speeds would be worse than
    // the loose rows it replaces, and with the overlay off that is
    // exactly what it would be.
    expect(src).toContain('const anyDev = Boolean(fps ?? fix ?? lod ?? water ?? ai ?? nav);');
    expect(src).toContain("const wantDev = anyDev ? '' : 'none';");
  });

  it('and reads down a shared left edge', () => {
    // Centred rows of different lengths have no edge to run the eye
    // down, which is most of why the stack read as noise.
    const block = src.slice(src.indexOf("this.dev.dataset.ui = 'compass-dev'"));
    expect(block.slice(0, 700)).toContain("textAlign: 'left'");
    const rows = src.slice(src.indexOf("this.fpsLine = document.createElement"),
      src.indexOf('host.appendChild(this.root);'));
    expect(rows).not.toContain("textAlign: 'center'");
  });

  it('and every long one still wraps inside the glass', () => {
    // The overflow Joshua photographed: these lines run to a hundred
    // and fifty characters and the compass root is a measured ~320 px.
    const rows = src.slice(src.indexOf("this.waterLine = document.createElement"),
      src.indexOf('host.appendChild(this.root);'));
    expect(rows.match(/overflowWrap: 'anywhere'/g) ?? []).toHaveLength(3);
  });
});
