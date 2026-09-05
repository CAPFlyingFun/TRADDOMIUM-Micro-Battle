/**
 * THE PRACTICE BOT'S PANEL: where it is, what it is pressing, and how
 * long it is staying.
 *
 * Joshua's brief on 2026-09-04 was two things at once — "have the AI
 * player draw what it's doing on the screen as well (controls) so I can
 * see location and buttons". So this is a LOCATION readout and a CONTROL
 * DIAGRAM, side by side, in the bottom-left corner the perf HUD and the
 * PAUSE button both leave empty.
 *
 * THE DIAGRAM IS DERIVED FROM THE INTENT THAT WAS SENT, never from a
 * copy of the script. A cell lights because `intent.forward` is positive
 * this frame, full stop — so if the diagram says AHEAD and the capsule
 * is not moving ahead, the bug is between the intent and the wire, which
 * is exactly the thing worth being able to see. A diagram driven off the
 * route's leg names would light up beautifully whether or not a single
 * pose ever left the machine.
 *
 * `input/Intent.ts` is imported for that reason: it is the one movement
 * shape (a value type and two constants, no state), and reading it here
 * is what keeps the drawing and the sending from being two opinions.
 *
 * WHY THE CELLS CARRY `data-cell` AND `data-lit`. The same reason every
 * control carries `data-action` (`app/actions.ts`): a probe must be able
 * to assert that the bot pressed AHEAD at some point in its loop without
 * a selector tied to this layout. `scripts/probe-bot.mjs` reads exactly
 * those two attributes.
 *
 * It says what it is, on screen, in words: a scripted test player is not
 * a person, and a panel about one must not let anybody wonder (the
 * honesty rule, CLAUDE.md).
 *
 * Refreshed at the perf HUD's own rate off RAW dt, for the same two
 * reasons: a readout that changes sixty times a second cannot be read,
 * and the DOM write is frame time spent inside the scene that measures
 * frame time.
 *
 * Talks to its owner through a typed hook and reads one plain struct; it
 * imports nothing of `net/` — the link reaches it as one of the same
 * plain words the perf HUD prints. DOM only, so jsdom can test it.
 */
import { ACTION, actionButton } from '../app/actions';
import type { Intent } from '../input/Intent';
import { HUD_HZ, linkWords, type SessionLink } from './PerfHud';

/** Below this a request is not a press: the diagram must not flicker on float dust. */
const DEADZONE = 1e-3;

const GOLD = '#c9a94a';
const PARCHMENT = '#e8e2c8';
/** The lit cell's fill. The same gold the HUD's headings use, dimmed enough to read the glyph on it. */
const LIT = 'rgba(201, 169, 74, 0.85)';
const UNLIT = 'rgba(232, 226, 200, 0.10)';

/** One cell of the diagram. The ids are what a probe asks for. */
export type ControlId = 'turn-left' | 'ahead' | 'turn-right' | 'strafe-left' | 'sprint' | 'strafe-right' | 'back';

/** The glyph in each cell, and where it sits in the three-by-three. Read left to right, top to bottom. */
const CELLS: readonly (readonly [ControlId | null, string])[] = [
  ['turn-left', '↺'],
  ['ahead', '▲'],
  ['turn-right', '↻'],
  ['strafe-left', '◄'],
  ['sprint', '»'],
  ['strafe-right', '►'],
  [null, ''],
  ['back', '▼'],
  [null, ''],
];

/**
 * Which cells this intent is pressing. Pure, and exported because it is
 * the whole meaning of the diagram: a test can pin "half ahead lights
 * AHEAD and nothing else" without building a DOM.
 */
export function pressedControls(intent: Intent): readonly ControlId[] {
  const on: ControlId[] = [];
  if (intent.turn < -DEADZONE) on.push('turn-left');
  if (intent.forward > DEADZONE) on.push('ahead');
  if (intent.turn > DEADZONE) on.push('turn-right');
  if (intent.strafe < -DEADZONE) on.push('strafe-left');
  if (intent.sprint) on.push('sprint');
  if (intent.strafe > DEADZONE) on.push('strafe-right');
  if (intent.forward < -DEADZONE) on.push('back');
  return on;
}

