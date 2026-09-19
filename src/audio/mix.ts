/**
 * THE ARITHMETIC OF THE MIX — what a slider MEANS, and what happens to
 * the room while somebody is talking.
 *
 * `manifest.ts` says what the audio IS; `AudioEngine.ts` is the only file
 * here allowed to touch the platform. This file is the sums between them,
 * and it is pure on purpose: every number a player can hear is decided by
 * a function that runs in plain node, so the two things most likely to be
 * got wrong — a fader that does not behave like a fader, and a duck that
 * never quite lets go — are pinned by a test instead of by listening.
 *
 * ─── A FADER IS NOT A MULTIPLIER ────────────────────────────────────
 *
 * Hearing is not linear in amplitude. Loudness grows roughly as the 0.3
 * power of intensity (Stevens' power law, the sone scale), so HALVING
 * the perceived loudness of a sound costs about 10 dB — a factor of 10
 * in power and therefore 10^(-1/2) = 0.316 in amplitude. A slider wired
 * straight through to a gain node puts "half as loud" at 0.316 of the
 * travel and spends its entire top half on a change most people cannot
 * describe. Every game that ships a linear volume slider ships a slider
 * that does nothing until it is nearly off.
 *
 * So the fader is a decibel curve. The naive one,
 *
 *     gain = 10 ^ ((level - 1) * RANGE_DB / 20)
 *
 * has the right shape and a real bug at the bottom: at level 0 it is
 * 10^(-RANGE_DB/20), which is not silence. With the range this curve
 * wants (13.4 dB, below) a fully "off" ambience bus would still be at
 * 0.21 of its amplitude — a ventilation hum the player has explicitly
 * turned off, still playing. An exponential does not reach zero, so the
 * curve is shifted and renormalised to make it reach zero:
 *
 *     gain = (10 ^ (level * SHAPE) - 1) / (10 ^ SHAPE - 1)
 *
 * which is exactly 0 at level 0, exactly 1 at level 1 (the same double
 * divided by itself), strictly increasing between, and still decibel-
 * shaped. `curveGain` additionally returns 0 for anything at or below
 * zero before the arithmetic runs, so no rounding and no negative
 * stored value can leave a whisper in a muted bus.
 *
 * SHAPE IS NOT A TASTE, IT IS SOLVED. Requiring the midpoint to be the
 * half-loudness point, gain(1/2) = 10^(-1/2), and writing x = 10^(SHAPE/2),
 * the curve at the midpoint collapses to (x - 1)/(x² - 1) = 1/(x + 1).
 * So x + 1 = √10, x = √10 - 1, and SHAPE = 2·log10(√10 - 1) = 0.6698 —
 * a total range of 13.4 dB. The midpoint lands on -10.00 dB by
 * construction rather than by a constant somebody tuned by ear and
 * nobody dares move. Below the midpoint the curve falls away fast:
 * a tenth of the travel is -26.9 dB, a twentieth is -33.2 dB, which is
 * why 13.4 dB of range is enough to reach "gone" without a cliff at the
 * very bottom.
 *
 * ─── THE DUCK IS PART OF THE MIX, NOT A SCENE'S PRIVATE TRICK ───────
 *
 * Dialogue you cannot hear over a ventilation bed is the exact problem
 * four separate buses exist to solve (`manifest.ts`), and no amount of
 * bus separation solves it on its own: the player would have to ride the
 * ambience fader through every conversation. So while a VOICE line is
 * playing, AMBIENCE and SFX step down by a named amount and come back up
 * over a named time, and that behaviour belongs to the mix — one rule,
 * applied wherever a line is played, rather than a fade written into
 * whichever scene happened to need it first.
 *
 * It is a function of two things and nothing else: whether a voice line
 * is playing, and elapsed time. No node, no clock, no audio context —
 * `stepDuck` moves a caller-owned `DuckState` by a dt and returns the
 * gain. That is what lets the engine drive an `AudioParam` ramp from the
 * same numbers a test reads.
 *
 * THE RAMPS ARE LINEAR, WHICH IS THE WHOLE REASON THE DUCK ENDS. An
 * exponential approach — the obvious `setTargetAtTime` — is never
 * finished: the bed comes back to within a hair of its level and stays
 * there, and "a hair" is a permanently quieter game after the first line
 * of dialogue. A linear ramp with a clamp arrives EXACTLY on 1.0 in
 * exactly DUCK_RELEASE_S, and the clamp is what makes "exactly" true.
 * This is the same failure the fader's shift fixes, one floor down.
 *
 * Every number below is GAME TUNING, said plainly as CLAUDE.md requires,
 * with the measurement that informed it named beside it.
 */
