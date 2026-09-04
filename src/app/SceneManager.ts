/**
 * The one choke point for scene transitions (ARCHITECTURE §2.5).
 *
 * `goTo()` does, in order: fade to black → dispose the old scene → hygiene
 * (input handlers cleared, DOM the old scene left in the ui layer removed)
 * → construct → `await enter()` → set current → resize → fade in.
 *
 * Two rules that the tests pin:
 *  - A second `goTo` while one is in flight is QUEUED, not dropped. The
 *    loading screen asks for the world from inside its own transition,
 *    and a dropped request there is a black screen with a spinner.
 *  - If `enter()` throws, the half-built scene is disposed and the
 *    registered fallback (the menu) is entered instead. `current` is never
 *    left null once the first scene has been reached.
 *
 * Built without importing three: scenes arrive through factories, so the
 * tests drive it with stub objects.
 */
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from './Scene';

export interface SceneManagerDeps {
  /** The DOM layer scenes draw into. The manager owns one child of it: the fader. */
  readonly uiLayer: HTMLElement;
  /** Shared singletons reset between scenes. */
  readonly input: { clearHandlers(): void };
  /** Current drawing-buffer size, applied to a scene once it is current. */
  readonly viewport: () => { width: number; height: number };
  /** Lazy, because the context contains this manager. */
  readonly context: () => SceneContext;
  /** Where to go when a scene fails to enter. */
  readonly fallback: () => SceneFactory;
  /** Told when the fallback was taken, so the app can reset its state. */
  readonly onFallback?: (error: unknown) => void;
  /** Milliseconds per fade; 0 in tests. */
  readonly fadeMs?: number;
}

export interface GoToOptions {
  readonly fade?: boolean;
}

const DEFAULT_FADE_MS = 220;

export class SceneManager {
  private active: AppScene | null = null;
  private readonly fader: HTMLElement;
  /** Sequential queue: every goTo appends to this chain. */
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;

  constructor(private readonly deps: SceneManagerDeps) {
    this.fader = deps.uiLayer.ownerDocument.createElement('div');
    this.fader.dataset.role = 'scene-fader';
    // Opaque from the start: the first scene fades IN from the boot black
    // rather than flashing an empty canvas.
    this.fader.style.cssText =
      'position:absolute;inset:0;background:#000;opacity:1;z-index:1000;' +
      `transition:opacity ${this.fadeMs}ms ease;pointer-events:auto;`;
    deps.uiLayer.appendChild(this.fader);
  }

  get current(): AppScene | null {
    return this.active;
  }

  get transitioning(): boolean {
    return this.inFlight > 0;
  }

  /** Resolves when THIS request has finished (including anything queued before it). */
  goTo(factory: SceneFactory, options: GoToOptions = {}): Promise<void> {
    this.inFlight += 1;
    const run = this.chain
      .then(() => this.swap(factory, options.fade ?? true))
      .finally(() => {
        this.inFlight -= 1;
      });
    // The chain must never break: a rejected step would stall every later request.
    this.chain = run.catch(() => undefined);
    return run;
  }

  update(frame: FrameInfo): void {
    this.active?.update(frame);
  }

  resize(width: number, height: number): void {
    this.active?.resize(width, height);
  }

  private get fadeMs(): number {
    return this.deps.fadeMs ?? DEFAULT_FADE_MS;
  }

  private async swap(factory: SceneFactory, fade: boolean): Promise<void> {
    await this.fadeOut(fade && this.active !== null);
    this.active?.dispose();
    this.active = null;
    this.hygiene();

    let next: AppScene;
    let fellBackWith: { error: unknown } | null = null;
    try {
      next = await this.build(factory);
    } catch (error) {
      console.error('[SceneManager] scene failed to enter; falling back to the menu', error);
      // The fallback is allowed to throw: there is nothing left to fall back to.
      next = await this.build(this.deps.fallback());
      fellBackWith = { error };
    }

    this.active = next;
    const { width, height } = this.deps.viewport();
    next.resize(width, height);
    // Told once the fallback scene is fully current, so the app can reset
    // its state against a scene that actually exists.
    if (fellBackWith) this.deps.onFallback?.(fellBackWith.error);
    await this.fadeIn();
  }

  /** Construct and enter; on failure dispose the half-built scene and re-clean. */
  private async build(factory: SceneFactory): Promise<AppScene> {
    let scene: AppScene | null = null;
    try {
      scene = factory(this.deps.context());
      await scene.enter();
      return scene;
    } catch (error) {
      try {
        scene?.dispose();
      } catch {
        // A scene that failed to enter may also fail to dispose; the first error is the one that matters.
      }
      this.hygiene();
      throw error;
    }
  }

  /** Clear everything shared that a departing scene might have left behind. */
  private hygiene(): void {
    this.deps.input.clearHandlers();
    for (const child of [...this.deps.uiLayer.children]) {
      if (child !== this.fader) child.remove();
    }
  }

  private fadeOut(animate: boolean): Promise<void> {
    this.fader.style.pointerEvents = 'auto';
    this.fader.style.opacity = '1';
    return animate ? wait(this.fadeMs) : Promise.resolve();
  }

  private async fadeIn(): Promise<void> {
    this.fader.style.opacity = '0';
    await wait(this.fadeMs);
    this.fader.style.pointerEvents = 'none';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
