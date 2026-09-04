// @vitest-environment jsdom
/**
 * ARCHITECTURE §12's flow, driven end to end through the REAL scene
 * registrations, the real SceneManager, the real AppState machine and a
 * memory store — everything but the renderer and the animation frame:
 *
 *   menu → NEW GAME → picker → SOLO → slot → session → loading → playing
 *        → PAUSE → paused (world may freeze) → RESUME → playing
 *        → PAUSE → QUIT → menu, session ended and saved
 *        → RESUME → the same world, the camera where it was left
 *
 * plus the three save slots as the player meets them: a new game in an
 * empty slot starts fresh, an occupied one asks before it is replaced,
 * and the games in the other slots are untouched by either.
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
import { soloSlotKey } from '../src/session/SoloSlots';
import { MULTIPLAYER_CAPTION } from '../src/session/RemoteMultiplayerSession';
import { ROOMS_CAPTION, ROOMS_SCOPE_NOTE, pauseWords } from '../src/ui';

// No terrain: this file is about menus, saves and the pause state, and
// a 2 MB download's retry backoff would be waited out on every scene
// transition to prove something about a button.
registerScenes({ survey: null });

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

    r.press('new-game');
    expect(r.app.state).toBe('session');
    r.press('solo');
    // Choosing how to play is not choosing a game: the slot list comes next.
    expect(r.app.state).toBe('session');
    r.press('slot:1');
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
    r.press('new-game');
    r.press('solo');
    r.press('slot:1');
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

  it('after QUIT the menu offers RESUME, which reopens the saved game at the saved pose', async () => {
    const r = rig();
    await boot(r);
    // A fresh device: nothing to resume, and the slots say so.
    expect(r.uiLayer.querySelector('[data-action="resume"]')).toBeNull();
    r.press('new-game');
    r.press('solo');
    expect([...r.uiLayer.querySelectorAll('.ui-slots .ui-button__sub')].map((e) => e.textContent))
      .toEqual(['Empty', 'Empty', 'Empty']);
    r.press('slot:1');
    await r.settle();
    r.frame();
    // Fly somewhere the START pose is not, then save through PAUSE and QUIT.
    const cam = r.scenes.current?.camera;
    if (!cam) throw new Error('the world has no camera');
    cam.position.set(123, 45, -678);
    r.press('pause');
    r.press('quit');
    await r.settle();

    expect(r.scenes.current?.name).toBe('menu');
    const resume = r.uiLayer.querySelector<HTMLButtonElement>('[data-action="resume"]');
    expect(resume).not.toBeNull();
    expect(resume?.disabled).toBe(false);
    expect(resume?.textContent).toContain('Last played just now');
    const save = JSON.parse(r.kv.get(SOLO_SAVE_SPEC.key) ?? 'null') as { camera: { at: { wx: number; wz: number } } };
    expect(save.camera.at).toEqual({ wx: 123, wz: -678 });
    // One game, so RESUME opens it rather than asking which.
    r.press('resume');
    expect(r.app.state).toBe('loading');
    await r.settle();
    expect(r.scenes.current?.name).toBe(PERF_WORLD_SCENE_ID);
    expect(r.app.state).toBe('playing');
    expect(r.app.session?.mode).toBe('solo');
    const resumed = r.scenes.current?.camera;
    expect(resumed?.position.x).toBeCloseTo(123);
    expect(resumed?.position.y).toBeCloseTo(45);
    expect(resumed?.position.z).toBeCloseTo(-678);
  });

  it('Escape toggles the pause menu from the keyboard', async () => {
    const r = rig();
    await boot(r);
    r.press('new-game');
    r.press('solo');
    r.press('slot:1');
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

  it('multiplayer asks for a room, enters the world, and its pause menu says the world keeps running', async () => {
    const r = rig();
    // A UNIT TEST MAY NOT OPEN A SOCKET. This build has the deployed relay
    // baked in (vite.config.ts), so joining a room builds a real
    // WebSocketTransport; a fake constructor here keeps the test to the
    // SCREENS it is about and Joshua's relay out of `npm test`. It never
    // opens, so the world's link sits at "connecting" — which is exactly
    // what a phone out of signal would show, and changes nothing on the
    // path under test.
    const realSocket = Reflect.get(globalThis, 'WebSocket') as unknown;
    Reflect.set(globalThis, 'WebSocket', class FakeSocket {
      onopen: unknown = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      onclose: unknown = null;
      send(): void {}
      close(): void {}
    });
    try {
      await boot(r);
      r.press('new-game');
      // This build HAS a relay, so the card describes the rooms it can
      // open. The no-relay line would be a lie on this screen.
      expect(r.uiLayer.textContent).toContain(ROOMS_CAPTION);
      expect(r.uiLayer.textContent).toContain(ROOMS_SCOPE_NOTE);
      expect(r.uiLayer.textContent).not.toContain(MULTIPLAYER_CAPTION);
      // MULTIPLAYER asks which room first; the code offered is ready to
      // join, so JOIN needs no typing. No slot is asked for and none is
      // written: a multiplayer game keeps nothing here.
      r.press('multiplayer');
      r.press('join-room');
      await r.settle();
      expect(r.scenes.current?.name).toBe(PERF_WORLD_SCENE_ID);
      expect(r.app.session?.canPauseWorld).toBe(false);
      r.press('pause');
      expect(r.app.state).toBe('paused');
      expect(r.veil()?.textContent).toContain(pauseWords(false));
      for (let i = 0; i < 20; i += 1) r.frame();
      expect(r.uiLayer.querySelector('[data-field="sim-dt"]')?.textContent).not.toBe('paused');
      // The wire is the world's, not the menu's: a session that holds one
      // gets the SESSION column, and it says what the link is doing rather
      // than what multiplayer will be one day.
      expect(r.uiLayer.querySelector('[data-field="session"]')?.textContent).toBe('Connecting…');
    } finally {
      Reflect.set(globalThis, 'WebSocket', realSocket);
    }
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

  it('three slots: a second game goes in its own slot, and RESUME then asks which', async () => {
    const r = rig();
    await boot(r);
    // First game, slot 1, flown somewhere recognisable.
    r.press('new-game');
    r.press('solo');
    r.press('slot:1');
    await r.settle();
    r.frame();
    r.scenes.current?.camera.position.set(111, 20, -111);
    r.press('pause');
    r.press('quit');
    await r.settle();

    // Second game, slot 2. Slot 1 is offered as a game, slot 2 as empty.
    r.press('new-game');
    r.press('solo');
    expect([...r.uiLayer.querySelectorAll('.ui-slots .ui-button__sub')].map((e) => e.textContent))
      .toEqual(['Last played just now', 'Empty', 'Empty']);
    r.press('slot:2');
    await r.settle();
    r.frame();
    // A NEW game: it did not inherit slot 1's camera.
    expect(r.scenes.current?.camera.position.x).not.toBeCloseTo(111);
    r.scenes.current?.camera.position.set(222, 20, -222);
    r.press('pause');
    r.press('quit');
    await r.settle();

    // Two games on the device, in two documents, neither overwritten.
    const slot1 = JSON.parse(r.kv.get(soloSlotKey(1)) ?? 'null') as { camera: { at: { wx: number } } };
    const slot2 = JSON.parse(r.kv.get(soloSlotKey(2)) ?? 'null') as { camera: { at: { wx: number } } };
    expect(slot1.camera.at.wx).toBe(111);
    expect(slot2.camera.at.wx).toBe(222);
    expect(r.kv.get(soloSlotKey(3))).toBeNull();

    // With two, RESUME opens the list instead of choosing for the player.
    r.press('resume');
    expect(r.uiLayer.querySelector<HTMLElement>('[data-role="slot-picker"]')?.dataset.purpose).toBe('resume');
    r.press('slot:1');
    await r.settle();
    r.frame();
    expect(r.scenes.current?.camera.position.x).toBeCloseTo(111);
  });

  it('a new game on an occupied slot asks first, and KEEP IT leaves the save exactly where it was', async () => {
    const r = rig();
    await boot(r);
    r.press('new-game');
    r.press('solo');
    r.press('slot:1');
    await r.settle();
    r.frame();
    r.scenes.current?.camera.position.set(333, 20, -333);
    r.press('pause');
    r.press('quit');
    await r.settle();
    const before = r.kv.get(soloSlotKey(1));

    r.press('new-game');
    r.press('solo');
    r.press('slot:1');
    // Nothing has started, and nothing has been written.
    expect(r.app.state).toBe('session');
    expect(r.uiLayer.querySelector('[data-role="slot-overwrite"]')?.textContent)
      .toContain('Slot 1 holds a game last played just now.');
    r.press('slot-keep');
    expect(r.kv.get(soloSlotKey(1))).toBe(before);
    expect(r.app.state).toBe('session');

    // Saying yes is what replaces it: the new game starts at the world's own pose.
    r.press('slot:1');
    r.press('slot-overwrite');
    await r.settle();
    r.frame();
    expect(r.scenes.current?.camera.position.x).not.toBeCloseTo(333);
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
