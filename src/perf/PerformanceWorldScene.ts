/**
 * The permanent benchmark scene (ARCHITECTURE §9): an empty world — a
 * large ground grid under a horizon-coloured sky — with the free-fly
 * camera and the perf HUD. Every world layer the plan adds becomes a
 * toggle here so its cost can be measured alone on a real phone; in
 * Phase 0 there is nothing to toggle and the scene measures the loop.
 *
 * Reached only through the registry as `world:perf-empty`, from the
 * loading screen via `WorldLoader.resolveWorld` or from the dev-tools hub.
 * It asks its owner for anything beyond its own state through the typed
 * hooks (§2.7): what PAUSE means is the owner's decision, not the scene's.
 */
import * as THREE from 'three';
import { ACTION, actionButton } from '../app/actions';
import type { AppState } from '../app/AppState';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { LoadProgress } from '../world/LoadProgress';
import { FrameStats } from './FrameStats';
import { FreeFlyCamera } from './FreeFlyCamera';
import { PerfHud } from './PerfHud';
import { BUILT_LAYERS, LayerToggles } from './layerToggles';
import { PERF_WORLD_SCENE_ID } from './perfTool';

/**
 * The settings this scene honours. Structural on purpose: the settings
 * document is the ui's, and perf/ may not import ui/ (§3), so whoever owns
 * the document builds this from it.
 */
export interface PerfWorldSettings {
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Multiplier on the look-drag turn rate. */
  readonly lookSensitivity: number;
  readonly invertY: boolean;
  /** Whether the perf HUD is shown at all. */
  readonly showFps: boolean;
}

export interface PerformanceWorldHooks {
  /** PAUSE was pressed. What a pause means — state, overlay, whether the world may freeze — is the owner's. */
  onPause(): void;
  /** Progress of `enter()`: a 0..1 fraction and an ETA in ms (null before there is a rate), for the loading screen. */
  onLoadProgress?(fraction: number, etaMs: number | null): void;
  /**
   * The current settings. Read once in `enter()` and again whenever the
   * app state changes — the pause menu is where a player changes them, and
   * returning from it is a state change — so no event bus is needed and
   * the document is not parsed every frame. Absent: the scene's defaults.
   */
  settings?(): PerfWorldSettings;
}

/** The sky the grid vanishes into, and the fog that makes it vanish. */
const HORIZON = '#9db6c6';
/** 2000 units across in 10-unit cells: big enough that a 40 unit/s camera takes time to reach the edge. */
const GRID_SIZE = 2000;
const GRID_DIVISIONS = 200;
const GRID_CENTRE = 0xc9a94a;
const GRID_LINE = 0x3b4a52;
/** Fog opens past the near cells and closes before the grid's edge, so the edge is never a hard line. */
const FOG_NEAR = 300;
const FOG_FAR = 1500;
/** A little above and behind the origin, looking slightly down at the centre lines. */
const START = { x: 0, y: 25, z: 80, yaw: 0, pitch: -0.22 } as const;

/**
 * Real milestones, weighted by roughly what they cost; not a timer. Small
 * today, but the loading screen shows THIS, and when terrain arrives the
 * DEM download joins the list with a weight that dwarfs these.
 */
const MILESTONES = [
  { id: 'ground', weight: 2 },
  { id: 'light', weight: 1 },
  { id: 'hud', weight: 1 },
] as const;

export function createPerformanceWorldScene(hooks: PerformanceWorldHooks): SceneFactory {
  return (ctx: SceneContext): AppScene => {
    const three = new THREE.Scene();
    three.background = new THREE.Color(HORIZON);
    three.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);

    const fly = new FreeFlyCamera();
    fly.place(START.x, START.y, START.z, START.yaw, START.pitch);
    const stats = new FrameStats();
    const toggles = new LayerToggles(BUILT_LAYERS);

    let grid: THREE.GridHelper | null = null;
    let light: THREE.DirectionalLight | null = null;
    let hud: PerfHud | null = null;
    let pauseButton: HTMLButtonElement | null = null;
    /** The app state at the last settings read; a change is the cue to read again. */
    let settingsReadAt: AppState | null = null;

    const applySettings = (): void => {
      settingsReadAt = ctx.app.state;
      const s = hooks.settings?.();
      if (!s) return;
      fly.setFov(s.fov);
      fly.setLook({ sensitivity: s.lookSensitivity, invertY: s.invertY });
      if (hud) hud.hidden = !s.showFps;
    };

    return {
      name: PERF_WORLD_SCENE_ID,
      three,
      camera: fly.camera,

      async enter() {
        const progress = new LoadProgress();
        progress.define(MILESTONES);
        const reached = (id: (typeof MILESTONES)[number]['id']): void => {
          progress.report(id, 1);
          hooks.onLoadProgress?.(progress.fraction(), progress.etaMs());
        };

        grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GRID_CENTRE, GRID_LINE);
        three.add(grid);
        reached('ground');

        // Nothing here is lit yet; the light is in place so the first lit
        // layer (terrain) is measured under the same sun as everything after it.
        light = new THREE.DirectionalLight(0xfff4e0, 1.2);
        light.position.set(200, 400, 100);
        three.add(light);
        reached('light');

        hud = new PerfHud(ctx.uiLayer, {
          layers: () => toggles.list(),
          onLayerToggle: (id, enabled) => {
            toggles.setEnabled(id, enabled);
          },
        });
        pauseButton = actionButton(ACTION.pause, 'Pause', () => hooks.onPause());
        pauseButton.style.cssText =
          'position:absolute;right:12px;top:8px;padding:10px 18px;font:14px system-ui,sans-serif;' +
          'color:#e8e2c8;background:#1a2014;border:1px solid #c9a94a;border-radius:6px;';
        ctx.uiLayer.appendChild(pauseButton);
        reached('hud');

        // loading → playing is requested here because only the world knows
        // when it is ready. Guarded: the state machine allows `playing` only
        // after `loading`, and opened as a dev tool from the hub the app is in
        // `menu`, where the hub owns what happens next.
        if (ctx.app.state === 'loading') ctx.app.requestState('playing');
        applySettings();
      },

      update(frame: FrameInfo) {
        if (ctx.app.state !== settingsReadAt) applySettings();
        stats.record(frame.rawDt, frame.simDt);
        // The camera moves by RAW dt: it is not simulation, it is the
        // instrument the player measures the simulation with. Fed sim dt it
        // would freeze on pause — exactly when you want to fly around and
        // look — and would lag the hand during a stall, because the sim cap
        // would swallow most of the stall's time.
        fly.update(ctx.input.snapshot(), frame.rawDt);
        hud?.update({ frame: stats.summary(), camera: fly.readout() }, frame.rawDt);
      },

      resize(width, height) {
        fly.resize(width, height);
      },

      dispose() {
        if (grid) {
          three.remove(grid);
          grid.dispose();
          grid = null;
        }
        if (light) {
          three.remove(light);
          light.dispose();
          light = null;
        }
        hud?.dispose();
        hud = null;
        pauseButton?.remove();
        pauseButton = null;
      },
    };
  };
}
