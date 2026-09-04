// @vitest-environment jsdom
/**
 * The loading screen's promises: it shows the key art with the bar that
 * is already in it, the readouts tell the measured truth, the drawn bar
 * trails that truth and never runs ahead of it or backwards, and
 * CONTINUE exists only while the wiring allows it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { EASE_SECONDS, formatEta, LoadingScene, type LoadingHooks } from '../src/ui/LoadingScene';
import { SPLASH_LANDSCAPE } from '../src/ui/splash/splashFrame';

function rig() {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const ctx = { uiLayer, app: { requestState: vi.fn() } } as unknown as SceneContext;
  let fraction = 0;
  let eta: number | null = null;
  let canContinue = false;
  const hooks: LoadingHooks = {
    caption: 'Loading the empty world',
    progress: { fraction: () => fraction, etaMs: () => eta },
    onEnter: vi.fn(),
    canContinue: () => canContinue,
    onContinue: vi.fn(),
  };
  const scene = new LoadingScene(ctx, hooks);
  const frame = (rawDt: number) => ({ rawDt, simDt: rawDt, elapsed: 0 });
  return {
    uiLayer, scene, hooks, frame,
    /** Change what the reader says, without running a frame. */
    read(f: number) {
      fraction = f;
    },
    /** Change the reader and run a second of frames, long enough for the eased bar to arrive. */
    set(f: number, e: number | null = eta, c = canContinue) {
      fraction = f;
      eta = e;
      canContinue = c;
      scene.update(frame(1));
    },
  };
}

/** Percent width of the meter's fill, as a number: jsdom normalises '30.00%' to '30%'. */
const fill = (root: ParentNode): number =>
  parseFloat(root.querySelector<HTMLElement>('[data-ui="meter-fill"]')?.style.width ?? 'NaN');
const percent = (root: ParentNode): string | undefined => root.querySelector('[data-ui="loading-percent"]')?.textContent ?? undefined;
const valueNow = (root: ParentNode): string | null | undefined => root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow');

describe('LoadingScene', () => {
  it('begins the load once on enter, shows the key art with its title, and starts empty', async () => {
    const { uiLayer, scene, hooks } = rig();
    await scene.enter();
    expect(hooks.onEnter).toHaveBeenCalledTimes(1);
    expect(uiLayer.querySelector('[data-ui="loading-title"]')?.textContent).toBe('Loading the empty world');
    // The picture is the meter's front layer: the sandwich is back, fill, art.
    const stage = uiLayer.querySelector<HTMLElement>('[role="progressbar"]');
    const img = stage?.querySelector('img');
    expect(img?.getAttribute('src')?.endsWith(SPLASH_LANDSCAPE.file)).toBe(true);
    expect([...(stage?.children ?? [])].indexOf(img as Element)).toBe(2);
    expect(fill(uiLayer)).toBe(0);
    expect(percent(uiLayer)).toBe('0%');
    expect(uiLayer.textContent).toContain('Measuring…');
  });

  it('fades everything up as one once the picture is painted', async () => {
    const { uiLayer, scene } = rig();
    await scene.enter();
    const stage = uiLayer.querySelector<HTMLElement>('[role="progressbar"]');
    // jsdom has no decode, so "painted" resolves at once; the held class is gone after a tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(stage?.classList.contains('splash-stage--held')).toBe(false);
    expect(uiLayer.querySelector('.splash-standby')?.classList.contains('splash-standby--gone')).toBe(true);
  });

  it('reads a monotonic truth even when the reader dips or returns garbage', async () => {
    const { uiLayer, scene, set } = rig();
    await scene.enter();
    set(0.3, 7000);
    expect(fill(uiLayer)).toBe(30);
    expect(percent(uiLayer)).toBe('30%');
    expect(valueNow(uiLayer)).toBe('30');
    expect(uiLayer.textContent).toContain('About 7 s left.');
    set(0.2);
    expect(fill(uiLayer)).toBe(30);
    set(NaN);
    expect(fill(uiLayer)).toBe(30);
    set(-1);
    expect(fill(uiLayer)).toBe(30);
    set(0.95);
    expect(fill(uiLayer)).toBe(95);
    set(2, 0);
    expect(fill(uiLayer)).toBe(100);
    expect(uiLayer.textContent).toContain('Ready.');
    expect(valueNow(uiLayer)).toBe('100');
  });

  it('eases the drawn bar toward the measured fraction without ever running ahead of it', async () => {
    const { uiLayer, scene, frame, read } = rig();
    await scene.enter();
    read(0.6);
    scene.update(frame(0));
    // No time has passed: the readouts already say 60 %, the bar has not moved yet.
    expect(percent(uiLayer)).toBe('60%');
    expect(fill(uiLayer)).toBe(0);
    scene.update(frame(EASE_SECONDS));
    // One time constant closes 1 - 1/e of the gap.
    expect(fill(uiLayer)).toBeCloseTo(60 * (1 - Math.exp(-1)), 0);
    let last = fill(uiLayer);
    for (let i = 0; i < 120; i++) {
      scene.update(frame(1 / 60));
      const now = fill(uiLayer);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(60);
      last = now;
    }
    expect(last).toBe(60);
    // Completion is drawn at once: the player has to see the bar full.
    read(1);
    scene.update(frame(0));
    expect(fill(uiLayer)).toBe(100);
  });

  it('shows CONTINUE only while canContinue() is true, and fires onContinue on tap', async () => {
    const { uiLayer, scene, hooks, set } = rig();
    await scene.enter();
    const button = uiLayer.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(true);
    set(0.5, null, true);
    expect(button?.hidden).toBe(false);
    button?.click();
    expect(hooks.onContinue).toHaveBeenCalledTimes(1);
    set(0.5, null, false);
    expect(button?.hidden).toBe(true);
  });

  it('takes its DOM with it on dispose', async () => {
    const { uiLayer, scene } = rig();
    await scene.enter();
    expect(uiLayer.querySelector('[data-ui="loading-stage"]')).not.toBeNull();
    scene.dispose();
    expect(uiLayer.querySelector('[data-ui="loading-stage"]')).toBeNull();
  });
});

describe('formatEta', () => {
  it('is honest about not knowing, and rounds to what a player can use', () => {
    expect(formatEta(null, false)).toBe('Measuring…');
    expect(formatEta(NaN, false)).toBe('Measuring…');
    expect(formatEta(500, false)).toBe('Less than a second left.');
    expect(formatEta(1001, false)).toBe('About 2 s left.');
    expect(formatEta(59_000, false)).toBe('About 59 s left.');
    expect(formatEta(125_000, false)).toBe('About 2 min 5 s left.');
    expect(formatEta(0, true)).toBe('Ready.');
    expect(formatEta(null, true)).toBe('Ready.');
  });
});
