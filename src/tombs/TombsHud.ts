/** Presentation only: the scene owns every action and readout. */
import type { LightMode, Room } from '../world/tombs';
import './tombsHud.css';
import {
  AUDIO_LABEL, BACK_LABEL, PREV_LABEL,
  TOMBS_ACTION, TOMBS_FIELD, TOMBS_HUD_HZ, TOMBS_HUD_ROLE,
  arrayLabel, arrayLine, audioLine, drawsLine, fpsLine, interactLabel, leverLabel, lightingLine,
  modeLine, peopleLine, posLine, promptLine, roomLabel, roomLine, runLabel, teleportAction, 
  walkLabel,
  audioLabel, beatLine, dialogueLine, progressLine, speakerLine,
} from './tombsTool';

/** What the HUD is told each refresh. Plain numbers and words; the scene works them out. */
export interface TombsReadout {
  /** The plan's own name for the room the camera is in, or `outside`. */
  readonly room: string;
  readonly lighting: LightMode;
  readonly running: boolean;
  readonly drawCalls: number;
  /** How many bodies are standing in the building, and how many of those are stand-ins. */
  readonly standing: number;
  readonly missing: number;
  readonly fps: number;
  /** The camera, in the plan's LOCAL METRES. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Is a body being walked, and what is it doing? */
  readonly walking: boolean;
  readonly stance: string;
  /**
   * Is the RUN button held on? This is the BUTTON'S state, not the
   * body's: a sprinting body standing still still reads `stance:
   * 'stand'`, so a control that took its word from the stance would
   * flip back to RUN every time the player let go of the stick.
   */
  readonly sprinting: boolean;
  /** What is in reach, in the plan's own words, and what to call the control that does it. */
  readonly prompt: string;
  readonly reachLabel: string;
  /** The audio, as `AudioStatus` reports it. */
  readonly audioRunning: boolean;
  readonly decoded: number;
  readonly failed: number;
  readonly playing: number;
  /**
   * THE LINE ON SCREEN, all of it quoted from the manifest and the beat
   * list. `lineAt` is ONE-BASED and 0 means the chapter has not started,
   * which is the one state the pane has to tell apart from line one —
   * before the first press there is nothing to show and the pane is not
   * there at all.
   */
  readonly lineAt: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly beatTitle: string;
}

interface TombsHudHooks {
  readout(): TombsReadout;
  /** Every press, by its `data-action` name. The scene decides what each one means. */
  onAction(action: string): void;
}

// Self-contained lab theme; scoped responsive rules live in tombsHud.css.
const GOLD = '#8edbd3';
const PARCHMENT = '#e6efec';
const PANEL = 'rgba(6,9,12,0.72)';
const BUTTON = '#19353e';
const FONT = '11px/1.3 var(--ui-mono,ui-monospace,SFMono-Regular,Menlo,monospace)';
const EDGE_LEFT = 'calc(10px + min(env(safe-area-inset-left), 14px))';
const EDGE_RIGHT = 'calc(10px + min(env(safe-area-inset-right), 14px))';

const CSS = {
  root: 'position:absolute;inset:0;pointer-events:none;',
  panel:
    'position:absolute;display:flex;flex-direction:column;gap:4px;padding:6px 8px;pointer-events:auto;'
    + `background:${PANEL};color:${PARCHMENT};font:${FONT};border:1px solid ${GOLD};border-radius:6px;`,
  row: 'display:flex;flex-wrap:wrap;gap:5px;',
  button:
    `min-height:36px;padding:4px 10px;font:${FONT};color:${PARCHMENT};background:${BUTTON};`
    + `border:1px solid ${GOLD};border-radius:6px;touch-action:manipulation;white-space:nowrap;`,
  line: 'white-space:nowrap;',
} as const;

