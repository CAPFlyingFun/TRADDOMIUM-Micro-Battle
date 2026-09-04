/**
 * The DevTool registry: registration order is the listing order, an
 * unknown id throws and names what exists, and a tool nothing could open
 * is refused at registration rather than shown as a dead button.
 *
 * Node environment on purpose: the registry is a Map and three functions
 * and must stay usable without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { listTools, registerTool, toolAction, toolById, type DevTool } from '../src/devtools/DevTool';

const sceneTool = (id: string, title = id): DevTool => ({
  id,
  title,
  description: `Opens the ${id} scene.`,
  sceneId: `world:${id}`,
});

describe('DevTool registry', () => {
  it('throws on an unknown id and names what is registered', () => {
    expect(() => toolById('nowhere')).toThrow(/No dev tool registered as "nowhere" \(registered: none\)/);
    registerTool(sceneTool('perf-world', 'Performance World'));
    expect(() => toolById('nowhere')).toThrow(/registered: perf-world/);
  });

  it('lists in registration order, not alphabetically, and resolves by id', () => {
    const zeta = sceneTool('zeta');
    const alpha = sceneTool('alpha');
    registerTool(zeta);
    registerTool(alpha);
    const ids = listTools().map((t) => t.id);
    expect(ids.indexOf('perf-world')).toBe(0);
    expect(ids.indexOf('zeta')).toBeLessThan(ids.indexOf('alpha'));
    expect(toolById('alpha')).toBe(alpha);
    expect(toolById('zeta')).toBe(zeta);
  });

  it('replaces on re-register (HMR re-evaluates modules) and keeps the original position', () => {
    const before = listTools().map((t) => t.id);
    const replacement = sceneTool('zeta', 'Zeta, second evaluation');
    registerTool(replacement);
    expect(toolById('zeta')).toBe(replacement);
    expect(listTools().map((t) => t.id)).toEqual(before);
  });

  it('accepts a panel tool that has open() and no scene', () => {
    const panel: DevTool = { id: 'panel', title: 'A panel', description: 'Opens over the hub.', open() {} };
    registerTool(panel);
    expect(toolById('panel')).toBe(panel);
  });

  it('refuses a tool that has neither a sceneId nor an open()', () => {
    const dead: DevTool = { id: 'dead', title: 'Nothing', description: 'Could never open.' };
    expect(() => registerTool(dead)).toThrow(/"dead" has neither a sceneId nor an open\(\)/);
    expect(() => toolById('dead')).toThrow(/No dev tool registered/);
  });

  it('refuses an id that would not survive as a data-action selector', () => {
    for (const bad of ['', ' ', 'has space', 'quote"mark', '-leading-dash', 'tool:colon']) {
      expect(() => registerTool(sceneTool(bad))).toThrow(/DevTool id/);
    }
    expect(() => registerTool(sceneTool('ok.tool_1-2'))).not.toThrow();
  });

  it('names the OPEN action as tool:<id>', () => {
    expect(toolAction('perf-world')).toBe('tool:perf-world');
  });
});
