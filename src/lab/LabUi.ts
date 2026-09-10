/**
 * THE CREATURE LAB'S HUD: the possess row, the lab's tool buttons, the
 * right thumb's held buttons and the per-creature debug overlay.
 *
 * Typed hooks only (ARCHITECTURE §2.7): the HUD reads a `LabReadout` the
 * scene composes and hands every press back as a name. It never sees
 * the simulation, the ledger or a camera, so what it shows is exactly
 * what the scene said and a test can drive it with a plain object.
 *
 * MOBILE FIRST, 932 × 430. The possess row sits top-left where a thumb
 * reaches it without leaving the stick; the tools top-right in two short
 * rows; the held buttons bottom-right where the right thumb rests
 * (CLAUDE.md: "Controls belong to the thumbs, not the screen"), and the
 * stick — `input/MoveStick.ts`, the scene's — bottom-left. The overlay
 * stands in the strip between the stick and the centre, pointer-events
 * none, so it is read through and never pressed.
 *
 * THE HELD BUTTONS ARE THE MEDIUM'S (`labTool.buttonsFor`): a worker's
 * cluster has FEED and SPRINT, a worm's SURFACE and BURROW too, a fly's
 * and the queen's UP, DOWN and LAND, an aphid's FEED, DROP and SPRINT —
 * and nobody's cluster shows while nobody is held. "An unavailable
 * action must never look functional" (§2.9): a button the body would
 * ignore is not dimmed, it is not there.
 *
 * Every control carries `data-action` and every readout `data-field`
 * (`app/actions.ts` rule), by the names in `labTool.ts`, so the probe
 * drives what a player presses. Styling is inline with the ui module's
 * `--ui-*` custom properties as first choice, as the hub's is: this
 * module may not import `ui/`, and a HUD that only looked right after
 * the menu had loaded a stylesheet would be a hidden dependency on load
 * order.
 */
import { ACTION } from '../app/actions';
import type { LabButtons } from '../control/PlayerDemand';
import type { CreatureId, CreatureSpecies, Medium } from '../creatures/species';
import type { Behaviour } from '../creatures/state';
import type { PredationPolicy } from '../creatures/world';
import {
  HUD_HZ, LAB_ACTION, LAB_BUTTON_ACTION, LAB_BUTTON_KINDS, LAB_FIELD, LAB_HUD_ROLE, POSSESS_ROW, buttonLabel, buttonsFor,
  cameraLabel, controlLabel, creatureField, onOffLabel, possessAction, predationLabel, rigModeLabel, stressLabel,
  type LabAction, type LabButtonKind, type LabCameraMode, type LabRigMode,
} from './labTool';
import type { StressPhase } from './stressTest';

// ---------------------------------------------------------------------------
// What the HUD is told
// ---------------------------------------------------------------------------

/** One creature's overlay block (the brief, §8). Plain numbers; the scene fills a reused record per creature. */
export interface CreatureLine {
  species: CreatureId;
  name: string;
  player: boolean;
  medium: Medium;
  behaviour: Behaviour;
  /** Distance to the target on the plane, mm, or null when it has none. */
  targetMm: number | null;
  hunger: number;
  fatigue: number;
  alarm: number;
  speedMmS: number;
  /** Height above the ground under it, mm: negative under the ground. */
  aglMm: number;
  /** The ground/surface word: on ground, underground, airborne, on host. */
  surface: string;
  sinceThink: number;
  thinkS: number;
  hostId: string | null;
  /** The plane position, world units, for a probe that wants to read where it is. */
  x: number;
  z: number;
  /** Where its body is drawn on the screen, CSS pixels from the top-left, or null when it is not drawn. */
  screenX: number | null;
  screenY: number | null;
  /** The worm's line: whether its burrowing edits the ground. Null for the rest. */
  edits: 'ON' | 'OFF' | null;
}

