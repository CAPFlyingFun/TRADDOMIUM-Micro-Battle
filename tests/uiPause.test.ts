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
});
