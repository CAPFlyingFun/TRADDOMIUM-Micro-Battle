// @vitest-environment jsdom
/**
 * THE BOT'S PANEL, AND THE ONE THING IT MUST NEVER DO: light a cell the
 * bot is not pressing.
 *
 * Joshua asked for the controls on screen so he could tell what the bot
 * was doing (2026-09-04). That only helps if the diagram is derived from
 * the intent that actually went out — a diagram driven off the route's
 * script would look perfect while nothing reached the wire at all. So
 * `pressedControls` is tested against the intent, and the DOM is tested
 * against `pressedControls`.
 *
 * The other half is the route: a diagram whose cells never light is not
 * evidence of anything, so the real `patrolRoute` is driven through the
 * real `ScriptedMover` and every cell has to come on at least once in a
 * loop.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { ScriptedMover } from '../src/actor/ScriptedMover';
import { patrolRoute } from '../src/actor/routes';
import { NEUTRAL_INTENT, type Intent } from '../src/input/Intent';
import { compassBearing } from '../src/world/coords';
import {
  BOT_HUD_NOTE, BotHud, countdown, facingDegrees, pressedControls, type BotReadout, type ControlId,
} from '../src/perf/BotHud';

const intent = (over: Partial<Intent> = {}): Intent => ({ ...NEUTRAL_INTENT, ...over });

const readout = (over: Partial<BotReadout> = {}): BotReadout => ({
  name: 'Practice Bot',
  link: 'connected',
  intent: NEUTRAL_INTENT,
  at: { wx: 12.34, wz: -88.06 },
  heading: 0,
  secondsLeft: 297,
  refusedClaims: 0,
  gone: false,
  ...over,
});

function mount(hooks = {}): { layer: HTMLElement; hud: BotHud } {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  return { layer, hud: new BotHud(layer, hooks) };
}

const cell = (layer: ParentNode, id: ControlId): HTMLElement => {
  const el = layer.querySelector<HTMLElement>(`[data-cell="${id}"]`);
  if (!el) throw new Error(`no cell for ${id}`);
  return el;
};

const litCells = (layer: ParentNode): string[] =>
  [...layer.querySelectorAll<HTMLElement>('[data-cell]')]
    .filter((el) => el.dataset.lit === 'true')
    .map((el) => el.dataset.cell ?? '');

const field = (layer: ParentNode, name: string): string =>
  layer.querySelector<HTMLElement>(`[data-field="${name}"]`)?.textContent ?? '';

/** A refresh period of raw time, so `update` actually paints. */
const PAINT = 1;

describe('which cells an intent presses', () => {
  it('reads each axis on its own', () => {
    expect(pressedControls(NEUTRAL_INTENT)).toEqual([]);
    expect(pressedControls(intent({ forward: 0.5 }))).toEqual(['ahead']);
    expect(pressedControls(intent({ forward: -1 }))).toEqual(['back']);
    expect(pressedControls(intent({ strafe: 0.5 }))).toEqual(['strafe-right']);
    expect(pressedControls(intent({ strafe: -0.5 }))).toEqual(['strafe-left']);
    expect(pressedControls(intent({ turn: 0.5 }))).toEqual(['turn-right']);
    expect(pressedControls(intent({ turn: -0.5 }))).toEqual(['turn-left']);
    expect(pressedControls(intent({ sprint: true }))).toEqual(['sprint']);
  });

  it('reads several at once, and treats float dust as no press', () => {
    // Reading order across the diagram: top row left to right, then the middle.
    expect(pressedControls(intent({ forward: 1, turn: 1, sprint: true }))).toEqual(['ahead', 'turn-right', 'sprint']);
    expect(pressedControls(intent({ forward: -1, turn: -1, strafe: -1 })))
      .toEqual(['turn-left', 'strafe-left', 'back']);
    // A dead zone, so a diagram does not flicker on the last bit of a float.
    expect(pressedControls(intent({ forward: 1e-9, strafe: -1e-9, turn: 1e-9 }))).toEqual([]);
  });

  it('the practice patrol presses every cell at least once in a loop', () => {
    // A control diagram nobody can see move is not evidence of anything.
    const route = patrolRoute(DEBUG_CAPSULE_TUNING);
    const period = route.reduce((total, leg) => total + leg.seconds, 0);
    const mover = new ScriptedMover(route);
    const seen = new Set<ControlId>();
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(period / dt); i += 1) {
      for (const id of pressedControls(mover.next(dt))) seen.add(id);
    }
    expect([...seen].sort()).toEqual(
      ['ahead', 'back', 'sprint', 'strafe-left', 'strafe-right', 'turn-left', 'turn-right'],
    );
  });
});

