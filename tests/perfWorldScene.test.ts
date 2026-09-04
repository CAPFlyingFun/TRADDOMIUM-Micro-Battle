// @vitest-environment jsdom
/**
 * The Performance World as a Scene: what enter() builds and reports, what
 * update() feeds where, and that the camera is an instrument rather than a
 * simulated thing. three's scene graph and helpers build without WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/app/AppState';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { Input } from '../src/input/Input';
import { DEFAULT_SPEED } from '../src/perf/FreeFlyCamera';
import { createPerformanceWorldScene, type PerformanceWorldHooks } from '../src/perf/PerformanceWorldScene';
import { PERF_WORLD_SCENE_ID } from '../src/perf/perfTool';

const SIXTY = 1 / 60;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

function rig(initial: AppState) {
  const states: AppState[] = [initial];
  const app: AppHandle = {
    get state() {
      return states[states.length - 1];
    },
    requestState: (next) => {
      states.push(next);
    },
    session: null,
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
  const hooks: PerformanceWorldHooks = {
    onPause: () => {
      pauses += 1;
    },
    onLoadProgress: (fraction) => {
      fractions.push(fraction);
    },
  };
  const scene = createPerformanceWorldScene(hooks)(ctx);
  const field = (name: string): string =>
    must(uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`), `field ${name}`).textContent ?? '';
  return { scene, states, uiLayer, input, fractions, pauses: () => pauses, field };
}

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