export interface LabReadout {
  /** The species the local player holds, or null in observer mode. */
  readonly held: CreatureSpecies | null;
  readonly camera: LabCameraMode;
  readonly predation: PredationPolicy;
  readonly disturbArmed: boolean;
  readonly cameraDisturbs: boolean;
  readonly debug: boolean;
  readonly fps: number;
  readonly frameMs: number;
  readonly aiMs: number;
  readonly animMs: number;
  readonly lines: readonly CreatureLine[];
  /** THE STRESS TEST (Joshua, 2026-09-10). `idle` hides its panel entirely. */
  readonly stressPhase: StressPhase;
  readonly stressCreatures: number;
  /**
   * What the panel shows: the live block while a run is going, the whole
   * copyable report when it is done. Composed by the scene — the HUD
   * shows what it is given and works nothing out (the header).
   */
  readonly stressText: string;
  readonly rigs: LabRigMode;
}

export interface LabUiHooks {
  readout(): LabReadout;
  onPossess(species: CreatureId): void;
  onAction(action: LabAction): void;
  onBack(): void;
}

// ---------------------------------------------------------------------------
// Chrome: TCS black and gold, the Performance World's sheet font
// ---------------------------------------------------------------------------

const GOLD = 'var(--ui-gold,#c9a94a)';
const PARCHMENT = 'var(--ui-ink,#e8e2c8)';
const PANEL = 'rgba(6,9,12,0.72)';
const BUTTON = 'var(--ui-button,#1a2014)';
const FONT = '11px/1.3 var(--ui-mono,ui-monospace,SFMono-Regular,Menlo,monospace)';
// 1.15, not 1.3: five blocks of five lines must fit under the possess
// panel on a 430 px phone screen (5 × 5 × 10.9 + padding + gaps ≈ 320 of
// the 330 available); at 1.3 the fly's block ran off the bottom.
const SHEET_FONT = '9.5px/1.15 var(--ui-mono,ui-monospace,SFMono-Regular,Menlo,monospace)';
/** The clamp the stick uses for the notch: the bottom corner is not obstructed, only rounded. */
const EDGE_RIGHT = 'calc(10px + min(env(safe-area-inset-right), 14px))';
const EDGE_LEFT = 'calc(10px + min(env(safe-area-inset-left), 14px))';
const FLOOR = 'calc(20px + min(env(safe-area-inset-bottom), 12px))';

const CSS = {
  root: 'position:absolute;inset:0;pointer-events:none;',
  panel:
    `position:absolute;display:flex;flex-direction:column;gap:4px;padding:6px 8px;pointer-events:auto;` +
    `background:${PANEL};color:${PARCHMENT};font:${FONT};border:1px solid ${GOLD};border-radius:6px;`,
  row: 'display:flex;flex-wrap:wrap;gap:5px;',
  button:
    `min-height:36px;padding:4px 10px;font:${FONT};color:${PARCHMENT};background:${BUTTON};` +
    `border:1px solid ${GOLD};border-radius:6px;touch-action:manipulation;white-space:nowrap;`,
  line: 'white-space:nowrap;',
  /** The overlay: read through, never pressed; between the stick and the centre. */
  overlay:
    `position:absolute;left:156px;top:92px;width:262px;max-height:calc(100% - 100px);overflow-y:auto;overscroll-behavior:contain;` +
    `display:flex;flex-direction:column;gap:4px;pointer-events:none;font:${SHEET_FONT};color:${PARCHMENT};`,
  block: `white-space:pre;padding:3px 6px;background:${PANEL};border:1px solid rgba(201,169,74,0.35);border-radius:4px;`,
  /** The right thumb's cluster: a column of pairs, 48 px targets. */
  /**
   * THE STRESS PANEL: where the creature overlay sits, but wider — a
   * thirty-line report is not a five-line block — and PRESSABLE, since
   * COPY and RUN AGAIN live in it. It is in the DOM only while a run is
   * going or its report stands, so it never covers the bench otherwise.
   */
  stress:
    `position:absolute;left:156px;top:96px;width:400px;max-width:calc(100% - 320px);max-height:calc(100% - 106px);` +
    `overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:6px;pointer-events:auto;` +
    `padding:6px 8px;background:${PANEL};color:${PARCHMENT};font:${SHEET_FONT};border:1px solid ${GOLD};border-radius:6px;`,
  report: 'margin:0;white-space:pre;user-select:text;-webkit-user-select:text;',
  cluster: `position:absolute;right:${EDGE_RIGHT};bottom:${FLOOR};display:grid;grid-template-columns:auto auto;gap:6px;pointer-events:auto;`,
  held:
    `min-width:64px;min-height:48px;padding:0 8px;font:${FONT};color:${PARCHMENT};background:${BUTTON};` +
    `border:1px solid ${GOLD};border-radius:10px;touch-action:none;user-select:none;-webkit-user-select:none;white-space:nowrap;`,
} as const;

