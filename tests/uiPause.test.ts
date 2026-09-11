// @vitest-environment jsdom
/**
 * Honesty in the pause overlay is a tested invariant (ARCHITECTURE §2.10):
 * the heading says the world is paused only for a session that can pause
 * it, and `show()` is what actually asks the app for the `paused` state.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { createStorageRoot } from '../src/persistence/StorageRoot';
import { memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import { PauseOverlay, pauseWords } from '../src/ui/PauseOverlay';
import type { PauseStressControls } from '../src/ui/PauseOverlay';

function fakeSession(canPauseWorld: boolean): GameSession {
  return {
    mode: canPauseWorld ? 'solo' : 'multiplayer',
    mapId: 'perf-empty',
    canPauseWorld,
    authority: canPauseWorld ? 'local' : 'server',
    caption: canPauseWorld ? 'Play alone on this device.' : 'Online play is not built yet.',
    save: async () => {},
    leave: async () => {},
  };
}

function rig(canPauseWorld: boolean) {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const requestState = vi.fn();
  const ctx = {
    uiLayer,
    storage: createStorageRoot(memoryKeyValueStore()),
    app: { requestState },
  } as unknown as SceneContext;
  const hooks = { session: fakeSession(canPauseWorld), onResume: vi.fn(), onQuit: vi.fn() };
  const overlay = new PauseOverlay(ctx, hooks);
  const veil = uiLayer.querySelector<HTMLElement>('[data-role="pause"]');
  const click = (action: string): void => uiLayer.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
  return { uiLayer, ctx, requestState, hooks, overlay, veil, click };
}

describe('pauseWords', () => {
  it('says the world is paused only when it is', () => {
    expect(pauseWords(true)).toBe('World paused');
    expect(pauseWords(false)).toBe('Menu open — the world keeps running');
  });
});

describe('PauseOverlay', () => {
  it('starts hidden, shows with the honest heading and requests the paused state', () => {
    const { requestState, overlay, veil } = rig(true);
    expect(veil?.hidden).toBe(true);
    expect(overlay.isOpen).toBe(false);
    overlay.show();
    expect(veil?.hidden).toBe(false);
    expect(overlay.isOpen).toBe(true);
    expect(veil?.querySelector('h1')?.textContent).toBe('World paused');
    expect(requestState).toHaveBeenCalledWith('paused');
    overlay.show();
    expect(requestState).toHaveBeenCalledTimes(1);
  });

  it('tells a multiplayer player the world keeps running', () => {
    const { overlay, veil } = rig(false);
    overlay.show();
    expect(veil?.querySelector('h1')?.textContent).toBe('Menu open — the world keeps running');
  });

  it('offers RESUME, SETTINGS and QUIT by data-action; RESUME hides, requests playing and fires onResume', () => {
    const { requestState, hooks, overlay, veil, click } = rig(true);
    overlay.show();
    const actions = [...veil!.querySelectorAll<HTMLElement>('button[data-action]')].map((b) => b.dataset.action);
    expect(actions).toEqual(['resume', 'settings', 'quit']);
    click('resume');
    expect(veil?.hidden).toBe(true);
    expect(overlay.isOpen).toBe(false);
    expect(requestState).toHaveBeenLastCalledWith('playing');
    expect(hooks.onResume).toHaveBeenCalledTimes(1);
  });

  it('QUIT closes without requesting a state and hands off to onQuit', () => {
    const { requestState, hooks, overlay, veil, click } = rig(true);
    overlay.show();
    requestState.mockClear();
    click('quit');
    expect(veil?.hidden).toBe(true);
    expect(requestState).not.toHaveBeenCalled();
    expect(hooks.onQuit).toHaveBeenCalledTimes(1);
    expect(hooks.onResume).not.toHaveBeenCalled();
  });

  it('SETTINGS swaps in the settings panel in place; Back returns to the pause card', () => {
    const { ctx, overlay, veil, click } = rig(true);
    overlay.show();
    click('settings');
    const fov = veil?.querySelector<HTMLInputElement>('[data-action="setting:fov"]');
    expect(fov).not.toBeNull();
    expect(veil?.querySelector('h1:not([hidden])')?.textContent).toBe('World paused');
    expect(veil?.querySelector<HTMLElement>('[data-action="resume"]')?.closest('section')?.hidden).toBe(true);

    fov!.value = '100';
    fov!.dispatchEvent(new Event('input'));
    expect(ctx.storage.kv.get('traddomium.v1.settings')).toContain('"fov":100');

    click('back');
    expect(veil?.querySelector('[data-action="setting:fov"]')).toBeNull();
    expect(veil?.querySelector<HTMLElement>('[data-action="resume"]')?.closest('section')?.hidden).toBe(false);
    overlay.dispose();
    expect(veil?.isConnected).toBe(false);
  });

  it('offers the solo island stress sheet and routes every control', () => {
    let active = false;
    let running = false;
    const controls: PauseStressControls = {
      get active() { return active; },
      get running() { return running; },
      finished: false,
      report: '',
      readout: {
        phase: 'idle', creatures: 0, bySpecies: {}, fps: 0, elapsedS: 0,
        crossings: [], nextFps: 45, recoveryLeftS: 0, ending: null,
        rigs: null, rigBudget: null, reducedBudget: null, withinFull: null,
        withinReduced: null, reduced: null, impostors: null, notDrawn: null,
        rate: 0, lod: null,
      },
      start: vi.fn(() => { active = true; running = true; }),
      stop: vi.fn(() => { running = false; }),
      runAgain: vi.fn(() => { active = true; running = true; }),
      exit: vi.fn(() => { active = false; running = false; }),
    };
    const uiLayer = document.createElement('div');
    document.body.appendChild(uiLayer);
    const ctx = {
      uiLayer,
      storage: createStorageRoot(memoryKeyValueStore()),
      app: { requestState: vi.fn() },
    } as unknown as SceneContext;
    const overlay = new PauseOverlay(ctx, {
      session: fakeSession(true), onResume: vi.fn(), onQuit: vi.fn(), stress: controls,
    });
    overlay.show();
    expect(uiLayer.querySelector('[data-action="island-stress"]')).not.toBeNull();
    uiLayer.querySelector<HTMLButtonElement>('[data-action="island-stress"]')!.click();
    expect(uiLayer.querySelector<HTMLElement>('[data-role="island-stress"]')?.hidden).toBe(false);
    uiLayer.querySelector<HTMLButtonElement>('[data-action="stress-start"]')!.click();
    uiLayer.querySelector<HTMLButtonElement>('[data-action="stress-stop"]')!.click();
    uiLayer.querySelector<HTMLButtonElement>('[data-action="stress-again"]')!.click();
    uiLayer.querySelector<HTMLButtonElement>('[data-action="stress-exit"]')!.click();
    expect(controls.start).toHaveBeenCalledTimes(1);
    expect(controls.stop).toHaveBeenCalledTimes(1);
    expect(controls.runAgain).toHaveBeenCalledTimes(1);
    expect(controls.exit).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it('does not offer the island stress sheet to multiplayer sessions', () => {
    const controls = {
      active: false, running: false, finished: false, report: '', readout: {},
      start: vi.fn(), stop: vi.fn(), runAgain: vi.fn(), exit: vi.fn(),
    } as unknown as PauseStressControls;
    const uiLayer = document.createElement('div');
    document.body.appendChild(uiLayer);
    const ctx = {
      uiLayer,
      storage: createStorageRoot(memoryKeyValueStore()),
      app: { requestState: vi.fn() },
    } as unknown as SceneContext;
    const overlay = new PauseOverlay(ctx, {
      session: fakeSession(false), onResume: vi.fn(), onQuit: vi.fn(), stress: controls,
    });
    overlay.show();
    expect(uiLayer.querySelector('[data-action="island-stress"]')).toBeNull();
    overlay.dispose();
  });

  it('renders a finished report and gives clipboard failures visible feedback', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    const controls = {
      active: true, running: false, finished: true, report: 'ISLAND STRESS REPORT',
      readout: { phase: 'done', creatures: 4, fps: 60, recoveryLeftS: 0 },
      start: vi.fn(), stop: vi.fn(), runAgain: vi.fn(), exit: vi.fn(),
    } as unknown as PauseStressControls;
    const uiLayer = document.createElement('div');
    document.body.appendChild(uiLayer);
    const ctx = {
      uiLayer,
      storage: createStorageRoot(memoryKeyValueStore()),
      app: { requestState: vi.fn() },
    } as unknown as SceneContext;
    const overlay = new PauseOverlay(ctx, {
      session: fakeSession(true), onResume: vi.fn(), onQuit: vi.fn(), stress: controls,
    });
    overlay.show();
    uiLayer.querySelector<HTMLButtonElement>('[data-action="island-stress"]')!.click();
    expect(uiLayer.querySelector('[data-role="stress-report"]')?.textContent).toBe('ISLAND STRESS REPORT');
    uiLayer.querySelector<HTMLButtonElement>('[data-action="stress-copy"]')!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ISLAND STRESS REPORT');
    expect(uiLayer.querySelector('[data-role="stress-copy-status"]')?.textContent).toContain('failed');
    overlay.dispose();
  });
});
