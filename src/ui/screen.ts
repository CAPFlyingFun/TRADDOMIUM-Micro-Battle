/**
 * THE TYPED-HOOKS CONVENTION, and the scraps of DOM every screen shares.
 *
 * RULE (ARCHITECTURE §2.7). Every screen's constructor takes
 * `(ctx: SceneContext, hooks: <ScreenName>Hooks)`. The hooks object is the
 * WHOLE of what a screen knows about the rest of the game: typed callbacks
 * it fires (`onBack`, `onStart(session)`) and read-only data it shows
 * (`session.caption`, `progress.fraction()`). A screen never imports
 * world/, actor/, autonomy/ or the session module's internals — only the
 * `GameSession` TYPE, because a session is handed to it as an opaque
 * object. `tests/uiBoundary.test.ts` reads the source text and fails the
 * build if a screen reaches past its hooks.
 *
 * Why: v0's screens imported the modules whose state they showed, and
 * the wiring between them became impossible to change one piece at a
 * time. A screen built to this convention is constructed in a jsdom test
 * with a fake context and fake hooks, and the person wiring it (the
 * integration pass, in `app/registry.ts`) can read everything it needs
 * from the hooks type alone.
 *
 * WIRING. What a screen cannot import, its factory takes as a
 * `Wire<T>` — a function from the scene context to the hooks (or to the
 * part of the hooks the ui cannot build itself). The factory is what the
 * registry gets; the wire is what integration writes.
 */
import * as THREE from 'three';
import { actionButton, type Action } from '../app/actions';
import type { AppScene, FrameInfo, SceneContext } from '../app/Scene';
import './styles.css';

/** Builds, from the scene context, the piece of a screen's hooks the ui may not import itself. */
export type Wire<T> = (ctx: SceneContext) => T;

/** Which backdrop a screen stands on. Only the menu wears the gradient. */
export type ScreenTone = 'menu' | 'plain';

/**
 * The colour the canvas clears to under a screen. Screens draw nothing in
 * three; this only stops the fade-in from revealing a stale frame.
 */
const CANVAS_BLACK = '#06090c';

/**
 * Base class for a DOM screen that satisfies the `AppScene` contract with
 * an empty three scene. Subclasses build their DOM into `root` and get
 * mounting, unmounting and camera aspect for free.
 */
export abstract class Screen implements AppScene {
  abstract readonly name: string;
  readonly three = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  protected root: HTMLElement | null = null;

  constructor(
    protected readonly ctx: SceneContext,
    private readonly tone: ScreenTone = 'plain',
  ) {
    this.three.background = new THREE.Color(CANVAS_BLACK);
  }

  async enter(): Promise<void> {
    this.root = screenRoot(this.ctx.uiLayer, this.tone, this.name);
    this.build(this.root);
  }

  /** Put the screen's DOM under `root`. Called once, from `enter()`. */
  protected abstract build(root: HTMLElement): void;

  update(_frame: FrameInfo): void {}

