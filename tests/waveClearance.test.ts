/**
 * HIGH ENOUGH THAT A WAVE CANNOT REACH HER.
 *
 * Joshua, 2026-08-31: "when flying over the ocean, it should get the
 * max wave height + 1m for a safe margin between the waves and ant. So
 * if it's +1.2m / -1.2m / 0 = sea level, it should be at +2.2m AWL with
 * a 3s sampling so it doesn't dip into a wave."
 *
 * The 55 cm floor was never going to do it: it is measured against the
 * DAMPED water surface — the one she flies against so she is not
 * chasing every 1.5 s crest — and a real crest stands well above that.
 * She was cruising through the tops of waves.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLE_SECONDS, SEA_MARGIN, WaveWatch } from '../src/ant/waveClearance';

/** Feed a steady crest for a span of world time, at 60 fps. */
function hold(watch: WaveWatch, crest: number, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) watch.see(crest, 1 / 60);
}

describe('the crest it remembers', () => {
  it('is the tallest one lately, not the one under her now', () => {
    // The whole reason for a window. A swell is at its trough half the
    // time, and an altitude chosen at a trough is an altitude that gets
    // hit by the next crest.
    const watch = new WaveWatch();
    watch.see(120, 1 / 60);
    hold(watch, 0, 1);
    expect(watch.crest).toBe(120);
  });

  it('and it is Joshua\'s arithmetic', () => {
    // +1.2 m over the reference, so fly at 2.2 m.
    const watch = new WaveWatch();
    watch.see(120, 1 / 60);
    expect(watch.clearance).toBe(120 + SEA_MARGIN);
    expect(SEA_MARGIN).toBe(100);
  });

  it('and it forgets a crest that has left the window', () => {
    const watch = new WaveWatch();
    watch.see(200, 1 / 60);
    hold(watch, 10, SAMPLE_SECONDS + 0.6);
    expect(watch.crest).toBe(10);
  });

  it('and forgets it by EXPIRING it, not by fading it', () => {
    // A decay makes the remembered crest depend on how long ago it was
    // rather than on whether it is still inside the window — so one big
    // wave lifts the answer slightly for ever. Half a window after a
    // 2 m crest, the answer is still the full 2 m.
    const watch = new WaveWatch();
    watch.see(200, 1 / 60);
    hold(watch, 0, SAMPLE_SECONDS / 2);
    expect(watch.crest).toBe(200);
  });

  it('and three seconds is about two swell periods', () => {
    // The number is Joshua's and it lands well: the swell's components
    // run at about a second and a half.
    expect(SAMPLE_SECONDS).toBe(3);
  });
});

describe('over dry land', () => {
  it('asks for nothing at all', () => {
    // So a caller can take the max of this and its own floor without
    // first asking whether she is over the sea.
    const watch = new WaveWatch();
    hold(watch, 0, 1);
    expect(watch.crest).toBe(0);
    expect(watch.clearance).toBe(0);
  });

  it('and a coast crossed is forgotten within the window', () => {
    const watch = new WaveWatch();
    hold(watch, 150, 2);
    expect(watch.clearance).toBe(150 + SEA_MARGIN);
    hold(watch, 0, SAMPLE_SECONDS + 0.6);
    expect(watch.clearance).toBe(0);
  });

  it('and a trough is not a negative crest', () => {
    // The gap goes both ways — the true surface is BELOW the damped one
    // half the time. A negative crest would quietly lower the floor.
    const watch = new WaveWatch();
    watch.see(-200, 1 / 60);
    expect(watch.crest).toBe(0);
  });
});

