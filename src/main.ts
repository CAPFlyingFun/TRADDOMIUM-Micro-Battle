import { IslandScene } from './scenes/IslandScene';
import { GameFlow } from './ui/GameFlow';
import { RotateGate } from './ui/rotateGate';
import { fitViewport } from './ui/viewportFit';
import { load as loadSettings } from './ui/settings';
import { useGrid } from './world/heightfield';
import { loadGrid, type HeightGrid } from './world/kauai';
import { fitBootBar } from './ui/bootBar';

/**
 * Boot — scene-by-scene rebuild entry point.
 *
 * Every approved system gets its own development scene reachable via
 * `?scene=`; the island lab is the first and the default. New labs
 * register here as their rebuild steps land.
 *
 * The island is 2 MB of baked elevation, so booting waits on a fetch
 * before any scene can ask how high the ground is.
 */

// Before anything measures itself, or reads a dial.
fitViewport();
loadSettings();

const host = document.getElementById('app');
if (!host) throw new Error('missing #app element');

/**
 * The splash is already on screen — `index.html` painted it with the
 * document, which is the only way to be there before this file runs.
 * What it cannot do is show progress, because the frame's coordinates
 * are generated and the download has not started. Both arrive here.
 */
const boot = document.getElementById('boot');
const bootBar = boot ? fitBootBar(boot) : null;

/** Lift the splash, and take it out of the tree once it has faded. */
function clearBoot(): void {
  if (!boot) return;
  boot.classList.add('gone');
  // Matches the CSS transition. Removed rather than left invisible: it
  // is a fixed full-screen element and would eat every tap.
  setTimeout(() => boot.remove(), 750);
}

/**
 * `?scene=island` still drops straight into the world, because the
 * island lab is how movement and terrain get worked on and a menu in
 * front of it is thirty seconds a day of nothing. The GAME boots into
 * the menu; the lab boots into the island. Both are real entry points.
 */
const scenes: Record<string, (h: HTMLElement, grid: HeightGrid) => unknown> = {
  island: (h, grid) => new IslandScene(h, grid),
  game: (h, grid) => new GameFlow(h, grid),
};

try {
  // TWO MEGABYTES OF ELEVATION, and the art has a bar drawn in it, so
  // there is no excuse for the old silent wait. Same measured bytes the
  // spawn screen shows, in the same frame.
  const grid = await loadGrid((done, total) => bootBar?.(done, total));
  useGrid(grid);
  const requested = new URLSearchParams(location.search).get('scene') ?? 'game';
  (scenes[requested] ?? scenes['island'])(host, grid);
  clearBoot();
  // Sits above whatever scene is running, so every lab gets it.
  new RotateGate(host);
} catch (error) {
  bootBar?.(0, 0, 'THE ISLAND FAILED TO LOAD');
  throw error;
}
