/**
 * THE STORY LAB'S HUB ENTRY and every name the scene answers to. Pure: no
 * three, no DOM, so a probe and a test can read the names without a
 * renderer.
 */
import type { DevTool } from '../devtools/DevTool';

export const STORY_LAB_SCENE_ID = 'lab:story';
export const STORY_LAB_TOOL_ID = 'lab.story';

export const storyLabTool: DevTool = {
  id: STORY_LAB_TOOL_ID,
  title: 'Chapter 1 Lab (3D)',
  description:
    "Jack's laboratory from the story, rebuilt in 3D from the painted picture: Jack asleep in his chair and Sarah "
    + 'standing in the aisle, both the real models. WIDE is the picture\'s own camera, PUSH IN drifts to Jack, FREE '
    + 'lets you fly. A preview of the room; no audio and no story yet.',
  sceneId: STORY_LAB_SCENE_ID,
};

/** The HUD root's `data-role`: what a probe waits for. */
export const STORY_LAB_HUD_ROLE = 'story-lab-hud';

export const STORY_LAB_ACTION = Object.freeze({
  back: 'storylab:back',
  wide: 'storylab:wide',
  push: 'storylab:push',
  free: 'storylab:free',
});

export const STORY_LAB_FIELD = Object.freeze({
  /** Which camera is live: WIDE, PUSH IN or FREE. */
  shot: 'storylab-shot',
  /** What has loaded: the room and the two people. */
  loaded: 'storylab-loaded',
});

export type StoryLabMode = 'wide' | 'push' | 'free';

export function shotLine(mode: StoryLabMode): string {
  return mode === 'wide' ? 'WIDE · the picture\'s camera' : mode === 'push' ? 'PUSH IN · toward Jack' : 'FREE · stick to fly, drag to look';
}

export function loadedLine(room: boolean, jack: boolean, sarah: boolean): string {
  const n = Number(room) + Number(jack) + Number(sarah);
  return `loaded ${n}/3: room ${room ? 'yes' : '…'}, Jack ${jack ? 'yes' : '…'}, Sarah ${sarah ? 'yes' : '…'}`;
}
