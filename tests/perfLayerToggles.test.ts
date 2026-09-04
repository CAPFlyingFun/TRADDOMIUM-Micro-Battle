/**
 * The pure layer-toggle model behind the perf HUD's LAYERS column: an
 * unbuilt layer can never be switched on (§2.9), and what IS on comes back
 * in the world plan's order.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_LAYERS, LayerToggles } from '../src/perf/layerToggles';
import { WORLD_LAYERS } from '../src/world/WorldLoader';

describe('LayerToggles', () => {
  it('lists every layer of the world plan, in plan order, off', () => {
    const rows = new LayerToggles([]).list();
    expect(rows.map((r) => r.id)).toEqual([...WORLD_LAYERS]);
    expect(rows.every((r) => !r.enabled)).toBe(true);
  });

  it('Phase 0 has built nothing: every row reads not built and none can be switched on', () => {
    expect(BUILT_LAYERS).toEqual([]);
    const toggles = new LayerToggles(BUILT_LAYERS);
    for (const row of toggles.list()) {
      expect(row.built).toBe(false);
      expect(toggles.setEnabled(row.id, true)).toBe(false);
      expect(toggles.isEnabled(row.id)).toBe(false);
    }
    expect(toggles.enabled()).toEqual([]);
    expect(new LayerToggles().list()).toEqual(toggles.list());
  });

  it('a built layer toggles, and setEnabled reports only real changes', () => {
    const toggles = new LayerToggles(['terrain']);
    expect(toggles.list().find((r) => r.id === 'terrain')?.built).toBe(true);
    expect(toggles.setEnabled('terrain', true)).toBe(true);
    expect(toggles.setEnabled('terrain', true)).toBe(false);
    expect(toggles.isEnabled('terrain')).toBe(true);
    expect(toggles.list().find((r) => r.id === 'terrain')?.enabled).toBe(true);
    expect(toggles.setEnabled('terrain', false)).toBe(true);
    expect(toggles.enabled()).toEqual([]);
  });

  it('enabled() comes back in plan order whatever order the player clicked in', () => {
    const toggles = new LayerToggles(['ocean', 'terrain', 'player']);
    toggles.setEnabled('player', true);
    toggles.setEnabled('ocean', true);
    toggles.setEnabled('terrain', true);
    expect(toggles.enabled()).toEqual(['terrain', 'ocean', 'player']);
  });

  it('an unbuilt layer stays off in a build where its neighbours are built', () => {
    const toggles = new LayerToggles(['terrain']);
    expect(toggles.setEnabled('ocean', true)).toBe(false);
    expect(toggles.isEnabled('ocean')).toBe(false);
    expect(toggles.list().find((r) => r.id === 'ocean')).toEqual({ id: 'ocean', built: false, enabled: false });
  });
});
