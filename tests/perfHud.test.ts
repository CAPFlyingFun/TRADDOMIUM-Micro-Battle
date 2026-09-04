// @vitest-environment jsdom
/**
 * The perf HUD's DOM: two separate readouts, an honest LAYERS column, and a
 * refresh rate that is not the frame rate. No three: the HUD reads structs.
 */
import { describe, expect, it } from 'vitest';
import { HUD_HZ, PerfHud, type PerfReadout } from '../src/perf/PerfHud';
import { LayerToggles } from '../src/perf/layerToggles';
import { WORLD_LAYERS, type WorldLayerId } from '../src/world/WorldLoader';

function readout(meanFps: number, lowFps: number, simDt: number, frames = 120): PerfReadout {
  return { frame: { meanFps, lowFps, simDt, frames }, camera: { x: 1.25, y: 2.5, z: -3.75, speed: 40 } };
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

function rig(built: readonly WorldLayerId[] = []) {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const toggles = new LayerToggles(built);
  const toggled: Array<[WorldLayerId, boolean]> = [];
  const hud = new PerfHud(uiLayer, {
    layers: () => toggles.list(),
    onLayerToggle: (id, enabled) => {
      toggled.push([id, enabled]);
      toggles.setEnabled(id, enabled);
    },
  });
  const field = (name: string): string =>
    must(uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`), `field ${name}`).textContent ?? '';
  const box = (id: string): HTMLInputElement =>
    must(uiLayer.querySelector<HTMLInputElement>(`[data-action="layer:${id}"]`), `checkbox layer:${id}`);
  return { uiLayer, hud, toggles, toggled, field, box };
}

describe('PerfHud', () => {
  it('shows FRAME (raw) and SIM dt as two separately headed readouts, plus the camera', () => {
    const { uiLayer, hud, field } = rig();
    expect(uiLayer.querySelector('[data-role="perf-hud"]')).not.toBeNull();
    expect(uiLayer.textContent).toContain('FRAME (raw)');
    expect(uiLayer.textContent).toContain('SIM dt');

    // An empty window is said to be empty, not shown as 0.0 fps.
    hud.update(readout(0, 0, 0, 0), 0.016);
    expect(field('mean-fps')).toContain('no frames yet');
    expect(field('low-fps')).toContain('no frames yet');

    hud.update(readout(60, 30, 1 / 60), 1);
    expect(field('mean-fps')).toBe('mean     60.0 fps');
    expect(field('low-fps')).toBe('95th low 30.0 fps');
    expect(field('sim-dt')).toBe('16.7 ms');
    expect(field('camera-position')).toBe('x 1.3  y 2.5  z -3.8');
    expect(field('camera-speed')).toBe('speed 40 units/s');

    // Different columns: the frame fields and the sim field have different parents.
    const mean = must(uiLayer.querySelector('[data-field="mean-fps"]'), 'mean field');
    const sim = must(uiLayer.querySelector('[data-field="sim-dt"]'), 'sim field');
    expect(mean.parentElement).not.toBe(sim.parentElement);
  });

  it('reads "paused" when sim dt is 0 while the raw frame rate keeps reporting', () => {
    const { hud, field } = rig();
    hud.update(readout(58.5, 41.2, 0), 1);
    expect(field('sim-dt')).toBe('paused');
    expect(field('mean-fps')).toBe('mean     58.5 fps');
    expect(field('low-fps')).toBe('95th low 41.2 fps');
  });

  it('refreshes the DOM at HUD_HZ, timed by raw dt, not every frame', () => {
    const { hud, field } = rig();
    expect(HUD_HZ).toBe(5);
    hud.update(readout(60, 60, 1 / 60), 0.016);
    expect(field('mean-fps')).toBe('mean     60.0 fps');
    // 16 ms later with new numbers: the text has not changed.
    hud.update(readout(30, 20, 0), 0.016);
    expect(field('mean-fps')).toBe('mean     60.0 fps');
    // Keep feeding 16 ms frames until a refresh period (200 ms) has passed.
    for (let i = 0; i < 12; i += 1) hud.update(readout(30, 20, 0), 0.016);
    expect(field('mean-fps')).toBe('mean     30.0 fps');
    expect(field('sim-dt')).toBe('paused');
  });

  it('lists the base world and every planned layer; unbuilt layers are disabled and say so', () => {
    const { box } = rig();
    const empty = box('empty');
    expect(empty.checked).toBe(true);
    expect(empty.disabled).toBe(true);
    expect(must(empty.parentElement, 'empty row').textContent).toContain('always on');
    for (const id of WORLD_LAYERS) {
      const b = box(id);
      expect(b.type).toBe('checkbox');
      expect(b.disabled).toBe(true);
      expect(b.checked).toBe(false);
      expect(must(b.parentElement, `${id} row`).textContent).toContain('not built');
    }
  });

  it('a built layer toggles through the hook, and the model wins over the DOM at the next refresh', () => {
    const { hud, box, toggled, toggles } = rig(['terrain']);
    const terrain = box('terrain');
    expect(terrain.disabled).toBe(false);
    expect(must(terrain.parentElement, 'terrain row').textContent).not.toContain('not built');
    expect(box('ocean').disabled).toBe(true);

    terrain.checked = true;
    terrain.dispatchEvent(new Event('change'));
    expect(toggled).toEqual([['terrain', true]]);
    expect(toggles.enabled()).toEqual(['terrain']);

    terrain.checked = false;
    hud.update(readout(60, 60, 1 / 60), 1);
    expect(terrain.checked).toBe(true);
  });

  it('dispose removes everything it added to the layer', () => {
    const { uiLayer, hud } = rig();
    expect(uiLayer.children.length).toBe(1);
    hud.dispose();
    expect(uiLayer.children.length).toBe(0);
  });
});
