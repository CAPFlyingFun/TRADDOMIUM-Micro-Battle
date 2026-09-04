// @vitest-environment jsdom
/**
 * The hub renders one card per registered tool, names each OPEN button
 * `tool:<id>` (the action a probe drives), hands a scene-tool to its
 * owner through `openScene`, opens a panel tool over itself and closes
 * it on the way out.
 *
 * The registry is module-level state, so the empty-hub case runs FIRST,
 * before this file registers anything. Keep it first.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { listTools, registerTool, toolAction, type DevTool } from '../src/devtools/DevTool';
import {
  BACK_LABEL, DEVTOOLS_SCENE_ID, DevToolsHubScene, HUB_EMPTY, HUB_TITLE, OPEN_LABEL, createDevToolsHubScene,
  type DevToolsHubHooks,
} from '../src/devtools/DevToolsHubScene';

function rig() {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const ctx = { uiLayer, scenes: { goTo: vi.fn(async () => {}) } } as unknown as SceneContext;
  const hooks: DevToolsHubHooks = { openScene: vi.fn(), onBack: vi.fn() };
  return { uiLayer, ctx, hooks };
}

const actions = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>('button[data-action]')].map((b) => b.dataset.action ?? '');

const click = (root: ParentNode, action: string): void => {
  const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!button) throw new Error(`no button carries data-action="${action}"`);
  button.click();
};

describe('DevToolsHubScene', () => {
  it('says so honestly when nothing is registered, and still offers BACK', async () => {
    expect(listTools()).toEqual([]);
    const { uiLayer, ctx, hooks } = rig();
    const scene = new DevToolsHubScene(ctx, hooks);
    await scene.enter();
    expect(scene.name).toBe(DEVTOOLS_SCENE_ID);
    expect(uiLayer.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe(DEVTOOLS_SCENE_ID);
    expect(uiLayer.querySelector('h1')?.textContent).toBe(HUB_TITLE);
    expect(uiLayer.textContent).toContain(HUB_EMPTY);
    expect(uiLayer.querySelectorAll('li').length).toBe(0);
    expect(actions(uiLayer)).toEqual(['back']);
    click(uiLayer, 'back');
    expect(hooks.onBack).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(uiLayer.children.length).toBe(0);
  });

  it('renders one card per registered tool, in registration order, each with title, description and tool:<id>', async () => {
    const perf: DevTool = {
      id: 'perf-world',
      title: 'Performance World',
      description: 'A free-fly camera over an empty grid, with raw frame time and sim dt read out separately.',
      sceneId: 'world:perf-empty',
    };
    const panel: DevTool = {
      id: 'stat-panel',
      title: 'Stat panel',
      description: 'A panel that opens over the hub.',
      open: vi.fn(),
      close: vi.fn(),
    };
    registerTool(perf);
    registerTool(panel);

    const { uiLayer, ctx, hooks } = rig();
    const scene = new DevToolsHubScene(ctx, hooks);
    await scene.enter();

    const cards = [...uiLayer.querySelectorAll<HTMLElement>('li[data-tool]')];
    expect(cards.map((c) => c.dataset.tool)).toEqual(listTools().map((t) => t.id));
    expect(cards.map((c) => c.dataset.tool)).toEqual(['perf-world', 'stat-panel']);
    for (const tool of [perf, panel]) {
      const card = uiLayer.querySelector<HTMLElement>(`li[data-tool="${tool.id}"]`);
      expect(card?.querySelector('h2')?.textContent).toBe(tool.title);
      expect(card?.querySelector('p')?.textContent).toBe(tool.description);
      const open = card?.querySelector<HTMLButtonElement>('button');
      expect(open?.dataset.action).toBe(toolAction(tool.id));
      expect(open?.textContent).toBe(OPEN_LABEL);
      expect(open?.disabled).toBe(false);
    }
    expect(actions(uiLayer)).toEqual(['tool:perf-world', 'tool:stat-panel', 'back']);
    expect(uiLayer.querySelector('[data-action="back"]')?.textContent).toBe(BACK_LABEL);
    expect(uiLayer.textContent).not.toContain(HUB_EMPTY);

    // A scene-tool is the owner's to open; the hub itself never touches the SceneManager.
    click(uiLayer, 'tool:perf-world');
    expect(hooks.openScene).toHaveBeenCalledWith('world:perf-empty');
    expect(ctx.scenes.goTo).not.toHaveBeenCalled();
    expect(panel.open).not.toHaveBeenCalled();

    // A panel tool opens over the hub with the hub's context, and the hub closes it on dispose.
    click(uiLayer, 'tool:stat-panel');
    expect(panel.open).toHaveBeenCalledTimes(1);
    expect(panel.open).toHaveBeenCalledWith(ctx);
    expect(panel.close).not.toHaveBeenCalled();
    scene.dispose();
    expect(panel.close).toHaveBeenCalledTimes(1);
    expect(uiLayer.children.length).toBe(0);
  });

  it('closes an open panel before opening another, and closes at most once', async () => {
    const first: DevTool = { id: 'first-panel', title: 'First', description: 'The first panel.', open: vi.fn(), close: vi.fn() };
    const second: DevTool = { id: 'second-panel', title: 'Second', description: 'The second panel.', open: vi.fn(), close: vi.fn() };
    registerTool(first);
    registerTool(second);
    const { uiLayer, ctx, hooks } = rig();
    const scene = new DevToolsHubScene(ctx, hooks);
    await scene.enter();
    click(uiLayer, 'tool:first-panel');
    click(uiLayer, 'tool:second-panel');
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.open).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('createDevToolsHubScene wires the hooks from the scene context', async () => {
    const { uiLayer, ctx } = rig();
    const wire = vi.fn((_ctx: SceneContext): DevToolsHubHooks => ({ openScene: vi.fn(), onBack: vi.fn() }));
    const scene = createDevToolsHubScene(wire)(ctx);
    expect(wire).toHaveBeenCalledWith(ctx);
    await scene.enter();
    expect(uiLayer.querySelector('h1')?.textContent).toBe(HUB_TITLE);
    scene.resize(932, 430);
    scene.resize(932, 0);
    scene.dispose();
  });
});
