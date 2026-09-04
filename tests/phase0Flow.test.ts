// @vitest-environment jsdom
/**
 * ARCHITECTURE §12's flow, driven end to end through the REAL scene
 * registrations, the real SceneManager, the real AppState machine and a
 * memory store — everything but the renderer and the animation frame:
 *
 *   menu → PLAY → picker → SOLO → session → loading → playing
 *        → PAUSE → paused (world may freeze) → RESUME → playing
 *        → PAUSE → QUIT → menu, session ended and saved
 *
 * plus the multiplayer mock's honest pause heading, the hub's OPEN of the
 * Performance World, and the world refusing to enter without a session.
 * Buttons are pressed by their `data-action`, exactly as the boot probe
 * does, so this is the probe's logic without the browser.
 */
import { describe, expect, it } from 'vitest';
import { AppStateMachine } from '../src/app/AppState';
import type { Assets } from '../src/assets/assets';
import type { Renderer } from '../src/app/Renderer';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { SceneManager } from '../src/app/SceneManager';
import { registerScenes } from '../src/app/registerScenes';
import { sceneFactory } from '../src/app/registry';
import { Input } from '../src/input/Input';
import { createStorageRoot } from '../src/persistence/StorageRoot';
import { memoryKeyValueStore } from '../src/persistence/store';
import { PERF_WORLD_SCENE_ID } from '../src/perf/perfTool';
import type { GameSession } from '../src/session/GameSession';
import { SOLO_SAVE_SPEC } from '../src/session/LocalSoloSession';
import { MULTIPLAYER_CAPTION } from '../src/session/RemoteMultiplayerSession';
import { pauseWords } from '../src/ui';

registerScenes();

function rig() {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const state = new AppStateMachine('boot');
  let session: GameSession | null = null;
  let fallbacks = 0;
  const app: AppHandle = {
    get state() {
      return state.get();
    },
    requestState: (next) => state.set(next),
    get session() {
      return session;
    },
    startSession: (s) => {
      session = s;
    },
    endSession: async () => {
      const leaving = session;
      session = null;
      await leaving?.leave();
    },
  };
  const kv = memoryKeyValueStore();
  const input = new Input();
  // Neither the screens nor the empty world touch the renderer or the
  // asset loader; a scene that starts to would fail here, loudly.
  // The manager reads its context lazily, which is what lets the two refer to each other.
  const scenes = new SceneManager({
    uiLayer,
    input,
    viewport: () => ({ width: 932, height: 430 }),
    context: () => ctx,
    fallback: () => sceneFactory('menu'),
    onFallback: () => {
      fallbacks += 1;
      void app.endSession();
      state.set('menu');
    },
    fadeMs: 0,
  });
  const ctx: SceneContext = {
    renderer: {} as Renderer,
    input,
    scenes,
    assets: {} as Assets,
    storage: createStorageRoot(kv),
    app,
    uiLayer,
  };

  const press = (action: string): void => {
    const button = uiLayer.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!button) throw new Error(`no [data-action="${action}"] on screen; UI reads: "${uiLayer.textContent}"`);
    if (button.disabled) throw new Error(`[data-action="${action}"] is disabled`);
    button.click();
  };
  /** Wait for every queued transition (a click only starts one). */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!scenes.transitioning) return;
    }
    throw new Error('scene transitions never settled');
  };
  const frame = (rawDt = 1 / 60): void => {
    const simDt = state.get() === 'paused' && (session?.canPauseWorld ?? false) ? 0 : rawDt;
    scenes.update({ rawDt, simDt, elapsed: 0 });
  };
  const veil = (): HTMLElement | null => uiLayer.querySelector<HTMLElement>('[data-role="pause"]');

  return { uiLayer, app, scenes, kv, input, press, settle, frame, veil, fallbacks: () => fallbacks };
}

async function boot(r: ReturnType<typeof rig>): Promise<void> {
  await r.scenes.goTo(sceneFactory('menu'));
  r.app.requestState('menu');
}

