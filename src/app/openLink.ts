/**
 * A BOOKMARK STRAIGHT INTO A TOOL (Joshua, 2026-10-20: "is there a quick link I can bookmark that will open that lab
 * directory without having to go to extras and select the last option?"). `?open=<name>` on the game's address opens
 * that Editors tool instead of the main menu. A tool answers to its id (`lab.tombs`) or the id's last part (`tombs`),
 * in any case. Its back button still leads to Editors, as when it is opened from there.
 *
 * The character room's links (`?open=CharacterRoom`, `?open=sarah`) are not this module's any more: the room moved to
 * its own site on 2026-11-04, and index.html's first script sends them there before this runs (app/characterBuilder.ts).
 *
 * Read at boot and left in the address, so the bookmark, a home-screen icon saved from it, and a reload (the update
 * check's included) all land in the same place. Only a tool with a scene of its own opens: a world tool starts a solo
 * game, which a link should never do quietly, and a panel or link tool lives inside the Editors screen. An unknown or
 * missing name opens the main menu as usual, never a blank screen.
 *
 * Pure: the caller passes the address's query and the registered tools.
 */
import type { DevTool } from '../devtools/DevTool';
import { WORLD_SCENE_PREFIX } from '../world/WorldLoader';

export const OPEN_QUERY_PARAM = 'open';

/** The scene id a `?open=` link names, or null when it names nothing that may open this way. */
export function openLinkScene(search: string, tools: readonly DevTool[]): string | null {
  const asked = new URLSearchParams(search).get(OPEN_QUERY_PARAM)?.trim().toLowerCase();
  if (!asked) return null;
  for (const tool of tools) {
    const sceneId = tool.sceneId;
    if (sceneId === undefined || sceneId.startsWith(WORLD_SCENE_PREFIX)) continue;
    const id = tool.id.toLowerCase();
    if (asked === id || asked === id.split('.').at(-1)) return sceneId;
  }
  return null;
}
