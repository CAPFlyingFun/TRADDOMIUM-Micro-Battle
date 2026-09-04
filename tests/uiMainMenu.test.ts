// @vitest-environment jsdom
/**
 * The main menu renders its controls by `data-action` (the names a probe
 * drives), shows RESUME above NEW GAME only when a saved game exists and
 * says when it was last played, walks NEW GAME → how to play → which slot,
 * starts multiplayer without a slot, and shows an unregistered destination
 * as disabled rather than as a button that throws.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppScene, SceneContext } from '../src/app/Scene';
import { registerScene } from '../src/app/registry';
import { createStorageRoot } from '../src/persistence/StorageRoot';
import { memoryKeyValueStore } from '../src/persistence/store';
import type { GameSession } from '../src/session/GameSession';
import {
  createMainMenuScene, GAME_TITLE, MainMenuScene, MENU_RESUME_ACTION, type MainMenuHooks, type SoloPlay,
} from '../src/ui/MainMenuScene';
import type { SavedGame, SessionOffers } from '../src/ui/SessionPicker';
import { SLOT_OVERWRITE_ACTION, slotAction, type SlotView } from '../src/ui/SlotPicker';

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

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();

const EMPTY_SLOTS: readonly SlotView[] = [
  { slot: 1, savedAt: null },
  { slot: 2, savedAt: null },
  { slot: 3, savedAt: null },
];

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
  const offers: SessionOffers = { solo: () => solo, multiplayer: () => multiplayer, slots: () => EMPTY_SLOTS };
  return { uiLayer, ctx, requestState, startSession, offers, solo, multiplayer };
}

/** Hooks with nothing saved and every destination live; override what a test is about. */
function hooksWith(offers: SessionOffers, overrides: Partial<MainMenuHooks> = {}): MainMenuHooks {
  return {
    sessions: offers,
    onStart: vi.fn(),
    savedGame: () => null,
    onNewGame: vi.fn(),
    onResume: vi.fn(),
    onProfile: vi.fn(),
    onSettings: vi.fn(),
    onEditors: vi.fn(),
    onAbout: vi.fn(),
    ...overrides,
  };
}

const noPlay: SoloPlay = { newGame: () => {}, resume: () => {} };

const actions = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>('button[data-action]')].map((b) => b.dataset.action ?? '');

const byAction = (root: ParentNode, action: string): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);

