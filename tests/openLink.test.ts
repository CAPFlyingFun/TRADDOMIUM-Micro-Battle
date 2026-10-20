/**
 * `?open=<name>` (src/app/openLink.ts): a bookmark straight into an Editors tool, Joshua's Sarah Lab first among
 * them. A name opens a tool by its id or the id's last part, in any case; a world tool (it would start a solo game)
 * and a panel tool never open this way; anything else falls back to the main menu.
 */
import { describe, expect, it } from 'vitest';
import type { DevTool } from '../src/devtools/DevTool';
import { openLinkScene } from '../src/app/openLink';
import { SARAH_LAB_SCENE_ID, sarahLabTool } from '../src/sarahlab/sarahLabTool';

const tool = (id: string, sceneId?: string): DevTool => ({ id, title: id, description: id, ...(sceneId ? { sceneId } : { open: () => {} }) });
const tools: DevTool[] = [tool('perf-world', 'world:perf'), tool('lab.creatures', 'lab:creatures'), tool('panel.thing'), sarahLabTool];

describe('?open= links', () => {
  it('opens the Sarah Lab from ?open=sarah, its full id, and any case', () => {
    for (const search of ['?open=sarah', '?open=lab.sarah', '?open=Sarah', '?open=%20SARAH%20', '?tier=low&open=sarah']) {
      expect(openLinkScene(search, tools), search).toBe(SARAH_LAB_SCENE_ID);
    }
  });

  it('opens other scene tools the same way', () => {
    expect(openLinkScene('?open=creatures', tools)).toBe('lab:creatures');
  });

  it('never starts a world or opens a panel tool, and falls back to the menu for anything unknown', () => {
    for (const search of ['', '?open=', '?open=perf-world', '?open=thing', '?open=panel.thing', '?open=nowhere', '?tier=low']) {
      expect(openLinkScene(search, tools), search).toBeNull();
    }
  });
});
