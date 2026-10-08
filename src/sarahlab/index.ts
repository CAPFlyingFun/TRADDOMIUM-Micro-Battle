/**
 * THE SARAH LAB — Sarah rebuilt from the base mannequin, on a turntable, for
 * Joshua to try before any of it goes live.
 *
 *   sarahLabTool.ts   the hub entry and every name the scene answers to. Pure.
 *   SarahLabScene.ts  the scene: the model, the belly slider, the finger curl,
 *                     the clothes, STAND / WALK / SIT, an orbit camera.
 *
 * A dev tool like the Story Lab (ARCHITECTURE §8): no session.
 */
export * from './sarahLabTool';
export { buildSarahLabScene, createSarahLabScene, type SarahLabHooks, type SarahLabWire } from './SarahLabScene';
