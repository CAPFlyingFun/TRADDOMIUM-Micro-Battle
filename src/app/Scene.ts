/**
 * The one contract every navigable thing implements — menu, settings,
 * loader, world, dev hub, every dev tool — and the flat, explicit bag of
 * shared services a scene is built from. A scene cannot be constructed
 * without `SceneContext`, which is what stops a scene from reaching for
 * a singleton behind the composition root's back.
 */
import type * as THREE from 'three';
import type { GameSession } from '../session/GameSession';
import type { Input } from '../input/Input';
import type { Assets } from '../assets/assets';
import type { StorageRoot } from '../persistence/StorageRoot';
import type { AppState } from './AppState';
import type { Renderer } from './Renderer';
import type { SceneManager } from './SceneManager';

export interface FrameInfo {
  /** Unclamped wall-clock seconds since last frame — for measurement only. */
  readonly rawDt: number;
  /** Clamped simulation seconds, 0 while the world is paused — for integration. */
  readonly simDt: number;
  /** Accumulated simulation seconds. */
  readonly elapsed: number;
}

export interface AppScene {
  readonly name: string;
  readonly three: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Heavy loading belongs here, behind the loading screen. */
  enter(): Promise<void>;
  update(frame: FrameInfo): void;
  resize(width: number, height: number): void;
  dispose(): void;
  /** Anything drawn after the main render pass (a HUD pass, a second camera). */
  renderOverlays?(): void;
}

/**
 * What a scene may ask of the app. Read-only state plus a request to move
 * it; the session as an object, never its mode enum (v0 duplicated `mode`
 * between GameFlow and IslandScene and they disagreed).
 */
export interface AppHandle {
  readonly state: AppState;
  requestState(next: AppState): void;
  readonly session: GameSession | null;
  startSession(session: GameSession): void;
  /** Leaves (and so flushes) the active session, if any. */
  endSession(): Promise<void>;
}

export interface SceneContext {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly scenes: SceneManager;
  readonly assets: Assets;
  readonly storage: StorageRoot;
  readonly app: AppHandle;
  /** The DOM layer above the canvas. Cleared between scenes by the SceneManager. */
  readonly uiLayer: HTMLElement;
}

export type SceneFactory = (ctx: SceneContext) => AppScene;
