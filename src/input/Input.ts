/**
 * Raw device input, gathered between frames and read once per frame.
 *
 * Keyboard state, one pointer drag (mouse or pen), the first two touches,
 * and the wheel. It knows nothing about what any of it MEANS — the
 * `Intent` shape that gameplay reads is produced from this (and from
 * autonomy/) in a later phase. Imports only DOM types.
 *
 * Deltas (`dx`, `dy`, `wheel`) accumulate from events and are cleared by
 * `endFrame()`, which `App` calls after the scene has read them, so a
 * scene sees everything that happened since the previous frame.
 */

export interface PointerState {
  readonly down: boolean;
  /** Bitmask as in PointerEvent.buttons (1 primary, 2 secondary, 4 middle). */
  readonly buttons: number;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

export interface TouchPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

export interface InputSnapshot {
  readonly keys: ReadonlySet<string>;
  readonly pointer: PointerState;
  /** The first two active touches, in the order they began. */
  readonly touches: readonly TouchPoint[];
  /** Accumulated wheel deltaY this frame, in pixels. */
  readonly wheel: number;
}

export type KeyHandler = (code: string, event: KeyboardEvent) => void;
export type PointerHandler = (event: PointerEvent) => void;

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

const MAX_TOUCHES = 2;

export class Input {
  private element: HTMLElement | null = null;
  private readonly keys = new Set<string>();
  private pointer: Mutable<PointerState> = { down: false, buttons: 0, x: 0, y: 0, dx: 0, dy: 0 };
  private readonly touches = new Map<number, Mutable<TouchPoint>>();
  private wheel = 0;
  /** Scene-registered handlers; cleared by the SceneManager between scenes. */
  private readonly keyDownHandlers = new Set<KeyHandler>();
  private readonly pointerDownHandlers = new Set<PointerHandler>();
  private readonly detachers: Array<() => void> = [];

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      const listener = fn as EventListener;
      target.addEventListener(type, listener, options);
      this.detachers.push(() => target.removeEventListener(type, listener, options));
    };
    // Keys on the window: the canvas never holds focus on a phone or after a click.
    on(window, 'keydown', this.handleKeyDown);
    on(window, 'keyup', this.handleKeyUp);
    on(window, 'blur', this.handleBlur);
    on(element, 'pointerdown', this.handlePointerDown);
    on(element, 'pointermove', this.handlePointerMove);
    on(element, 'pointerup', this.handlePointerEnd);
    on(element, 'pointercancel', this.handlePointerEnd);
    on(element, 'wheel', this.handleWheel, { passive: true });
    on(element, 'contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    for (const off of this.detachers) off();
    this.detachers.length = 0;
    this.element = null;
    this.keys.clear();
    this.touches.clear();
    this.pointer = { down: false, buttons: 0, x: 0, y: 0, dx: 0, dy: 0 };
    this.wheel = 0;
  }

  snapshot(): InputSnapshot {
    return {
      keys: this.keys,
      pointer: { ...this.pointer },
      touches: [...this.touches.values()].slice(0, MAX_TOUCHES).map((t) => ({ ...t })),
      wheel: this.wheel,
    };
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Clear per-frame deltas. Called by App after the scene has read them. */
  endFrame(): void {
    this.pointer.dx = 0;
    this.pointer.dy = 0;
    for (const t of this.touches.values()) {
      t.dx = 0;
      t.dy = 0;
    }
    this.wheel = 0;
  }

  onKeyDown(handler: KeyHandler): () => void {
    this.keyDownHandlers.add(handler);
    return () => {
      this.keyDownHandlers.delete(handler);
    };
  }

  onPointerDown(handler: PointerHandler): () => void {
    this.pointerDownHandlers.add(handler);
    return () => {
      this.pointerDownHandlers.delete(handler);
    };
  }

  /** Scene hygiene: a departing scene's handlers must not fire in the next one. */
  clearHandlers(): void {
    this.keyDownHandlers.clear();
    this.pointerDownHandlers.clear();
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    for (const cb of this.keyDownHandlers) cb(e.code, e);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** Losing the window loses key-up events; treat every key as released. */
  private readonly handleBlur = (): void => {
    this.keys.clear();
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (this.touches.size < MAX_TOUCHES) {
        this.touches.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
      }
    } else {
      this.pointer.down = true;
      this.pointer.buttons = e.buttons;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      // Keep receiving moves after the pointer leaves the element mid-drag.
      this.element?.setPointerCapture?.(e.pointerId);
    }
    for (const cb of this.pointerDownHandlers) cb(e);
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.dx += e.clientX - t.x;
      t.dy += e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      return;
    }
    if (this.pointer.down) {
      this.pointer.dx += e.clientX - this.pointer.x;
      this.pointer.dy += e.clientY - this.pointer.y;
    }
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.buttons = e.buttons;
  };

  private readonly handlePointerEnd = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      return;
    }
    this.pointer.down = false;
    this.pointer.buttons = 0;
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    this.wheel += e.deltaY;
  };
}
