import { IslandScene } from './scenes/IslandScene';
import { GameFlow } from './ui/GameFlow';
import { RotateGate } from './ui/rotateGate';
import { fitViewport } from './ui/viewportFit';
import { load as loadSettings } from './ui/settings';
import { useGrid } from './world/heightfield';
import { HYDRO_BYTES, loadHydro } from './world/hydro';
import { useHydro } from './world/water';
import { useLakes } from './world/lakes';
import { GRID_BYTES, loadGrid, type HeightGrid } from './world/kauai';
import { fitBootBar } from './ui/bootBar';

/**
 * Boot — scene-by-scene rebuild entry point.
 *
 * Every approved system gets its own development scene reachable via
 * `?scene=`; the island lab is the first and the default. New labs
 * register here as their rebuild steps land.
 *
 * The island is 2 MB of baked elevation plus three quarters of a
 * megabyte of real hydrography, so booting waits on both before any
 * scene can ask how high the ground is or where the water runs.
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
  // BOTH FILES ON ONE BAR. They are fetched together rather than in
  // sequence because a bar that fills, resets and fills again reads as
  // a stall and a restart; two running totals summed into one reads as
  // what it is. The grid's size is a constant it insists on itself and
  // the hydrography's is a constant its own bake keeps honest, so the
  // maximum is known before either byte arrives — which is the whole
  // reason neither asks the server for a Content-Length.
  const total = GRID_BYTES + HYDRO_BYTES;
  let gridDone = 0;
  let hydroDone = 0;
  const moved = () => bootBar?.(gridDone + hydroDone, total);
  bootBar?.(0, total);
  const [grid, hydro] = await Promise.all([
    loadGrid((done) => { gridDone = done; moved(); }),
    loadHydro((done) => { hydroDone = done; moved(); }),
  ]);
  useGrid(grid);
  useHydro(hydro);
  // BEFORE ANY SCENE ASKS HOW HIGH THE GROUND IS. The lakes press the
  // island down under them (see lakes.ts), so a terrain cut before this
  // would be cut without its basins — and the ant placed on it would
  // stand on ground the mesh no longer has.
  useLakes(hydro);
  const requested = new URLSearchParams(location.search).get('scene') ?? 'game';
  (scenes[requested] ?? scenes['island'])(host, grid);
  clearBoot();
  // Sits above whatever scene is running, so every lab gets it.
  new RotateGate(host);
} catch (error) {
  bootBar?.(0, 0, 'THE ISLAND FAILED TO LOAD');
  throw error;
}
