/**
 * THE ONLY FILE IN `src/audio/` THAT TOUCHES THE PLATFORM — the graph,
 * the decoding, and the one honest answer to "is there any sound".
 *
 * `manifest.ts` is the data, `mix.ts` is the arithmetic, and both are
 * pure. Everything that needs an `AudioContext`, a `fetch` or a
 * `decodeAudioData` is here, so the half of the audio system that can be
 * reasoned about in plain node stays that size.
 *
 * ─── THE GRAPH ──────────────────────────────────────────────────────
 *
 *     source ─┬─[trim: SoundAsset.gain]─┐
 *             └─────────────────────────┴─> bus gain ─> master gain ─> out
 *
 * Four bus gains, one master, and one trim per source that needs one.
 * The buses are the milestone: a player who cannot hear Jack over the
 * ventilation turns ONE fader down, and that only works if the beds and
 * the lines are genuinely on different nodes. `SoundAsset.gain` is the
 * story repository's own measured level for that asset and is applied
 * per source rather than folded into the bus, because it is a property
 * of the clip and not of the player's preferences.
 *
 * ─── iOS STARTS SILENT, AND THAT IS THE NORMAL CASE HERE ────────────
 *
 * An `AudioContext` is created `suspended` and may only be resumed from
 * inside a real user gesture — a tap, in the same task as the event, not
 * after an await that has already yielded. Safari is the strictest
 * implementation of that rule and this game is tested on a phone, from
 * the home screen, where there is no address bar to reload from and
 * nobody to explain the silence to. So:
 *
 *   - NO CONTEXT IS CREATED AT CONSTRUCTION. Safari caps how many
 *     contexts a page may hold, and one made at boot and never resumed
 *     spends that budget to sit suspended forever.
 *   - `unlock()` is explicit and must be called from a tap handler. It
 *     creates the graph, starts a one-frame silent buffer (some iOS
 *     versions do not consider a context unlocked until a source has
 *     been started inside the gesture) and then resumes.
 *   - NOTHING ASSUMES IT WORKED. Every play checks the context state and
 *     a play into a context that is not running is a counted no-op
 *     (`status.blocked`), never an exception and never a clip queued to
 *     erupt four minutes later when the player finally taps something.
 *   - Safari also has a non-standard `interrupted` state — what a phone
 *     call or Siri leaves behind — which is why the status reports the
 *     state as a word rather than a boolean, and why a blocked play also
 *     fires a background resume: an interrupted context recovers, a
 *     suspended one waits for a finger.
 *
 * ─── A MISSING CLIP IS A COUNTER, NOT AN EXCEPTION ──────────────────
 *
 * `assets/assets.ts` already works this way and for the same reason: a
 * 404 on a deploy path must cost the sound, not the scene. Every fetch
 * and decode is caught; the url is remembered as failed so it is not
 * retried on every line; and `status.failed`, `status.missing` and
 * `status.blocked` are three DIFFERENT numbers because they have three
 * different fixes — a bad path, a cue pointing at a line this chapter
 * does not carry, and a context nobody has unlocked.
 *
 * Decoding is lazy and cached: at most one fetch per url ever, with the
 * in-flight promise shared, so two cues firing on the same sting in one
 * frame do not both pull the file. Note that `decodeAudioData` DETACHES
 * the ArrayBuffer it is given, so a retry means a fresh fetch — another
 * reason a failure is remembered rather than repeated.
 *
 * ─── THE DUCK IS SCHEDULED, NOT WRITTEN EVERY FRAME ─────────────────
 *
 * `update(dt)` steps `mix.ts`'s pure duck and, only when the TARGET
 * changes, schedules one `linearRampToValueAtTime` on each ducked bus.
 * Sixty gain writes a second across a 120 ms drop would be seven steps
 * of about a decibel on a sustained bed, which is audible as a stair; a
 * scheduled ramp is interpolated at the sample rate and arrives at the
 * same number the pure model holds, because it is the same straight
 * line. Between two lines of one exchange the target does not change at
 * all, so nothing is rescheduled.
 */
import { assets as defaultAssets, type Assets } from '../assets/assets';
import { BUSES, type AudioManifest, type Bus, type SoundAsset, type VoiceLine } from './manifest';
import {
  DUCKED_BUSES, MIX_DEFAULTS,
  busGainFor, duckGainOf, duckRampTo, ducks, masterGainFor, newDuckRamp, newDuckState, resetDuck,
  sanitizeMixLevels, stepDuck,
  type DuckRamp, type DuckState, type MixLevels,
} from './mix';

