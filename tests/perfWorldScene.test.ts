// @vitest-environment jsdom
/**
 * The Performance World as a Scene: what enter() builds and reports, what
 * update() feeds where, that the camera is an instrument rather than a
 * simulated thing, and the save points — a restored camera on enter, a
 * save through the session when the pause overlay opens, and the save
 * point handed to the owner for QUIT. three's scene graph and helpers
 * build without WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../src/app/AppState';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { Input } from '../src/input/Input';
import { DEFAULT_SPEED } from '../src/perf/FreeFlyCamera';
import { createPerformanceWorldScene, type PerformanceWorldHooks } from '../src/perf/PerformanceWorldScene';
import { PERF_WORLD_SCENE_ID } from '../src/perf/perfTool';
import type { GameSession, SessionSaveState } from '../src/session/GameSession';
import { world } from '../src/world/coords';

const SIXTY = 1 / 60;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** A session whose save() is a spy: the scene never learns which kind it holds. */
function spySession(): GameSession & { readonly save: ReturnType<typeof vi.fn> } {
  return {
    mode: 'solo',
    mapId: 'perf-empty',
    canPauseWorld: true,
    authority: 'local',
    caption: 'Play alone on this device.',
    save: vi.fn(async () => {}),
    leave: async () => {},
  };
}

interface RigOptions {
  readonly session?: GameSession | null;
  readonly resume?: () => SessionSaveState | null;
}