  resize(width: number, height: number): void {
    this.camera.aspect = height > 0 ? width / height : 1;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

/** The full-cover element a screen lives in; `data-screen` names it for probes. */
export function screenRoot(uiLayer: HTMLElement, tone: ScreenTone, name: string): HTMLElement {
  const root = uiLayer.ownerDocument.createElement('div');
  root.className = `ui-screen ui-screen--${tone}`;
  root.dataset.screen = name;
  uiLayer.appendChild(root);
  return root;
}

export interface PanelOptions {
  readonly subtitle?: string;
  /** Centre the heading — the main menu's hero title. */
  readonly hero?: boolean;
  readonly wide?: boolean;
}

/** A titled panel. Append rows to the returned element. */
export function titledPanel(host: HTMLElement, title: string, options: PanelOptions = {}): HTMLElement {
  const doc = host.ownerDocument;
  const panel = doc.createElement('section');
  panel.className = options.wide ? 'ui-panel ui-panel--wide' : 'ui-panel';
  const heading = doc.createElement('h1');
  heading.className = options.hero ? 'ui-title ui-title--hero' : 'ui-title';
  heading.textContent = title;
  panel.appendChild(heading);
  if (options.subtitle) {
    const sub = doc.createElement('p');
    sub.className = options.hero ? 'ui-subtitle ui-subtitle--center' : 'ui-subtitle';
    sub.textContent = options.subtitle;
    panel.appendChild(sub);
  }
  host.appendChild(panel);
  return panel;
}

export interface ButtonOptions {
  /** The one action on a screen that is the point of the screen. */
  readonly primary?: boolean;
  /** Fit to content rather than the 180 px column width. */
  readonly compact?: boolean;
}

/**
 * A shared-vocabulary control: `actionButton` from app/actions.ts with the
 * screen styling on it. Every button a player can press on a screen comes
 * through here or `namedButton`, so every one carries `data-action`.
 */
export function actionRow(action: Action, label: string, onClick: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  return styleButton(actionButton(action, label, onClick), options);
}

/**
 * A control whose action is outside the closed `ACTION` vocabulary — the
 * settings screen names its controls `setting:<field>`, one per persisted
 * field, and that set grows with the settings document rather than with
 * the app's shared verbs. Same shape as `actionButton` on purpose.
 */
export function namedButton(action: string, label: string, onClick: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return styleButton(button, options);
}

export function styleButton(button: HTMLButtonElement, options: ButtonOptions = {}): HTMLButtonElement {
  button.classList.add('ui-button');
  if (options.primary) button.classList.add('ui-button--primary');
  if (options.compact) button.classList.add('ui-button--compact');
  return button;
}

/**
 * Marks a destination that is not in this build: disabled, dashed, and the
 * label says why. Kept as a button so the layout does not shift when the
 * destination arrives, and so a probe can still find it by `data-action`.
 */
export function markUnavailable(button: HTMLButtonElement, reason = 'not in this build'): HTMLButtonElement {
  button.disabled = true;
  button.textContent = `${button.textContent} — ${reason}`;
  return button;
}

/** A vertical stack of buttons. */
export function buttonColumn(host: HTMLElement, buttons: readonly HTMLElement[]): HTMLElement {
  const column = host.ownerDocument.createElement('div');
  column.className = 'ui-column';
  for (const b of buttons) column.appendChild(b);
  host.appendChild(column);
  return column;
}

/** A right-aligned row of buttons — a screen's Back / Reset / Save line. */
export function actionsRow(host: HTMLElement, buttons: readonly HTMLElement[]): HTMLElement {
  const row = host.ownerDocument.createElement('div');
  row.className = 'ui-actions';
  for (const b of buttons) row.appendChild(b);
  host.appendChild(row);
  return row;
}

/** A labelled control row: label on the left, control(s) on the right. */
export function labelledRow(host: HTMLElement, label: string, controls: readonly HTMLElement[]): HTMLElement {
  const doc = host.ownerDocument;
  const row = doc.createElement('div');
  row.className = 'ui-row';
  const text = doc.createElement('span');
  text.className = 'ui-row__label';
  text.textContent = label;
  const slot = doc.createElement('div');
  slot.className = 'ui-row__control';
  for (const c of controls) slot.appendChild(c);
  row.append(text, slot);
  host.appendChild(row);
  return row;
}

export function note(host: HTMLElement, text: string): HTMLParagraphElement {
  const p = host.ownerDocument.createElement('p');
  p.className = 'ui-note';
  p.textContent = text;
  host.appendChild(p);
  return p;
}

export function footer(host: HTMLElement, text: string): HTMLParagraphElement {
  const p = host.ownerDocument.createElement('p');
  p.className = 'ui-footer';
  p.textContent = text;
  host.appendChild(p);
  return p;
}
