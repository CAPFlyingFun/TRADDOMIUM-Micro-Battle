// @vitest-environment jsdom
/**
 * The slot picker draws one row per slot with the one honest fact about
 * it, refuses to resume an empty slot, and — the whole reason it exists —
 * puts a confirmation in front of overwriting a saved game.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SLOT_KEEP_ACTION, SLOT_OVERWRITE_ACTION, SlotPicker, slotAction, type SlotPickerHooks, type SlotView,
} from '../src/ui/SlotPicker';

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();

/** One occupied slot and two empty ones — the shape a first game leaves behind. */
const ONE_GAME: readonly SlotView[] = [
  { slot: 1, savedAt: minutesAgo(3) },
  { slot: 2, savedAt: null },
  { slot: 3, savedAt: null },
];

function rig(overrides: Partial<SlotPickerHooks> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onChoose = vi.fn();
  const onBack = vi.fn();
  const picker = new SlotPicker(host, { purpose: 'new-game', slots: ONE_GAME, onChoose, onBack, ...overrides });
  return { host, picker, onChoose, onBack };
}

const byAction = (root: ParentNode, action: string): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);

const sub = (button: HTMLButtonElement | null): string | undefined =>
  button?.querySelector('.ui-button__sub')?.textContent ?? undefined;

describe('SlotPicker', () => {
  it('draws one row per slot: the saved one says when, the empty ones say Empty', () => {
    const { host } = rig();
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.ui-slots button[data-action]')];
    expect(rows.map((b) => b.dataset.action)).toEqual(['slot:1', 'slot:2', 'slot:3']);
    expect(rows[0]?.textContent).toContain('Slot 1');
    expect(sub(rows[0] ?? null)).toBe('Last played 3 minutes ago');
    expect(sub(rows[1] ?? null)).toBe('Empty');
    expect(sub(rows[2] ?? null)).toBe('Empty');
    expect(byAction(host, 'back')).not.toBeNull();
  });

  it('a new game in an EMPTY slot starts at once — there is nothing to ask about', () => {
    const { host, onChoose } = rig();
    byAction(host, slotAction(2))?.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(2);
    expect(host.querySelector('[data-role="slot-overwrite"]')).toBeNull();
  });

  it('a new game in an OCCUPIED slot asks first, names the game, and does not start until the answer is yes', () => {
    const { host, onChoose } = rig();
    byAction(host, slotAction(1))?.click();
    expect(onChoose).not.toHaveBeenCalled();

    const confirm = host.querySelector<HTMLElement>('[data-role="slot-overwrite"]');
    expect(confirm).not.toBeNull();
    expect(confirm?.dataset.slot).toBe('1');
    expect(confirm?.textContent).toContain('Slot 1 holds a game last played 3 minutes ago.');
    expect(confirm?.textContent).toContain('There is no way to get it back.');
    // The question is the only thing on screen: no rows behind it, and no
    // BACK offering a second way to say no.
    expect(host.querySelector<HTMLElement>('.ui-slots')?.hidden).toBe(true);
    expect(byAction(host, 'back')?.closest('.ui-actions')?.hasAttribute('hidden')).toBe(true);

    byAction(host, SLOT_OVERWRITE_ACTION)?.click();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(1);
  });

  it('KEEP IT answers no: the game stays, the rows come back, nothing was chosen', () => {
    const { host, onChoose } = rig();
    byAction(host, slotAction(1))?.click();
    byAction(host, SLOT_KEEP_ACTION)?.click();
    expect(onChoose).not.toHaveBeenCalled();
    expect(host.querySelector('[data-role="slot-overwrite"]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.ui-slots')?.hidden).toBe(false);
    expect(byAction(host, 'back')?.closest('.ui-actions')?.hasAttribute('hidden')).toBe(false);
    // And the slot can be chosen again, which asks again.
    byAction(host, slotAction(1))?.click();
    expect(host.querySelector('[data-role="slot-overwrite"]')).not.toBeNull();
  });

  it('resuming offers only the slots that hold a game; an empty one is disabled, not silently inert', () => {
    const { host, onChoose } = rig({ purpose: 'resume' });
    expect(host.querySelector<HTMLElement>('[data-role="slot-picker"]')?.dataset.purpose).toBe('resume');
    expect(byAction(host, slotAction(1))?.disabled).toBe(false);
    expect(byAction(host, slotAction(2))?.disabled).toBe(true);
    expect(byAction(host, slotAction(3))?.disabled).toBe(true);

    byAction(host, slotAction(1))?.click();
    expect(onChoose).toHaveBeenCalledWith(1);
    // Resuming never asks to overwrite: nothing is being replaced.
    expect(host.querySelector('[data-role="slot-overwrite"]')).toBeNull();
  });

  it('names its purpose in words, and BACK is the way out of either', () => {
    const newGame = rig();
    expect(newGame.host.textContent).toContain('Choose a slot for the new game.');
    newGame.picker.dispose();

    const resume = rig({ purpose: 'resume' });
    expect(resume.host.textContent).toContain('Choose a game to resume.');
    byAction(resume.host, 'back')?.click();
    expect(resume.onBack).toHaveBeenCalledTimes(1);

    resume.picker.dispose();
    expect(resume.host.querySelector('[data-role="slot-picker"]')).toBeNull();
  });
});
