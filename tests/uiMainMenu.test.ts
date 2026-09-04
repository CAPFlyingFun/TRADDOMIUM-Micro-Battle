// @vitest-environment jsdom
/**
 * The main menu renders its five controls by `data-action` (the names a
 * probe drives), opens the session picker in place with the sessions' own
 * captions, and shows an unregistered destination as disabled rather than
 * as a button that throws.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppScene, SceneContext } from '../src/app/Scene';
import { registerScene } from '../src/app/registry';
import { createStorageRoot } from '../src/persistence/StorageRoot';
import { memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import { createMainMenuScene, GAME_TITLE, MainMenuScene, type MainMenuHooks } from '../src/ui/MainMenuScene';
import type { SessionOffers } from '../src/ui/SessionPicker';

function fakeSession(mode: GameSession['mode'], caption: string): GameSession {
  return {
    mode,
    mapId: 'perf-empty',
    canPauseWorld: mode === 'solo',
    authority: mode === 'solo' ? 'local' : 'server',
    caption,
    save: async () => {},
    leave: async () => {},
  };
}

function rig() {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const requestState = vi.fn();
  const ctx = {
    uiLayer,
    storage: createStorageRoot(memoryKeyValueStore()),
    scenes: { goTo: vi.fn(async () => {}) },
    app: { state: 'menu', requestState, session: null, startSession: vi.fn(), endSession: vi.fn(async () => {}) },
  } as unknown as SceneContext;
  const solo = fakeSession('solo', 'Play alone on this device.');
  const multiplayer = fakeSession('multiplayer', 'Online play is not built yet.');
  const offers: SessionOffers = { solo: () => solo, multiplayer: () => multiplayer };
  return { uiLayer, ctx, requestState, offers, solo, multiplayer };
}

const actions = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>('button[data-action]')].map((b) => b.dataset.action ?? '');

describe('MainMenuScene', () => {
  it('renders the title, the five action buttons and the build stamp', async () => {
    const { uiLayer, ctx, offers } = rig();
    const hooks: MainMenuHooks = {
      sessions: offers,
      onStart: vi.fn(),
      onProfile: vi.fn(),
      onSettings: vi.fn(),
      onEditors: vi.fn(),
      onAbout: vi.fn(),
    };
    const scene = new MainMenuScene(ctx, hooks);
    await scene.enter();
    expect(uiLayer.querySelector('h1')?.textContent).toBe(GAME_TITLE);
    expect(actions(uiLayer)).toEqual(['play', 'profile', 'settings', 'editors', 'about']);
    for (const b of uiLayer.querySelectorAll<HTMLButtonElement>('button[data-action]')) expect(b.disabled).toBe(false);
    expect(uiLayer.querySelector('.ui-footer')?.textContent).toMatch(/^v.+ · .+$/);

    uiLayer.querySelector<HTMLButtonElement>('[data-action="about"]')?.click();
    expect(hooks.onAbout).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(uiLayer.children.length).toBe(0);
  });

  it('PLAY opens the picker in place with each session\'s own caption; SOLO starts it; BACK returns', async () => {
    const { uiLayer, ctx, requestState, offers, solo, multiplayer } = rig();
    const onStart = vi.fn();
    const scene = new MainMenuScene(ctx, {
      sessions: offers, onStart, onProfile: null, onSettings: null, onEditors: null, onAbout: null,
    });
    await scene.enter();
    const column = uiLayer.querySelector<HTMLElement>('.ui-column');
    uiLayer.querySelector<HTMLButtonElement>('[data-action="play"]')?.click();

    expect(requestState).toHaveBeenLastCalledWith('session');
    expect(column?.hidden).toBe(true);
    const picker = uiLayer.querySelector('[data-role="session-picker"]');
    expect(picker).not.toBeNull();
    expect(picker?.textContent).toContain(solo.caption);
    expect(picker?.textContent).toContain(multiplayer.caption);
    expect(picker?.textContent).toContain('Online play is not built yet.');
    expect(actions(picker as ParentNode)).toEqual(['solo', 'multiplayer', 'back']);
    // Same panel, above the build stamp.
    expect(picker?.nextElementSibling?.classList.contains('ui-footer')).toBe(true);

    uiLayer.querySelector<HTMLButtonElement>('[data-action="multiplayer"]')?.click();
    expect(onStart).toHaveBeenLastCalledWith(multiplayer);
    uiLayer.querySelector<HTMLButtonElement>('[data-action="solo"]')?.click();
    expect(onStart).toHaveBeenLastCalledWith(solo);

    uiLayer.querySelector<HTMLButtonElement>('[data-action="back"]')?.click();
    expect(uiLayer.querySelector('[data-role="session-picker"]')).toBeNull();
    expect(column?.hidden).toBe(false);
    expect(requestState).toHaveBeenLastCalledWith('menu');
  });

  it('shows a null destination disabled, with the reason in the label', async () => {
    const { uiLayer, ctx, offers } = rig();
    const scene = new MainMenuScene(ctx, {
      sessions: offers, onStart: vi.fn(), onProfile: vi.fn(), onSettings: null, onEditors: null, onAbout: vi.fn(),
    });
    await scene.enter();
    const editors = uiLayer.querySelector<HTMLButtonElement>('[data-action="editors"]');
    expect(editors?.disabled).toBe(true);
    expect(editors?.textContent).toBe('Editors — not in this build');
    expect(uiLayer.querySelector<HTMLButtonElement>('[data-action="profile"]')?.disabled).toBe(false);
  });

  it('the factory looks destinations up in the registry, so an unregistered screen is disabled instead of throwing', async () => {
    const { uiLayer, ctx, offers } = rig();
    const stub = (): AppScene => ({}) as unknown as AppScene;
    registerScene('settings', stub);
    registerScene('about', stub);
    const scene = createMainMenuScene(() => offers)(ctx);
    await scene.enter();
    const byAction = (a: string): HTMLButtonElement | null => uiLayer.querySelector(`[data-action="${a}"]`);
    expect(byAction('settings')?.disabled).toBe(false);
    expect(byAction('about')?.disabled).toBe(false);
    expect(byAction('profile')?.disabled).toBe(true);
    expect(byAction('editors')?.disabled).toBe(true);
    byAction('settings')?.click();
    expect(ctx.scenes.goTo).toHaveBeenCalledTimes(1);
  });
});
