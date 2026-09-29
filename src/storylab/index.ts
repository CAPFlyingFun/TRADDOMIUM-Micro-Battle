/**
 * CHAPTER 1'S LABORATORY IN 3D — the story's painted lab rebuilt as a room
 * (`public/models/lab-story.glb`, baked by `scripts/bakeStoryLab.py` from
 * `art/story/lab-night.jpg`), with the real Jack and Sarah in it.
 *
 *   storyLabSet.ts    where the picture's camera stood, the chair, the
 *                     people and the shots, in metres. Pure.
 *   storyLabTool.ts   the hub entry and every name the scene answers to. Pure.
 *   StoryLabScene.ts  the scene: the room, the chair, the posed bodies,
 *                     WIDE / PUSH IN / FREE (three and the DOM).
 *
 * A dev tool like the TOMBS laboratory (ARCHITECTURE §8): no session.
 */
export * from './storyLabSet';
export * from './storyLabTool';
export { buildStoryLabScene, createStoryLabScene, type StoryLabHooks, type StoryLabSettings, type StoryLabWire } from './StoryLabScene';
