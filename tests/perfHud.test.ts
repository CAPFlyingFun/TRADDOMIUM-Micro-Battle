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
  return { frame: { meanFps, lowFps, simDt, frames }, camera: { x: 1.25, y: 2.5, z: -3.75, facing: Math.PI / 2, speed: 40 } };
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

/**
 * THE SEA COLUMN — the device-visible half of the CPU/GPU question
 * Joshua asked this phase for. The HUD's job is to print what it is told
 * and to say plainly when it has not been told anything yet.
 */
describe('the sea rows', () => {
  const seaRig = (sea?: () => { meanMs: number; peakMs: number; tier: string } | null) => {
    const uiLayer = document.createElement('div');
    document.body.appendChild(uiLayer);
    const toggles = new LayerToggles([]);
    const hud = new PerfHud(uiLayer, {
      layers: () => toggles.list(),
      onLayerToggle: (id, enabled) => toggles.setEnabled(id, enabled),
      ...(sea === undefined ? {} : { sea }),
    });
    const field = (name: string): string | null =>
      uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`)?.textContent ?? null;
    return { uiLayer, hud, field };
  };

  it('are not built at all when the world has no sea to ask about', () => {
    // A readout about an ocean that is never coming is a claim of its
    // own — the same rule the SESSION column follows.
    const { field } = seaRig();
    expect(field('sea-mean')).toBeNull();
    expect(field('sea-peak')).toBeNull();
    expect(field('sea-rung')).toBeNull();
  });

  it('say the ocean is not built YET rather than showing it costing nothing', () => {
    const { hud, field } = seaRig(() => null);
    hud.update(readout(60, 30, 1 / 60), 1);
    expect(field('sea-mean')).toBe('sea      not built');
    expect(field('sea-peak')).toBe('');
    expect(field('sea-rung')).toBe('');
  });

  it('print the mean, the PEAK and the rung', () => {
    // The peak is shown because a mean alone hides the refill frame, and
    // a hitch is exactly what "slightly choppy" describes.
    const { hud, field } = seaRig(() => ({ meanMs: 0.042, peakMs: 12.34, tier: 'medium' }));
    hud.update(readout(60, 30, 1 / 60), 1);
    expect(field('sea-mean')).toBe('sea mean 0.04 ms');
    expect(field('sea-peak')).toBe('sea peak 12.3 ms');
    expect(field('sea-rung')).toBe('sea rung medium');
  });

  it('SIT IN THE FRAME COLUMN, and never widen it past the lines already there', () => {
    // A column of their own does not fit: the HUD is a flex row, and at
    // the 932 px canvas the existing columns already come within about
    // 80 px of PAUSE. So these go under the frame rate — which is what
    // they have to be read against anyway — and are kept to the width of
    // "95th low 30.0 fps". probe:bot measures the real thing in a room,
    // where the HUD is widest; this pins the intent so a later edit
    // cannot quietly grow one of them past it.
    const { uiLayer, hud, field } = seaRig(() => ({ meanMs: 0.042, peakMs: 12.34, tier: 'ultra-low' }));
    hud.update(readout(60, 30, 1 / 60), 1);
    const widest = '95th low 30.0 fps'.length;
    for (const name of ['sea-mean', 'sea-peak', 'sea-rung']) {
      expect((field(name) ?? '').length, name).toBeLessThanOrEqual(widest + 1);
    }
    // And they are in the FRAME column, not a new one.
    const mean = uiLayer.querySelector('[data-field="mean-fps"]');
    const seaMean = uiLayer.querySelector('[data-field="sea-mean"]');
    expect(seaMean?.parentElement).toBe(mean?.parentElement);
    expect(uiLayer.textContent).not.toContain('SEA');
  });

  it('re-read the hook every refresh, so a rebuilt sea is not stale on the line', () => {
    // Quality is changed from the pause menu and rebuilds the ocean at a
    // different rung. A line written once would keep naming the old one.
    let tier = 'high';
    const { hud, field } = seaRig(() => ({ meanMs: 1, peakMs: 2, tier }));
    hud.update(readout(60, 30, 1 / 60), 1);
    expect(field('sea-rung')).toBe('sea rung high');
    tier = 'low';
    hud.update(readout(60, 30, 1 / 60), 1);
    expect(field('sea-rung')).toBe('sea rung low');
  });

  it('cost no DOM writes while the HUD is hidden', () => {
    let asked = 0;
    const { hud } = seaRig(() => {
      asked += 1;
      return { meanMs: 0, peakMs: 0, tier: 'medium' };
    });
    hud.update(readout(60, 30, 1 / 60), 1);
    const before = asked;
    expect(before).toBeGreaterThan(0); // the hook IS asked while the HUD is shown
    hud.hidden = true;
    for (let i = 0; i < 10; i += 1) hud.update(readout(60, 30, 1 / 60), 1 / HUD_HZ);
    expect(asked).toBe(before);
  });
});
