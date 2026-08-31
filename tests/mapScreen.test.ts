import { existsSync, readFileSync } from 'node:fs';
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
    expect(clearTarget([NORTH], null)).toBe('preview');
    expect(clearTarget([NORTH], SOUTH)).toBe('preview');
  });

  it('falls through to the mission only when no preview is up', () => {
    expect(clearTarget([], SOUTH)).toBe('mission');
  });

  it('has nothing to do on an empty map', () => {
    expect(clearTarget([], null)).toBe('none');
  });

  it('says out loud which one it is about to take', () => {
    // A button reading only "CLEAR" beside two pins is a coin toss, and
    // the losing side of that toss cancels a mission somebody wanted.
    const labels = [
      clearWords(clearTarget([NORTH], SOUTH)),
      clearWords(clearTarget([], SOUTH)),
      clearWords(clearTarget([], null)),
    ];
    expect(new Set(labels).size).toBe(3);
    expect(clearWords('preview')).toContain('PIN');
    expect(clearWords('mission')).toContain('MISSION');
  });
});

describe('when FLY HERE may be pressed', () => {
  it('is dead until something has been previewed', () => {
    expect(canFly([])).toBe(false);
  });

  it('is armed by a preview', () => {
    expect(canFly([NORTH])).toBe(true);
  });

  it('stays dead for a preview that is not a place', () => {
    // A viewport that has not been laid out yet can hand a NaN back
    // through the screen transform, and a NaN destination reaches
    // MissionBrain as somewhere she can never arrive.
    expect(canFly([world(Number.NaN, 0)])).toBe(false);
    expect(canFly([world(0, Number.POSITIVE_INFINITY)])).toBe(false);
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
    expect(readout(HER, [], null)).toEqual(NOWHERE);
  });

  it('describes the preview over the mission', () => {
    // The numbers sit beside FLY HERE, so they must describe what FLY
    // HERE would act on — otherwise the range shown and the range about
    // to be flown are two different numbers.
    const said = readout(HER, [NORTH], SOUTH);
    expect(said.label).toBe('PREVIEW');
    expect(said.bearing).toBe('N 000°');
  });

  it('describes the mission once the preview is gone', () => {
    const said = readout(HER, [], SOUTH);
    expect(said.label).toBe('MISSION');
    expect(said.bearing).toBe('S 180°');
  });

  it('has east and west the right way round', () => {
    // +wz is SOUTH and north is −Z. Getting this mirrored is the class
    // of mistake nobody notices for weeks.
    expect(readout(HER, [EAST], null).bearing).toBe('E 090°');
    expect(readout(HER, [WEST], null).bearing).toBe('W 270°');
  });

  it('gives the range in metres, then kilometres', () => {
    // A world unit is a centimetre; UNITS_PER_METRE is 100.
    expect(readout(HER, [world(0, 50 * UNITS_PER_METRE)], null).range)
      .toBe('50m');
    expect(readout(HER, [world(0, 2000 * UNITS_PER_METRE)], null).range)
      .toBe('2.0km');
  });

  it('shows no ETA, ever', () => {
    // DELIBERATE. The Phase 1 trip estimator is a straight line at a
    // fixed speed; printed beside a map it would read as a flight plan,
    // and this screen has no flight plan to show.
    const said = readout(HER, [NORTH], null);
    // `stops` joined it when a draft became a CHAIN — it is a count of
    // taps, not a prediction about time, and the rule this test defends
    // is that nothing here estimates how long anything takes.
    expect(Object.keys(said).sort()).toEqual(['bearing', 'label', 'range', 'stops']);
  });

  it('is still truthful about ground she has never seen', () => {
    // Fog hides the terrain, not the geometry. Range and bearing to an
    // undiscovered place are as true as to a known one, and the readout
    // deliberately does not name the ground — that would hand back the
    // survey the fog exists to withhold, one tap at a time.
    const far = world(-2_400_000, 2_400_000);
    const said = readout(HER, [far], null);
    expect(said.range).toBe('33.9km');
    expect(said.bearing).toBe('SW 225°');
  });

  it('says nothing it cannot know when she has no position yet', () => {
    const said = readout(null, [NORTH], null);
    expect(said.label).toBe('PREVIEW');
    expect(said.range).toBe('—');
    expect(said.bearing).toBe('—');
  });

  it('does not print NaN for a broken preview', () => {
    const said = readout(HER, [world(Number.NaN, 0)], null);
    expect(said.range).toBe('—');
    expect(said.bearing).toBe('—');
  });
});

/**
 * AND THE CAPTION HAS TO KEEP UP WITH THE TRUTH.
 *
 * "Direct line — not a planned route" was written because a line drawn
 * between two points looks like a route unless it is called something
 * else, and until v0.0.140 it never was one. Now it sometimes is, and
 * leaving the words alone would be the same lie in the other direction.
 */
describe('what the map calls the line', () => {
  const src = readFileSync('src/ui/MapScreen.ts', 'utf8');

  it('has two captions, and picks one per frame', () => {
    expect(src).toContain("const DIRECT = 'Direct line — not a planned route.'");
    expect(src).toContain('const ROUTED =');
    expect(src).toContain('this.say(ROUTED);');
    expect(src).toContain('this.say(DIRECT);');
  });

  it('and the routed one is chosen by the same test that draws the track', () => {
    // One condition, not two that can drift apart into a solid route
    // captioned as a direct line.
    const paint = src.slice(src.indexOf('marks?.route && marks.route.length > 1'));
    expect(paint.slice(0, 260)).toContain('this.planned(');
    expect(paint.slice(0, 260)).toContain('this.say(ROUTED);');
  });
});

