/**
 * Direct control input — one ant, one stick.
 *
 * Keyboard (WASD / arrows) for desktop, a touch joystick on the left
 * half of the screen for mobile landscape. Output is a single move
 * vector in screen space (x right, y forward), magnitude 0..1; the
 * scene turns it into a camera-relative heading.
 */

export interface MoveInput {
  x: number;
  y: number;
}

export class DirectControl {
  private readonly keys = new Set<string>();
  private touchId: number | null = null;
  private touchOrigin = { x: 0, y: 0 };
  private touchVector = { x: 0, y: 0 };
  private readonly stick: HTMLDivElement;
  private readonly nub: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  /** Drag distance, in px, at which the stick reads full deflection. */
  private static readonly STICK_RANGE = 48;

  constructor(host: HTMLElement) {
    this.stick = document.createElement('div');
    this.nub = document.createElement('div');
    this.styleStick();
    host.appendChild(this.stick);
    this.stick.appendChild(this.nub);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());

    this.listen(host, 'touchstart', (e: TouchEvent) => this.onTouchStart(e), { passive: false });
    this.listen(host, 'touchmove', (e: TouchEvent) => this.onTouchMove(e), { passive: false });
    this.listen(host, 'touchend', (e: TouchEvent) => this.onTouchEnd(e));
    this.listen(host, 'touchcancel', (e: TouchEvent) => this.onTouchEnd(e));
  }

  read(): MoveInput {
    if (this.touchId !== null) return { ...this.touchVector };
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.stick.remove();
  }

  private onTouchStart(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      // Left half of the screen is the movement stick.
      if (this.touchId === null && t.clientX < window.innerWidth / 2) {
        this.touchId = t.identifier;
        this.touchOrigin = { x: t.clientX, y: t.clientY };
        this.touchVector = { x: 0, y: 0 };
        this.showStick(t.clientX, t.clientY);
        e.preventDefault();
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      const dx = t.clientX - this.touchOrigin.x;
      const dy = t.clientY - this.touchOrigin.y;
      const len = Math.hypot(dx, dy);
      const scale = len > 0 ? Math.min(1, len / DirectControl.STICK_RANGE) / (len || 1) : 0;
      // Screen up is forward, so y flips.
      this.touchVector = { x: dx * scale, y: -dy * scale };
      this.moveNub(dx, dy);
      e.preventDefault();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      this.touchId = null;
      this.touchVector = { x: 0, y: 0 };
      this.stick.style.display = 'none';
    }
  }

  private listen<K extends string>(
    target: EventTarget,
    type: K,
    handler: (e: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.detach.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private styleStick(): void {
    Object.assign(this.stick.style, {
      position: 'fixed',
      width: '112px',
      height: '112px',
      marginLeft: '-56px',
      marginTop: '-56px',
      borderRadius: '50%',
      border: '2px solid rgba(255, 210, 110, 0.5)',
      background: 'rgba(20, 16, 8, 0.25)',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    Object.assign(this.nub.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '44px',
      height: '44px',
      marginLeft: '-22px',
      marginTop: '-22px',
      borderRadius: '50%',
      background: 'rgba(255, 210, 110, 0.65)',
    } satisfies Partial<CSSStyleDeclaration>);
  }

  private showStick(x: number, y: number): void {
    this.stick.style.left = `${x}px`;
    this.stick.style.top = `${y}px`;
    this.stick.style.display = 'block';
    this.moveNub(0, 0);
  }

  private moveNub(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const cap = DirectControl.STICK_RANGE;
    const f = len > cap ? cap / len : 1;
    this.nub.style.transform = `translate(${dx * f}px, ${dy * f}px)`;
  }
}