describe('the panel', () => {
  it('says what it is, in words, without being asked', () => {
    const { layer } = mount();
    expect(layer.textContent).toContain(BOT_HUD_NOTE);
    expect(BOT_HUD_NOTE).toMatch(/not a person/i);
  });

  it('lights exactly the cells the intent is pressing, and puts them out again', () => {
    const { layer, hud } = mount();
    hud.update(readout({ intent: intent({ forward: 1, turn: -1 }) }), PAINT);
    expect(litCells(layer).sort()).toEqual(['ahead', 'turn-left']);
    expect(cell(layer, 'ahead').dataset.lit).toBe('true');
    expect(cell(layer, 'back').dataset.lit).toBe('false');

    hud.update(readout({ intent: intent({ forward: -1 }) }), PAINT);
    expect(litCells(layer)).toEqual(['back']);
  });

  it('shows where the bot is and which way it faces', () => {
    const { layer, hud } = mount();
    hud.update(readout({ at: { wx: 12.34, wz: -88.06 }, heading: Math.PI / 2 }), PAINT);
    expect(field(layer, 'bot-where')).toBe('wx 12.3  wz -88.1   facing 90°');
  });

  it('says it is waiting rather than inventing a position it has not been given', () => {
    // Before the welcome the bot genuinely does not know where it is, and
    // printing 0, 0 would be a coordinate somebody could act on.
    const { layer, hud } = mount();
    hud.update(readout({ at: null, link: 'connecting' }), PAINT);
    expect(field(layer, 'bot-where')).toMatch(/waiting for the authority/);
    expect(field(layer, 'bot-link')).toBe('Connecting…');
  });

  it('counts down in minutes and seconds, and names the link and the round trip', () => {
    const { layer, hud } = mount();
    hud.update(readout({ secondsLeft: 277.9, roundTripMs: 42.4 }), PAINT);
    expect(field(layer, 'bot-title')).toContain('4:37');
    expect(field(layer, 'bot-link')).toBe('Connected · claim→ack 42 ms');
  });

  it('counts refusals, because a claim the authority would not allow is otherwise invisible', () => {
    const { layer, hud } = mount();
    hud.update(readout({ refusedClaims: 3 }), PAINT);
    expect(field(layer, 'bot-link')).toContain('3 refused');
  });

  it('when its time is up it says so, presses nothing, and offers to send it back in', () => {
    const onRestart = vi.fn();
    const { layer, hud } = mount({ onRestart });
    const send = layer.querySelector<HTMLButtonElement>('[data-action="restart-bot"]');
    if (!send) throw new Error('no restart control');

    hud.update(readout({ intent: intent({ forward: 1 }) }), PAINT);
    expect(send.hidden).toBe(true);

    hud.update(readout({ gone: true, intent: intent({ forward: 1 }), secondsLeft: 0 }), PAINT);
    expect(field(layer, 'bot-link')).toBe('Its five minutes are up');
    // Frozen mid-stride would read as a bot still walking.
    expect(litCells(layer)).toEqual([]);
    expect(send.hidden).toBe(false);

    send.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('builds no restart control when the owner cannot restart it', () => {
    const { layer } = mount();
    expect(layer.querySelector('[data-action="restart-bot"]')).toBeNull();
  });

  it('writes the DOM at the HUD rate, not every frame', () => {
    const { layer, hud } = mount();
    hud.update(readout({ secondsLeft: 300 }), PAINT);
    expect(field(layer, 'bot-title')).toContain('5:00');
    // A sixtieth of a second later: not a refresh period, so nothing moves.
    hud.update(readout({ secondsLeft: 120 }), 1 / 60);
    expect(field(layer, 'bot-title')).toContain('5:00');
    hud.update(readout({ secondsLeft: 120 }), PAINT);
    expect(field(layer, 'bot-title')).toContain('2:00');
  });

  it('sits centred along the bottom, clear of the thumb that moves the camera', () => {
    // Joshua, 2026-09-05: "move that AI bot info in the middle center not
    // blocking the bottom left to be able to move around."
    //
    // The free-fly camera's touch control is twin-zone — a drag that
    // STARTS on the left half is what moves you — so a panel anchored in
    // the bottom-left corner eats the movement gesture on a phone.
    // "Controls belong to the thumbs" (CLAUDE.md); a readout does not get
    // to sit on one. jsdom does no layout, so this pins the ANCHORING;
    // `scripts/probe-bot.mjs` measures the real box at 932 x 430.
    const { layer } = mount();
    const panel = layer.querySelector<HTMLElement>('[data-role="bot-hud"]');
    if (!panel) throw new Error('no bot panel');
    expect(panel.style.left).toBe('50%');
    expect(panel.style.transform).toContain('translateX(-50%)');
    // Not pinned to either corner.
    expect(panel.style.right).toBe('');
    expect(panel.style.bottom).toContain('safe-area-inset-bottom');
  });

  it('lets a finger through: it is something to look at, not something to touch', () => {
    // THE HALF THAT MOVING IT DOES NOT FIX. index.html gives every direct
    // child of #ui `pointer-events:auto`, so this panel was SWALLOWING the
    // drag that starts a move rather than merely sitting in front of it —
    // which is what Joshua actually hit. Only the restart button opts back
    // in, because it is the only thing here meant to be pressed.
    const onRestart = vi.fn();
    const { layer } = mount({ onRestart });
    const panel = layer.querySelector<HTMLElement>('[data-role="bot-hud"]');
    const send = layer.querySelector<HTMLElement>('[data-action="restart-bot"]');
    if (!panel || !send) throw new Error('no bot panel');
    expect(panel.style.pointerEvents).toBe('none');
    expect(send.style.pointerEvents).toBe('auto');
  });

  it('leaves nothing behind when it is disposed', () => {
    const { layer, hud } = mount();
    expect(layer.querySelector('[data-role="bot-hud"]')).not.toBeNull();
    hud.dispose();
    expect(layer.querySelector('[data-role="bot-hud"]')).toBeNull();
  });
});

describe('the small conversions', () => {
  it('floors the countdown, so it never promises a second it does not have', () => {
    expect(countdown(300)).toBe('5:00');
    expect(countdown(59.9)).toBe('0:59');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-4)).toBe('0:00');
    expect(countdown(61)).toBe('1:01');
  });

  it('turns a heading into a COMPASS BEARING a person reads, always 0..359', () => {
    // This test used to assert the identity — heading degrees printed
    // raw — and that was the bug Joshua reported from the device: a
    // mirrored compass. It agreed with a real one at east and west and
    // was a half-turn out at north and south, which is why it survived.
    //
    // `+wz is SOUTH` (world/dem.ts) and ahead is (sin h, cos h)
    // (actor/Transform.ts), so h = 0 points south.
    expect(facingDegrees(0)).toBe(180); // +wz, south
    expect(facingDegrees(Math.PI / 2)).toBe(90); // +wx, east
    expect(facingDegrees(Math.PI)).toBe(0); // -wz, north
    expect(facingDegrees(-Math.PI / 2)).toBe(270); // -wx, west
  });

  it('is the world’s one compass, not a second copy of it', () => {
    // Two panels printing the same kind of number about the same world is
    // how one of them ends up mirrored while the other is not.
    expect(facingDegrees(1.234)).toBe(compassBearing(1.234));
  });
});
