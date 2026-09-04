/**
 * The Editors / Dev Tools hub: a routed menu destination (§8) that lists
 * every registered `DevTool` as a card and opens the one you press.
 *
 * Typed hooks (§2.7). The hub does not know what opening a scene means
 * for the app — whether the state stays `menu`, whether a session has to
 * exist first — so a scene-tool's OPEN calls `hooks.openScene(sceneId)`
 * and the owner decides. The Performance World relies on this: entered
 * from the hub it finds the app in `menu` and leaves the state alone,
 * entered from the loading screen it asks for `playing` itself. A panel
 * tool is the hub's own business: it opens over the hub and the hub
 * closes it on the way out.
 *
 * Every control carries `data-action` (app/actions.ts): `back`, and
 * `tool:<id>` per card, so a probe can drive the hub by the names a
 * player presses. Styling is inline, with the ui module's `--ui-*`
 * custom properties as first choice and this module's own values as
 * fallback: the hub is not allowed to import ui/ (§3), and a hub that
 * only looked right after the menu had loaded a stylesheet would be a
 * hidden dependency on load order.
 */
import * as THREE from 'three';
import { ACTION, actionButton } from '../app/actions';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { listTools, toolAction, type DevTool } from './DevTool';

/** The registry id integration binds this scene to; the menu's EDITORS button opens it. */
export const DEVTOOLS_SCENE_ID = 'devtools';

export const HUB_TITLE = 'Editors / Dev Tools';
/** Honest about scope: a tool's saves are this device's overlay until exported (KeyedContentStore). */
export const HUB_SUBTITLE = 'Tools for looking at and tuning the game. What a tool saves stays on this device unless you export it.';
export const HUB_EMPTY = 'No tools are registered in this build.';
export const OPEN_LABEL = 'Open';
export const BACK_LABEL = 'Back';

export interface DevToolsHubHooks {
  /** A scene-tool was pressed. Walk the app state as needed and ask the SceneManager for `sceneId`. */
  openScene(sceneId: string): void;
  onBack(): void;
}

/** Builds the hooks from the scene context, because the hooks need the SceneManager and the registry gets only a factory. */
export type DevToolsHubWire = (ctx: SceneContext) => DevToolsHubHooks;

const CANVAS_BLACK = '#06090c';

/** Inline styles. `var(--ui-…, fallback)` picks up the ui theme when it is loaded and stands alone when it is not. */
const CSS = {
  screen:
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'padding:12px max(12px,env(safe-area-inset-right)) 12px max(12px,env(safe-area-inset-left));' +
    `color:var(--ui-ink,#e8e2c8);font:16px/1.35 var(--ui-font,system-ui,sans-serif);` +
    `background:linear-gradient(180deg,#0b0f07 0%,var(--ui-black,${CANVAS_BLACK}) 100%);`,
  panel:
    'display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:min(100%,760px);max-height:100%;' +
    'overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;padding:16px 20px;' +
    'border:1px solid var(--ui-gold-soft,rgba(201,169,74,0.45));border-radius:14px;' +
    'background:linear-gradient(180deg,var(--ui-panel-edge,rgba(26,32,20,0.98)),var(--ui-panel,rgba(14,18,12,0.94)));',
  title: 'margin:0;font-size:22px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ui-gold,#c9a94a);',
  subtitle: 'margin:0;font-size:14px;color:var(--ui-ink-dim,rgba(232,226,200,0.62));',
  list: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin:0;padding:0;list-style:none;',
  card:
    'display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--ui-gold-soft,rgba(201,169,74,0.45));' +
    'border-radius:var(--ui-radius,10px);background:rgba(0,0,0,0.25);',
  cardTitle: 'margin:0;font-size:16px;font-weight:600;color:var(--ui-gold,#c9a94a);',
  cardText: 'margin:0;flex:1;font-size:14px;color:var(--ui-ink-dim,rgba(232,226,200,0.62));',
  /** 48 px: the smallest target a thumb hits reliably. */
  button:
    'min-height:var(--ui-touch,48px);padding:10px 18px;font:inherit;color:inherit;' +
    'background:var(--ui-button,#1a2014);border:1px solid var(--ui-gold,#c9a94a);border-radius:var(--ui-radius,10px);',
  actions: 'display:flex;justify-content:flex-end;gap:10px;',
} as const;

export class DevToolsHubScene implements AppScene {
  readonly name = DEVTOOLS_SCENE_ID;
  readonly three = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  private root: HTMLElement | null = null;
  /** The panel tool currently open over the hub, if any; closed when another opens or the hub leaves. */
  private openedPanel: DevTool | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly hooks: DevToolsHubHooks,
  ) {
    this.three.background = new THREE.Color(CANVAS_BLACK);
  }

  async enter(): Promise<void> {
    const doc = this.ctx.uiLayer.ownerDocument;
    this.root = el(doc, 'div', CSS.screen);
    this.root.dataset.screen = this.name;

    const panel = el(doc, 'section', CSS.panel);
    const title = el(doc, 'h1', CSS.title);
    title.textContent = HUB_TITLE;
    const subtitle = el(doc, 'p', CSS.subtitle);
    subtitle.textContent = HUB_SUBTITLE;
    panel.append(title, subtitle);

    const tools = listTools();
    if (tools.length === 0) {
      const empty = el(doc, 'p', CSS.cardText);
      empty.textContent = HUB_EMPTY;
      panel.appendChild(empty);
    } else {
      const list = el(doc, 'ul', CSS.list);
      for (const tool of tools) list.appendChild(this.card(doc, tool));
      panel.appendChild(list);
    }

    const actions = el(doc, 'div', CSS.actions);
    const back = actionButton(ACTION.back, BACK_LABEL, () => this.hooks.onBack());
    back.style.cssText = CSS.button;
    actions.appendChild(back);
    panel.appendChild(actions);

    this.root.appendChild(panel);
    this.ctx.uiLayer.appendChild(this.root);
  }

  update(_frame: FrameInfo): void {}

  resize(width: number, height: number): void {
    this.camera.aspect = height > 0 ? width / height : 1;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.closePanel();
    this.root?.remove();
    this.root = null;
  }

  /** What OPEN does. A scene-tool is the owner's to open; a panel opens here, over the hub. */
  open(tool: DevTool): void {
    if (tool.sceneId !== undefined) {
      this.hooks.openScene(tool.sceneId);
      return;
    }
    // `registerTool` guarantees a tool without a sceneId has an open().
    this.closePanel();
    tool.open?.(this.ctx);
    this.openedPanel = tool;
  }

  private closePanel(): void {
    this.openedPanel?.close?.();
    this.openedPanel = null;
  }

  private card(doc: Document, tool: DevTool): HTMLElement {
    const card = el(doc, 'li', CSS.card);
    card.dataset.tool = tool.id;
    const title = el(doc, 'h2', CSS.cardTitle);
    title.textContent = tool.title;
    const text = el(doc, 'p', CSS.cardText);
    text.textContent = tool.description;
    // Same shape as `actionButton`, outside the closed ACTION vocabulary: one action per registered tool.
    const open = doc.createElement('button');
    open.type = 'button';
    open.dataset.action = toolAction(tool.id);
    open.textContent = OPEN_LABEL;
    open.style.cssText = CSS.button;
    open.addEventListener('click', () => this.open(tool));
    card.append(title, text, open);
    return card;
  }
}

export function createDevToolsHubScene(hooks: DevToolsHubWire): SceneFactory {
  return (ctx) => new DevToolsHubScene(ctx, hooks(ctx));
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  return node;
}
