import { IslandScene } from './scenes/IslandScene';

/**
 * Boot — scene-by-scene rebuild entry point.
 *
 * Every approved system gets its own development scene reachable via
 * `?scene=`; the island lab is the first and the default. New labs
 * register here as their rebuild steps land.
 */
const scenes: Record<string, (host: HTMLElement) => unknown> = {
  island: (host) => new IslandScene(host),
};

const host = document.getElementById('app');
if (!host) throw new Error('missing #app element');

const requested = new URLSearchParams(location.search).get('scene') ?? 'island';
const build = scenes[requested] ?? scenes['island'];
build(host);
