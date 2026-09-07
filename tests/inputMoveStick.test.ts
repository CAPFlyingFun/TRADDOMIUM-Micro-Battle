// @vitest-environment jsdom
/**
 * The move stick's DOM and reading: a fixed ring, a nub that follows the
 * thumb on every move, a dead zone rescaled from its edge, and pointer
 * events it takes for itself. jsdom has no PointerEvent and no pointer
 * capture, so events are MouseEvents wearing a pointerId and capture is a
 * stub on the ring — which is also how the capture calls get asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveStick, STICK_RANGE, type StickReading } from '../src/input/MoveStick';

/** Where the ring is told it sits: a 128 px box whose centre is (164, 364). */
const BOX = { left: 100, top: 300, width: 128, height: 128 };
const CENTRE = { x: BOX.left + BOX.width / 2, y: BOX.top + BOX.height / 2 };
const DEAD_ZONE = 0.12;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

interface Rig {
  readonly host: HTMLElement;
  readonly stick: MoveStick;
  readonly ring: HTMLElement;
  readonly nub: HTMLElement;
  readonly capture: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

const rigs: Rig[] = [];

function rig(): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stick = new MoveStick(host);
  const ring = must(host.querySelector<HTMLElement>('[data-control="stick"]'), 'the ring');
  const nub = must(ring.firstElementChild as HTMLElement | null, 'the nub');
  ring.getBoundingClientRect = () =>
    ({ ...BOX, right: BOX.left + BOX.width, bottom: BOX.top + BOX.height, x: BOX.left, y: BOX.top, toJSON: () => ({}) }) as DOMRect;
  const capture = vi.fn();
  const release = vi.fn();
  Object.assign(ring, { setPointerCapture: capture, releasePointerCapture: release });
  const r = { host, stick, ring, nub, capture, release };
  rigs.push(r);
  return r;
}

afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.stick.dispose();
    r.host.remove();
  }
});

/** Fire a pointer event at an offset from the ring's centre; returns whether it was swallowed. */
function fire(target: EventTarget, type: string, dx: number, dy: number, pointerId = 1): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: CENTRE.x + dx, clientY: CENTRE.y + dy });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  target.dispatchEvent(e);
  return e;
}

function expectReading(actual: StickReading, x: number, y: number, deflection: number, held: boolean): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.deflection).toBeCloseTo(deflection, 9);
  expect(actual.held).toBe(held);
}

