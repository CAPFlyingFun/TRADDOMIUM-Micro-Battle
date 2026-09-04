/**
 * Phase 0 placeholder — replaced by the ui agent's real loading screen.
 *
 * Asks for the session's world from inside its own transition, which is
 * exactly the case the SceneManager's queue exists for. With no session
 * it throws, and the manager's fallback returns the player to the menu.
 */
import * as THREE from 'three';
import { resolveWorld } from '../../world/WorldLoader';
import type { AppScene, SceneContext } from '../Scene';
import { panel } from './dom';

export function loadingPlaceholder(ctx: SceneContext): AppScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color('#06090c');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  let root: HTMLElement | null = null;

  return {
    name: 'loading-placeholder',
    three,
    camera,
    async enter() {
      const session = ctx.app.session;
      if (!session) throw new Error('loading screen entered without a session');
      root = panel(ctx.uiLayer, `Loading ${session.mapId}…`);
      // Queued behind this transition; the world's own enter() does the loading.
      void ctx.scenes.goTo(resolveWorld({ id: session.mapId, layers: [] }));
    },
    update() {},
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      root?.remove();
      root = null;
    },
  };
}