/** What the panel is told. Every field measured by whoever owns the bot; nothing is worked out here. */
export interface BotReadout {
  readonly name: string;
  readonly link: SessionLink;
  /** The intent that went out this frame. */
  readonly intent: Intent;
  /** World coordinates, or null before the authority has named a spawn. */
  readonly at: { readonly wx: number; readonly wz: number } | null;
  /** Radians, actor convention: 0 faces +wz and a positive turn is clockwise from above. */
  readonly heading: number;
  readonly secondsLeft: number;
  readonly roundTripMs?: number;
  readonly refusedClaims: number;
  /** True once its time is up: the panel offers to send it back in rather than sitting there stale. */
  readonly gone: boolean;
}

export interface BotHudHooks {
  /** SEND IT BACK IN. Absent means the owner cannot restart it, and no button is built. */
  onRestart?(): void;
}

/** The panel's heading. Upper case because every HUD heading in this world is. */
const HEADING = 'PRACTICE BOT';

/** What the panel says it is. On screen, not only in this file. */
export const BOT_HUD_NOTE = 'A scripted test player, not a person.';

/** `m:ss`, floored, because a countdown that rounds up finishes a second after it said it would. */
export function countdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Degrees, 0..359, from the actor's heading convention. */
export function facingDegrees(heading: number): number {
  const deg = Math.round((heading * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

export class BotHud {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly linkLine: HTMLElement;
  private readonly whereLine: HTMLElement;
  private readonly restart: HTMLButtonElement | null;
  private readonly cells = new Map<ControlId, HTMLElement>();
  /** Infinity so the first update() paints without waiting a refresh period. */
  private sinceRefresh = Infinity;

  constructor(uiLayer: HTMLElement, hooks: BotHudHooks = {}) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = 'bot-hud';
    this.root.style.cssText =
      // CENTRED ALONG THE BOTTOM, NOT IN THE CORNER (Joshua, 2026-09-05:
      // "move that AI bot info in the middle center not blocking the
      // bottom left to be able to move around").
      //
      // The bottom-left corner is where the thumb lives: the free-fly
      // camera's touch control is twin-zone and a drag that STARTS on the
      // left half is what moves you, so a panel sitting there eats the
      // movement gesture on a phone. "Controls belong to the thumbs"
      // (CLAUDE.md) — a readout has no claim on that space.
      //
      // Still the safe area below, the way the rest of the project does
      // it (`ui/styles.css`, `splash.css`), for the home indicator.
      'position:absolute;left:50%;transform:translateX(-50%);' +
      'bottom:max(10px,env(safe-area-inset-bottom));' +
      // AND IT LETS TOUCHES THROUGH. Moving the panel out of the corner
      // is only half of it: `index.html` gives every direct child of #ui
      // `pointer-events:auto`, so this panel was SWALLOWING the drag that
      // starts a move, not merely sitting in front of it. A readout is
      // something to look at, never something to touch — so the panel is
      // transparent to the finger and only the restart button below opts
      // back in. It could sit anywhere now; centred is where Joshua asked
      // for it.
      'pointer-events:none;' +
      'display:flex;align-items:flex-start;gap:14px;' +
      `padding:8px 10px;background:rgba(6,9,12,0.72);color:${PARCHMENT};` +
      `font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid ${GOLD};border-radius:6px;`;

    const readouts = doc.createElement('div');
    this.root.appendChild(readouts);

    this.title = doc.createElement('div');
    this.title.dataset.field = 'bot-title';
    this.title.style.cssText = `color:${GOLD};letter-spacing:0.06em;margin-bottom:2px;white-space:nowrap;`;
    readouts.appendChild(this.title);

    this.linkLine = doc.createElement('div');
    this.linkLine.dataset.field = 'bot-link';
    this.linkLine.style.whiteSpace = 'nowrap';
    readouts.appendChild(this.linkLine);

    this.whereLine = doc.createElement('div');
    this.whereLine.dataset.field = 'bot-where';
    this.whereLine.style.whiteSpace = 'nowrap';
    readouts.appendChild(this.whereLine);

    const note = doc.createElement('div');
    note.dataset.field = 'bot-note';
    note.textContent = BOT_HUD_NOTE;
    note.style.cssText = 'opacity:0.65;white-space:nowrap;margin-top:2px;';
    readouts.appendChild(note);

    if (hooks.onRestart === undefined) {
      this.restart = null;
    } else {
      const onRestart = hooks.onRestart;
      this.restart = actionButton(ACTION.restartBot, 'Send it back in', () => onRestart());
      this.restart.style.cssText =
        // The one thing here that IS to be touched, so the one thing that
        // opts back into receiving a touch.
        `pointer-events:auto;margin-top:6px;padding:6px 10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;` +
        `color:${PARCHMENT};background:#1a2014;border:1px solid ${GOLD};border-radius:4px;`;
      this.restart.hidden = true;
      readouts.appendChild(this.restart);
    }

    this.root.appendChild(this.buildDiagram(doc));
    uiLayer.appendChild(this.root);
  }

  /** Call every frame with the WALL-CLOCK dt; the DOM is touched only HUD_HZ times a second. */
  update(readout: BotReadout, rawDt: number): void {
    this.sinceRefresh += rawDt;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.sinceRefresh = 0;
    if (this.root.hidden) return;
    this.render(readout);
  }

  dispose(): void {
    this.root.remove();
    this.cells.clear();
  }

  private buildDiagram(doc: Document): HTMLElement {
    const grid = doc.createElement('div');
    grid.dataset.role = 'bot-controls';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,22px);gap:3px;';
    for (const [id, glyph] of CELLS) {
      const cell = doc.createElement('div');
      cell.style.cssText =
        'width:22px;height:22px;display:flex;align-items:center;justify-content:center;' +
        `border-radius:3px;font-size:13px;line-height:1;background:${id === null ? 'transparent' : UNLIT};`;
      if (id !== null) {
        cell.dataset.cell = id;
        cell.dataset.lit = 'false';
        cell.textContent = glyph;
        this.cells.set(id, cell);
      }
      grid.appendChild(cell);
    }
    return grid;
  }

  private render(readout: BotReadout): void {
    // "PRACTICE BOT · Practice Bot" is a stutter, and it is the ordinary
    // case: the heading and the name it goes by on the wire are the same
    // words. The name is worth printing only when it is NOT.
    const named = readout.name.trim().toUpperCase() === HEADING ? HEADING : `${HEADING} · ${readout.name}`;
    this.title.textContent = readout.gone ? named : `${named}   ${countdown(readout.secondsLeft)} left`;

    const link: string[] = [readout.gone ? 'Its five minutes are up' : linkWords(readout.link)];
    if (readout.roundTripMs !== undefined && !readout.gone) link.push(`claim→ack ${Math.round(readout.roundTripMs)} ms`);
    if (readout.refusedClaims > 0) link.push(`${readout.refusedClaims} refused`);
    this.linkLine.textContent = link.join(' · ');

    const at = readout.at;
    this.whereLine.textContent =
      at === null
        ? 'waiting for the authority to say where it starts'
        : `wx ${at.wx.toFixed(1)}  wz ${at.wz.toFixed(1)}   facing ${facingDegrees(readout.heading)}°`;

    // A bot that has left is pressing nothing, and the diagram must say so
    // rather than freezing on whatever it was doing when the clock ran out.
    const on = new Set(readout.gone ? [] : pressedControls(readout.intent));
    for (const [id, cell] of this.cells) {
      const lit = on.has(id);
      cell.dataset.lit = String(lit);
      cell.style.background = lit ? LIT : UNLIT;
      cell.style.color = lit ? '#0d1013' : PARCHMENT;
    }

    if (this.restart !== null) this.restart.hidden = !readout.gone;
  }
}
