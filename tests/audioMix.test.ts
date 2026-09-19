/**
 * THE MIX'S ARITHMETIC, PINNED — the half of the audio system that can
 * be wrong without anything crashing.
 *
 * `src/audio/mix.ts` is pure precisely so this test can exist: a fader
 * law and a duck are heard rather than observed, and "the ambience
 * sounds a bit low since that change" is not a bug report anybody can
 * act on. `AudioEngine.ts` is deliberately not tested here — WebAudio in
 * node is a mock of a mock, and what it would pin is the mock.
 *
 * Four things would rot silently and each has a test below:
 *
 *  1. THE FADER GOING LINEAR. The single most common volume-slider bug
 *     in games: a control that does nothing for its top half. The curve
 *     is shaped so its midpoint is the half-loudness point, -10 dB, and
 *     that is asserted as a number rather than described in a comment.
 *  2. A MUTED BUS THAT IS NOT SILENT. A decibel curve never reaches
 *     zero; a naive one would leave a bus the player turned off at 0.21
 *     of its amplitude. Both ends are asserted with `toBe`, not
 *     `toBeCloseTo`, because "almost silent" is the whole bug.
 *  3. A STORED DOCUMENT WITH RUBBISH IN IT taking the game down, or
 *     worse, deafening somebody. NaN, out of range, missing, the wrong
 *     type and not-an-object-at-all all have to come back as a usable
 *     mix.
 *  4. A DUCK THAT NEVER LETS GO. If the recovery does not land exactly
 *     on the undicked value, every line of dialogue leaves the room
 *     permanently quieter than the player set it — which is a bug that
 *     compounds over a play session and would be blamed on anything but
 *     the duck.
 */
import { describe, expect, it } from 'vitest';
import { BUSES, type Bus } from '../src/audio/manifest';
import {
  DUCKED_BUSES, DUCK_ATTACK_S, DUCK_DEPTH_DB, DUCK_GAIN, DUCK_HOLD_S, DUCK_RELEASE_S,
  MIX_DEFAULTS, MIX_RANGE_DB, MIX_SHAPE,
  busGainFor, curveGain, duckGainAt, duckGainOf, duckRampTo, duckedGainFor, ducks, gainFor,
  masterGainFor, mixSnapshot, newDuckRamp, newDuckState, resetDuck, sanitizeMixLevels, stepDuck,
  type MixLevels,
} from '../src/audio/mix';

/** Half the perceived loudness is -10 dB (Stevens), which is this in amplitude. */
const HALF_LOUDNESS = 10 ** -0.5;

/** A phone frame. The duck is stepped from the frame clock like everything else. */
const FRAME = 1 / 60;

const dB = (gain: number): number => 20 * Math.log10(gain);

