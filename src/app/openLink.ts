/**
 * A BOOKMARK STRAIGHT INTO A TOOL (Joshua, 2026-10-20: "is there a quick link I can bookmark that will open that lab
 * directory without having to go to extras and select the last option?"). `?open=<name>` on the game's address opens
 * that Editors tool instead of the main menu. The character room is `?open=CharacterRoom` ("should rename it from
 * Sarah to ?open=CharacterRoom since it won't be limited to just Sarah"); `?open=sarah`, its first name, still works so
 * a bookmark already made keeps working. Any tool also answers to its id (`lab.sarah`) or the id's last part (`sarah`),
 * in any case. Its back button still leads to Editors, as when it is opened from there.
 *
 * Read at boot and left in the address, so the bookmark, a home-screen icon saved from it, and a reload (the update
 * check's included) all land in the same place. Only a tool with a scene of its own opens: a world tool starts a solo
 * game, which a link should never do quietly, and a panel tool lives inside the Editors screen. An unknown or missing
 * name opens the main menu as usual, never a blank screen.
 *
 * Pure: the caller passes the address's query and the registered tools.
 */
import type { DevTool } from '../devtools/DevTool';
import { WORLD_SCENE_PREFIX } from '../world/WorldLoader';

export const OPEN_QUERY_PARAM = 'open';

/** Names a link may use beyond a tool's own id, lower case, each naming a tool id. */
export const OPEN_LINK_NAMES: Readonly<Record<string, string>> = Object.freeze({ characterroom: 'lab.sarah' });

/**
 * The attribute on `<html>` that stands the rotate prompt down (index.html's #orient). The scene manager sets it for
 * a scene that may be upright; index.html's first inline script sets it before the first paint for a link that opens
 * one, so the prompt never flashes over the splash — PORTRAIT_LINKS is that script's list, pinned by a test.
 */
export const PORTRAIT_ATTRIBUTE = 'data-any-orientation';
export const PORTRAIT_LINKS: readonly string[] = Object.freeze(['characterroom', 'sarah', 'lab.sarah']);

/** The scene id a `?open=` link names, or null when it names nothing that may open this way. */
export function openLinkScene(search: string, tools: readonly DevTool[]): string | null {
  const asked = new URLSearchParams(search).get(OPEN_QUERY_PARAM)?.trim().toLowerCase();
  if (!asked) return null;
  const named = OPEN_LINK_NAMES[asked] ?? asked;
  for (const tool of tools) {
    const sceneId = tool.sceneId;
    if (sceneId === undefined || sceneId.startsWith(WORLD_SCENE_PREFIX)) continue;
    const id = tool.id.toLowerCase();
    if (named === id || named === id.split('.').at(-1)) return sceneId;
  }
  return null;
}