/**
 * The shortest ramp any gain change is allowed to take: 20 ms.
 *
 * A gain that jumps is a click — a discontinuity in the waveform, which
 * is broadband and far more noticeable than the change that caused it.
 * 20 ms is longer than one sample and shorter than one frame, so a
 * slider drag is smooth and nothing feels late.
 */
const MIN_RAMP_S = 0.02;

/**
 * What the context is doing. The three standard states, Safari's
 * `interrupted`, and `none` for "no context has been created yet" —
 * which is a real and common state here, since one is not made until the
 * first tap.
 */
export type AudioPhase = 'none' | 'suspended' | 'running' | 'interrupted' | 'closed';

/**
 * What a HUD can read. Mutable and caller-owned: `readStatus` writes
 * into it, so a sheet that prints this every frame allocates nothing.
 */
export interface AudioStatus {
  state: AudioPhase;
  /** Has the context EVER been running? A phone that was unlocked and then interrupted still reads true. */
  unlocked: boolean;
  /** Clips decoded and held in memory. */
  decoded: number;
  /** Fetches or decodes in flight. */
  decoding: number;
  /** Urls that failed and will not be retried. A wrong path, a 404 on deploy. */
  failed: number;
  /** Ids asked for that the manifest does not carry. A cue pointing outside this chapter. */
  missing: number;
  /** Plays refused because the context was not running. The unlock counter. */
  blocked: number;
  /** Sources playing now, beds included. */
  playing: number;
  /** Voice sources playing now. Non-zero is what ducks the room. */
  voices: number;
  /** Looping beds running now. */
  beds: number;
  /** The line that is speaking, or the last one that spoke. */
  line: string | null;
  /** The duck's position: 0 fully open, 1 fully ducked. */
  duck: number;
}

/** A status object to hand to `readStatus` each frame. */
export function newAudioStatus(): AudioStatus {
  return {
    state: 'none', unlocked: false, decoded: 0, decoding: 0, failed: 0, missing: 0,
    blocked: 0, playing: 0, voices: 0, beds: 0, line: null, duck: 0,
  };
}

export interface AudioEngineOptions {
  /** What this build carries. The engine indexes it once and never re-reads the arrays. */
  readonly manifest: AudioManifest;
  /** The player's faders. Sanitised on the way in; defaults to unity. */
  readonly levels?: MixLevels;
  /**
   * The url half of the codebase's one loader (ARCHITECTURE §2.5). Every
   * clip path goes through `assetUrl`, which is what adds the deployed
   * base and the file's content revision — a clip fetched by hand would
   * 404 on Pages and would be served stale from a phone's cache after a
   * re-bake. Injectable so a harness can point somewhere else.
   */
  readonly assets?: Pick<Assets, 'assetUrl'>;
}

export class AudioEngine {
  private readonly lines = new Map<string, VoiceLine>();
  private readonly sounds = new Map<string, SoundAsset>();
  private readonly assets: Pick<Assets, 'assetUrl'>;

  private mix: MixLevels;

  private ctx: AudioContext | null = null;
  private masterNode: GainNode | null = null;
  private busNodes: Record<Bus, GainNode> | null = null;

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly inFlight = new Map<string, Promise<AudioBuffer | null>>();
  private readonly failed = new Set<string>();

  private readonly live = new Set<AudioBufferSourceNode>();
  private readonly trims = new Map<AudioBufferSourceNode, GainNode>();
  /**
   * Which live sources are voice, and which bed each live source is.
   *
   * MEMBERSHIP RATHER THAN COUNTERS. A counter has to be decremented by
   * whoever ends a source, and a source can end three ways — it ran out,
   * `stopBed` stopped it, `stopAll` stopped it — two of which also fire
   * `onended` afterwards. Every one of those paths has to agree, and the
   * failure mode when they do not is a voice count stuck above zero,
   * which means the ambience never comes back up for the rest of the
   * session. A set cannot be double-counted: `delete` says whether this
   * is the first retirement, and `size` is the answer to "is anybody
   * speaking".
   */
  private readonly voiceSources = new Set<AudioBufferSourceNode>();
  private readonly bedOf = new Map<AudioBufferSourceNode, string>();
  private readonly beds = new Map<string, AudioBufferSourceNode>();
  private readonly bedsStarting = new Set<string>();

  private readonly duck: DuckState = newDuckState();
  private readonly ramp: DuckRamp = newDuckRamp();
  /** The duck gain currently scheduled on the ducked buses; NaN forces a reschedule. */
  private scheduledDuck = Number.NaN;

