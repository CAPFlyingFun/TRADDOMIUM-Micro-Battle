// @vitest-environment jsdom
/**
 * THE ANTENNAE BUTTON (`src/ui/Antennae.ts`): the one control that sends
 * a sweep, on a phone held in landscape with one thumb on it.
 *
 * Four rules are pinned here, and every one of them is a way the control
 * could quietly lie to the player.
 *
 * A PRESS THAT IS NOT TAKEN IS NOT REPORTED. The sweep is not
 * interruptible, so most presses arrive while the antennae are busy; the
 * button must refuse them itself rather than hand the sense a ping it
 * will drop.
 *
 * DEAD IS DEAD, AND SAYS SO BOTH WAYS. `disabled` is what a thumb meets
 * and `aria-disabled` is what a screen reader is told, and a button that
 * sets one without the other is functional to exactly one of them.
 *
 * THE LINE CARRIES THE REASON, and never rounds the refusal away. `0 s`
 * beside a button that still will not fire is the one lie the seconds
 * could tell, and it would tell it for a whole second every ping.
 *
 * A FRAME THAT CHANGES NOTHING WRITES NOTHING. `update` runs at sixty
 * hertz behind a live world; a `textContent` write replaces a text node
 * whether or not the string differs, so the guard is checked with a
 * MutationObserver rather than taken on trust.
 */
import { describe, expect, it, vi } from 'vitest';
import { Antennae, type AntennaeReadout } from '../src/ui/Antennae';

const ready = (over: Partial<AntennaeReadout> = {}): AntennaeReadout =>
  ({ ready: true, lit: false, readyIn: 0, sighted: 0, ...over });

/** Mid-sweep: something is lit, and another ping is a good ten seconds off. */
const sensing = (sighted: number, readyIn = 14): AntennaeReadout =>
  ({ ready: false, lit: true, readyIn, sighted });

/** The tail of a ping: nothing lit any more, and the antennae still recovering. */
const recovering = (readyIn: number): AntennaeReadout =>
  ({ ready: false, lit: false, readyIn, sighted: 0 });

function rig(onPing: () => boolean = () => true) {
  const host = document.createElement('div');
  document.body.append(host);
  const ping = vi.fn(onPing);
  const ui = new Antennae(host, { onPing: ping });
  const button = host.querySelector<HTMLButtonElement>('[data-action="antennae"]')!;
  const line = host.querySelector<HTMLElement>('[data-field="antennae"]')!;
  return {
    ui, host, ping, button, line,
    text: () => line.textContent ?? '',
    /** What a probe or a thumb does: an ordinary click at the element. */
    press: () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    done: () => { ui.dispose(); host.remove(); },
  };
}

describe('the antennae control', () => {
  it('is our word for our animal, and a probe can find it', () => {
    const r = rig();
    expect(r.button.textContent).toBe('ANTENNAE');
    expect(r.button.getAttribute('aria-label')).toBeTruthy();
    expect(r.line.getAttribute('role')).toBe('status');
    r.done();
  });

  it('sends a sweep when it is pressed', () => {
    const r = rig();
    r.press();
    expect(r.ping).toHaveBeenCalledOnce();
    r.done();
  });

  it('does not send one while the sense is busy, however the press arrives', () => {
    const r = rig();
    r.ui.update(sensing(6));
    r.press();
    // Not merely because a disabled button swallows a thumb: the handler
    // itself refuses, so a dispatched event cannot get past it either.
    expect(r.ping).not.toHaveBeenCalled();

    r.ui.update(recovering(3));
    r.press();
    expect(r.ping).not.toHaveBeenCalled();

    r.ui.update(ready());
    r.press();
    expect(r.ping).toHaveBeenCalledOnce();
    r.done();
  });

  it('goes dead the moment a sweep is away, before the next frame can say so', () => {
    const r = rig();
    r.press();
    expect(r.button.disabled).toBe(true);
    expect(r.button.getAttribute('aria-disabled')).toBe('true');
    // A second thumb on the same button is not a second ping.
    r.press();
    expect(r.ping).toHaveBeenCalledOnce();
    r.done();
  });

  it('is disabled, and says it is disabled, exactly when the sense is not ready', () => {
    const r = rig();
    const both = () => [r.button.disabled, r.button.getAttribute('aria-disabled')];
    expect(both()).toEqual([false, 'false']);
    for (const readout of [sensing(3), recovering(2), ready(), recovering(4), ready()]) {
      r.ui.update(readout);
      expect(both()).toEqual(readout.ready ? [false, 'false'] : [true, 'true']);
    }
    r.done();
  });

  it('names what is lit while it is lit', () => {
    const r = rig();
    r.ui.update(sensing(12));
    expect(r.text()).toContain('12');
    r.ui.update(sensing(1));
    expect(r.text()).toContain('1');
    // A sweep one frame old has honestly reached nothing yet, so the
    // count is printed rather than talked around.
    r.ui.update(sensing(0));
    expect(r.text()).toContain('0');
    r.done();
  });

  it('counts the seconds down while recovering, and never reads 0 s while it is still refusing', () => {
    const r = rig();
    r.ui.update(recovering(3.4));
    expect(r.text()).toContain('4 s');
    r.ui.update(recovering(1.05));
    expect(r.text()).toContain('2 s');
    // The last part-second of the cooldown, and a readout that has already
    // reached zero while the button is still dead: neither may print 0 s.
    for (const left of [0.4, 0.01, 0, -1, Number.NaN]) {
      r.ui.update(recovering(left));
      expect(r.text()).toContain('1 s');
      expect(r.text()).not.toContain('0 s');
      expect(r.button.disabled).toBe(true);
    }
    r.done();
  });

  it('says nothing about seconds once the sweep is available again', () => {
    const r = rig();
    r.ui.update(recovering(2));
    r.ui.update(ready());
    // Nothing to count: no number of any kind is on the line.
    expect(r.text()).not.toMatch(/\d/);
    expect(r.button.disabled).toBe(false);
    r.done();
  });

  it('writes no DOM at all on a frame that changes nothing', () => {
    const r = rig();
    const seen = new MutationObserver(() => {});
    seen.observe(r.host, { subtree: true, childList: true, attributes: true, characterData: true });

    r.ui.update(sensing(7));
    expect(seen.takeRecords().length).toBeGreaterThan(0);
    // Sixty of these a second arrive behind a live world.
    for (let i = 0; i < 8; i += 1) r.ui.update(sensing(7));
    expect(seen.takeRecords()).toEqual([]);

    // And the same on the far side of a change, so the guard is not just
    // a first-write special case.
    r.ui.update(ready());
    seen.takeRecords();
    r.ui.update(ready());
    expect(seen.takeRecords()).toEqual([]);

    seen.disconnect();
    r.done();
  });

  it('takes itself off the screen', () => {
    const r = rig();
    expect(r.host.children.length).toBe(1);
    r.ui.dispose();
    expect(r.host.children.length).toBe(0);
    expect(r.host.querySelector('[data-action="antennae"]')).toBeNull();
    r.host.remove();
  });
});
