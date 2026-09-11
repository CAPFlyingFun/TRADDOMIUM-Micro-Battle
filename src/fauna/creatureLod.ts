/**
 * Player-facing creature level of detail settings.
 *
 * Distances in this file are metres. FaunaView converts them to world units
 * at the render boundary. Keeping the settings in metres makes the sliders,
 * copied settings and stress reports useful to a player instead of exposing
 * the island's internal centimetre-like units.
 */

export type CreatureLodMode = 'manual' | 'auto';

export interface CreatureLodDistances {
  /** The textured material is finished by this distance. */
  readonly textureEnd: number;
  /** The texture-to-solid transition is complete by this distance. */
  readonly solidEnd: number;
  /** The solid real model starts fading to a procedural body here. */
  readonly proceduralStart: number;
  /** The real model is procedural-only at and beyond this distance. */
  readonly proceduralOnly: number;
}

export interface CreatureLodSettings extends CreatureLodDistances {
  readonly mode: CreatureLodMode;
}

export interface CreatureLodAdaptiveState {
  readonly level: number;
  readonly multiplier: number;
  readonly rigBudgetMultiplier: number;
  readonly fps: number;
  readonly frameMs: number;
  readonly acceptedFrames: number;
  readonly ignoredFrames: number;
  readonly bypassed: boolean;
}

export interface CreatureLodSnapshot {
  readonly mode: CreatureLodMode;
  readonly baseline: CreatureLodDistances;
  readonly effective: CreatureLodDistances;
  readonly adaptive: CreatureLodAdaptiveState;
}

export const CREATURE_LOD_DEFAULTS: Readonly<CreatureLodSettings> = Object.freeze({
  textureEnd: 0.20,
  solidEnd: 0.30,
  proceduralStart: 0.40,
  proceduralOnly: 0.46,
  mode: 'manual',
});

export const DEFAULT_CREATURE_LOD_SETTINGS = CREATURE_LOD_DEFAULTS;
export const CREATURE_LOD_BASELINE = CREATURE_LOD_DEFAULTS;

/** Slider limits. The one-centimetre spacing is enforced by sanitization. */
export const CREATURE_LOD_LIMITS = Object.freeze({
  min: 0.05,
  max: 1.50,
  step: 0.01,
});

const MIN_GAP = CREATURE_LOD_LIMITS.step;

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rounded(value: number): number {
  return Math.round(value / CREATURE_LOD_LIMITS.step) * CREATURE_LOD_LIMITS.step;
}

/**
 * Clamp in order rather than independently. This means a corrupted save or
 * a slider dragged past its neighbour can never create a reversed band or a
 * silent gap.
 */
export function sanitizeCreatureLodSettings(
  raw: unknown,
  defaults: CreatureLodSettings = CREATURE_LOD_DEFAULTS,
): CreatureLodSettings {
  const r = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const d = defaults;
  const max = CREATURE_LOD_LIMITS.max;
  const min = CREATURE_LOD_LIMITS.min;
  const textureEnd = Math.min(max - MIN_GAP * 3, Math.max(min, rounded(numberOr(r.textureEnd, d.textureEnd))));
  const solidEnd = Math.min(max - MIN_GAP * 2, Math.max(textureEnd + MIN_GAP, rounded(numberOr(r.solidEnd, d.solidEnd))));
  const proceduralStart = Math.min(max - MIN_GAP, Math.max(solidEnd + MIN_GAP, rounded(numberOr(r.proceduralStart, d.proceduralStart))));
  const proceduralOnly = Math.min(max, Math.max(proceduralStart + MIN_GAP, rounded(numberOr(r.proceduralOnly, d.proceduralOnly))));
  return {
    textureEnd,
    solidEnd,
    proceduralStart,
    proceduralOnly,
    mode: r.mode === 'auto' || r.mode === 'manual' ? r.mode : d.mode,
  };
}

/** Alias retained for call sites that want to emphasize this is a document field. */
export const sanitizeCreatureLod = sanitizeCreatureLodSettings;

export function effectiveCreatureLod(
  baseline: CreatureLodSettings,
  multiplier: number,
): CreatureLodDistances {
  const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  // Scaling preserves the order and the transition widths. It intentionally
  // does not re-sanitize: the adaptation controller only supplies factors.
  return {
    textureEnd: baseline.textureEnd * factor,
    solidEnd: baseline.solidEnd * factor,
    proceduralStart: baseline.proceduralStart * factor,
    proceduralOnly: baseline.proceduralOnly * factor,
  };
}

export type CreatureLodTier = 'textured' | 'solid' | 'procedural';

/** Pure tier classification used by tests, reports and non-Three callers. */
export function creatureLodTier(distanceM: number, distances: CreatureLodDistances = CREATURE_LOD_DEFAULTS): CreatureLodTier {
  if (!Number.isFinite(distanceM) || distanceM <= distances.textureEnd) return 'textured';
  if (distanceM < distances.proceduralOnly) return 'solid';
  return 'procedural';
}

/** Continuous texture-to-solid amount for one real model. */
export function creatureLodTextureBlend(
  distanceM: number,
  distances: CreatureLodDistances = CREATURE_LOD_DEFAULTS,
): number {
  if (!Number.isFinite(distanceM) || distanceM <= distances.textureEnd) return 0;
  if (distanceM >= distances.solidEnd) return 1;
  return (distanceM - distances.textureEnd) / (distances.solidEnd - distances.textureEnd);
}