interface ToolSpec {
  readonly action: LabAction;
  readonly field: string | null;
}

/** The tools, in two rows: the ones that change what is watched, then the ones that change the bench. */
const TOOL_ROWS: readonly (readonly ToolSpec[])[] = [
  [
    { action: LAB_ACTION.observe, field: null },
    { action: LAB_ACTION.camera, field: LAB_FIELD.camera },
    { action: LAB_ACTION.predation, field: LAB_FIELD.predation },
    { action: LAB_ACTION.reset, field: null },
  ],
  [
    { action: LAB_ACTION.disturb, field: LAB_FIELD.disturb },
    { action: LAB_ACTION.cameraDisturbs, field: LAB_FIELD.cameraDisturbs },
    { action: LAB_ACTION.debug, field: LAB_FIELD.debug },
  ],
  // The stress test's own row: the run, and the one option that changes its answer.
  [
    { action: LAB_ACTION.stress, field: LAB_FIELD.stress },
    { action: LAB_ACTION.rigs, field: LAB_FIELD.rigs },
  ],
];

interface HeldState {
  up: boolean;
  down: boolean;
  primary: boolean;
  secondary: boolean;
  sprint: boolean;
}

export class LabUi {
  private readonly root: HTMLElement;
  private readonly possess = new Map<CreatureId, HTMLButtonElement>();
  private readonly tools = new Map<LabAction, HTMLButtonElement>();
  private readonly fields = new Map<string, HTMLElement>();
  private readonly blocks = new Map<CreatureId, HTMLElement>();
  private readonly cluster: HTMLElement;
  private readonly overlay: HTMLElement;
  /** The stress test's panel, its report and the row of buttons under it (`lab/stressTest.ts`). */
  private readonly stress: HTMLElement;
  private readonly stressReport: HTMLElement;
  private readonly stressButtons: HTMLElement;
  private readonly heldButtons = new Map<LabButtonKind, HTMLButtonElement>();
  /** The right thumb's state, written by the buttons' pointer events and read by the scene every frame. */
  private readonly held: HeldState = { up: false, down: false, primary: false, secondary: false, sprint: false };
  private readonly detach: Array<() => void> = [];
  private sinceRefresh = Infinity;
  /** The medium the cluster was last laid out for, so a refresh that changes nothing touches no DOM. */
  private clusterFor: string | null = null;

  constructor(
    uiLayer: HTMLElement,
    private readonly hooks: LabUiHooks,
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = LAB_HUD_ROLE;
    this.root.style.cssText = CSS.root;

    // TOP-LEFT: the possess row and the CONTROL line.
    const left = el(doc, 'div', `${CSS.panel}top:8px;left:${EDGE_LEFT};`);
    const row = el(doc, 'div', CSS.row);
    for (const entry of POSSESS_ROW) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.action = possessAction(entry.species);
      button.textContent = entry.label;
      button.style.cssText = CSS.button;
      button.addEventListener('click', () => {
        this.hooks.onPossess(entry.species);
        this.refreshNow();
      });
      this.possess.set(entry.species, button);
      row.appendChild(button);
    }
    left.appendChild(row);
    left.appendChild(this.field(doc, LAB_FIELD.control, `${CSS.line}color:${GOLD};letter-spacing:0.06em;`));
    this.root.appendChild(left);

    // TOP-RIGHT: the tools, then the frame lines.
    const right = el(doc, 'div', `${CSS.panel}top:8px;right:${EDGE_RIGHT};align-items:flex-end;`);
    for (const specs of TOOL_ROWS) {
      const tools = el(doc, 'div', `${CSS.row}justify-content:flex-end;`);
      for (const spec of specs) tools.appendChild(this.tool(doc, spec));
      right.appendChild(tools);
    }
    const back = doc.createElement('button');
    back.type = 'button';
    back.dataset.action = ACTION.back;
    back.textContent = 'Back to hub';
    back.style.cssText = CSS.button;
    back.addEventListener('click', () => this.hooks.onBack());
    right.children[right.children.length - 1].appendChild(back);
    const perf = el(doc, 'div', `${CSS.row}justify-content:flex-end;gap:10px;opacity:0.85;`);
    for (const name of [LAB_FIELD.fps, LAB_FIELD.frameMs, LAB_FIELD.aiMs, LAB_FIELD.animMs]) perf.appendChild(this.field(doc, name, CSS.line));
    right.appendChild(perf);
    this.root.appendChild(right);

