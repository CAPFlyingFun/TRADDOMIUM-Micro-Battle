/**
 * THE ANTENNAE CONTROL: the one thing on screen that sends a sweep, and
 * the one line that says why it will not.
 *
 * THE WORD IS OURS. The button reads ANTENNAE because an ant reads the
 * world through the pair on its head — touch and scent, a sweep of them
 * at a time — and that is the most literal name this game could give the
 * sense. Generic conventions may be modelled on other games (CLAUDE.md,
 * 2026-09-07: a joystick, a meter, a button cluster); a NAME never is.
 * If this ever needs a shorter word on a narrow phone, shorten it to
 * something an ant still owns.
 *
 * ─── it goes dead, and it says which ────────────────────────────────
 *
 * A sweep is not interruptible and it costs a few seconds afterwards
 * (`sense/pulse.ts` owns both facts), so for most of a ping's life the
 * button cannot be pressed. "An unavailable action must never look
 * functional" (CLAUDE.md) — but a control that goes grey and says
 * nothing reads as a broken button rather than as a sense recovering,
 * and on a phone the player's thumb is already on it. So the disabled
 * state always carries its reason on the line above: WHAT IS LIT while
 * the sweep is up, and HOW LONG until the next one while it is not.
 *
 * The seconds round UP, never down. A line that reads `0 s` beside a
 * button that still refuses is the one way this could lie, and it would
 * lie for a whole second every single ping.
 *
 * ─── plain values, not the pulse ────────────────────────────────────
 *
 * `src/ui/` may not import `src/sense/` — a screen takes a typed hook
 * object and never the module whose state it shows (ARCHITECTURE §3), so
 * `AntennaeReadout` is four plain values declared here and the scene
 * fills them from `SensePulse` and the selection. It follows that this
 * file knows no radius, no cooldown and no colour: every number it might
 * print about the sense would be a second copy of a number that lives in
 * `sense/`, and the two would drift.
 *
 * ─── where it sits ──────────────────────────────────────────────────
 *
 * Directly above SOIL, at the same right margin, because the right thumb
 * already lives there and screen space near the thumbs is the scarcest
 * resource there is (CLAUDE.md, "controls belong to the thumbs"). The
 * arithmetic that keeps the two apart is in `styles.css` beside the
 * rules that do it.
 */

/** What the button can ask of the world. Nothing else reaches the sense from here. */
export interface AntennaeHooks {
  /**
   * Send a sweep. False means the antennae refused it — one is already
   * running, or they are still recovering. The control shows the refusal
   * and never retries: a press that silently does nothing is the same
   * bug as a button that looks alive while it is dead.
   */
  onPing(): boolean;
}

/** What the scene tells the control each frame. Four plain values, all derived, none stored. */
export interface AntennaeReadout {
  /** Whether a ping would be accepted right now. */
  readonly ready: boolean;
  /** Whether anything is lit at all — the sweep, the hold or the fade. */
  readonly lit: boolean;
  /** SIMULATION seconds until another ping is taken; 0 when one already would be. */
  readonly readyIn: number;
  /** How many things are lit right now. */
  readonly sighted: number;
}

/** What the line says while the antennae are ready and nothing is lit. */
const READY_TEXT = 'Ready to sweep';

/**
 * The line, from the readout alone.
 *
 * There is deliberately NO special case for a sweep that has found
 * nothing. A sweep that is one frame old has legitimately reached
 * nothing yet, so `nothing in reach` would be a false statement for the
 * first eighth of a second of every ping; `0 lit` is true at every
 * instant of one, which is the whole of what this line is for.
 */
function lineFor(readout: AntennaeReadout): string {
  if (readout.lit) return `Sensing · ${count(readout.sighted)} lit`;
  if (readout.ready) return READY_TEXT;
  return `Recovering · ${seconds(readout.readyIn)} s`;
}

function count(sighted: number): number {
  return Number.isFinite(sighted) && sighted > 0 ? Math.round(sighted) : 0;
}

/**
 * Whole seconds, ROUNDED UP and never below one. Up, because the button
 * is still refusing for the part-second the rounding would throw away;
 * never below one, because a readout that reaches zero a frame before
 * the sense comes back would otherwise print `0 s` beside a dead button.
 */
function seconds(readyIn: number): number {
  const left = Number.isFinite(readyIn) && readyIn > 0 ? readyIn : 0;
  return Math.max(1, Math.ceil(left));
}

/** The sweep's control: one button, one line, and no state of its own beyond what it has drawn. */
export class Antennae {
  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly line = document.createElement('p');

  /** What is on screen right now, so a frame that changes nothing writes nothing. */
  private enabled = true;
  private text = READY_TEXT;

  constructor(host: HTMLElement, private readonly hooks: AntennaeHooks) {
    this.root.className = 'antennae';
    this.button.type = 'button';
    this.button.dataset.action = 'antennae';
    this.button.textContent = 'ANTENNAE';
    this.button.setAttribute('aria-label', 'Sweep the antennae to sense what is nearby');
    this.button.setAttribute('aria-disabled', 'false');
    this.button.addEventListener('click', () => this.press());
    this.line.className = 'antennae-line';
    this.line.setAttribute('role', 'status');
    this.line.dataset.field = 'antennae';
    this.line.textContent = this.text;
    this.root.append(this.line, this.button);
    // A thumb on the button belongs to the button, and an arrow key on it
    // to the button too: neither is the camera's, which is listening on
    // the window behind this control.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'])
      this.root.addEventListener(type, event => event.stopPropagation());
    this.root.addEventListener('keydown', event => event.stopPropagation());
    host.append(this.root);
  }

  private press(): void {
    // Guarded rather than trusted to the disabled attribute: a probe
    // dispatches a click event straight at the element, and a refused
    // ping must be refused there too.
    if (!this.enabled) return;
    // Both answers mean the same thing about the button. `true` says a
    // sweep has just started, `false` that one was already running — in
    // neither case would a second press be taken, and the readout that
    // says so is a frame away. Going dead here is a fact, not optimism.
    this.hooks.onPing();
    this.setEnabled(false);
  }

  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.button.disabled = !enabled;
    // The two must never disagree: a screen reader is told by one and a
    // pointer by the other, and they are describing the same button.
    this.button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }

  /** Called every frame, so it writes only what has actually changed. */
  update(readout: AntennaeReadout): void {
    this.setEnabled(readout.ready);
    const text = lineFor(readout);
    if (this.text === text) return;
    this.text = text;
    this.line.textContent = text;
  }

  dispose(): void { this.root.remove(); }
}