function rig(initial: AppState, options: RigOptions = {}) {
  const states: AppState[] = [initial];
  const app: AppHandle = {
    get state() {
      return states[states.length - 1];
    },
    requestState: (next) => {
      states.push(next);
    },
    session: options.session ?? null,
    startSession: () => {},
    endSession: async () => {},
  };
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const input = new Input();
  // The scene reads `uiLayer`, `input` and `app` only. The rest of the
  // context is deliberately absent, so a scene that starts reaching for the
  // renderer, storage or assets fails loudly here instead of quietly
  // coupling to them.
  const ctx = { uiLayer, input, app } as unknown as SceneContext;

  const fractions: number[] = [];
  let pauses = 0;
  let savePoint: (() => Promise<void>) | null = null;
  const hooks: PerformanceWorldHooks = {
    // What the shell does with PAUSE: the overlay opens and requests `paused`.
    onPause: () => {
      pauses += 1;
      app.requestState('paused');
    },
    onLoadProgress: (fraction) => {
      fractions.push(fraction);
    },
    resume: options.resume,
    onSavePoint: (save) => {
      savePoint = save;
    },
  };
  const scene = createPerformanceWorldScene(hooks)(ctx);
  const field = (name: string): string =>
    must(uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`), `field ${name}`).textContent ?? '';
  const frame = (simDt = SIXTY): void => scene.update({ rawDt: SIXTY, simDt, elapsed: 0 });
  return { scene, states, app, uiLayer, input, fractions, pauses: () => pauses, savePoint: () => savePoint, field, frame };
}

/** The world's START pose, as the scene places it. */
const START = { x: 0, y: 25, z: 80, yaw: 0, pitch: -0.22 };

describe('PerformanceWorldScene', () => {
  it('enters quickly, reports rising milestone progress ending at 1, and moves loading → playing', async () => {
    const { scene, states, fractions } = rig('loading');
    expect(scene.name).toBe(PERF_WORLD_SCENE_ID);
    await scene.enter();
    expect(fractions.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < fractions.length; i += 1) expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(states).toEqual(['loading', 'playing']);
  });

  it('opened from the menu as a dev tool, it leaves the app state to the hub', async () => {
    const { scene, states } = rig('menu');
    await scene.enter();
    expect(states).toEqual(['menu']);
  });

  it('builds a lit ground grid under a horizon sky, a HUD, and a PAUSE button that asks its owner', async () => {
    const { scene, uiLayer, pauses } = rig('loading');
    await scene.enter();
    expect(scene.three.children.some((o) => o instanceof THREE.GridHelper)).toBe(true);
    expect(scene.three.children.some((o) => o instanceof THREE.DirectionalLight)).toBe(true);
    expect(scene.three.background).toBeInstanceOf(THREE.Color);
    expect(scene.three.fog).not.toBeNull();
    expect(uiLayer.querySelector('[data-role="perf-hud"]')).not.toBeNull();
    const pause = must(uiLayer.querySelector<HTMLButtonElement>('[data-action="pause"]'), 'pause button');
    expect(pause.textContent).toBe('Pause');
    pause.click();
    expect(pauses()).toBe(1);
  });

  it('feeds raw dt to the FRAME readout and sim dt to the SIM readout, as two different numbers', async () => {
    const { scene, field } = rig('loading');
    await scene.enter();
    for (let i = 0; i < 119; i += 1) scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: i * SIXTY });
    // The v0 stall: raw 2.0 s, sim clamped to 0.1 s. The 2 s frame also
    // trips the HUD's refresh, so the readout is current after this call.
    scene.update({ rawDt: 2.0, simDt: 0.1, elapsed: 2 });
    expect(field('low-fps')).toBe('95th low 0.5 fps');
    expect(field('sim-dt')).toBe('100.0 ms');
    // Paused: sim dt 0, raw still ticking. Enough frames for one refresh.
    for (let i = 0; i < 13; i += 1) scene.update({ rawDt: SIXTY, simDt: 0, elapsed: 2 });
    expect(field('sim-dt')).toBe('paused');
    expect(field('low-fps')).toBe('95th low 0.5 fps');
  });

  it('flies the camera by raw dt even while the simulation is paused', async () => {
    const { scene, input } = rig('loading');
    const host = document.createElement('div');
    input.attach(host);
    await scene.enter();
    const start = scene.camera.position.clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    scene.update({ rawDt: 1, simDt: 0, elapsed: 0 });
    // One second of wall-clock at the default speed, along the view.
    expect(start.distanceTo(scene.camera.position)).toBeCloseTo(DEFAULT_SPEED, 6);
    expect(scene.camera.position.z).toBeLessThan(start.z);
    input.detach();
  });

  it('resizes its camera and disposes everything it added', async () => {
    const { scene, uiLayer } = rig('loading');
    await scene.enter();
    scene.resize(932, 430);
    expect((scene.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(932 / 430, 9);
    expect(uiLayer.children.length).toBe(2);
    scene.dispose();
    expect(scene.three.children.length).toBe(0);
    expect(uiLayer.children.length).toBe(0);
  });
});

describe('PerformanceWorldScene save points', () => {
  const saved: SessionSaveState = { camera: { at: world(1_200, -340), height: 55, yaw: 0.7, pitch: -0.3 } };

  it('starts at START when there is nothing to resume, whether the hook is absent or answers null', async () => {
    for (const options of [{}, { resume: () => null }]) {
      const { scene } = rig('loading', options);
      await scene.enter();
      const p = scene.camera.position;
      expect([p.x, p.y, p.z]).toEqual([START.x, START.y, START.z]);
      expect(scene.camera.rotation.y).toBe(START.yaw);
      expect(scene.camera.rotation.x).toBeCloseTo(START.pitch, 9);
    }
  });

  it('applies a restored camera: the saved WorldPoint, height, yaw and pitch, converted at the render boundary', async () => {
    const { scene } = rig('loading', { resume: () => saved });
    await scene.enter();
    const p = scene.camera.position;
    // The floating origin sits at 0 in this world, so local equals world here — and this is the one place that conversion happens.
    expect([p.x, p.y, p.z]).toEqual([1_200, 55, -340]);
    expect(scene.camera.rotation.y).toBeCloseTo(0.7, 9);
    expect(scene.camera.rotation.x).toBeCloseTo(-0.3, 9);
  });

  it('saves the camera through the session once when the pause overlay opens, and not again until it opens again', async () => {
    const session = spySession();
    const { scene, uiLayer, app, frame } = rig('loading', { session });
    await scene.enter();
    frame();
    expect(session.save).not.toHaveBeenCalled();

    must(uiLayer.querySelector<HTMLButtonElement>('[data-action="pause"]'), 'pause button').click();
    expect(app.state).toBe('paused');
    // The overlay opened between frames; the next frame notices and saves — once.
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.save).toHaveBeenCalledWith({
      camera: { at: world(START.x, START.z), height: START.y, yaw: START.yaw, pitch: START.pitch },
    });
    for (let i = 0; i < 5; i += 1) frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);

    app.requestState('playing');
    frame();
    expect(session.save).toHaveBeenCalledTimes(1);
    // Escape opens the same overlay without touching this scene's button: the state is what is watched.
    app.requestState('paused');
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(2);
  });

  it('hands its save point to the owner, and that writes the pose the player last saw — after flying while paused', async () => {
    const session = spySession();
    const { scene, app, input, savePoint, frame } = rig('loading', { session });
    const host = document.createElement('div');
    input.attach(host);
    await scene.enter();
    expect(savePoint()).not.toBeNull();

    app.requestState('paused');
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);
    // The instrument keeps flying under the pause menu; QUIT must not lose that.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    scene.update({ rawDt: 1, simDt: 0, elapsed: 0 });
    const p = scene.camera.position.clone();
    expect(p.distanceTo(new THREE.Vector3(START.x, START.y, START.z))).toBeCloseTo(DEFAULT_SPEED, 6);

    await must(savePoint(), 'save point')();
    expect(session.save).toHaveBeenCalledTimes(2);
    expect(session.save).toHaveBeenLastCalledWith({
      camera: { at: world(p.x, p.z), height: p.y, yaw: START.yaw, pitch: expect.closeTo(START.pitch, 9) },
    });
    input.detach();
  });

  it('with no session there is nothing to save through, and a pause is not an error', async () => {
    const { scene, app, frame, savePoint } = rig('loading', { session: null });
    await scene.enter();
    app.requestState('paused');
    expect(() => frame(0)).not.toThrow();
    await expect(must(savePoint(), 'save point')()).resolves.toBeUndefined();
  });
});
