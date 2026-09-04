// @vitest-environment jsdom
/**
 * The loading screen's two promises: the bar never runs backwards whatever
 * the reader says, and CONTINUE exists only while the wiring allows it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { formatEta, LoadingScene, type LoadingHooks } from '../src/ui/LoadingScene';

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
  const frame = { rawDt: 0.016, simDt: 0.016, elapsed: 0 };
  return {
    uiLayer, scene, hooks, frame,
    set(f: number, e: number | null = eta, c = canContinue) {
      fraction = f;
      eta = e;
      canContinue = c;
      scene.update(frame);
    },
  };
}

/** Percent width of the fill, as a number: jsdom normalises '30.0%' to '30%'. */
const fill = (root: ParentNode): number => parseFloat(root.querySelector<HTMLElement>('.ui-bar__fill')?.style.width ?? 'NaN');

describe('LoadingScene', () => {
  it('begins the load once on enter and shows the caption', async () => {
    const { uiLayer, scene, hooks } = rig();
    await scene.enter();
    expect(hooks.onEnter).toHaveBeenCalledTimes(1);
    expect(uiLayer.querySelector('h1')?.textContent).toBe('Loading the empty world');
    expect(fill(uiLayer)).toBe(0);
    expect(uiLayer.textContent).toContain('Measuring…');
  });

  it('draws a monotonic bar even when the reader dips or returns garbage', async () => {
    const { uiLayer, scene, set } = rig();
    await scene.enter();
    set(0.3, 7000);
    expect(fill(uiLayer)).toBe(30);
    expect(uiLayer.querySelector('.ui-readout')?.textContent).toBe('30%');
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
    expect(uiLayer.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
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
