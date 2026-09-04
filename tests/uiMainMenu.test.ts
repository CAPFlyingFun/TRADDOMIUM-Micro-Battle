// @vitest-environment jsdom
/**
 * The main menu renders its controls by `data-action` (the names a probe
 * drives), shows CONTINUE above PLAY only when a saved game exists and
 * says when it was last played, opens the session picker in place with
 * the sessions' own captions, and shows an unregistered destination as
 * disabled rather than as a button that throws.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppScene, SceneContext } from '../src/app/Scene';
import { registerScene } from '../src/app/registry';
import { createStorageRoot } from '../src/persistence/StorageRoot';
import { memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import {
  createMainMenuScene, GAME_TITLE, MainMenuScene, MENU_CONTINUE_ACTION, timeAgo, type MainMenuHooks,
} from '../src/ui/MainMenuScene';
import type { SavedGame, SessionOffers } from '../src/ui/SessionPicker';

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
  const startSession = vi.fn();
  const ctx = {
    uiLayer,
    storage: createStorageRoot(memoryKeyValueStore()),
    scenes: { goTo: vi.fn(async () => {}) },
    app: { state: 'menu', requestState, session: null, startSession, endSession: vi.fn(async () => {}) },
  } as unknown as SceneContext;
  const solo = fakeSession('solo', 'Play alone on this device.');
  const multiplayer = fakeSession('multiplayer', 'Online play is not built yet.');
  const offers: SessionOffers = { solo: () => solo, multiplayer: () => multiplayer };
  return { uiLayer, ctx, requestState, startSession, offers, solo, multiplayer };
}

/** Hooks with nothing saved and every destination live; override what a test is about. */
function hooksWith(offers: SessionOffers, overrides: Partial<MainMenuHooks> = {}): MainMenuHooks {
  return {
    sessions: offers,
    onStart: vi.fn(),
    savedGame: () => null,
    onContinue: vi.fn(),
    onProfile: vi.fn(),
    onSettings: vi.fn(),
    onEditors: vi.fn(),
    onAbout: vi.fn(),
    ...overrides,
  };
}

const actions = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>('button[data-action]')].map((b) => b.dataset.action ?? '');

const byAction = (root: ParentNode, action: string): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();

