/**
 * The composition root and the single requestAnimationFrame loop.
 *
 * Owns every shared service (renderer, input, assets, storage, clock,
 * state machine, scene manager, the active session) and hands them to
 * scenes as one flat `SceneContext`. Nothing else constructs these.
 *
 * THE PAUSE RULE. A true pause exists only when `session.canPauseWorld`:
 * in solo the clock is paused and every ticking system stops because
 * `simDt` reads 0 — not because each system checks a flag. In multiplayer
 * the pause overlay may show, but the world keeps running underneath it
 * (`canPauseWorld` is false), because the server's clock does not stop
 * for one player's menu.
 */
import { assets } from '../assets/assets';
import { Input } from '../input/Input';
import { createStorageRoot } from '../persistence/StorageRoot';
import { localStorageKeyValueStore } from '../persistence/localStorageStore';
import type { GameSession } from '../session/GameSession';
import { AppStateMachine, type AppState } from './AppState';
import { FrameClock } from './FrameClock';
import { Renderer } from './Renderer';
import type { AppHandle, SceneContext } from './Scene';
import { SceneManager } from './SceneManager';
import { sceneFactory } from './registry';
import { registerPhase0Placeholders } from './placeholders/register';

export class App {
  readonly handle: AppHandle;
  private readonly renderer: Renderer;
  private readonly input: Input;
  private readonly clock = new FrameClock();
  private readonly state = new AppStateMachine('boot');
  private readonly scenes: SceneManager;
  private readonly ctx: SceneContext;
  private session: GameSession | null = null;
  private rafId = 0;

  constructor(host: HTMLElement, uiLayer: HTMLElement) {
    this.renderer = new Renderer(host);
    this.input = new Input();
    this.input.attach(host);

    // `this` inside the getters below would be the handle, hence the alias.
    const app = this;
    this.handle = {
      get state() {
        return app.state.get();
      },
      requestState: (next: AppState) => this.state.set(next),
      get session() {
        return app.session;
      },
      startSession: (session: GameSession) => {
        this.session = session;
      },
      endSession: async () => {
        const leaving = this.session;
        this.session = null;
        await leaving?.leave();
      },
    };
    this.scenes = new SceneManager({
      uiLayer,
      input: this.input,
      viewport: () => this.renderer.size(),
      context: () => this.ctx,
      fallback: () => sceneFactory('menu'),
      onFallback: () => {
        // A scene that could not be entered has no session worth keeping.
        void this.handle.endSession();
        this.state.set('menu');
      },
    });

    this.ctx = {
      renderer: this.renderer,
      input: this.input,
      scenes: this.scenes,
      assets,
      storage: createStorageRoot(localStorageKeyValueStore()),
      app: this.handle,
      uiLayer,
    };

    this.renderer.onResize((w, h) => this.scenes.resize(w, h));
  }

  async start(): Promise<void> {
    // Phase 0 placeholders. The integration pass replaces this one line
    // with the real menu / loading / world registrations.
    registerPhase0Placeholders();

    await this.scenes.goTo(sceneFactory('menu'));
    this.state.set('menu');
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.renderer.dispose();
  }

  private readonly frame = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const frozen = this.state.get() === 'paused' && (this.session?.canPauseWorld ?? false);
    if (frozen) this.clock.pause();
    else this.clock.resume();

    const { rawDt, simDt } = this.clock.tick(nowMs);
    const scene = this.scenes.current;
    if (scene) {
      scene.update({ rawDt, simDt, elapsed: this.clock.elapsed });
      this.renderer.render(scene.three, scene.camera);
      scene.renderOverlays?.();
    }
    // After update, so a scene reads everything that happened since last frame.
    this.input.endFrame();
  };
}
