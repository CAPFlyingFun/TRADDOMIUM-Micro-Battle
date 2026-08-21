import { IslandScene } from './scenes/IslandScene';
import { GameFlow } from './ui/GameFlow';
import { RotateGate } from './ui/rotateGate';
import { fitViewport } from './ui/viewportFit';
import { load as loadSettings } from './ui/settings';
import { useGrid } from './world/heightfield';
import { loadGrid, type HeightGrid } from './world/kauai';

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

const notice = document.createElement('div');
Object.assign(notice.style, {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgba(255, 226, 160, 0.92)',
  font: '600 17px/1.5 system-ui, sans-serif',
  textAlign: 'center',
  whiteSpace: 'pre-wrap',
  padding: '24px',
  zIndex: '20',
} satisfies Partial<CSSStyleDeclaration>);
notice.textContent = 'Surveying the island…';
host.appendChild(notice);

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
  const grid = await loadGrid();
  useGrid(grid);
  const requested = new URLSearchParams(location.search).get('scene') ?? 'game';
  (scenes[requested] ?? scenes['island'])(host, grid);
  notice.remove();
  // Sits above whatever scene is running, so every lab gets it.
  new RotateGate(host);
} catch (error) {
  notice.textContent = `The island failed to load.\n${String(error)}`;
  throw error;
}