describe('MainMenuScene', () => {
  it('renders the title, the five action buttons and the build stamp', async () => {
    const { uiLayer, ctx, offers } = rig();
    const hooks = hooksWith(offers);
    const scene = new MainMenuScene(ctx, hooks);
    await scene.enter();
    expect(uiLayer.querySelector('h1')?.textContent).toBe(GAME_TITLE);
    expect(actions(uiLayer)).toEqual(['play', 'profile', 'settings', 'editors', 'about']);
    for (const b of uiLayer.querySelectorAll<HTMLButtonElement>('button[data-action]')) expect(b.disabled).toBe(false);
    expect(uiLayer.querySelector('.ui-footer')?.textContent).toMatch(/^v.+ · .+$/);
    // Without a save, PLAY is the point of the screen.
    expect(byAction(uiLayer, 'play')?.classList.contains('ui-button--primary')).toBe(true);

    byAction(uiLayer, 'about')?.click();
    expect(hooks.onAbout).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(uiLayer.children.length).toBe(0);
  });

  it('shows no CONTINUE when there is nothing saved', async () => {
    const { uiLayer, ctx, offers } = rig();
    const scene = new MainMenuScene(ctx, hooksWith(offers, { savedGame: () => null }));
    await scene.enter();
    expect(byAction(uiLayer, MENU_CONTINUE_ACTION)).toBeNull();
    expect(uiLayer.textContent).not.toContain('Last played');
  });

  it('with a save, CONTINUE sits above PLAY, takes the gold, says when it was last played, and resumes that game', async () => {
    const { uiLayer, ctx, offers, solo } = rig();
    const saved: SavedGame = { session: solo, savedAt: minutesAgo(3) };
    const onContinue = vi.fn();
    const onStart = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(offers, { savedGame: () => saved, onContinue, onStart }));
    await scene.enter();

    expect(actions(uiLayer)).toEqual(['continue', 'play', 'profile', 'settings', 'editors', 'about']);
    const cont = byAction(uiLayer, MENU_CONTINUE_ACTION);
    expect(cont?.disabled).toBe(false);
    expect(cont?.classList.contains('ui-button--primary')).toBe(true);
    expect(byAction(uiLayer, 'play')?.classList.contains('ui-button--primary')).toBe(false);
    expect(cont?.querySelector('.ui-button__sub')?.textContent).toBe('Last played 3 minutes ago');
    // One touch target, two lines: the column does not grow a row for the caption.
    expect(uiLayer.querySelectorAll('.ui-column > *').length).toBe(6);

    cont?.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(saved);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('PLAY opens the picker in place with each session\'s own caption; SOLO starts it; BACK returns', async () => {
    const { uiLayer, ctx, requestState, offers, solo, multiplayer } = rig();
    const onStart = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(offers, {
      onStart, onProfile: null, onSettings: null, onEditors: null, onAbout: null,
    }));
    await scene.enter();
    const column = uiLayer.querySelector<HTMLElement>('.ui-column');
    byAction(uiLayer, 'play')?.click();

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

    byAction(uiLayer, 'multiplayer')?.click();
    expect(onStart).toHaveBeenLastCalledWith(multiplayer);
    byAction(uiLayer, 'solo')?.click();
    expect(onStart).toHaveBeenLastCalledWith(solo);

    byAction(uiLayer, 'back')?.click();
    expect(uiLayer.querySelector('[data-role="session-picker"]')).toBeNull();
    expect(column?.hidden).toBe(false);
    expect(requestState).toHaveBeenLastCalledWith('menu');
  });

  it('shows a null destination disabled, with the reason in the label', async () => {
    const { uiLayer, ctx, offers } = rig();
    const scene = new MainMenuScene(ctx, hooksWith(offers, { onSettings: null, onEditors: null }));
    await scene.enter();
    const editors = byAction(uiLayer, 'editors');
    expect(editors?.disabled).toBe(true);
    expect(editors?.textContent).toBe('Editors — not in this build');
    expect(byAction(uiLayer, 'profile')?.disabled).toBe(false);
  });

  it('the factory looks destinations up in the registry, so an unregistered screen is disabled instead of throwing', async () => {
    const { uiLayer, ctx, offers } = rig();
    const stub = (): AppScene => ({}) as unknown as AppScene;
    registerScene('settings', stub);
    registerScene('about', stub);
    const scene = createMainMenuScene(() => offers)(ctx);
    await scene.enter();
    expect(byAction(uiLayer, 'settings')?.disabled).toBe(false);
    expect(byAction(uiLayer, 'about')?.disabled).toBe(false);
    expect(byAction(uiLayer, 'profile')?.disabled).toBe(true);
    expect(byAction(uiLayer, 'editors')?.disabled).toBe(true);
    // A wiring that says nothing about saves has no CONTINUE, rather than one that cannot.
    expect(byAction(uiLayer, MENU_CONTINUE_ACTION)).toBeNull();
    byAction(uiLayer, 'settings')?.click();
    expect(ctx.scenes.goTo).toHaveBeenCalledTimes(1);
  });

  it('the factory wires CONTINUE from offers.saved and starts the saved session through the loading screen', async () => {
    const { uiLayer, ctx, requestState, startSession, offers, solo } = rig();
    const stub = (): AppScene => ({}) as unknown as AppScene;
    registerScene('loading', stub);
    const resumed = fakeSession('solo', solo.caption);
    const withSave: SessionOffers = { ...offers, saved: () => ({ session: resumed, savedAt: minutesAgo(90) }) };
    const scene = createMainMenuScene(() => withSave)(ctx);
    await scene.enter();

    const cont = byAction(uiLayer, MENU_CONTINUE_ACTION);
    expect(cont?.querySelector('.ui-button__sub')?.textContent).toBe('Last played 1 hour ago');
    cont?.click();
    expect(startSession).toHaveBeenCalledWith(resumed);
    expect(requestState).toHaveBeenLastCalledWith('loading');
    expect(ctx.scenes.goTo).toHaveBeenCalledTimes(1);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-09-04T12:00:00.000Z');
  const before = (ms: number): string => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('picks the roughest honest unit', () => {
    expect(timeAgo(before(0), now)).toBe('just now');
    expect(timeAgo(before(59_000), now)).toBe('just now');
    expect(timeAgo(before(MIN), now)).toBe('1 minute ago');
    expect(timeAgo(before(3 * MIN), now)).toBe('3 minutes ago');
    expect(timeAgo(before(59 * MIN), now)).toBe('59 minutes ago');
    expect(timeAgo(before(HOUR), now)).toBe('1 hour ago');
    expect(timeAgo(before(23 * HOUR), now)).toBe('23 hours ago');
    expect(timeAgo(before(DAY), now)).toBe('yesterday');
    expect(timeAgo(before(2 * DAY), now)).toBe('2 days ago');
    expect(timeAgo(before(6 * DAY), now)).toBe('6 days ago');
    expect(timeAgo(before(7 * DAY), now)).toBe('1 week ago');
    expect(timeAgo(before(29 * DAY), now)).toBe('4 weeks ago');
    expect(timeAgo(before(30 * DAY), now)).toBe('1 month ago');
    expect(timeAgo(before(364 * DAY), now)).toBe('12 months ago');
    expect(timeAgo(before(365 * DAY), now)).toBe('1 year ago');
    expect(timeAgo(before(800 * DAY), now)).toBe('2 years ago');
  });

  it('never invents a time: a future stamp is "just now", an unreadable one is "some time ago"', () => {
    expect(timeAgo(new Date(now + HOUR).toISOString(), now)).toBe('just now');
    expect(timeAgo('yesterday-ish', now)).toBe('some time ago');
    expect(timeAgo('', now)).toBe('some time ago');
  });
});