describe('Phase 0 flow', () => {
  it('menu → PLAY → SOLO reaches the Performance World in the playing state', async () => {
    const r = rig();
    await boot(r);
    expect(r.scenes.current?.name).toBe('menu');

    r.press('play');
    expect(r.app.state).toBe('session');
    r.press('solo');
    expect(r.app.state).toBe('loading');
    await r.settle();

    expect(r.scenes.current?.name).toBe(PERF_WORLD_SCENE_ID);
    expect(r.app.state).toBe('playing');
    expect(r.app.session?.mode).toBe('solo');
    expect(r.uiLayer.querySelector('[data-role="perf-hud"]')).not.toBeNull();
    expect(r.uiLayer.querySelector('[data-action="pause"]')).not.toBeNull();
    // The overlay exists, hidden, above the HUD.
    expect(r.veil()?.hidden).toBe(true);
  });

  it('PAUSE freezes a solo world honestly; RESUME runs it; QUIT saves, ends the session and lands on the menu', async () => {
    const r = rig();
    await boot(r);
    r.press('play');
    r.press('solo');
    await r.settle();

    r.frame();
    r.press('pause');
    expect(r.app.state).toBe('paused');
    expect(r.veil()?.hidden).toBe(false);
    expect(r.veil()?.textContent).toContain(pauseWords(true));
    // Enough frames for the HUD's 5 Hz refresh: sim dt reads as a pause.
    for (let i = 0; i < 20; i += 1) r.frame();
    expect(r.uiLayer.querySelector('[data-field="sim-dt"]')?.textContent).toBe('paused');

    r.press('resume');
    expect(r.app.state).toBe('playing');
    expect(r.veil()?.hidden).toBe(true);
    for (let i = 0; i < 20; i += 1) r.frame();
    expect(r.uiLayer.querySelector('[data-field="sim-dt"]')?.textContent).not.toBe('paused');

    r.press('pause');
    r.press('quit');
    await r.settle();
    expect(r.scenes.current?.name).toBe('menu');
    expect(r.app.state).toBe('menu');
    expect(r.app.session).toBeNull();
    // Leaving flushed the save.
    expect(r.kv.get(SOLO_SAVE_SPEC.key)).toContain('"mapId":"perf-empty"');
    expect(r.uiLayer.querySelector('[data-role="perf-hud"]')).toBeNull();
    expect(r.fallbacks()).toBe(0);
  });

  it('Escape toggles the pause menu from the keyboard', async () => {
    const r = rig();
    await boot(r);
    r.press('play');
    r.press('solo');
    await r.settle();
    // Through Input's own key path, so the handler the world registered is what fires.
    r.input.attach(document.body);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      expect(r.app.state).toBe('paused');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      expect(r.app.state).toBe('playing');
    } finally {
      r.input.detach();
    }
  });

  it('the multiplayer mock is enterable and its pause menu says the world keeps running', async () => {
    const r = rig();
    await boot(r);
    r.press('play');
    expect(r.uiLayer.textContent).toContain(MULTIPLAYER_CAPTION);
    r.press('multiplayer');
    await r.settle();
    expect(r.scenes.current?.name).toBe(PERF_WORLD_SCENE_ID);
    expect(r.app.session?.canPauseWorld).toBe(false);
    r.press('pause');
    expect(r.app.state).toBe('paused');
    expect(r.veil()?.textContent).toContain(pauseWords(false));
    for (let i = 0; i < 20; i += 1) r.frame();
    expect(r.uiLayer.querySelector('[data-field="sim-dt"]')?.textContent).not.toBe('paused');
  });

  it('EDITORS opens the hub; OPEN on the Performance World starts a solo game there', async () => {
    const r = rig();
    await boot(r);
    r.press('editors');
    await r.settle();
    expect(r.scenes.current?.name).toBe('devtools');
    expect(r.app.state).toBe('menu');
    expect(r.uiLayer.querySelector('li[data-tool]')?.getAttribute('data-tool')).toBe('perf-world');
    r.press('tool:perf-world');
    await r.settle();
    expect(r.scenes.current?.name).toBe(PERF_WORLD_SCENE_ID);
    expect(r.app.state).toBe('playing');
    expect(r.app.session?.mode).toBe('solo');
    // And PAUSE is legal from there, which is why the hub goes through a session.
    r.press('pause');
    expect(r.app.state).toBe('paused');
  });

  it('a world entered without a session falls back to the menu with nothing half-built', async () => {
    const r = rig();
    await boot(r);
    await r.scenes.goTo(sceneFactory(PERF_WORLD_SCENE_ID)).catch(() => undefined);
    expect(r.fallbacks()).toBe(1);
    expect(r.scenes.current?.name).toBe('menu');
    expect(r.uiLayer.querySelector('[data-role="perf-hud"]')).toBeNull();
  });
});