/** Scene-owned readouts and actions in a responsive, scroll-safe shell. */
export class TombsHud {
  private readonly root: HTMLElement;
  readonly inputLayer: HTMLElement;
  private lastLine = -1;
  private readonly fields = new Map<string, HTMLElement>();
  private readonly lever: HTMLButtonElement;
  private readonly array: HTMLButtonElement;
  private readonly walk: HTMLButtonElement;
  private readonly run: HTMLButtonElement;
  /**
   * The INTERACT control is CREATED AND DESTROYED rather than shown and
   * hidden, and that is the standing rule rather than a preference: an
   * unavailable action must never look functional, and a disabled button
   * that is on screen nine tenths of the time is a control that reads as
   * broken. When nothing is in reach there is nothing there.
   */
  private readonly prompt: HTMLElement;
  private readonly promptRow: HTMLElement;
  private interact: HTMLButtonElement | null = null;
  /**
   * The dialogue pane. The PANEL is always there because the control
   * that starts the chapter lives in it; the three QUOTED LINES are
   * what appears with the first line and not before.
   */
  private readonly dialogue: HTMLElement;
  private readonly dialogueText: HTMLElement;
  private readonly dialogueControls: HTMLElement;
  private prev: HTMLButtonElement | null = null;
  private readonly next: HTMLButtonElement;
  private readonly detach: Array<() => void> = [];
  private sinceRefresh = Infinity;