    // THE OVERLAY: one block per creature, in the possess row's order, always in the DOM.
    this.overlay = el(doc, 'div', CSS.overlay);
    this.overlay.dataset.role = 'lab-overlay';
    for (const entry of POSSESS_ROW) {
      const block = el(doc, 'div', CSS.block);
      block.dataset.field = creatureField(entry.species);
      this.blocks.set(entry.species, block);
      this.overlay.appendChild(block);
    }
    this.root.appendChild(this.overlay);

    // THE STRESS PANEL: built once, hidden while there is no run.
    this.stress = el(doc, 'div', CSS.stress);
    this.stress.dataset.role = 'lab-stress-panel';
    this.stressReport = el(doc, 'pre', CSS.report);
    this.stressReport.dataset.field = LAB_FIELD.stressReport;
    this.fields.set(LAB_FIELD.stressReport, this.stressReport);
    this.stress.appendChild(this.stressReport);
    this.stressButtons = el(doc, 'div', CSS.row);
    for (const [action, label] of [
      [LAB_ACTION.stressCopy, 'COPY'] as const,
      [LAB_ACTION.stressAgain, 'RUN AGAIN'] as const,
      [LAB_ACTION.stressReset, 'RESET'] as const,
    ]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = label;
      button.style.cssText = CSS.button;
      button.addEventListener('click', () => {
        // COPY is the HUD's own: it owns the text and the clipboard is a DOM
        // concern, so the scene is not asked to reach into an element it does
        // not own. Everything else is the scene's decision.
        if (action === LAB_ACTION.stressCopy) void this.copyReport(button);
        else this.hooks.onAction(action);
        this.refreshNow();
      });
      this.stressButtons.appendChild(button);
    }
    this.stress.appendChild(this.stressButtons);
    this.stress.hidden = true;
    this.root.appendChild(this.stress);

    // THE RIGHT THUMB: every held button built once; which show is the medium's.
    this.cluster = el(doc, 'div', CSS.cluster);
    this.cluster.dataset.role = 'lab-held';
    for (const kind of LAB_BUTTON_KINDS) this.cluster.appendChild(this.heldButton(doc, kind));
    this.cluster.hidden = true;
    this.root.appendChild(this.cluster);

