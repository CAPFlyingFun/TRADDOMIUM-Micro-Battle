import { describe, expect, it } from 'vitest';
import {
  AutoRun, cancelsAuto, laneAt, LANE_FROM, LANE_LOCK,
} from '../src/input/autoRun';

const RANGE = 64;
/** Push straight up, this many stick-radii from centre. */
const up = (reach: number) => laneAt(0, RANGE * reach, RANGE);

describe('the lane', () => {
  it('is not there at all for an ordinary push', () => {
    expect(up(0)).toBe('none');
    expect(up(0.6)).toBe('none');
  });

  it('does not open merely because she is at full forward', () => {
    // The rule that stops Auto engaging by accident: full forward is
    // just fast, and it happens constantly.
    expect(up(1)).toBe('none');
  });

  it('opens once the thumb pushes past the rim', () => {
    expect(up(LANE_FROM + 0.05)).toBe('arming');
  });

  it('reaches the lock only with real extra travel', () => {
    expect(up(LANE_LOCK - 0.1)).toBe('arming');
    expect(up(LANE_LOCK + 0.1)).toBe('ready');
  });

  it('ignores a hard sideways drag past the rim', () => {
    // That is a big sidestep, not a request to lock.
    expect(laneAt(RANGE * 2, 0, RANGE)).toBe('none');
    expect(laneAt(RANGE * 2, RANGE * 0.4, RANGE)).toBe('none');
  });

  it('is not opened by dragging DOWN past the rim', () => {
    expect(laneAt(0, -RANGE * 2, RANGE)).toBe('none');
  });
});

describe('arming and engaging', () => {
  it('engages only on release, and only from the lock', () => {
    const auto = new AutoRun();
    expect(auto.update('arming', false, { x: 0, y: 1 })).toBe('arming');
    expect(auto.update('ready', false, { x: 0, y: 1 })).toBe('ready');
    expect(auto.update('none', true, { x: 0, y: 0 })).toBe('active');
  });

  it('does not engage when the thumb leaves the lock first', () => {
    // The clean change of mind.
    const auto = new AutoRun();
    auto.update('ready', false, { x: 0, y: 1 });
    auto.update('arming', false, { x: 0, y: 1 });
    expect(auto.update('none', true, { x: 0, y: 0 })).toBe('off');
  });

  it('does not engage from a full-forward release', () => {
    const auto = new AutoRun();
    auto.update('none', false, { x: 0, y: 1 });
    expect(auto.update('none', true, { x: 0, y: 0 })).toBe('off');
  });
});

describe('once auto is running', () => {
  function running() {
    const auto = new AutoRun();
    auto.update('ready', false, { x: 0, y: 1 });
    auto.update('none', true, { x: 0, y: 0 });
    return auto;
  }

  it('a centred stick leaves it alone', () => {
    expect(running().update('none', false, { x: 0, y: 0 })).toBe('active');
  });

  it('sidestepping does not cancel it', () => {
    expect(running().update('none', false, { x: 1, y: 0 })).toBe('active');
    expect(running().update('none', false, { x: -1, y: 0 })).toBe('active');
  });

  it('a wobbly thumb aiming sideways does not cancel it', () => {
    // Joshua's own example of what a real thumb produces.
    expect(running().update('none', false, { x: 0.9, y: 0.08 })).toBe('active');
    expect(running().update('none', false, { x: -0.86, y: -0.21 })).toBe('active');
  });

  it('a clear forward push takes manual control back', () => {
    expect(running().update('none', false, { x: 0, y: 1 })).toBe('off');
  });

  it('a clear backward push takes manual control back', () => {
    expect(running().update('none', false, { x: 0, y: -1 })).toBe('off');
  });

  it('can be cancelled outright', () => {
    const auto = running();
    auto.cancel();
    expect(auto.state).toBe('off');
  });
});

describe('which way it carries her', () => {
  function running() {
    const auto = new AutoRun();
    auto.update('ready', false, { x: 0, y: 1 });
    auto.update('none', true, { x: 0, y: 0 });
    return auto;
  }

  it('goes ahead by default', () => {
    expect(running().way).toBe(1);
  });

  it('turns round without giving up the lock', () => {
    const auto = running();
    auto.flip();
    expect(auto.way).toBe(-1);
    expect(auto.active).toBe(true);
  });

  it('faces forward again when it is engaged afresh', () => {
    // A stale astern would send the next lock the wrong way entirely.
    const auto = running();
    auto.flip();
    auto.cancel();
    expect(running().way).toBe(1);
    auto.update('arming', false, { x: 0, y: 1 });
    expect(auto.way).toBe(1);
  });

  it('can be engaged astern outright, for the desktop key', () => {
    const auto = new AutoRun();
    auto.engage(-1);
    expect(auto.active).toBe(true);
    expect(auto.way).toBe(-1);
  });
});

describe('the cancel cone', () => {
  it('wants the fore/aft axis to actually win', () => {
    expect(cancelsAuto({ x: 0, y: 1 })).toBe(true);
    expect(cancelsAuto({ x: 0.9, y: 0.08 })).toBe(false);
    // Equal parts of both is a diagonal, not a clear demand.
    expect(cancelsAuto({ x: 0.7, y: 0.7 })).toBe(false);
  });

  it('ignores a small forward wobble', () => {
    expect(cancelsAuto({ x: 0, y: 0.2 })).toBe(false);
  });
});