describe('MainMenuScene', () => {
  it('renders the title, the five action buttons and the build stamp', async () => {
    const { uiLayer, ctx, offers } = rig();
    const hooks = hooksWith(offers);
    const scene = new MainMenuScene(ctx, hooks);
    await scene.enter();
    expect(uiLayer.querySelector('h1')?.textContent).toBe(GAME_TITLE);
    expect(actions(uiLayer)).toEqual(['new-game', 'profile', 'settings', 'editors', 'about']);
    for (const b of uiLayer.querySelectorAll<HTMLButtonElement>('button[data-action]')) expect(b.disabled).toBe(false);
    expect(uiLayer.querySelector('.ui-footer')?.textContent).toMatch(/^v.+ · .+$/);
    // Without a save, a new game is the point of the screen.
    expect(byAction(uiLayer, 'new-game')?.classList.contains('ui-button--primary')).toBe(true);

    byAction(uiLayer, 'about')?.click();
    expect(hooks.onAbout).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(uiLayer.children.length).toBe(0);
  });

  it('shows no RESUME when there is nothing saved', async () => {
    const { uiLayer, ctx, offers } = rig();
    const scene = new MainMenuScene(ctx, hooksWith(offers, { savedGame: () => null }));
    await scene.enter();
    expect(byAction(uiLayer, MENU_RESUME_ACTION)).toBeNull();
    expect(uiLayer.textContent).not.toContain('Last played');
  });

  it('with one save, RESUME sits above NEW GAME, takes the gold, says when, and opens that slot directly', async () => {
    const { uiLayer, ctx, offers } = rig();
    const slots: readonly SlotView[] = [{ slot: 1, savedAt: null }, { slot: 2, savedAt: minutesAgo(3) }, { slot: 3, savedAt: null }];
    const saved: SavedGame = { slot: 2, savedAt: minutesAgo(3) };
    const onResume = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(
      { ...offers, slots: () => slots },
      { savedGame: () => saved, onResume },
    ));
    await scene.enter();

    expect(actions(uiLayer)).toEqual(['resume', 'new-game', 'profile', 'settings', 'editors', 'about']);
    const resume = byAction(uiLayer, MENU_RESUME_ACTION);
    expect(resume?.disabled).toBe(false);
    expect(resume?.classList.contains('ui-button--primary')).toBe(true);
    expect(byAction(uiLayer, 'new-game')?.classList.contains('ui-button--primary')).toBe(false);
    expect(resume?.querySelector('.ui-button__sub')?.textContent).toBe('Last played 3 minutes ago');
    // One touch target, two lines: the column does not grow a row for the caption.
    expect(uiLayer.querySelectorAll('.ui-column > *').length).toBe(6);

    resume?.click();
    // One game is one game: no list, straight into the slot it is in.
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(2);
    expect(uiLayer.querySelector('[data-role="slot-picker"]')).toBeNull();
  });

  it('with more than one save, RESUME opens the slot list instead of picking for the player', async () => {
    const { uiLayer, ctx, offers, requestState } = rig();
    const slots: readonly SlotView[] = [
      { slot: 1, savedAt: minutesAgo(600) },
      { slot: 2, savedAt: minutesAgo(3) },
      { slot: 3, savedAt: null },
    ];
    const onResume = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(
      { ...offers, slots: () => slots },
      { savedGame: () => ({ slot: 2, savedAt: minutesAgo(3) }), onResume },
    ));
    await scene.enter();
    // The button still names the newest, so it promises nothing it will not show.
    expect(byAction(uiLayer, MENU_RESUME_ACTION)?.textContent).toContain('Last played 3 minutes ago');

    byAction(uiLayer, MENU_RESUME_ACTION)?.click();
    expect(onResume).not.toHaveBeenCalled();
    const picker = uiLayer.querySelector<HTMLElement>('[data-role="slot-picker"]');
    expect(picker?.dataset.purpose).toBe('resume');
    expect(requestState).toHaveBeenLastCalledWith('session');
    expect(byAction(uiLayer, slotAction(3))?.disabled).toBe(true);

    byAction(uiLayer, slotAction(1))?.click();
    expect(onResume).toHaveBeenCalledWith(1);
  });

  it("NEW GAME opens the picker in place with each session's own caption; SOLO asks which slot; BACK walks out", async () => {
    const { uiLayer, ctx, requestState, offers, solo, multiplayer } = rig();
    const onStart = vi.fn();
    const onNewGame = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(offers, {
      onStart, onNewGame, onProfile: null, onSettings: null, onEditors: null, onAbout: null,
    }));
    await scene.enter();
    const column = uiLayer.querySelector<HTMLElement>('.ui-column');
    byAction(uiLayer, 'new-game')?.click();

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

    // Multiplayer takes no slot: the session it shows is the session it starts.
    byAction(uiLayer, 'multiplayer')?.click();
    expect(onStart).toHaveBeenCalledWith(multiplayer);
    expect(uiLayer.querySelector('[data-role="slot-picker"]')).toBeNull();

    // Solo starts nothing here; it asks which of the three slots.
    byAction(uiLayer, 'solo')?.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    const slots = uiLayer.querySelector<HTMLElement>('[data-role="slot-picker"]');
    expect(slots?.dataset.purpose).toBe('new-game');
    expect(uiLayer.querySelector('[data-role="session-picker"]')).toBeNull();

    byAction(uiLayer, slotAction(2))?.click();
    expect(onNewGame).toHaveBeenCalledWith(2);

    // BACK from the slots returns to how-to-play; BACK again to the column.
    byAction(uiLayer, 'back')?.click();
    expect(uiLayer.querySelector('[data-role="session-picker"]')).not.toBeNull();
    byAction(uiLayer, 'back')?.click();
    expect(uiLayer.querySelector('[data-role="session-picker"]')).toBeNull();
    expect(column?.hidden).toBe(false);
    expect(requestState).toHaveBeenLastCalledWith('menu');
  });

  it('a new game on an occupied slot goes through the overwrite question', async () => {
    const { uiLayer, ctx, offers } = rig();
    const slots: readonly SlotView[] = [{ slot: 1, savedAt: minutesAgo(3) }, { slot: 2, savedAt: null }, { slot: 3, savedAt: null }];
    const onNewGame = vi.fn();
    const scene = new MainMenuScene(ctx, hooksWith(
      { ...offers, slots: () => slots },
      { savedGame: () => ({ slot: 1, savedAt: minutesAgo(3) }), onNewGame },
    ));
    await scene.enter();
    byAction(uiLayer, 'new-game')?.click();
    byAction(uiLayer, 'solo')?.click();
    byAction(uiLayer, slotAction(1))?.click();
    expect(onNewGame).not.toHaveBeenCalled();
    expect(uiLayer.querySelector('[data-role="slot-overwrite"]')).not.toBeNull();
    byAction(uiLayer, SLOT_OVERWRITE_ACTION)?.click();
    expect(onNewGame).toHaveBeenCalledWith(1);
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
    const scene = createMainMenuScene(() => offers, () => noPlay)(ctx);
    await scene.enter();
    expect(byAction(uiLayer, 'settings')?.disabled).toBe(false);
    expect(byAction(uiLayer, 'about')?.disabled).toBe(false);
    expect(byAction(uiLayer, 'profile')?.disabled).toBe(true);
    expect(byAction(uiLayer, 'editors')?.disabled).toBe(true);
    // A wiring that says nothing about saves has no RESUME, rather than one that cannot.
    expect(byAction(uiLayer, MENU_RESUME_ACTION)).toBeNull();
    byAction(uiLayer, 'settings')?.click();
    expect(ctx.scenes.goTo).toHaveBeenCalledTimes(1);
  });

  it('the factory wires RESUME from offers.saved and opens that slot through the wiring', async () => {
    const { uiLayer, ctx, offers } = rig();
    const withSave: SessionOffers = {
      ...offers,
      slots: () => [{ slot: 1, savedAt: null }, { slot: 2, savedAt: null }, { slot: 3, savedAt: minutesAgo(90) }],
      saved: () => ({ slot: 3, savedAt: minutesAgo(90) }),
    };
    const resume = vi.fn();
    const scene = createMainMenuScene(() => withSave, () => ({ newGame: vi.fn(), resume }))(ctx);
    await scene.enter();

    const button = byAction(uiLayer, MENU_RESUME_ACTION);
    expect(button?.querySelector('.ui-button__sub')?.textContent).toBe('Last played 1 hour ago');
    button?.click();
    expect(resume).toHaveBeenCalledWith(3);
  });
});