    uiLayer.appendChild(this.root);
    this.refreshNow();
  }

  /** The right thumb's buttons as `control/PlayerDemand` reads them. The object is the HUD's and is rewritten in place. */
  get buttons(): LabButtons {
    return this.held;
  }

  /** Every frame with RAW dt; the DOM is written HUD_HZ times a second. */
  update(rawDt: number): void {
    this.sinceRefresh += Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.refreshNow();
  }

  refreshNow(): void {
    this.sinceRefresh = 0;
    this.render(this.hooks.readout());
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.root.remove();
    this.possess.clear();
    this.tools.clear();
    this.fields.clear();
    this.blocks.clear();
    this.heldButtons.clear();
    this.stress.remove();
    this.held.up = this.held.down = this.held.primary = this.held.secondary = this.held.sprint = false;
  }

  // -------------------------------------------------------------------------

  private field(doc: Document, name: string, css: string): HTMLElement {
    const line = el(doc, 'div', css);
    line.dataset.field = name;
    this.fields.set(name, line);
    return line;
  }

  private tool(doc: Document, spec: ToolSpec): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.action = spec.action;
    if (spec.field !== null) {
      // The button IS the readout: a probe reads `lab-predation` off the thing it presses.
      button.dataset.field = spec.field;
      this.fields.set(spec.field, button);
    }
    button.style.cssText = CSS.button;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      this.hooks.onAction(spec.action);
      this.refreshNow();
    });
    this.tools.set(spec.action, button);
    return button;
  }

  /**
   * A held button: down while the pointer is on it, up the moment it
   * lifts or is lost. Pointer capture keeps a thumb that slides off the
   * button reporting to it, so SPRINT does not drop because the thumb
   * wandered; jsdom has no capture and the guard says so.
   */
  private heldButton(doc: Document, kind: LabButtonKind): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.action = LAB_BUTTON_ACTION[kind];
    button.style.cssText = CSS.held;
    const press = (e: PointerEvent): void => {
      this.held[kind] = true;
      button.setPointerCapture?.(e.pointerId);
      button.style.background = 'var(--ui-button-down,#2a3420)';
      e.preventDefault();
    };
    const lift = (): void => {
      this.held[kind] = false;
      button.style.background = BUTTON;
    };
    this.listen(button, 'pointerdown', press);
    this.listen(button, 'pointerup', lift);
    this.listen(button, 'pointercancel', lift);
    this.listen(button, 'lostpointercapture', lift);
    this.listen(button, 'contextmenu', (e: Event) => e.preventDefault());
    this.heldButtons.set(kind, button);
    return button;
  }

  private listen(target: EventTarget, type: string, handler: (e: never) => void): void {
    target.addEventListener(type, handler as EventListener);
    this.detach.push(() => target.removeEventListener(type, handler as EventListener));
  }

  private set(name: string, text: string): void {
    const node = this.fields.get(name);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private render(r: LabReadout): void {
    // The possess row: the held one lit.
    for (const [species, button] of this.possess) {
      const on = r.held !== null && r.held.id === species;
      const pressed = on ? 'true' : 'false';
      if (button.getAttribute('aria-pressed') !== pressed) {
        button.setAttribute('aria-pressed', pressed);
        button.style.background = on ? '#c9a94a' : BUTTON;
        button.style.color = on ? '#06090c' : PARCHMENT;
      }
    }
    this.set(LAB_FIELD.control, controlLabel(r.held));

    // The tools.
    const observe = this.tools.get(LAB_ACTION.observe);
    if (observe) observe.textContent = 'OBSERVE';
    const reset = this.tools.get(LAB_ACTION.reset);
    if (reset) reset.textContent = 'RESET LAB';
    this.set(LAB_FIELD.camera, cameraLabel(r.camera));
    const camera = this.tools.get(LAB_ACTION.camera);
    if (camera) {
      // Nothing to follow while nobody is held: the toggle is not available, and says so.
      const available = r.held !== null;
      camera.disabled = !available;
      camera.style.opacity = available ? '1' : '0.45';
    }
    this.set(LAB_FIELD.predation, predationLabel(r.predation));
    this.set(LAB_FIELD.disturb, r.disturbArmed ? 'DISTURB: TAP THE BENCH' : 'DISTURB');
    const disturb = this.tools.get(LAB_ACTION.disturb);
    if (disturb) disturb.style.background = r.disturbArmed ? 'var(--ui-button-down,#2a3420)' : BUTTON;
    this.set(LAB_FIELD.cameraDisturbs, onOffLabel('CAM DISTURBS', r.cameraDisturbs));
    this.set(LAB_FIELD.debug, onOffLabel('DEBUG', r.debug));

    // The frame lines.
    this.set(LAB_FIELD.fps, `${r.fps.toFixed(0)} fps`);
    this.set(LAB_FIELD.frameMs, `frame ${r.frameMs.toFixed(1)} ms`);
    this.set(LAB_FIELD.aiMs, `ai ${r.aiMs.toFixed(2)} ms`);
    this.set(LAB_FIELD.animMs, `anim ${r.animMs.toFixed(2)} ms`);

    // The stress test: its button's word, the option that changes its
    // answer, and the panel — which carries the live block while a run is
    // going and the whole report when it is done. The report is only
    // written when it CHANGES, so a thumb that has selected a line of it
    // to copy does not lose the selection ten times a second.
    this.set(LAB_FIELD.stress, stressLabel(r.stressPhase, r.stressCreatures));
    this.set(LAB_FIELD.rigs, rigModeLabel(r.rigs));
    const running = r.stressPhase !== 'idle';
    if (this.stress.hidden === running) this.stress.hidden = !running;
    if (running && this.stressReport.textContent !== r.stressText) this.stressReport.textContent = r.stressText;
    const finished = r.stressPhase === 'done';
    if (this.stressButtons.hidden === finished) this.stressButtons.hidden = !finished;

    // The right thumb: the medium's buttons, or none.
    this.layoutCluster(r.held);

    // The overlay: never beside the stress panel, which stands where it does.
    const overlay = r.debug && !running;
    if (this.overlay.hidden === overlay) this.overlay.hidden = !overlay;
    for (const line of r.lines) {
      const block = this.blocks.get(line.species);
      if (!block) continue;
      const text = blockText(line);
      if (block.textContent !== text) block.textContent = text;
    }
  }

  /**
   * THE REPORT ONTO THE CLIPBOARD, and if the browser will not have it,
   * SELECTED so a thumb can long-press and copy. `navigator.clipboard`
   * wants a user gesture and a secure origin: the button is the gesture
   * and GitHub Pages is the origin, but an iOS Safari that refuses
   * anyway must not leave the report unreachable — which is the whole
   * point of a report meant to be pasted into a card.
   */
  private async copyReport(button: HTMLButtonElement): Promise<void> {
    const text = this.stressReport.textContent ?? '';
    const say = (word: string): void => {
      button.textContent = word;
      const doc = button.ownerDocument;
      doc.defaultView?.setTimeout(() => { button.textContent = 'COPY'; }, 1200);
    };
    try {
      await button.ownerDocument.defaultView?.navigator?.clipboard?.writeText(text);
      say('COPIED');
      return;
    } catch {
      // Fall through to the selection.
    }
    const doc = button.ownerDocument;
    const selection = doc.defaultView?.getSelection?.();
    if (selection && doc.createRange) {
      const range = doc.createRange();
      range.selectNodeContents(this.stressReport);
      selection.removeAllRanges();
      selection.addRange(range);
      say('SELECTED');
      return;
    }
    say('COPY FAILED');
  }

  private layoutCluster(held: CreatureSpecies | null): void {
    const key = held === null ? null : `${held.medium}:${held.flight !== null ? 'winged' : 'walker'}`;
    if (key === this.clusterFor) return;
    this.clusterFor = key;
    if (held === null) {
      this.cluster.hidden = true;
      // A button that vanishes while pressed would stay held; let go of all of them.
      this.held.up = this.held.down = this.held.primary = this.held.secondary = this.held.sprint = false;
      return;
    }
    const kinds = buttonsFor(held.medium, held.flight !== null);
    for (const [kind, button] of this.heldButtons) {
      const shown = kinds.includes(kind);
      button.hidden = !shown;
      if (!shown) this.held[kind] = false;
      button.textContent = buttonLabel(kind, held.medium);
    }
    this.cluster.hidden = false;
  }
}

