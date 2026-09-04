/**
 * Phase 0 placeholder — replaced by the ui agent's real menu.
 *
 * PLAY starts a LocalSoloSession and walks the state machine through
 * session → loading so the whole path is exercised. The other three
 * destinations are not built yet and are shown DISABLED with a label that
 * says so: an unavailable action must never look functional.
 */
import * as THREE from 'three';
import { LocalSoloSession, SOLO_SAVE_SPEC } from '../../session/LocalSoloSession';
import { ACTION, actionButton } from '../actions';
import { sceneFactory } from '../registry';
import type { AppScene, SceneContext } from '../Scene';
import { panel, styleButton } from './dom';

/** The only world that exists in Phase 0. */
const PHASE0_MAP_ID = 'perf-empty';

export function menuPlaceholder(ctx: SceneContext): AppScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color('#0b0f07');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  let root: HTMLElement | null = null;

  const play = (): void => {
    ctx.app.startSession(new LocalSoloSession(ctx.storage.open(SOLO_SAVE_SPEC), PHASE0_MAP_ID));
    ctx.app.requestState('session');
    ctx.app.requestState('loading');
    void ctx.scenes.goTo(sceneFactory('loading'));
  };

  return {
    name: 'menu-placeholder',
    three,
    camera,
    async enter() {
      root = panel(ctx.uiLayer, 'TRADDOMIUM: Micro Battle!');
      root.appendChild(styleButton(actionButton(ACTION.play, 'Play — empty world', play)));
      for (const [action, label] of [
        [ACTION.settings, 'Settings — not built yet'],
        [ACTION.editors, 'Editors — not built yet'],
        [ACTION.about, 'About — not built yet'],
      ] as const) {
        const button = actionButton(action, label, () => console.info(`[menu] ${action} is not built yet`));
        button.disabled = true;
        root.appendChild(styleButton(button));
      }
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
