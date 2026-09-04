/**
 * The DevTool contract (ARCHITECTURE §8) and the registry the hub lists.
 *
 * A tool is one of two things:
 *
 *  - a SCENE. `sceneId` names a scene in `app/registry`, and the hub opens
 *    it through the same `SceneManager.goTo` every other screen goes
 *    through. There is no special routing and no second choke point: the
 *    Performance World is `world:perf-empty` whether the loading screen
 *    or the hub asks for it, and a tool scene is an ordinary `AppScene`
 *    that knows nothing about the hub.
 *  - a PANEL. `open(ctx)` builds something over the hub — a DOM panel,
 *    typically — and `close()` takes it down. For a tool too small to
 *    deserve a scene of its own.
 *
 * §8 sketches the contract with an "optional sceneFactory". This carries
 * a scene ID instead: the scene registry already owns the factories, and
 * a tool holding its own would be a second place to look for one. The
 * perf module's `perfWorldTool` record was written against `sceneId` for
 * the same reason.
 *
 * Tools register themselves from their own module; the hub lists what is
 * registered and nothing else, so adding a tool never touches the hub.
 * There is deliberately no PIN gate: the hub is a routed menu destination,
 * and a client-side PIN is a convenience toggle, not security (§2.11). A
 * tool that writes to anything shared is gated server-side or not at all.
 *
 * Pure: a Map and three functions. The registry test runs without a DOM.
 */
import type { SceneContext } from '../app/Scene';

export interface DevTool {
  /**
   * Unique and stable. It becomes the OPEN button's `data-action`
   * (`tool:<id>`), which is what a probe drives, so it is limited to the
   * characters that survive an attribute selector unquoted.
   */
  readonly id: string;
  readonly title: string;
  /** One honest sentence for the card: what the tool does in THIS build. */
  readonly description: string;
  /** A registered scene id. The hub asks its owner to open it; nothing else is special about it. */
  readonly sceneId?: string;
  /** A panel tool builds itself here, with the hub's own context. */
  open?(ctx: SceneContext): void;
  /** Take the panel down. The hub calls it when it leaves or when another panel opens. */
  close?(): void;
}

/** Letters, digits, dot, dash, underscore: safe inside `[data-action="tool:<id>"]` and readable in a probe log. */
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const TOOL_ACTION_PREFIX = 'tool:';

/** The `data-action` value of a tool's OPEN button, shared by the hub, its test and any probe. */
export function toolAction(id: string): string {
  return `${TOOL_ACTION_PREFIX}${id}`;
}

const tools = new Map<string, DevTool>();

/**
 * Registers a tool, or REPLACES one with the same id. Replacing rather
 * than throwing for the reason `app/registry.ts` gives: Vite's HMR
 * re-evaluates a module on edit, and a registry that throws on the second
 * evaluation turns every dev-server edit into a crash. A replaced tool
 * keeps its place in the list, because `Map.set` on an existing key does.
 *
 * Throws for a tool that could never be opened. With neither `sceneId`
 * nor `open()` there is nothing for the OPEN button to do, and a card
 * whose button does nothing is an unavailable action that looks
 * functional (§2.9). Loud at registration — which is module load, in
 * development — rather than silent on the phone.
 */
export function registerTool(tool: DevTool): void {
  if (!TOOL_ID.test(tool.id)) {
    throw new Error(
      `DevTool id "${tool.id}" must be letters, digits, dot, dash or underscore, starting with a letter or digit`,
    );
  }
  if (tool.sceneId === undefined && tool.open === undefined) {
    throw new Error(`DevTool "${tool.id}" has neither a sceneId nor an open(); nothing could open it`);
  }
  tools.set(tool.id, tool);
}

/**
 * In REGISTRATION order, not sorted. The hub's order is curated — the
 * Performance World is registered first so it is listed first (§12) —
 * and an alphabetical list would put the Animation viewer above it.
 */
export function listTools(): DevTool[] {
  return [...tools.values()];
}

/** Throws on an unknown id, naming what IS registered. */
export function toolById(id: string): DevTool {
  const tool = tools.get(id);
  if (!tool) {
    const known = listTools()
      .map((t) => t.id)
      .join(', ');
    throw new Error(`No dev tool registered as "${id}" (registered: ${known || 'none'})`);
  }
  return tool;
}