describe('the fader curve', () => {
  it('is exactly silent at 0 and exactly unity at 1', () => {
    // `toBe`, deliberately. A muted bus that is 1e-9 of its amplitude is
    // silent; one that is 0.2 of it is the bug this guards, and the only
    // way to be sure which one shipped is to demand the exact number.
    expect(curveGain(0)).toBe(0);
    expect(curveGain(1)).toBe(1);
  });

  it('is strictly increasing across its whole travel', () => {
    let previous = curveGain(0);
    for (let i = 1; i <= 1000; i += 1) {
      const gain = curveGain(i / 1000);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
    expect(previous).toBe(1);
  });

  it('puts the midpoint at half the LOUDNESS, which is 0.316 of the amplitude and not 0.5', () => {
    const mid = curveGain(0.5);
    // -10 dB by construction: the shape parameter is solved for it
    // (mix.ts's header), so this is an equality and not a tolerance
    // somebody widened once.
    expect(dB(mid)).toBeCloseTo(-10, 9);
    expect(mid).toBeCloseTo(HALF_LOUDNESS, 12);
    // Well below linear: a slider at half travel is 0.316 of the
    // amplitude, a third less than the 0.5 a straight-through fader
    // would give, and that difference is the entire point of the curve.
    expect(mid).toBeLessThan(0.5);
    expect(0.5 - mid).toBeGreaterThan(0.18);
  });

  it('falls away fast below the midpoint, so the bottom of the travel is usable', () => {
    expect(dB(curveGain(0.25))).toBeCloseTo(-17.86, 1);
    expect(dB(curveGain(0.1))).toBeCloseTo(-26.86, 1);
    expect(dB(curveGain(0.05))).toBeCloseTo(-33.23, 1);
  });

  it('is the shifted curve, not the naive decibel one that never reaches zero', () => {
    // What the naive fader `10 ^ ((level - 1) * RANGE / 20)` would leave
    // in a bus the player had turned fully off. A fifth of the
    // amplitude: an audible ventilation hum with the slider at zero.
    const naiveAtZero = 10 ** (-MIX_RANGE_DB / 20);
    expect(naiveAtZero).toBeGreaterThan(0.2);
    expect(curveGain(0)).toBe(0);
    // And the shape is the solved one, 13.4 dB of travel.
    expect(MIX_SHAPE).toBeCloseTo(0.66982, 5);
    expect(MIX_RANGE_DB).toBeCloseTo(13.396, 3);
  });

  it('reads rubbish as silence, and a level above the top as the top', () => {
    // A number above 1 is a slider pushed too far and clamps to full.
    expect(curveGain(2)).toBe(1);
    // Anything that is not a real number is silence — INCLUDING
    // +Infinity, which a plain clamp would read as full volume. The
    // sanitiser never lets one through; this is the last line before a
    // gain node, and its failure direction is deliberately downward.
    expect(curveGain(Number.NaN)).toBe(0);
    expect(curveGain(-1)).toBe(0);
    expect(curveGain(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(curveGain(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('the two faders in series', () => {
  const levels: MixLevels = { master: 0.8, voice: 1, sfx: 0.5, ambience: 0.25, music: 0 };

  it('multiplies a bus level by the master, for every bus', () => {
    for (const bus of BUSES) {
      expect(gainFor(levels, bus)).toBe(curveGain(levels.master) * curveGain(levels[bus]));
      expect(gainFor(levels, bus)).toBe(masterGainFor(levels) * busGainFor(levels, bus));
    }
  });

  it('leaves a bus alone at master 1, and silences every bus at master 0', () => {
    const open = { ...levels, master: 1 };
    for (const bus of BUSES) expect(gainFor(open, bus)).toBe(curveGain(levels[bus]));
    const shut = { ...levels, master: 0 };
    for (const bus of BUSES) expect(gainFor(shut, bus)).toBe(0);
  });

  it('halves the loudness twice when both faders are at half', () => {
    const half: MixLevels = { master: 0.5, voice: 0.5, sfx: 0.5, ambience: 0.5, music: 0.5 };
    // -10 dB and -10 dB again: a quarter of the loudness, 0.1 of the amplitude.
    expect(dB(gainFor(half, 'voice'))).toBeCloseTo(-20, 8);
  });
});

describe('the sanitiser', () => {
  it('repairs NaN, out-of-range, missing, non-numeric and not-an-object', () => {
    const repaired = sanitizeMixLevels({
      master: Number.NaN,
      voice: 5,
      sfx: -3,
      ambience: 'loud',
      // `music` missing entirely.
      nonsense: 0.5,
    });
    expect(repaired.master).toBe(MIX_DEFAULTS.master);
    expect(repaired.voice).toBe(1);
    expect(repaired.sfx).toBe(0);
    expect(repaired.ambience).toBe(MIX_DEFAULTS.ambience);
    expect(repaired.music).toBe(MIX_DEFAULTS.music);
    expect(Object.keys(repaired).sort()).toEqual(['ambience', 'master', 'music', 'sfx', 'voice']);
    for (const raw of [null, undefined, 42, 'levels', [], true]) {
      expect(sanitizeMixLevels(raw)).toEqual(MIX_DEFAULTS);
    }
  });

  it('keeps a legitimate document as it is, and hands back a fresh object every time', () => {
    const stored: MixLevels = { master: 0.6, voice: 1, sfx: 0.4, ambience: 0.2, music: 0 };
    expect(sanitizeMixLevels(stored)).toEqual(stored);
    const first = sanitizeMixLevels(stored);
    expect(first).not.toBe(stored);
    expect(sanitizeMixLevels(undefined)).not.toBe(MIX_DEFAULTS);
  });

  it('honours a caller-supplied set of defaults', () => {
    const quiet: MixLevels = { master: 0.3, voice: 0.9, sfx: 0.3, ambience: 0.2, music: 0.1 };
    expect(sanitizeMixLevels({}, quiet)).toEqual(quiet);
  });

  it('every repaired level survives the curve as a real gain', () => {
    const repaired = sanitizeMixLevels({ master: Number.NaN, voice: Infinity, sfx: -1 });
    for (const bus of BUSES) {
      const gain = gainFor(repaired, bus);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });
});

describe('the duck', () => {
  const levels = MIX_DEFAULTS;

  it('touches ambience and sfx, and nothing else', () => {
    expect([...DUCKED_BUSES].sort()).toEqual(['ambience', 'sfx']);
    expect(ducks('voice')).toBe(false);
    expect(ducks('music')).toBe(false);
  });

  it('drops the ducked buses by the named amount and leaves voice at its full level', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S);
    expect(duckGainOf(duck)).toBe(DUCK_GAIN);
    expect(dB(DUCK_GAIN)).toBeCloseTo(DUCK_DEPTH_DB, 12);
    for (const bus of ['ambience', 'sfx'] as Bus[]) {
      expect(duckedGainFor(levels, bus, duck)).toBe(gainFor(levels, bus) * DUCK_GAIN);
      expect(duckedGainFor(levels, bus, duck)).toBeLessThan(gainFor(levels, bus));
    }
    // The line itself, and the empty bus, are untouched at full duck.
    expect(duckedGainFor(levels, 'voice', duck)).toBe(gainFor(levels, 'voice'));
    expect(duckedGainFor(levels, 'music', duck)).toBe(gainFor(levels, 'music'));
  });

  it('never touches voice at ANY point of the drop or the recovery', () => {
    const duck = newDuckState();
    const voiceOpen = gainFor(levels, 'voice');
    for (let t = 0; t < 1.5; t += FRAME) {
      stepDuck(duck, t < 0.5, FRAME);
      expect(duckedGainFor(levels, 'voice', duck)).toBe(voiceOpen);
    }
  });

  it('is fully down within the attack time and not before', () => {
    const duck = newDuckState();
    let elapsed = 0;
    while (elapsed < DUCK_ATTACK_S - FRAME) {
      stepDuck(duck, true, FRAME);
      elapsed += FRAME;
      expect(duck.ducking).toBeLessThan(1);
    }
    while (elapsed < DUCK_ATTACK_S + FRAME) {
      stepDuck(duck, true, FRAME);
      elapsed += FRAME;
    }
    expect(duck.ducking).toBe(1);
    expect(duckGainOf(duck)).toBe(DUCK_GAIN);
  });

  it('holds through the gap between two lines instead of pumping', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S);
    // The bed must not move at all through a conversational gap — the
    // modal one is about 200 ms, well inside the hold.
    for (let t = 0; t < DUCK_HOLD_S - FRAME; t += FRAME) {
      stepDuck(duck, false, FRAME);
      expect(duckGainOf(duck)).toBe(DUCK_GAIN);
    }
  });

  it('recovers monotonically to EXACTLY the undicked value, and stays there', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S);
    const ducked = duckedGainFor(levels, 'ambience', duck);
    let previous = ducked;
    let elapsed = 0;
    const span = DUCK_HOLD_S + DUCK_RELEASE_S;
    while (elapsed < span - FRAME) {
      stepDuck(duck, false, FRAME);
      elapsed += FRAME;
      const now = duckedGainFor(levels, 'ambience', duck);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    // Not back yet a frame before the ramp is due...
    expect(previous).toBeLessThan(gainFor(levels, 'ambience'));
    // ...and exactly back a couple of frames after. `toBe`: a recovery
    // that lands on 0.999 leaves the room quieter after every line.
    for (let i = 0; i < 3; i += 1) stepDuck(duck, false, FRAME);
    expect(duck.ducking).toBe(0);
    expect(duckGainOf(duck)).toBe(1);
    for (const bus of BUSES) {
      expect(duckedGainFor(levels, bus, duck)).toBe(gainFor(levels, bus));
    }
    stepDuck(duck, false, 10);
    expect(duckGainOf(duck)).toBe(1);
  });

  it('cannot be stranded by a bad dt', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S / 2);
    const half = duck.ducking;
    for (const dt of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      stepDuck(duck, true, dt);
      expect(duck.ducking).toBe(half);
    }
    // And an enormous dt clamps rather than overshooting into a gain
    // above unity — and pays off the hold AND the release in the one
    // step, which is what makes the duck frame-rate independent when a
    // backgrounded tab hands back four seconds at once.
    stepDuck(duck, true, 1e6);
    expect(duck.ducking).toBe(1);
    stepDuck(duck, false, 1e6);
    expect(duck.hold).toBe(0);
    expect(duck.ducking).toBe(0);
    expect(duckGainOf(duck)).toBe(1);
  });

  it('resets to fully open in place', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S);
    resetDuck(duck);
    expect(duck).toEqual({ ducking: 0, hold: 0 });
    expect(duckGainOf(duck)).toBe(1);
  });

  it('reports a ramp the engine can schedule that matches the model it is stepping', () => {
    const duck = newDuckState();
    const ramp = newDuckRamp();
    // Open and silent: nothing to do.
    duckRampTo(duck, false, ramp);
    expect(ramp).toEqual({ to: 0, gain: 1, seconds: 0 });
    // A line starts: head all the way down, over the attack time.
    duckRampTo(duck, true, ramp);
    expect(ramp.to).toBe(1);
    expect(ramp.gain).toBe(DUCK_GAIN);
    expect(ramp.seconds).toBeCloseTo(DUCK_ATTACK_S, 12);
    // Half way down, the remaining ramp is half as long.
    stepDuck(duck, true, DUCK_ATTACK_S / 2);
    duckRampTo(duck, true, ramp);
    expect(ramp.seconds).toBeCloseTo(DUCK_ATTACK_S / 2, 12);
    // The line ends: while the hold runs, the TARGET does not change, so
    // the engine reschedules nothing between two lines of one exchange.
    stepDuck(duck, true, DUCK_ATTACK_S);
    stepDuck(duck, false, FRAME);
    duckRampTo(duck, false, ramp);
    expect(ramp.gain).toBe(DUCK_GAIN);
    // Once the hold expires the target flips, over the release time —
    // measured from a step that spends exactly the hold that is left, so
    // that none of it has already been paid into the release.
    stepDuck(duck, false, duck.hold);
    expect(duck.hold).toBe(0);
    expect(duck.ducking).toBe(1);
    duckRampTo(duck, false, ramp);
    expect(ramp.to).toBe(0);
    expect(ramp.gain).toBe(1);
    expect(ramp.seconds).toBeCloseTo(DUCK_RELEASE_S, 12);
  });

  it('writes every bus into a caller-owned snapshot and allocates nothing of its own', () => {
    const duck = newDuckState();
    stepDuck(duck, true, DUCK_ATTACK_S);
    const out = { voice: 0, sfx: 0, ambience: 0, music: 0 } as Record<Bus, number>;
    expect(mixSnapshot(MIX_DEFAULTS, duck, out)).toBe(out);
    for (const bus of BUSES) expect(out[bus]).toBe(duckedGainFor(MIX_DEFAULTS, bus, duck));
    expect(out.voice).toBe(1);
    expect(out.ambience).toBe(DUCK_GAIN);
  });

  it('interpolates linearly between the two ends, which is why it arrives', () => {
    expect(duckGainAt(0)).toBe(1);
    expect(duckGainAt(1)).toBe(DUCK_GAIN);
    expect(duckGainAt(0.5)).toBeCloseTo((1 + DUCK_GAIN) / 2, 12);
    expect(duckGainAt(-1)).toBe(1);
    expect(duckGainAt(2)).toBe(DUCK_GAIN);
    expect(duckGainAt(Number.NaN)).toBe(1);
  });
});