export function creatureLodIsOrdered(distances: CreatureLodDistances): boolean {
  return distances.textureEnd + MIN_GAP <= distances.solidEnd &&
    distances.solidEnd + MIN_GAP <= distances.proceduralStart &&
    distances.proceduralStart + MIN_GAP <= distances.proceduralOnly;
}

/**
 * Sustained frame-time adaptation. A single hitch is ignored, while a
 * genuinely slow run must remain slow for several seconds before distance
 * bands are moved inward. Recovery is deliberately slower and has a
 * 60-fps hysteresis target, so an old phone does not oscillate every few
 * frames. Hidden-tab and loading samples are explicitly excluded.
 */
export class CreatureLodAdaptive {
  private static readonly LEVEL_MULTIPLIERS = [1, 0.88, 0.76, 0.64] as const;
  private static readonly LEVEL_BUDGETS = [1, 0.88, 0.76, 0.64] as const;
  private static readonly BAD_FPS = 45;
  private static readonly GOOD_FPS = 58;
  private static readonly BAD_HOLD_S = 2.5;
  private static readonly GOOD_HOLD_S = 8;
  private static readonly MAX_SAMPLE_MS = 250;

  private levelNow = 0;
  private frameMsNow = 1000 / 60;
  private accepted = 0;
  private ignored = 0;
  private badFor = 0;
  private goodFor = 0;

  /**
   * Add a wall-clock frame sample. `elapsedS` is supplied separately so
   * callers can use the app's raw frame time and tests can drive time without
   * relying on the process clock.
   */
  private accept(frameMs: number, elapsedS: number, options: { readonly hidden?: boolean; readonly loading?: boolean }): boolean {
    if (
      !Number.isFinite(frameMs) || frameMs <= 0 ||
      !Number.isFinite(elapsedS) || elapsedS <= 0 ||
      frameMs > CreatureLodAdaptive.MAX_SAMPLE_MS ||
      options.hidden === true || options.loading === true
    ) {
      this.ignored += 1;
      return false;
    }
    this.accepted += 1;
    const alpha = Math.min(1, elapsedS / 1.25);
    this.frameMsNow += (frameMs - this.frameMsNow) * alpha;
    return true;
  }

  update(frameMs: number, elapsedS = frameMs / 1000, options: { readonly hidden?: boolean; readonly loading?: boolean } = {}): CreatureLodAdaptiveState {
    if (!this.accept(frameMs, elapsedS, options)) return this.state();
    const fps = 1000 / this.frameMsNow;
    if (fps < CreatureLodAdaptive.BAD_FPS) {
      this.badFor += elapsedS;
      this.goodFor = 0;
      if (this.badFor >= CreatureLodAdaptive.BAD_HOLD_S) {
        this.levelNow = Math.min(CreatureLodAdaptive.LEVEL_MULTIPLIERS.length - 1, this.levelNow + 1);
        this.badFor = 0;
      }
    } else if (fps >= CreatureLodAdaptive.GOOD_FPS) {
      this.goodFor += elapsedS;
      this.badFor = 0;
      if (this.goodFor >= CreatureLodAdaptive.GOOD_HOLD_S) {
        this.levelNow = Math.max(0, this.levelNow - 1);
        this.goodFor = 0;
      }
    } else {
      this.badFor = 0;
      this.goodFor = 0;
    }
    return this.state();
  }

  /** Record a frame for the FPS readout without changing the adaptive level. */
  observe(frameMs: number, elapsedS = frameMs / 1000, options: { readonly hidden?: boolean; readonly loading?: boolean } = {}): CreatureLodAdaptiveState {
    this.accept(frameMs, elapsedS, options);
    return this.state();
  }

  /** Readable alias for code that treats adaptation as a frame sample. */
  sample(frameMs: number, elapsedS?: number, options?: { readonly hidden?: boolean; readonly loading?: boolean }): CreatureLodAdaptiveState {
    return this.update(frameMs, elapsedS, options);
  }

  reset(): void {
    this.levelNow = 0;
    this.frameMsNow = 1000 / 60;
    this.accepted = 0;
    this.ignored = 0;
    this.badFor = 0;
    this.goodFor = 0;
  }

  state(bypassed = false): CreatureLodAdaptiveState {
    return {
      level: this.levelNow,
      multiplier: CreatureLodAdaptive.LEVEL_MULTIPLIERS[this.levelNow],
      rigBudgetMultiplier: CreatureLodAdaptive.LEVEL_BUDGETS[this.levelNow],
      fps: 1000 / this.frameMsNow,
      frameMs: this.frameMsNow,
      acceptedFrames: this.accepted,
      ignoredFrames: this.ignored,
      bypassed,
    };
  }
}

export function creatureLodSnapshot(
  settings: CreatureLodSettings,
  adaptive: CreatureLodAdaptiveState,
): CreatureLodSnapshot {
  const effective = effectiveCreatureLod(settings, settings.mode === 'auto' && !adaptive.bypassed ? adaptive.multiplier : 1);
  return {
    mode: settings.mode,
    baseline: {
      textureEnd: settings.textureEnd,
      solidEnd: settings.solidEnd,
      proceduralStart: settings.proceduralStart,
      proceduralOnly: settings.proceduralOnly,
    },
    effective,
    adaptive,
  };
}