  private blocked = 0;
  private missing = 0;
  private everRunning = false;
  private disposed = false;
  private line: string | null = null;
  /**
   * Bumped by `stopAll` and `dispose`. A decode that finishes after one
   * of those must not start its source: the player has left the scene,
   * and a line arriving into the menu is exactly the bug a shared decode
   * cache makes easy to write.
   */
  private generation = 0;

  constructor(options: AudioEngineOptions) {
    for (const line of options.manifest.voice) this.lines.set(line.lineId, line);
    for (const sound of options.manifest.sounds) this.sounds.set(sound.assetId, sound);
    this.assets = options.assets ?? defaultAssets;
    this.mix = sanitizeMixLevels(options.levels ?? MIX_DEFAULTS);
  }

  /** The faders as the engine holds them — sanitised, never the raw document. */
  get levels(): MixLevels {
    return this.mix;
  }

  /**
   * CALL THIS FROM A REAL TAP. Creates the graph if it does not exist,
   * starts a silent frame inside the gesture, resumes, and reports
   * whether the context is actually running afterwards.
   *
   * Safe to call again: an already-running context is left alone, and a
   * context Safari has `interrupted` is resumed by the same path.
   */
  async unlock(): Promise<boolean> {
    if (!this.ensureGraph()) return false;
    const ctx = this.ctx;
    if (!ctx) return false;
    // Synchronously, before any await: some iOS versions only treat a
    // context as unlocked once a source has been started within the
    // gesture's own task.
    this.primeSilence(ctx);
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (error) {
        console.warn('[audio] the context refused to resume; audio stays silent until the next tap', error);
      }
    }
    if (ctx.state === 'running') this.everRunning = true;
    return ctx.state === 'running';
  }

  /** Is there a context and is it running right now? Never inferred, always asked. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Replace the faders. Sanitised, and applied over 20 ms so a drag does not click. */
  setLevels(levels: MixLevels): void {
    this.mix = sanitizeMixLevels(levels);
    const ctx = this.ctx;
    const master = this.masterNode;
    if (!ctx || !master || !this.busNodes) return;
    rampTo(master.gain, masterGainFor(this.mix), ctx.currentTime, MIN_RAMP_S);
    const duckGain = duckGainOf(this.duck);
    for (let i = 0; i < BUSES.length; i += 1) {
      const bus = BUSES[i];
      this.rampBus(bus, ducks(bus) ? duckGain : 1, 0);
    }
  }

  /**
   * One frame of mix. Steps the duck from whether a voice line is
   * playing, and schedules a ramp only when the duck's target changes.
   * Allocates nothing.
   */
  update(dt: number): void {
    const speaking = this.voiceSources.size > 0;
    stepDuck(this.duck, speaking, dt);
    duckRampTo(this.duck, speaking, this.ramp);
    if (this.ramp.gain === this.scheduledDuck) return;
    this.scheduledDuck = this.ramp.gain;
    for (let i = 0; i < DUCKED_BUSES.length; i += 1) {
      this.rampBus(DUCKED_BUSES[i], this.ramp.gain, this.ramp.seconds);
    }
  }

  /**
   * Speak a Chapter 1 line. Resolves true if a source actually started.
   *
   * An unknown id is counted and dropped rather than thrown: a cue
   * sheet that names a chapter-2 line is a content problem, and it
   * should show up as a number on the sheet, not as a scene that fell
   * over mid-sentence.
   */
  async playLine(lineId: string): Promise<boolean> {
    const line = this.lines.get(lineId);
    if (!line) {
      this.missing += 1;
      return false;
    }
    const started = await this.play(line.url, 'voice', 1, false);
    if (started) this.line = lineId;
    return started;
  }

  /**
   * Play a sound asset on its own bus, at its own authored gain.
   *
   * `loop` is the ASSET'S property, not the call site's (`manifest.ts`),
   * so a looping asset asked for here becomes its bed rather than an
   * endless source with no handle. That keeps the caller from having to
   * know which assets loop while still leaving exactly one way to stop
   * one.
   */
  async playSound(assetId: string): Promise<boolean> {
    const asset = this.sounds.get(assetId);
    if (!asset) {
      this.missing += 1;
      return false;
    }
    if (asset.loop) return this.startBed(assetId);
    return this.play(asset.url, asset.bus, asset.gain, false);
  }

  /**
   * Start a looping bed, at most one instance per asset. Idempotent
   * while the first one is still decoding as well as while it plays —
   * two calls in the same frame are one bed, not two ventilation hums a
   * few milliseconds out of phase.
   */
  async startBed(assetId: string): Promise<boolean> {
    const asset = this.sounds.get(assetId);
    if (!asset) {
      this.missing += 1;
      return false;
    }
    if (!asset.loop) return this.playSound(assetId);
    if (this.beds.has(assetId) || this.bedsStarting.has(assetId)) return true;
    this.bedsStarting.add(assetId);
    try {
      return await this.play(asset.url, asset.bus, asset.gain, true, assetId);
    } finally {
      this.bedsStarting.delete(assetId);
    }
  }

  /** Stop a bed. Unknown or already-stopped ids are a no-op. */
  stopBed(assetId: string): void {
    const source = this.beds.get(assetId);
    if (!source) return;
    this.beds.delete(assetId);
    this.halt(source);
  }

  /**
   * Silence everything and open the duck.
   *
   * The generation bump is the important half: decodes already in flight
   * will resolve after this and must not start anything.
   */
  stopAll(): void {
    this.generation += 1;
    for (const source of Array.from(this.live)) this.halt(source);
    this.beds.clear();
    this.bedOf.clear();
    this.bedsStarting.clear();
    this.voiceSources.clear();
    this.line = null;
    resetDuck(this.duck);
    this.scheduledDuck = Number.NaN;
    this.update(0);
  }

  /** Read the whole state into a caller-owned object. Allocates nothing. */
  readStatus(out: AudioStatus): AudioStatus {
    const state = (this.ctx?.state ?? 'none') as AudioPhase;
    if (state === 'running') this.everRunning = true;
    out.state = state;
    out.unlocked = this.everRunning;
    out.decoded = this.buffers.size;
    out.decoding = this.inFlight.size;
    out.failed = this.failed.size;
    out.missing = this.missing;
    out.blocked = this.blocked;
    out.playing = this.live.size;
    out.voices = this.voiceSources.size;
    out.beds = this.beds.size;
    out.line = this.line;
    out.duck = this.duck.ducking;
    return out;
  }

  /**
   * Close the context and release every decoded buffer. The engine is
   * not usable afterwards — a scene that comes back builds a new one,
   * which is also how it gets a context the platform has not been
   * holding open in the background.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.stopAll();
    this.disposed = true;
    this.buffers.clear();
    this.inFlight.clear();
    this.failed.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.masterNode = null;
    this.busNodes = null;
    if (!ctx) return;
    try {
      await ctx.close();
    } catch (error) {
      console.warn('[audio] the context did not close cleanly', error);
    }
  }

  // ─── the graph ────────────────────────────────────────────────────

  /** Build the context and the five gain nodes on first need. False if the platform has no WebAudio. */
  private ensureGraph(): boolean {
    if (this.disposed) return false;
    if (this.ctx && this.masterNode && this.busNodes) return true;
    const Ctor = platformContext();
    if (!Ctor) {
      console.warn('[audio] no AudioContext on this platform; the game runs silent');
      return false;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch (error) {
      console.warn('[audio] an AudioContext could not be created; the game runs silent', error);
      return false;
    }
    const master = ctx.createGain();
    master.gain.value = masterGainFor(this.mix);
    master.connect(ctx.destination);
    const buses = {} as Record<Bus, GainNode>;
    for (let i = 0; i < BUSES.length; i += 1) {
      const bus = BUSES[i];
      const node = ctx.createGain();
      node.gain.value = busGainFor(this.mix, bus) * (ducks(bus) ? duckGainOf(this.duck) : 1);
      node.connect(master);
      buses[bus] = node;
    }
    this.ctx = ctx;
    this.masterNode = master;
    this.busNodes = buses;
    return true;
  }

  /** One sample of nothing, started inside the gesture. See the header. */
  private primeSilence(ctx: AudioContext): void {
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start(0);
    } catch (error) {
      console.warn('[audio] the silent unlock frame did not start', error);
    }
  }

  /** Move one bus to its level times a duck gain, over at least MIN_RAMP_S. */
  private rampBus(bus: Bus, duckGain: number, seconds: number): void {
    const ctx = this.ctx;
    const nodes = this.busNodes;
    if (!ctx || !nodes) return;
    rampTo(nodes[bus].gain, busGainFor(this.mix, bus) * duckGain, ctx.currentTime, Math.max(seconds, MIN_RAMP_S));
  }

  // ─── sources ──────────────────────────────────────────────────────

  private async play(path: string, bus: Bus, trim: number, loop: boolean, bedId?: string): Promise<boolean> {
    if (!this.ensureGraph()) return false;
    const generation = this.generation;
    const buffer = await this.buffer(path);
    if (!buffer) return false;
    const ctx = this.ctx;
    const nodes = this.busNodes;
    if (!ctx || !nodes || this.disposed || generation !== this.generation) return false;
    if (ctx.state !== 'running') {
      // Counted, not queued. A clip that starts whenever the context
      // happens to wake is worse than one that never played.
      this.blocked += 1;
      void this.nudge(ctx);
      return false;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    let head: AudioNode = nodes[bus];
    if (trim !== 1 && Number.isFinite(trim)) {
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, trim);
      gain.connect(head);
      this.trims.set(source, gain);
      head = gain;
    }
    source.connect(head);
    this.live.add(source);
    if (bus === 'voice') this.voiceSources.add(source);
    if (bedId !== undefined) {
      this.beds.set(bedId, source);
      this.bedOf.set(source, bedId);
    }
    source.onended = () => this.retire(source);
    source.start();
    return true;
  }

  /** Stop a source now and retire it. `onended` may still follow, and retiring twice is a no-op. */
  private halt(source: AudioBufferSourceNode): void {
    try {
      source.stop();
    } catch {
      // A source that never started, or has already ended, refuses to
      // stop. Either way it is on its way out.
    }
    this.retire(source);
  }

  /** Forget a source and unwire it. Idempotent: the `live` delete is the gate. */
  private retire(source: AudioBufferSourceNode): void {
    if (!this.live.delete(source)) return;
    this.voiceSources.delete(source);
    const bedId = this.bedOf.get(source);
    if (bedId !== undefined) {
      this.bedOf.delete(source);
      if (this.beds.get(bedId) === source) this.beds.delete(bedId);
    }
    source.onended = null;
    try {
      source.disconnect();
    } catch {
      // A closed context has already torn its graph down.
    }
    const trim = this.trims.get(source);
    if (trim) {
      this.trims.delete(source);
      try {
        trim.disconnect();
      } catch {
        // As above.
      }
    }
  }

  /**
   * A background resume attempt after a blocked play. It is what
   * recovers a Safari context left `interrupted` by a phone call; a
   * merely `suspended` one will refuse, which is correct — that one is
   * waiting for a finger, and `unlock()` is where the finger is.
   */
  private async nudge(ctx: AudioContext): Promise<void> {
    if (ctx.state === 'closed') return;
    try {
      await ctx.resume();
    } catch {
      // Expected before the first tap. `status.blocked` is the report.
    }
  }

  // ─── decoding ─────────────────────────────────────────────────────

  /** The cache, the in-flight share and the failure memo, in that order. */
  private buffer(path: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(path);
    if (cached) return Promise.resolve(cached);
    if (this.failed.has(path)) return Promise.resolve(null);
    const pending = this.inFlight.get(path);
    if (pending) return pending;
    const task = this.fetchAndDecode(path);
    this.inFlight.set(path, task);
    return task;
  }

  private async fetchAndDecode(path: string): Promise<AudioBuffer | null> {
    const url = this.assets.assetUrl(path);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const ctx = this.ctx;
      if (!ctx || this.disposed) return null;
      const buffer = await decodeAudio(ctx, bytes);
      if (this.disposed) return null;
      this.buffers.set(path, buffer);
      return buffer;
    } catch (error) {
      if (this.disposed) return null;
      // Remembered, not retried: `decodeAudioData` detaches the buffer
      // it was given, so a retry is a fresh download, and a cue that
      // fires every few seconds would download a missing file forever.
      this.failed.add(path);
      console.warn(`[audio] clip not played; expected it at ${url}`, error);
      return null;
    } finally {
      this.inFlight.delete(path);
    }
  }
}

/** Ramp a param to a value over `seconds`, from wherever it is now. */
function rampTo(param: AudioParam, value: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + Math.max(seconds, MIN_RAMP_S));
}

type AudioContextCtor = new () => AudioContext;

/** `AudioContext`, or Safari's prefixed one, or nothing at all. */
function platformContext(): AudioContextCtor | null {
  const global = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return global.AudioContext ?? global.webkitAudioContext ?? null;
}

/**
 * `decodeAudioData` both ways round.
 *
 * The promise form is the standard and is what every current browser
 * returns; older WebKit only ever calls the success and error callbacks
 * and returns undefined. Passing both and resolving on whichever answers
 * costs one closure per clip — decoded once, cached forever — and is the
 * difference between audio and silence on an older iPhone.
 */
function decodeAudio(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const returned = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (returned && typeof returned.then === 'function') returned.then(resolve, reject);
  });
}