/** One creature's block, five lines. The words a probe parses: PLAYER or AI, the behaviour, `hunger NN%`, `AGL NN mm`. */
export function blockText(line: CreatureLine): string {
  const pct = (v: number): string => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
  const who = line.player ? 'PLAYER' : 'AI';
  const target = line.targetMm === null ? 'target —' : `target ${Math.round(line.targetMm)} mm`;
  const host = line.hostId === null ? 'host —' : `host ${line.hostId}`;
  const edits = line.edits === null ? '' : ` · ground edits ${line.edits}`;
  const px = line.screenX === null || line.screenY === null ? 'px —' : `px ${Math.round(line.screenX)},${Math.round(line.screenY)}`;
  return (
    `${line.name.toUpperCase()} · ${who} · ${line.medium}\n` +
    `${line.behaviour} · ${target} · ${host}\n` +
    `hunger ${pct(line.hunger)} · fatigue ${pct(line.fatigue)} · alarm ${pct(line.alarm)}\n` +
    `speed ${line.speedMmS.toFixed(1)} mm/s · AGL ${Math.round(line.aglMm)} mm · ${line.surface}${edits}\n` +
    `think ${line.sinceThink.toFixed(2)}/${line.thinkS.toFixed(2)} s · at ${line.x.toFixed(1)},${line.z.toFixed(1)} · ${px}`
  );
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  return node;
}