/**
 * AND THE ACTION PAD HAS TO BE SOMEWHERE A THUMB CAN SEE.
 *
 * Joshua, 2026-08-31, with a screenshot: "water is underneath the mini
 * map, so need to move it not hidden like bottom to the left or right
 * of the up/down slider depending on room."
 *
 * The pad stacked UPWARD from just above the lift lever, so the top of
 * the column ran under the minimap — which is drawn later and wins. A
 * button that cannot be seen is a button that does not exist.
 */
describe('where the action pad sits', () => {
  const pad = readFileSync('src/input/ActionPad.ts', 'utf8');

  it('is beside the lift lever rather than above it', () => {
    // 84 = the lever's own 14 px inset, its 58 px width, and 12 px
    // between them. There is no room to its RIGHT — it is already 14 px
    // off the edge — so the column goes left and shares its baseline.
    expect(pad).toContain("right: 'calc(84px + min(env(safe-area-inset-right), 14px))'");
    expect(pad).toContain("bottom: 'calc(18px + min(env(safe-area-inset-bottom), 12px))'");
    expect(pad).not.toContain("bottom: 'calc(198px");
  });

  it('and wins the pixels if it ever meets the minimap again', () => {
    // The minimap is 14. Three actions from this baseline stop well
    // short of it, but a fourth would reach — and when a control and a
    // panel want the same pixels, the control wins.
    const lift = readFileSync('src/input/LiftSlider.ts', 'utf8');
    const minimap = readFileSync('src/ui/Minimap.ts', 'utf8');
    expect(pad).toContain("zIndex: '15'");
    expect(minimap).toContain("zIndex: '14'");
    expect(lift).toContain("zIndex: '14'");
  });
});

/**
 * AND ENDING THE RUN IS NOT A THING ON THE PLAYING SURFACE.
 *
 * "move the DIE in settings since it's not needed on the main game."
 * Its own comment had already argued for it: it is scaffolding, the top
 * right should be the game's own furniture, and a control that ends the
 * run has no business one tap deep on the glass.
 */
describe('where ending the run lives', () => {
  it('is behind the gear, and nowhere else', () => {
    const panel = readFileSync('src/ui/SettingsPanel.ts', 'utf8');
    expect(panel).toContain("button.dataset.ui = 'debug-die'");
    expect(panel).toContain('private readonly onDie?: () => void,');
    // Two deliberate taps, and the panel closes on the way out so the
    // death screen is not opened behind it.
    const die = panel.slice(panel.indexOf('private buildDie()'));
    expect(die.slice(0, 1600)).toContain('this.show(false);');
    expect(die.slice(0, 1600)).toContain('this.onDie?.();');
  });

  it('and the floating button is gone rather than hidden', () => {
    // A HUD component nothing constructs is worse than one that does
    // something: it reads as live code to the next person.
    expect(existsSync('src/ui/DebugDie.ts')).toBe(false);
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).not.toContain('DebugDie');
    expect(scene).toContain('new SettingsPanel(host, true, () => this.kill())');
  });
});

/**
 * A CHAIN OF TAPS, WITH THE LAST ONE THE DESTINATION.
 *
 * Joshua, 2026-08-31: "Ability to add more than 1 waypoint as a
 * tap/spline with the last point always the destination." A tap used to
 * REPLACE the single preview; now it appends, and everything before the
 * last one is somewhere she goes on the way.
 */
describe('the draft chain', () => {
  const NE = world(10_000, -10_000);
  const SE = world(20_000, 10_000);

  it('reads the numbers off the LAST tap', () => {
    // That is what FLY commits her to arriving at, so it is what the
    // figures beside FLY have to describe.
    const said = readout(HER, [NE, SE], null);
    expect(said.stops).toBe(2);
    expect(said.range).toBe(readout(HER, [SE], null).range);
    expect(said.bearing).toBe(readout(HER, [SE], null).bearing);
  });

  it('and CLEAR undoes one tap at a time once there is a chain', () => {
    // A five-tap route that only starting again can correct is a route
    // nobody edits.
    expect(clearWords('preview', 3)).toBe('UNDO PIN');
    expect(clearWords('preview', 1)).toBe('CLEAR PIN');
    expect(clearWords('mission', 0)).toBe('CANCEL MISSION');
  });

  it('and one tap is exactly the single pin it always was', () => {
    expect(clearWords('preview')).toBe('CLEAR PIN');
    expect(readout(HER, [NE], null).stops).toBe(1);
    expect(canFly([NE])).toBe(true);
  });

  it('and an empty draft arms nothing', () => {
    expect(canFly([])).toBe(false);
    expect(clearTarget([], null)).toBe('none');
    expect(readout(HER, [], null)).toEqual(NOWHERE);
  });

  it('and one broken point poisons the whole chain', () => {
    // The draft comes back from a screen transform, and a viewport that
    // has not been laid out yet can hand back a NaN. One of those
    // sailing into MissionBrain is a destination she can never arrive
    // at — and in a chain it would be a stop she can never leave.
    expect(canFly([NE, world(Number.NaN, 0), SE])).toBe(false);
    expect(canFly([NE, world(0, Number.POSITIVE_INFINITY)])).toBe(false);
  });

  it('and the map appends rather than replaces', () => {
    const src = readFileSync('src/ui/MapScreen.ts', 'utf8');
    expect(src).toContain('this.draft.push(screenToWorld(');
    // UNDO is a pop, not a wipe.
    expect(src).toContain('this.draft.pop();');
    // And the whole chain goes to the scene, in order.
    expect(src).toContain('this.hooks.confirm(chain);');
  });
});
