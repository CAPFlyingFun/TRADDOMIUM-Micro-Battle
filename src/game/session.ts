/**
 * WHAT KIND OF RUN THIS IS — and today it decides exactly one thing.
 *
 * Joshua, 2026-08-30: "the game needs to be default for multiplayer not
 * solo… so, the ant might stop if moving on the ground and hover if
 * flying, but everything must keep going and need to check it does that
 * now and not everything freezes — only player stops while the world
 * keeps going." Then: "the simple fix is go ahead on the main menu have
 * a split (Solo/Multiplayer)."
 *
 * He is right that it did not do that. `IslandScene.tick` opened with a
 * single `if (this.halted) { render; return; }`, and everything below
 * that line — the world clock, the wind, the weather, the sea, the
 * water simulation, the autonomy, the autosave — simply did not run.
 * That is a legitimate pause for one player alone. It is not a pause
 * that can survive a second player, because the other queen does not
 * stop existing while this one reads a map.
 *
 * SO THE FREEZE BECOMES A PROPERTY OF THE SESSION rather than of the
 * menu that asked for it. Solo keeps the old behaviour exactly.
 * Multiplayer keeps the world turning and takes the controls out of her
 * hands instead: she coasts to a stop on the ground and holds station
 * in the air.
 *
 * WHAT MULTIPLAYER IS NOT, and the menu says so out loud. There is no
 * netcode in this repo — no server, no transport, no second player.
 * Choosing it today buys one honest thing: a world that does not stop.
 * The caption under the button is the whole promise, and it must not
 * grow until the thing it describes does.
 *
 * It lives here rather than in MainMenu because the scene has to read
 * it, and a renderer importing a type out of a menu widget is how two
 * unrelated things end up unable to move independently.
 */

/**
 * Solo pauses the world. Multiplayer only stops her hands.
 *
 * WHICH CLOCK THE RUN IS UNDER, and nothing more than that. Solo and
 * Multiplayer are one game under two authorities — local and, one day,
 * a server — and `tests/simulationCore.test.ts` already protects the
 * property that makes that possible: every module that DECIDES what is
 * true imports no three.js, touches no DOM and reads no storage, so the
 * same island and the same flight model could be evaluated off a tab.
 * The client can honour only the clock today, and that is all either
 * word is allowed to claim.
 */
export type SessionMode = 'solo' | 'multiplayer';

/**
 * The default for anything that does not go through the front door.
 *
 * SOLO ON PURPOSE, and it is the opposite of the menu's default. The
 * dev routes (`?scene=island` and friends) build `IslandScene` straight
 * from `main.ts` with no GameFlow between them, and every probe and
 * screenshot rig in `scripts/` drives one of those. Defaulting them to
 * multiplayer would change what a dozen existing measurements measure
 * without a single line of them saying so. The front door picks
 * multiplayer explicitly; everything else keeps the behaviour it had.
 */
export const DEFAULT_MODE: SessionMode = 'solo';

/**
 * What the front door is allowed to promise about a mode.
 *
 * Pure, exported and tested, because this one sentence carries the
 * whole honesty of the feature. MULTIPLAYER buys a world that keeps
 * running and nothing else; the moment this line overstates that, the
 * menu starts selling a game that does not exist.
 */
export function modeCaption(mode: SessionMode): string {
  return mode === 'solo'
    ? 'Pausing stops the world.'
    : 'The world keeps running. Online play is not built yet.';
}