import { finiteNumber } from '../persistence/store';
import { BUSES, type Bus } from './manifest';

/**
 * A master and one level per bus, each 0..1 as a slider reads. Stored,
 * so every reader goes through `sanitizeMixLevels` first.
 *
 * Spelled out field by field rather than `Record<Bus, number>` plus a
 * master, because this is a document that gets written to storage and a
 * document is easier to read, diff and repair when its shape is written
 * down once.
 */
export interface MixLevels {
  /** Everything, after its own bus. */
  readonly master: number;
  readonly voice: number;
  readonly sfx: number;
  readonly ambience: number;
  readonly music: number;
}

/**
 * UNITY, ALL FIVE.
 *
 * Not laziness — the balance already exists. `SoundAsset.gain` is the
 * story repository's own measured mix level for each asset, the result
 * of somebody listening to the assets against each other, and the bake
 * carries those numbers across rather than re-guessing them
 * (`manifest.ts`). A bus fader is the PLAYER'S departure from that mix,
 * so it starts where the mix was left. A default of, say, 0.7 on
 * ambience would be a second, invisible mix layered on the measured one,
 * and the first person to wonder why the beds are quiet would have two
 * places to look instead of one.
 */
export const MIX_DEFAULTS: MixLevels = Object.freeze({
  master: 1,
  voice: 1,
  sfx: 1,
  ambience: 1,
  music: 1,
});

/**
 * The curve's shape parameter, solved rather than chosen: the value that
 * puts a slider's midpoint at exactly -10 dB, the half-loudness point
 * (header). 2·log10(√10 - 1) = 0.66982.
 */
export const MIX_SHAPE = 2 * Math.log10(Math.sqrt(10) - 1);

/** The same number as a fader travel, for a label or a tooltip: 13.4 dB. */
export const MIX_RANGE_DB = 20 * MIX_SHAPE;

/**
 * The denominator that makes the curve land on exactly 1. Computed from
 * the same expression the numerator uses, so at level 1 the division is
 * a double divided by itself and the result is 1.0 and not 0.9999999.
 */
const CURVE_SPAN = 10 ** MIX_SHAPE - 1;

/**
 * One fader's law: a 0..1 slider position to a 0..1 linear gain.
 *
 * Exactly 0 at 0, exactly 1 at 1, 0.3162 at the midpoint, monotonic
 * throughout.
 *
 * ANYTHING THAT IS NOT A REAL NUMBER READS AS SILENCE, including
 * +Infinity, which a clamp would read as full. That asymmetry is
 * deliberate: this is the last line before a gain node, the sanitiser
 * has already turned every non-finite stored level into a default
 * before it could get here, and of the two ways to be wrong at the end
 * of the chain, a bus that went quiet is a slider away from fixed and a
 * bus that went to full is in somebody's headphones.
 */
export function curveGain(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (level >= 1) return 1;
  return (10 ** (level * MIX_SHAPE) - 1) / CURVE_SPAN;
}

/** The master fader's gain alone — what the master node carries. */
export function masterGainFor(levels: MixLevels): number {
  return curveGain(levels.master);
}

/** One bus fader's gain alone — what that bus's node carries, before the duck. */
export function busGainFor(levels: MixLevels, bus: Bus): number {
  return curveGain(levels[bus]);
}

/**
 * What a bus actually sounds at: its own fader through the master's.
 *
 * Both go through the curve, because both are sliders a person moves and
 * a slider that is perceptual in one place and linear in another is two
 * different controls wearing one shape. The graph realises this as two
 * nodes in series (`AudioEngine`), which is the same product.
 */
export function gainFor(levels: MixLevels, bus: Bus): number {
  return masterGainFor(levels) * busGainFor(levels, bus);
}

/**
 * Known keys only, every level a finite number in 0..1, always a fresh
 * object — `sanitizeSettings`' contract, for the same reason: a meddled
 * with or half-written document should cost a bad balance, not a boot
 * failure, and a caller may mutate what it gets back.
 */
export function sanitizeMixLevels(raw: unknown, defaults: MixLevels = MIX_DEFAULTS): MixLevels {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    master: finiteNumber(r.master, defaults.master, 0, 1),
    voice: finiteNumber(r.voice, defaults.voice, 0, 1),
    sfx: finiteNumber(r.sfx, defaults.sfx, 0, 1),
    ambience: finiteNumber(r.ambience, defaults.ambience, 0, 1),
    music: finiteNumber(r.music, defaults.music, 0, 1),
  };
}

