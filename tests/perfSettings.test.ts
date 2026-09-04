// @vitest-environment jsdom
/**
 * The settings the Performance World honours, and how they reach it: the
 * camera's look tuning and field of view, the HUD's visibility, and the
 * hook that is read at enter() and again on every app-state change (the
 * pause menu is where a player changes settings, and coming back from it
 * is a state change).
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/app/AppState';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { Input, type InputSnapshot } from '../src/input/Input';
import { FreeFlyCamera } from '../src/perf/FreeFlyCamera';
import { createPerformanceWorldScene, type PerfWorldSettings } from '../src/perf/PerformanceWorldScene';

const SIXTY = 1 / 60;

function drag(dx: number, dy: number): InputSnapshot {
  return { keys: new Set(), pointer: { down: true, buttons: 1, x: 100, y: 100, dx, dy }, touches: [], wheel: 0 };
}

describe('FreeFlyCamera look tuning and field of view', () => {
  it('scales the turn by sensitivity and flips pitch with invertY', () => {
    const plain = new FreeFlyCamera();
    plain.update(drag(10, 10), SIXTY);
    const twice = new FreeFlyCamera();
    twice.setLook({ sensitivity: 2, invertY: false });
    twice.update(drag(10, 10), SIXTY);
    expect(twice.camera.rotation.y).toBeCloseTo(plain.camera.rotation.y * 2, 10);
    expect(twice.camera.rotation.x).toBeCloseTo(plain.camera.rotation.x * 2, 10);

    const flipped = new FreeFlyCamera();
    flipped.setLook({ sensitivity: 1, invertY: true });
    flipped.update(drag(10, 10), SIXTY);
    expect(flipped.camera.rotation.y).toBeCloseTo(plain.camera.rotation.y, 10);
    expect(flipped.camera.rotation.x).toBeCloseTo(-plain.camera.rotation.x, 10);
  });

  it('ignores a non-finite or non-positive sensitivity but still takes the flag', () => {
    const cam = new FreeFlyCamera();
    cam.setLook({ sensitivity: 3, invertY: false });
    cam.setLook({ sensitivity: NaN, invertY: true });
    const reference = new FreeFlyCamera();
    reference.setLook({ sensitivity: 3, invertY: true });
    cam.update(drag(4, 6), SIXTY);
    reference.update(drag(4, 6), SIXTY);
    expect(cam.camera.rotation.x).toBeCloseTo(reference.camera.rotation.x, 10);
    expect(cam.camera.rotation.y).toBeCloseTo(reference.camera.rotation.y, 10);
  });

  it('sets the field of view within (0, 180) and ignores anything else', () => {
    const cam = new FreeFlyCamera();
    cam.setFov(95);
    expect(cam.camera.fov).toBe(95);
    for (const bad of [0, -10, 180, 400, NaN, Infinity]) cam.setFov(bad);
    expect(cam.camera.fov).toBe(95);
  });
});

function rig(initial: AppState, settings: () => PerfWorldSettings) {
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
  const ctx = { uiLayer, input: new Input(), app } as unknown as SceneContext;
  let reads = 0;
  const scene = createPerformanceWorldScene({
    onPause: () => {},
    settings: () => {
      reads += 1;
      return settings();
    },
  })(ctx);
  const hud = (): HTMLElement | null => uiLayer.querySelector<HTMLElement>('[data-role="perf-hud"]');
  return { scene, app, uiLayer, hud, reads: () => reads };
}

describe('PerformanceWorldScene settings hook', () => {
  it('applies fov and HUD visibility at enter() and re-reads only when the app state changes', async () => {
    let current: PerfWorldSettings = { fov: 90, lookSensitivity: 1, invertY: false, showFps: true };
    const r = rig('loading', () => current);
    await r.scene.enter();
    expect(r.app.state).toBe('playing');
    expect(r.reads()).toBe(1);
    const camera = r.scene.camera as THREE.PerspectiveCamera;
    expect(camera.fov).toBe(90);
    expect(r.hud()?.hidden).toBe(false);

    // Frames in a steady state do not parse the document again.
    for (let i = 0; i < 10; i += 1) r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(r.reads()).toBe(1);

    // The player opened the pause menu, changed settings, and came back.
    current = { fov: 75, lookSensitivity: 2, invertY: true, showFps: false };
    r.app.requestState('paused');
    r.scene.update({ rawDt: SIXTY, simDt: 0, elapsed: 0 });
    r.app.requestState('playing');
    r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(r.reads()).toBe(3);
    expect(camera.fov).toBe(75);
    expect(r.hud()?.hidden).toBe(true);
  });

  it('runs on its defaults when no settings hook is wired', async () => {
    const uiLayer = document.createElement('div');
    const app: AppHandle = {
      state: 'loading',
      requestState: () => {},
      session: null,
      startSession: () => {},
      endSession: async () => {},
    };
    const ctx = { uiLayer, input: new Input(), app } as unknown as SceneContext;
    const scene = createPerformanceWorldScene({ onPause: () => {} })(ctx);
    await scene.enter();
    expect((scene.camera as THREE.PerspectiveCamera).fov).toBe(60);
    expect(uiLayer.querySelector<HTMLElement>('[data-role="perf-hud"]')?.hidden).toBe(false);
  });
});