describe('the clock it runs on', () => {
  it('is fed the WORLD\'s time, not hers', () => {
    // The sea is not boosted — the travel scale is one ant moving
    // quickly through a world going about its business. Sampled on her
    // clock at x10 the window would be a third of a swell period and
    // would routinely miss the crest it exists to find.
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    const call = scene.slice(scene.indexOf('this.waves.see('));
    expect(call.slice(0, 200)).toContain('dt,');
    expect(call.slice(0, 200)).not.toContain('plan.each');
    expect(call.slice(0, 200)).not.toContain('plan.budget');
  });

  it('and sampled once a frame, outside the substep loop', () => {
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene.match(/this\.waves\.see\(/g) ?? []).toHaveLength(1);
    // Before the loop that spends her time, which is where `plan` is
    // made and where the shadowed dt begins.
    const sample = scene.indexOf('this.waves.see(');
    const loop = scene.indexOf('for (let leg = 0; leg < plan.steps; leg++)');
    expect(sample).toBeLessThan(loop);
  });

  it('and measured as the gap, so it needs no wave model', () => {
    // The true surface under her against the damped one she flies
    // against. That difference IS the crest, it already carries the
    // shoaling that grows waves toward the beach, and it cannot fall
    // out of step with the ocean because it is read from it.
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    const call = scene.slice(scene.indexOf('this.waves.see('));
    expect(call.slice(0, 200)).toContain('seaHere.depth - this.holdFloor');
  });
});

describe('and the autopilot has to respect it', () => {
  const src = readFileSync('src/ant/autopilot.ts', 'utf8');

  it('as a floor it combines with the leg\'s by taking the larger', () => {
    // Two different claims: the leg's is the ROUTE's, fixed when the
    // route was planned, and this one is what is under her right now.
    // Neither is allowed to talk the other down.
    expect(src).toContain('readonly minimumAgl: number;');
    expect(src).toContain('sense.minimumAgl > this.leg.floorAgl');
    expect(src).toContain('{ ...this.leg, floorAgl: sense.minimumAgl }');
  });

  it('and every floor it uses is the combined one', () => {
    // A band search that looked below the combined floor would offer
    // her an altitude inside the waves.
    const from = src.indexOf('const leg = sense.minimumAgl');
    // Past the line that BUILDS the combined floor, where the only
    // legitimate mention of the leg's own is.
    const fly = src.slice(src.indexOf('bestBand(sense, wanted, leg)', from));
    expect(src.slice(from)).toContain('bestBand(sense, wanted, leg)');
    expect(fly).toContain('const under = (leg.floorAgl - agl)');
    expect(fly).toContain('soon.agl < leg.floorAgl');
    // Nothing downstream reaches past the combination for the raw one.
    expect(fly).not.toContain('this.leg.floorAgl');
  });

  it('and the scene tells it what the water is doing', () => {
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).toContain('minimumAgl: this.waves.clearance,');
  });
});

describe('and a hand-flown queen is told, not pushed', () => {
  it('because the one manoeuvre that must go down is landing on it', () => {
    // Joshua asked for the sampling in both modes. The autopilot is
    // MADE to respect the number; a player is shown it. Forcing a
    // hand-flown queen up would fight a deliberate descent onto water,
    // which is a move the game is built around.
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).toContain('→ fly ${far(this.waves.clearance)} AWL');
    // Silent when there is no sea under her.
    expect(scene).toContain('crest > 0');
  });
});

describe('and the takeoff aims at the safe height too', () => {
  it('climbs to the wave clearance when it is higher than a metre', () => {
    // THE TIGHTEST MOMENT OF A SEA CROSSING IS THE LIFT, and it has to
    // be: she starts on the surface. Measured at 16 cm over a crest
    // before this. She reached the safe height either way — the band
    // search takes over the moment the climb ends — but the takeoff is
    // the part actually inside the wave zone, so it should be aiming
    // there rather than arriving afterwards.
    const src = readFileSync('src/ant/autopilot.ts', 'utf8');
    expect(src).toContain('const upTo = Math.max(this.cfg.launchAgl, sense.minimumAgl);');
    expect(src).toContain('if (climbed < upTo)');
  });
});