/**
 * How far the ducked buses drop while a line is playing: -9 dB, a gain
 * of 0.355.
 *
 * GAME TUNING, informed by two things. Half the perceived loudness is
 * -10 dB (the header's Stevens figure), and broadcast practice ducks a
 * bed by roughly 6 to 12 dB under a voice. -9 dB leaves the bed just
 * ABOVE half as loud: still obviously there, no longer competing for the
 * same words. Ducking to silence was the alternative and it is worse —
 * a room tone that disappears the instant anybody speaks reads as a
 * dropout, and the player hears the mix working instead of the line.
 */
export const DUCK_DEPTH_DB = -9;

/** -9 dB as a linear gain: 0.3548. */
export const DUCK_GAIN = 10 ** (DUCK_DEPTH_DB / 20);

/**
 * How long the drop takes: 120 ms.
 *
 * GAME TUNING. It has to be under the bed before the first syllable is
 * intelligible, which is a hundred-odd milliseconds into a clip, and it
 * must not be so fast that the step reads as a cut in the ambience.
 */
export const DUCK_ATTACK_S = 0.12;

/**
 * How long the duck STAYS down after a line ends before it starts to
 * release: 350 ms.
 *
 * GAME TUNING over a measurement. Conversation does not leave room for a
 * bed to come back between turns: across ten languages the modal gap
 * between one speaker finishing and the next starting is about 200 ms
 * (Stivers et al., PNAS 2009). Without a hold, Jack and Sarah trading
 * lines would pump the ventilation up and down through the whole
 * exchange, which is more distracting than the bed ever was. 350 ms
 * covers the ordinary gap with margin and still lets go promptly when
 * the scene actually falls quiet.
 */
export const DUCK_HOLD_S = 0.35;

/**
 * How long the recovery takes once the hold expires: 450 ms.
 *
 * GAME TUNING, and deliberately several times the attack. A duck that
 * drops fast and lifts slowly is the one nobody notices; matching the
 * two makes the bed swell at the end of every line.
 */
export const DUCK_RELEASE_S = 0.45;

/**
 * The buses the duck touches.
 *
 * VOICE is not here, which is the point — a duck that touched voice
 * would be a compressor arguing with itself. MUSIC is not here either,
 * and that is a decision rather than an oversight: the manifest carries
 * no music at all (`busCounts`, and `manifest.ts`'s header on why the
 * bus exists while empty), so a ducking rule for it could never be
 * heard, tuned or falsified. When a score exists, adding 'music' here is
 * the whole change, and it should be made beside somebody who can hear
 * the result.
 */
export const DUCKED_BUSES: readonly Bus[] = Object.freeze(['ambience', 'sfx'] as Bus[]);

/** Does this bus drop while a line is playing? */
export function ducks(bus: Bus): boolean {
  return DUCKED_BUSES.includes(bus);
}

/**
 * The duck's whole state: where it is, and how much hold is left.
 *
 * MUTABLE AND CALLER-OWNED. It is stepped every frame, so it is one
 * object made once and written into, never a fresh value per frame
 * (`control/PlayerDemand.ts`, `input/Intent.ts`).
 */
export interface DuckState {
  /** 0 = fully open, 1 = fully ducked. The ramps move this, not the gain. */
  ducking: number;
  /** Seconds of hold remaining after the last voice line ended. */
  hold: number;
}

/** A duck that is fully open, which is what silence sounds like. */
export function newDuckState(): DuckState {
  return { ducking: 0, hold: 0 };
}

/** Put a duck back to fully open in place — what `stopAll` means for the mix. */
export function resetDuck(out: DuckState): void {
  out.ducking = 0;
  out.hold = 0;
}

/**
 * The gain a ducked bus carries at a given position: 1 fully open,
 * DUCK_GAIN fully ducked, linear between.
 *
 * Linear in the 0..1 position rather than in decibels, so that position
 * 0 gives exactly 1 — an undicked bus is bit-for-bit the level the
 * player set, not a rounding of it.
 */