describe('MoveStick', () => {
  it('is a fixed ring at the bottom-left, marked data-control="stick", with the nub inside and reading idle', () => {
    const { host, ring, nub, stick } = rig();
    expect(ring.dataset.control).toBe('stick');
    expect(ring.parentElement).toBe(host);
    expect(nub.parentElement).toBe(ring);
    expect(ring.style.position).toBe('fixed');
    expect(ring.style.left).toContain('safe-area-inset-left');
    expect(ring.style.bottom).toContain('safe-area-inset-bottom');
    expect(ring.style.width).toBe(`${STICK_RANGE * 2}px`);
    expect(ring.style.touchAction).toBe('none');
    expect(nub.style.width).toBe('52px');
    expect(nub.style.pointerEvents).toBe('none');
    expect(STICK_RANGE).toBe(64);
    expectReading(stick.read(), 0, 0, 0, false);
    expect(nub.style.transform).toBe('translate(0px, 0px)');
  });

  it('a push 32 px up reads y = (0.5 − 0.12) / (1 − 0.12): the dead zone is rescaled from its edge, not stepped over', () => {
    const { ring, stick } = rig();
    fire(ring, 'pointerdown', 0, 0);
    expectReading(stick.read(), 0, 0, 0, true);
    fire(ring, 'pointermove', 0, -32);
    const live = (0.5 - DEAD_ZONE) / (1 - DEAD_ZONE);
    expect(live).toBeCloseTo(0.4318, 3);
    expectReading(stick.read(), 0, live, live, true);
    // Inside the dead zone reads centred but held.
    fire(ring, 'pointermove', 0, -5);
    expectReading(stick.read(), 0, 0, 0, true);
  });

  it('100 px up clamps to a full push, and a move to the right reads x positive', () => {
    const { ring, stick } = rig();
    fire(ring, 'pointerdown', 0, 0);
    fire(ring, 'pointermove', 0, -100);
    expectReading(stick.read(), 0, 1, 1, true);
    fire(ring, 'pointermove', 64, 0);
    expectReading(stick.read(), 1, 0, 1, true);
    fire(ring, 'pointermove', 32, 0);
    const live = (0.5 - DEAD_ZONE) / (1 - DEAD_ZONE);
    expectReading(stick.read(), live, 0, live, true);
    // A diagonal past the rim is a unit vector, split evenly.
    fire(ring, 'pointermove', 90, -90);
    const r = stick.read();
    expectReading(r, Math.SQRT1_2, Math.SQRT1_2, 1, true);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(r.deflection, 9);
  });

  it('the nub follows the thumb on every pointermove, before anyone reads the stick', () => {
    const { ring, nub, stick } = rig();
    fire(ring, 'pointerdown', 0, 0);
    fire(ring, 'pointermove', 0, -32);
    // Asserted BEFORE read(): the stick must draw while moving, read or not.
    expect(nub.style.transform).toBe('translate(0px, -32px)');
    fire(ring, 'pointermove', 0, -100);
    expect(nub.style.transform).toBe('translate(0px, -64px)');
    fire(ring, 'pointermove', 32, 0);
    expect(nub.style.transform).toBe('translate(32px, 0px)');
    fire(ring, 'pointermove', -16, 16);
    expect(nub.style.transform).toBe('translate(-16px, 16px)');
    // The nub sits at the rim, not the dead-zoned reading: 32 px is 32 px.
    stick.read();
    expect(nub.style.transform).toBe('translate(-16px, 16px)');
  });

  it('pointerup returns to zero, unheld, with the nub centred; pointercancel does the same', () => {
    const { ring, nub, stick, capture, release } = rig();
    fire(ring, 'pointerdown', 0, 0, 5);
    expect(capture).toHaveBeenCalledWith(5);
    fire(ring, 'pointermove', 0, -64, 5);
    expectReading(stick.read(), 0, 1, 1, true);
    fire(ring, 'pointerup', 0, -64, 5);
    expect(release).toHaveBeenCalledWith(5);
    expectReading(stick.read(), 0, 0, 0, false);
    expect(nub.style.transform).toBe('translate(0px, 0px)');
    // A move from a pointer that no longer holds it is ignored.
    fire(ring, 'pointermove', 0, -64, 5);
    expectReading(stick.read(), 0, 0, 0, false);

    fire(ring, 'pointerdown', 0, 0, 6);
    fire(ring, 'pointermove', 40, 0, 6);
    expect(stick.read().x).toBeGreaterThan(0);
    fire(ring, 'pointercancel', 40, 0, 6);
    expectReading(stick.read(), 0, 0, 0, false);
  });

  it('a pointerdown outside GRAB_SLACK × RANGE is ignored; one just inside it, outside the ring, is taken', () => {
    const { ring, stick, capture } = rig();
    // 1.7 × 64 = 108.8 px is the grab radius.
    fire(ring, 'pointerdown', 120, 0);
    expect(capture).not.toHaveBeenCalled();
    fire(ring, 'pointermove', 0, -64);
    expectReading(stick.read(), 0, 0, 0, false);

    fire(ring, 'pointerdown', 0, 100);
    expect(capture).toHaveBeenCalledTimes(1);
    expectReading(stick.read(), 0, -1, 1, true);
  });

  it('a second pointer while one holds the stick is ignored, and cannot release it', () => {
    const { ring, stick } = rig();
    fire(ring, 'pointerdown', 0, 0, 1);
    fire(ring, 'pointermove', 0, -64, 1);
    fire(ring, 'pointerdown', 0, 0, 2);
    fire(ring, 'pointermove', 64, 0, 2);
    expectReading(stick.read(), 0, 1, 1, true);
    fire(ring, 'pointerup', 64, 0, 2);
    expectReading(stick.read(), 0, 1, 1, true);
    fire(ring, 'pointerup', 0, -64, 1);
    expectReading(stick.read(), 0, 0, 0, false);
  });

  it('swallows the pointer events it takes: nothing above the ring sees them, and their default is prevented', () => {
    const { host, ring } = rig();
    const seen: string[] = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      host.addEventListener(type, () => seen.push(type));
    }
    expect(fire(ring, 'pointerdown', 0, 0).defaultPrevented).toBe(true);
    expect(fire(ring, 'pointermove', 0, -32).defaultPrevented).toBe(true);
    expect(fire(ring, 'pointerup', 0, -32).defaultPrevented).toBe(true);
    expect(seen).toEqual([]);

    // What it does NOT take, it does not swallow: a tap outside the grab
    // radius, and a move from a pointer it is not holding, pass through.
    expect(fire(ring, 'pointerdown', 120, 0).defaultPrevented).toBe(false);
    expect(fire(ring, 'pointermove', 0, -32, 9).defaultPrevented).toBe(false);
    expect(seen).toEqual(['pointerdown', 'pointermove']);
  });

  it('dispose removes the ring and stops listening', () => {
    const { host, ring, stick } = rig();
    fire(ring, 'pointerdown', 0, 0);
    fire(ring, 'pointermove', 0, -64);
    expect(stick.read().held).toBe(true);
    stick.dispose();
    expect(host.querySelector('[data-control="stick"]')).toBeNull();
    expect(ring.isConnected).toBe(false);
    expectReading(stick.read(), 0, 0, 0, false);
    // The detached element still dispatches; nothing is listening.
    fire(ring, 'pointerdown', 0, 0);
    fire(ring, 'pointermove', 0, -64);
    expectReading(stick.read(), 0, 0, 0, false);
    // Disposing twice is harmless.
    stick.dispose();
  });
});
