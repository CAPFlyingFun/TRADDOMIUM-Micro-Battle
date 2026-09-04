/**
 * Phase 0 placeholder — replaced by the perf agent's PerformanceWorldScene.
 *
 * A grid, a static camera, and a way back. Enters the `playing` state so
 * the frame loop's pause gate has something real to gate.
 */
import * as THREE from 'three';
import { ACTION, actionButton } from '../actions';
import { sceneFactory } from '../registry';
import type { AppScene, FrameInfo, SceneContext } from '../Scene';
import { styleButton } from './dom';

export function emptyWorldPlaceholder(ctx: SceneContext): AppScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color('#101a22');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(12, 8, 12);
  camera.lookAt(0, 0, 0);
  const grid = new THREE.GridHelper(40, 40, 0xc9a94a, 0x2a3a2a);
  three.add(grid);
  let readout: HTMLElement | null = null;
  let back: HTMLButtonElement | null = null;

  const leave = async (): Promise<void> => {
    await ctx.app.endSession();
    ctx.app.requestState('menu');
    await ctx.scenes.goTo(sceneFactory('menu'));
  };

  return {
    name: 'empty-world-placeholder',
    three,
    camera,
    async enter() {
      ctx.app.requestState('playing');
      readout = ctx.uiLayer.ownerDocument.createElement('div');
      readout.style.cssText =
        'position:absolute;top:10px;left:12px;color:#e8e2c8;font:13px ui-monospace,monospace;';
      ctx.uiLayer.appendChild(readout);
      back = styleButton(actionButton(ACTION.back, 'Back to menu', () => void leave()));
      back.style.cssText += 'position:absolute;right:12px;top:10px;min-width:0;';
      ctx.uiLayer.appendChild(back);
    },
    update(frame: FrameInfo) {
      if (readout) readout.textContent = `raw dt ${frame.rawDt.toFixed(4)} s   sim dt ${frame.simDt.toFixed(4)} s`;
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      readout?.remove();
      back?.remove();
      readout = null;
      back = null;
    },
  };
}