export function duckGainAt(ducking: number): number {
  // Both ends are returned rather than computed. `1 + 1 * (DUCK_GAIN - 1)`
  // is DUCK_GAIN to within one unit in the last place and not a bit
  // further, which is inaudible and still enough to make "the duck is
  // exactly as deep as it says" untestable; the same goes for the open
  // end, which is the one that matters (`stepDuck`'s header).
  if (!Number.isFinite(ducking) || ducking <= 0) return 1;
  if (ducking >= 1) return DUCK_GAIN;
  return 1 + ducking * (DUCK_GAIN - 1);
}

/** Where the duck is now, without moving it. */
export function duckGainOf(state: Readonly<DuckState>): number {
  return duckGainAt(state.ducking);
}

/**
 * Advance the duck by `dt` seconds and return the gain the ducked buses
 * should now carry. Writes into `out`; allocates nothing.
 *
 * While a line plays the duck drives down and the hold is held charged,
 * so the hold always starts full at the moment the last line ends. A
 * non-finite or negative dt is treated as no time passing, because a
 * paused tab handing back a NaN must not be able to strand the bed at
 * half volume for the rest of the session.
 */
export function stepDuck(out: DuckState, voicePlaying: boolean, dt: number): number {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (voicePlaying) {
    out.hold = DUCK_HOLD_S;
    out.ducking = Math.min(1, out.ducking + step / DUCK_ATTACK_S);
    return duckGainAt(out.ducking);
  }
  // THE STEP IS SPENT, NOT DISCARDED. A dt longer than the hold pays the
  // hold off and puts the REMAINDER into the release, so one step of
  // 0.5 s lands exactly where ten of 0.05 s do. The naive version —
  // hold this frame, release next frame — makes the duck's timing a
  // function of the frame rate, which is the one thing a mix must not
  // be: a tab coming back from the background hands over a dt of
  // several seconds, and the bed would stay down for an extra frame of
  // an unknown length.
  let left = step;
  if (out.hold > 0) {
    const spent = Math.min(out.hold, left);
    out.hold -= spent;
    left -= spent;
  }
  if (left > 0) out.ducking = Math.max(0, out.ducking - left / DUCK_RELEASE_S);
  return duckGainAt(out.ducking);
}

/**
 * Where the duck is heading and how long the model above will take to
 * get there — the two numbers an `AudioParam` ramp needs.
 *
 * This exists so the engine can schedule ONE linear ramp per transition
 * instead of writing a gain every frame. Sixty writes a second across a
 * 120 ms drop is seven steps of about 1 dB each, which is audible as a
 * stair on a sustained bed; a scheduled ramp is interpolated at the
 * sample rate and lands on the same number this model does, because it
 * is the same straight line.
 *
 * Writes into `out`; allocates nothing.
 */
export interface DuckRamp {
  /** The `ducking` position being ramped to: 1 down, 0 open. */
  to: number;
  /** The gain at that position — what to ramp the AudioParam to. */
  gain: number;
  /** Seconds the ramp takes from where the duck is now. Zero when it is already there. */
  seconds: number;
}

/** A ramp object to hand to `duckRampTo` each frame. */
export function newDuckRamp(): DuckRamp {
  return { to: 0, gain: 1, seconds: 0 };
}

export function duckRampTo(state: Readonly<DuckState>, voicePlaying: boolean, out: DuckRamp): DuckRamp {
  // Holding counts as still heading down: the target does not change
  // until the hold expires, so nothing is rescheduled between two lines
  // of one exchange.
  const down = voicePlaying || state.hold > 0;
  out.to = down ? 1 : 0;
  out.gain = duckGainAt(out.to);
  out.seconds = down
    ? Math.max(0, 1 - state.ducking) * DUCK_ATTACK_S
    : Math.max(0, state.ducking) * DUCK_RELEASE_S;
  return out;
}

/**
 * The complete per-bus number: the player's two faders, and the duck if
 * this bus is one the duck touches. What the engine's graph adds up to,
 * and what a test can assert without a browser.
 */
export function duckedGainFor(levels: MixLevels, bus: Bus, state: Readonly<DuckState>): number {
  const gain = gainFor(levels, bus);
  return ducks(bus) ? gain * duckGainOf(state) : gain;
}

/**
 * Every bus's effective gain at once, written into a caller-owned
 * record. For a HUD that prints the mix, and for the engine when it
 * re-reads the whole graph after a settings change.
 */
export function mixSnapshot(
  levels: MixLevels,
  state: Readonly<DuckState>,
  out: Record<Bus, number>,
): Record<Bus, number> {
  for (const bus of BUSES) out[bus] = duckedGainFor(levels, bus, state);
  return out;
}
