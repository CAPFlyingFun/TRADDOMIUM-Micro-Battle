// @vitest-environment jsdom
/**
 * The three-layer sandwich: back, fill, front — in that DOM order for a
 * cut-out picture, and front, back, fill for a drawn-on one; the fill's
 * width is the value and nothing else; and the layers can be assembled
 * around a `<picture>` the document already painted.
 */
import { describe, expect, it } from 'vitest';
import { Meter } from '../src/ui/splash/Meter';

const WINDOW = { left: 0.3, right: 0.7, top: 0.75, bottom: 0.8 };

function art(): HTMLImageElement {
  const img = document.createElement('img');
  img.src = '/splash.webp';
  return img;
}

/** Which layer each child of the box is, back to front as the DOM stacks them. */
function order(root: HTMLElement): string[] {
  return [...root.children].map((el) => {
    if (el.tagName === 'IMG' || el.tagName === 'PICTURE') return 'front';
    if (el.querySelector('[data-ui="meter-fill"]')) return 'fill';
    return 'back';
  });
}

describe('Meter', () => {
  it('stacks back, fill, front for a cut-out picture', () => {
    const meter = new Meter({ frame: art(), window: WINDOW });
    expect(order(meter.root)).toEqual(['back', 'fill', 'front']);
    expect(meter.layers.map((l) => l.tagName)).toEqual(['DIV', 'DIV', 'IMG']);
    expect(meter.worn.tagName).toBe('IMG');
  });

  it('points the hidden layers at the hole, bleeding past its top and bottom', () => {
    const meter = new Meter({ frame: art(), window: WINDOW });
    const [back, clip] = meter.layers;
    const tall = WINDOW.bottom - WINDOW.top;
    const bleed = tall * Meter.BLEED;
    // Compared as numbers: jsdom normalises '30.000%' to '30%'.
    for (const el of [back, clip]) {
      expect(el.style.left).toMatch(/%$/);
      expect(parseFloat(el.style.left)).toBeCloseTo(30, 3);
      expect(parseFloat(el.style.width)).toBeCloseTo(40, 3);
      expect(parseFloat(el.style.top)).toBeCloseTo((WINDOW.top - bleed) * 100, 3);
      expect(parseFloat(el.style.height)).toBeCloseTo((tall + bleed * 2) * 100, 3);
    }
  });

  it('the fill width is the value, clamped, and garbage reads as empty', () => {
    const meter = new Meter({ frame: art(), window: WINDOW });
    const fill = meter.root.querySelector<HTMLElement>('[data-ui="meter-fill"]');
    expect(fill?.style.width).toBe('0%');
    meter.set(0.5);
    expect(fill?.style.width).toBe('50%');
    expect(meter.fraction).toBe(0.5);
    meter.set(2);
    expect(fill?.style.width).toBe('100%');
    meter.set(-1);
    expect(fill?.style.width).toBe('0%');
    meter.set(NaN);
    expect(fill?.style.width).toBe('0%');
    expect(meter.fraction).toBe(0);
  });

  it('re-stacks front, back, fill for a drawn bar, rounds it, rims it and caps it to the screen', () => {
    const meter = new Meter({ frame: art(), window: WINDOW, rim: 'gold' });
    meter.aim({ window: WINDOW, behind: true, cap: 'min(78vw, 460px)' });
    expect(order(meter.root)).toEqual(['front', 'back', 'fill']);
    expect(meter.layers.map((l) => l.tagName)).toEqual(['IMG', 'DIV', 'DIV']);
    const [, back, clip] = meter.layers;
    expect(back.style.borderRadius).toBe('999px');
    expect(back.style.boxShadow).toContain('gold');
    // No bleed: a drawn bar is its own edge.
    expect(parseFloat(back.style.top)).toBeCloseTo(75, 3);
    expect(clip.style.left).toBe('50%');
    expect(clip.style.width).toBe('min(40.000%, min(78vw, 460px))');
    // And back again when the phone turns back.
    meter.aim({ window: WINDOW });
    expect(order(meter.root)).toEqual(['back', 'fill', 'front']);
    expect(back.style.boxShadow).toBe('none');
    expect(parseFloat(back.style.borderRadius)).toBe(0);
  });

  it('assembles around a <picture> the document painted, inserting the layers beside it', () => {
    const host = document.createElement('div');
    host.innerHTML = '<picture><source media="(orientation: portrait)" srcset="/p.webp"><img src="/splash.webp"></picture>';
    const frame = host.querySelector('img');
    if (!frame) throw new Error('fixture has no img');
    const meter = new Meter({ frame, host, window: WINDOW });
    expect(meter.root).toBe(host);
    expect(order(host)).toEqual(['back', 'fill', 'front']);
    // The picture is still the image's parent: the layers went beside the <picture>, not inside it.
    expect(frame.parentElement?.tagName).toBe('PICTURE');
    meter.aim({ window: WINDOW, behind: true });
    expect(order(host)).toEqual(['front', 'back', 'fill']);
    expect(frame.parentElement?.tagName).toBe('PICTURE');
  });

  it('swaps the picture on the front without disturbing the other layers', () => {
    const meter = new Meter({ frame: art(), window: WINDOW });
    const [back, clip, first] = meter.layers;
    const next = art();
    meter.wear(next);
    expect(meter.worn).toBe(next);
    expect(first.parentElement).toBeNull();
    expect(meter.layers).toEqual([back, clip, next]);
    expect(order(meter.root)).toEqual(['back', 'fill', 'front']);
    expect(next.style.position).toBe('absolute');
  });
});
