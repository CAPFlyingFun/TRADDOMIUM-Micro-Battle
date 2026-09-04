// @vitest-environment jsdom
/**
 * The SceneManager's two promises: a second goTo is queued rather than
 * dropped, and a scene that fails to enter falls back to the menu instead
 * of leaving a black screen. No three here — the fakes are plain objects.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppScene, SceneContext, SceneFactory } from '../src/app/Scene';
import { SceneManager } from '../src/app/SceneManager';

interface FakeScene extends AppScene {
  readonly log: string[];
}

function fakeScene(name: string, log: string[], enter: () => Promise<void> = async () => {}): FakeScene {
  return {
    name,
    log,
    three: {} as AppScene['three'],
    camera: {} as AppScene['camera'],
    async enter() {
      log.push(`enter ${name}`);
      await enter();
    },
    update() {
      log.push(`update ${name}`);
    },
    resize(w, h) {
      log.push(`resize ${name} ${w}x${h}`);
    },
    dispose() {
      log.push(`dispose ${name}`);
    },
  };
}

function rig() {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const log: string[] = [];
  const clearHandlers = vi.fn();
  const fallbackFactory: SceneFactory = () => fakeScene('menu', log);
  const manager = new SceneManager({
    uiLayer,
    input: { clearHandlers },
    viewport: () => ({ width: 932, height: 430 }),
    context: () => ({}) as unknown as SceneContext,
    fallback: () => fallbackFactory,
    onFallback: () => log.push('fallback'),
    fadeMs: 0,
  });
  return { manager, uiLayer, log, clearHandlers };
}

describe('SceneManager.goTo', () => {
  it('disposes the old scene, clears shared handlers and stray DOM, then enters and resizes the new one', async () => {
    const { manager, uiLayer, log, clearHandlers } = rig();
    await manager.goTo(() => fakeScene('a', log));
    expect(manager.current?.name).toBe('a');
    const stray = document.createElement('div');
    uiLayer.appendChild(stray);

    await manager.goTo(() => fakeScene('b', log));
    expect(log).toEqual(['enter a', 'resize a 932x430', 'dispose a', 'enter b', 'resize b 932x430']);
    expect(clearHandlers).toHaveBeenCalledTimes(2);
    expect(stray.isConnected).toBe(false);
    // The fader is the manager's own and survives hygiene.
    expect(uiLayer.querySelector('[data-role="scene-fader"]')).not.toBeNull();
  });

  it('queues a second goTo made while the first is still entering, and does not drop it', async () => {
    const { manager, log } = rig();
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const first = manager.goTo(() => fakeScene('a', log, () => gateA));
    const second = manager.goTo(() => fakeScene('b', log));
    expect(manager.transitioning).toBe(true);
    // b must not start until a has finished entering.
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['enter a']);
    releaseA();
    await first;
    expect(manager.current?.name).toBe('a');
    await second;
    expect(manager.current?.name).toBe('b');
    expect(log).toEqual(['enter a', 'resize a 932x430', 'dispose a', 'enter b', 'resize b 932x430']);
    expect(manager.transitioning).toBe(false);
  });

  it('runs a goTo requested from inside enter() after the current transition (the loading screen case)', async () => {
    const { manager, log } = rig();
    await manager.goTo(() => fakeScene('loading', log, async () => {
      void manager.goTo(() => fakeScene('world', log));
    }));
    expect(manager.current?.name).toBe('loading');
    // Let the queued request run.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.current?.name).toBe('world');
  });

  it('falls back to the menu when enter() throws, and never leaves current null', async () => {
    const { manager, log } = rig();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.goTo(() => fakeScene('a', log));
    await expect(manager.goTo(() => fakeScene('broken', log, async () => {
      throw new Error('no session');
    }))).resolves.toBeUndefined();
    expect(manager.current?.name).toBe('menu');
    expect(log).toEqual([
      'enter a', 'resize a 932x430', 'dispose a', 'enter broken', 'dispose broken',
      'enter menu', 'resize menu 932x430', 'fallback',
    ]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('keeps serving requests queued after a failed one', async () => {
    const { manager, log } = rig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = manager.goTo(() => fakeScene('broken', log, async () => {
      throw new Error('boom');
    }));
    const next = manager.goTo(() => fakeScene('b', log));
    await failed;
    await next;
    expect(manager.current?.name).toBe('b');
    vi.restoreAllMocks();
  });

  it('forwards update and resize to the current scene only', async () => {
    const { manager, log } = rig();
    manager.update({ rawDt: 0.016, simDt: 0.016, elapsed: 0 });
    manager.resize(10, 10);
    expect(log).toEqual([]);
    await manager.goTo(() => fakeScene('a', log));
    manager.update({ rawDt: 0.016, simDt: 0.016, elapsed: 0 });
    expect(log.at(-1)).toBe('update a');
  });
});