  constructor(
    uiLayer: HTMLElement,
    rooms: readonly Room[],
    private readonly hooks: TombsHudHooks,
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = TOMBS_HUD_ROLE;
    this.root.style.cssText = CSS.root;
    this.root.className = 'tombs-cinematic';
    this.inputLayer = doc.createElement('div');
    this.inputLayer.className = 'tombs-input';
    this.root.appendChild(this.inputLayer);
    const toolbar = doc.createElement('div');
    toolbar.className = 'tombs-toolbar';
    const brand = doc.createElement('div');
    brand.className = 'tombs-brand';
    brand.textContent = 'TOMBS / RESEARCH DIVISION';
    const tools = doc.createElement('details');
    tools.className = 'tombs-tools';
    const toggle = doc.createElement('summary');
    toggle.textContent = 'Lab tools';
    tools.appendChild(toggle);
    toolbar.append(brand, tools, this.button(doc, TOMBS_ACTION.back, BACK_LABEL));
    this.root.appendChild(toolbar);

    // Expandable tools retain the layout-owned room destinations.
    const left = el(doc, 'div', `${CSS.panel}top:8px;left:${EDGE_LEFT};max-width:min(440px,52%);`);
    left.appendChild(this.field(doc, TOMBS_FIELD.room, `${CSS.line}color:${GOLD};letter-spacing:0.06em;`));
    left.appendChild(this.field(doc, TOMBS_FIELD.pos, `${CSS.line}opacity:0.85;`));
    left.appendChild(this.field(doc, TOMBS_FIELD.mode, `${CSS.line}opacity:0.85;`));
    const roomRow = el(doc, 'div', CSS.row);
    // THE ROOMS COME FROM THE LAYOUT, in the plan's order and under the
    // plan's names: six buttons because the plan has six rooms, and a
    // seventh room would grow a seventh button without an edit here.
    for (const room of rooms) roomRow.appendChild(this.button(doc, teleportAction(room.id), roomLabel(room.name)));
    left.appendChild(roomRow);
    left.className = 'tombs-tool-panel';
    tools.appendChild(left);

    // All existing simulation controls and diagnostics stay available.
    const right = el(doc, 'div', `${CSS.panel}top:8px;right:${EDGE_RIGHT};align-items:flex-end;`);
    const controls = el(doc, 'div', `${CSS.row}justify-content:flex-end;`);
    this.lever = this.button(doc, TOMBS_ACTION.lever, leverLabel('normal'));
    this.array = this.button(doc, TOMBS_ACTION.array, arrayLabel(false));
    this.walk = this.button(doc, TOMBS_ACTION.walk, walkLabel(false));
    this.run = this.button(doc, TOMBS_ACTION.run, runLabel(false));
    controls.appendChild(this.walk);
    controls.appendChild(this.run);
    controls.appendChild(this.lever);
    controls.appendChild(this.array);
    
    right.appendChild(controls);
    right.appendChild(this.field(doc, TOMBS_FIELD.lighting, `${CSS.line}color:${GOLD};`));
    right.appendChild(this.field(doc, TOMBS_FIELD.array, CSS.line));
    const perf = el(doc, 'div', `${CSS.row}justify-content:flex-end;gap:10px;opacity:0.85;`);
    perf.appendChild(this.field(doc, TOMBS_FIELD.draws, CSS.line));
    perf.appendChild(this.field(doc, TOMBS_FIELD.people, CSS.line));
    perf.appendChild(this.field(doc, TOMBS_FIELD.fps, CSS.line));
    right.appendChild(perf);
    right.appendChild(this.field(doc, TOMBS_FIELD.audio, `${CSS.line}opacity:0.85;`));
    right.className = 'tombs-tool-panel';
    tools.appendChild(right);

    // BOTTOM CENTRE: what is in reach and the one control that does it.
    // Not bottom-left — `input/MoveStick.ts` owns that corner and the
    // thumb that rests in it — and not top, where the room row already
    // is: a prompt belongs under the eye, near the thing it is about.
    this.promptRow = el(doc, 'div',
      `${CSS.panel}bottom:10px;left:50%;transform:translateX(-50%);align-items:center;gap:6px;`);
    this.prompt = this.field(doc, TOMBS_FIELD.prompt, `${CSS.line}color:${GOLD};`);
    this.promptRow.appendChild(this.prompt);
    this.promptRow.style.display = 'none';
    this.promptRow.className = 'tombs-reach';
    this.inputLayer.appendChild(this.promptRow);

    // The text scrolls independently; navigation remains in a fixed footer.
    this.dialogue = el(doc, 'div',
      `${CSS.panel}bottom:10px;right:${EDGE_RIGHT};max-width:min(360px,44%);gap:3px;`);
    this.dialogue.className = 'tombs-dialogue';
    this.dialogue.setAttribute('aria-label', 'Story dialogue');
    this.dialogueText = el(doc, 'div', 'display:flex;flex-direction:column;gap:3px;');
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.beat,
      `${CSS.line}color:${GOLD};letter-spacing:0.06em;opacity:0.9;font-size:10px;`));
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.speaker, `${CSS.line}color:${GOLD};`));
    // The one readout in this HUD that WRAPS. Every other line is a
    // reading and fits; a line of dialogue is a sentence and does not.
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.line,
      'white-space:normal;line-height:1.35;'));
    this.dialogueText.className = 'tombs-dialogue-text';
    this.dialogueText.tabIndex = 0;
    this.dialogueText.style.display = 'none';
    this.dialogue.appendChild(this.dialogueText);
    this.dialogueControls = el(doc, 'div', `${CSS.row}justify-content:flex-end;`);
    this.dialogueControls.className = 'tombs-dialogue-controls';
    this.next = this.button(doc, TOMBS_ACTION.audio, AUDIO_LABEL);
    this.dialogueControls.appendChild(this.next);
    this.dialogue.appendChild(this.dialogueControls);
    this.root.appendChild(this.dialogue);

    uiLayer.appendChild(this.root);
    this.refreshNow();
  }

  /** Every frame with RAW dt; the DOM is written `TOMBS_HUD_HZ` times a second. */
  update(rawDt: number): void {
    this.sinceRefresh += Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
    if (this.sinceRefresh < 1 / TOMBS_HUD_HZ) return;
    this.refreshNow();
  }

  refreshNow(): void {
    this.sinceRefresh = 0;
    this.render(this.hooks.readout());
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.fields.clear();
    this.root.remove();
  }

  // -------------------------------------------------------------------------

  private field(doc: Document, name: string, css: string): HTMLElement {
    const line = el(doc, 'div', css);
    line.dataset.field = name;
    this.fields.set(name, line);
    return line;
  }

  private button(doc: Document, action: string, label: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    button.style.cssText = CSS.button;
    const press = (): void => {
      this.hooks.onAction(action);
      this.refreshNow();
    };
    button.addEventListener('click', press);
    this.detach.push(() => button.removeEventListener('click', press));
    return button;
  }

  private set(name: string, text: string): void {
    const node = this.fields.get(name);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private render(r: TombsReadout): void {
    this.set(TOMBS_FIELD.room, roomLine(r.room));
    this.set(TOMBS_FIELD.pos, posLine(r.x, r.y, r.z));
    this.set(TOMBS_FIELD.lighting, lightingLine(r.lighting));
    this.set(TOMBS_FIELD.array, arrayLine(r.running));
    this.set(TOMBS_FIELD.draws, drawsLine(r.drawCalls));
    this.set(TOMBS_FIELD.people, peopleLine(r.standing, r.missing));
    this.set(TOMBS_FIELD.fps, fpsLine(r.fps));
    this.set(TOMBS_FIELD.mode, modeLine(r.walking, r.stance));
    this.set(TOMBS_FIELD.prompt, promptLine(r.prompt));
    this.set(TOMBS_FIELD.audio, audioLine(r.audioRunning, r.decoded, r.failed, r.playing));
    this.setReach(r.reachLabel);
    this.setDialogue(r);
    // The two buttons offer the CHANGE; the two lines above report the state.
    const lever = leverLabel(r.lighting);
    if (this.lever.textContent !== lever) this.lever.textContent = lever;
    const array = arrayLabel(r.running);
    if (this.array.textContent !== array) this.array.textContent = array;
    const walk = walkLabel(r.walking);
    if (this.walk.textContent !== walk) this.walk.textContent = walk;
    // RUN is offered only while there is a body to run: on a flying
    // camera it would be a control with nothing to act on. Its WORD is
    // the way back, like every other control on this HUD — a button
    // that still reads RUN after it has been pressed is a control the
    // player cannot tell the state of.
    this.run.style.display = r.walking ? '' : 'none';
    const run = runLabel(r.sprinting);
    if (this.run.textContent !== run) this.run.textContent = run;
  }

  /**
   * THE PANE FOLLOWS THE LINE, and the line is the only thing that
   * decides whether it exists. `lineAt === 0` is the chapter not started;
   * `lineAt === 1` is the first line, where PREV has nowhere to go and so
   * is not built.
   */
  private setDialogue(r: TombsReadout): void {
    this.root.dataset.started = String(r.lineAt > 0);
    this.next.disabled = r.lineAt > 0 && r.lineAt >= r.lineCount;
    this.next.title = this.next.disabled ? 'End of available dialogue' : '';
    if (this.lastLine !== r.lineAt) {
      this.dialogueText.scrollTop = 0;
      this.lastLine = r.lineAt;
    }
    if (r.lineAt < 1) {
      this.dialogueText.style.display = 'none';
      this.dropPrev();
      if (this.next.textContent !== AUDIO_LABEL) this.next.textContent = AUDIO_LABEL;
      return;
    }
    this.dialogueText.style.display = '';
    const beat = beatLine(r.beatTitle);
    const where = progressLine(r.lineAt, r.lineCount);
    // The beat is a title and the counter is a number, and a reader wants
    // both on one line: `THE SMARTER SCIENTIST · 8 / 85`. A chapter with
    // no beats written yet prints the counter alone rather than a dot
    // with nothing before it.
    this.set(TOMBS_FIELD.beat, beat === '' ? where : `${beat} · ${where}`);
    this.set(TOMBS_FIELD.speaker, speakerLine(r.speaker));
    this.set(TOMBS_FIELD.line, dialogueLine(r.text));
    const next = audioLabel(true);
    if (this.next.textContent !== next) this.next.textContent = next;
    if (r.lineAt > 1) {
      if (this.prev === null) {
        this.prev = this.button(this.dialogue.ownerDocument, TOMBS_ACTION.prevLine, PREV_LABEL);
        this.dialogueControls.insertBefore(this.prev, this.next);
      }
    } else {
      this.dropPrev();
    }
  }

  private dropPrev(): void {
    if (this.prev === null) return;
    this.prev.remove();
    this.prev = null;
  }

  /** The prompt and its control appear together and go together. */
  private setReach(label: string): void {
    const want = interactLabel(label);
    if (want === '') {
      this.promptRow.style.display = 'none';
      if (this.interact !== null) {
        this.interact.remove();
        this.interact = null;
      }
      return;
    }
    this.promptRow.style.display = '';
    if (this.interact === null) {
      this.interact = this.button(this.promptRow.ownerDocument, TOMBS_ACTION.interact, want);
      this.promptRow.appendChild(this.interact);
    } else if (this.interact.textContent !== want) {
      this.interact.textContent = want;
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  return node;
}

