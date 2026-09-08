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
import { CAMERA_SPEEDS, FreeFlyCamera, STICK_MIN_SPEED, stickSpeed } from '../src/perf/FreeFlyCamera';
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
    let current: PerfWorldSettings = { fov: 90, lookSensitivity: 1, invertY: false, showFps: true, hudCollapsed: false, finderOn: false, cameraSpeed: 'fast', timeOfDay: null, textures: 'medium', detail: 'medium' };
    const r = rig('loading', () => current);
    await r.scene.enter();
    expect(r.app.state).toBe('playing');
    expect(r.reads()).toBe(1);
    const camera = r.scene.camera as THREE.PerspectiveCamera;
    expect(camera.fov).toBe(90);
    expect(r.hud()?.hidden).toBe(false);
    // Unfolded: the summary row is the hidden one.
    expect(r.hud()?.querySelector<HTMLElement>('[data-field="summary"]')?.hidden).toBe(true);

    // Frames in a steady state do not parse the document again.
    for (let i = 0; i < 10; i += 1) r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(r.reads()).toBe(1);

    // The player opened the pause menu, changed settings, and came back.
    current = { fov: 75, lookSensitivity: 2, invertY: true, showFps: false, hudCollapsed: true, finderOn: false, cameraSpeed: 'fast', timeOfDay: null, textures: 'medium', detail: 'medium' };
    r.app.requestState('paused');
    r.scene.update({ rawDt: SIXTY, simDt: 0, elapsed: 0 });
    r.app.requestState('playing');
    r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(r.reads()).toBe(3);
    expect(camera.fov).toBe(75);
    expect(r.hud()?.hidden).toBe(true);
    // And folded, from the document: the summary row is the one showing.
    expect(r.hud()?.querySelector<HTMLElement>('[data-field="summary"]')?.hidden).toBe(false);
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

/**
 * THE CAMERA'S SPEED RUNG (Joshua, 2026-09-08: "make the joystick camera
 * speed adjustable so slow is 1-5m per second, medium is 1-10m per
 * second, and fast is 1-30m per second... I am moving too fast to see
 * them").
 *
 * The rung is the CEILING a full push reaches; the floor is 1 m/s at
 * every rung, which is `stickSpeed`'s own floor and is tested with it.
 */
describe('the camera speed setting', () => {
  const withSpeed = (cameraSpeed: PerfWorldSettings['cameraSpeed']): PerfWorldSettings => ({
    fov: 60, lookSensitivity: 1, invertY: false, showFps: true, hudCollapsed: false,
    finderOn: false, cameraSpeed, timeOfDay: null, textures: 'medium', detail: 'medium',
  });

  it('is the three speeds Joshua asked for, in world units a second', () => {
    // The world is centimetres, so a metre a second is 100 units.
    expect(CAMERA_SPEEDS.slow).toBe(5 * 100);
    expect(CAMERA_SPEEDS.medium).toBe(10 * 100);
    expect(CAMERA_SPEEDS.fast).toBe(30 * 100);
    // The floor never moves: every rung reads "1 to n".
    expect(STICK_MIN_SPEED).toBe(1 * 100);
    for (const top of Object.values(CAMERA_SPEEDS)) {
      expect(stickSpeed(0.0001, top)).toBeCloseTo(STICK_MIN_SPEED, 0);
      expect(stickSpeed(1, top)).toBe(top);
    }
  });

  it('flies at the rung the document names, and follows a change made in the pause menu', async () => {
    let current = withSpeed('slow');
    const r = rig('loading', () => current);
    await r.scene.enter();
    // The empty world has no terrain, so the camera is paced by `pace()`
    // through the same path the island uses.
    const speedOf = (): number => {
      const text = r.hud()?.querySelector<HTMLElement>('[data-field="camera-speed"]')?.textContent ?? '';
      return Number(/(-?[\d.]+)/.exec(text)?.[1] ?? Number.NaN);
    };
    for (let i = 0; i < 15; i += 1) r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(speedOf()).toBe(CAMERA_SPEEDS.slow);

    current = withSpeed('fast');
    r.app.requestState('paused');
    r.scene.update({ rawDt: SIXTY, simDt: 0, elapsed: 0 });
    r.app.requestState('playing');
    // The sheet repaints five times a second, so one frame is not enough
    // to read the new number off it.
    for (let i = 0; i < 15; i += 1) r.scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: 0 });
    expect(speedOf()).toBe(CAMERA_SPEEDS.fast);
  });
});
