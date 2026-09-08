// @vitest-environment jsdom
/**
 * THE ECOLOGY BLOCK on the perf HUD (Phase 7, the ecology pass): the
 * plant families' count, the three species against their caps, what
 * they cost, the resource sites and the terrain-edit seam. Joshua asked
 * for the diagnostics "in dev tools, not the normal HUD"; this sheet is
 * the dev tool, and its job is to print what it is told and to say
 * plainly when it has not been told anything.
 *
 * Three rules pinned here. Absent hook, no lines: a scene with no
 * creatures says nothing about them. Null readout, empty lines: a count
 * nobody took is not printed as a number. And every line is held to the
 * FRAME column's widest (`95th low 52.6 fps`, seventeen characters) at
 * the largest values the caps allow, so the block could move columns
 * without widening the sheet.
 */
import { describe, expect, it } from 'vitest';
import {
  HUD_HZ, PerfHud, finderWords, type CreaturesReadout, type FinderReadout, type ObjectsReadout, type PerfReadout,
} from '../src/perf/PerfHud';
import { BUILT_LAYERS, LayerToggles } from '../src/perf/layerToggles';
import { CREATURE_IDS, CREATURE_SPECIES } from '../src/creatures';
import type { WorldLayerId } from '../src/world/WorldLoader';

function readout(meanFps = 60, lowFps = 30, simDt = 1 / 60, frames = 120): PerfReadout {
  return { frame: { meanFps, lowFps, simDt, frames }, camera: { x: 1.25, y: 2.5, z: -3.75, facing: Math.PI / 2, pitch: -0.2, speed: 40 }, aboveGround: 320 };
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** The FRAME column's widest line, which every ecology line is measured against. */
const WIDEST = '95th low 52.6 fps'.length;

const ECO_FIELDS = ['eco-worms', 'eco-aphids', 'eco-flies', 'eco-cost', 'eco-resources', 'eco-ground'] as const;

/** A lawn's worth of objects, with the plant families counted. */
const lawn: ObjectsReadout = {
  meanMs: 0.3, peakMs: 4, cells: 37, pending: 0, grass: 25_000, twig: 120, stone: 40, rock: 3, tree: 12, plants: 1234, habitat: 'grassland',
};

/** A forest at the high rung on a fair day: the brief's own sample values. */
const forest: CreaturesReadout = {
  worms: { resident: 12, near: 5, full: 2, cap: 40 },
  aphids: { resident: 80, near: 30, full: 9, cap: 150 },
  flies: { resident: 30, near: 12, full: 4, cap: 50 },
  thinkMs: 0.4, moveMs: 0.3, drawMs: 0.2, rigs: 46,
  resources: { sites: 96, waterEdges: 4 },
  ground: { built: false, applied: 0 },
};

interface RigOptions {
  readonly built?: readonly WorldLayerId[];
  readonly objects?: () => ObjectsReadout | null;
  readonly creatures?: () => CreaturesReadout | null;
  readonly weather?: boolean;
  readonly collapsed?: boolean;
  readonly finder?: () => FinderReadout;
}

function rig(options: RigOptions = {}) {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const toggles = new LayerToggles(options.built ?? []);
  const toggled: Array<[WorldLayerId, boolean]> = [];
  const finderToggles: boolean[] = [];
  const goes: number[] = [];
  const hud = new PerfHud(uiLayer, {
    layers: () => toggles.list(),
    onLayerToggle: (id, enabled) => {
      toggled.push([id, enabled]);
      toggles.setEnabled(id, enabled);
    },
    ...(options.objects === undefined ? {} : { objects: options.objects }),
    ...(options.creatures === undefined ? {} : { creatures: options.creatures }),
    ...(options.weather
      ? { weather: () => ({ sky: 'clear', rainMmHr: 0, cloud: 0.12, source: 'live' as const, clock: '14:32', sunElevationDeg: 61.4 }) }
      : {}),
    ...(options.finder === undefined ? {} : {
      finder: options.finder,
      onFinderToggle: (on: boolean) => { finderToggles.push(on); },
      onFinderGo: () => { goes.push(1); },
    }),
  }, { collapsed: options.collapsed });
  const el = (name: string): HTMLElement | null => uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const field = (name: string): string | null => el(name)?.textContent ?? null;
  const box = (id: string): HTMLInputElement =>
    must(uiLayer.querySelector<HTMLInputElement>(`[data-action="layer:${id}"]`), `checkbox layer:${id}`);
  const finderBox = (): HTMLInputElement | null => uiLayer.querySelector<HTMLInputElement>('[data-action="finder"]');
  const goButton = (): HTMLButtonElement | null => uiLayer.querySelector<HTMLButtonElement>('[data-action="finder-go"]');
  return { uiLayer, hud, toggles, toggled, el, field, box, finderToggles, goes, finderBox, goButton };
}

describe('the ecology block: when it exists at all', () => {
  it('is not built when the world offers no creatures hook — a scene without them says nothing about them', () => {
    const { field } = rig({ objects: () => lawn });
    for (const name of ECO_FIELDS) expect(field(name), name).toBeNull();
    // The plants line rides with the OBJECTS hook, not the creatures'.
    expect(field('veg-plants')).not.toBeNull();
  });

  it('has no plants line when the world offers no objects hook', () => {
    const { field } = rig({ creatures: () => forest });
    expect(field('veg-plants')).toBeNull();
    for (const name of ECO_FIELDS) expect(field(name), name).not.toBeNull();
  });

  it('leaves every line EMPTY while the hook returns null — a count nobody took is not printed as a number', () => {
    // Not "worms not built", not "worms 0 of 40": the world has the hook
    // and nothing has been built yet, and only a built simulation
    // produces a readout. Six empty lines cost the column no height.
    const { hud, field } = rig({ objects: () => null, creatures: () => null });
    hud.update(readout(), 1);
    for (const name of ECO_FIELDS) expect(field(name), name).toBe('');
    expect(field('veg-plants')).toBe('');
  });
});

describe('the ecology block: what it prints', () => {
  it('prints the sample values of the brief, line for line', () => {
    const { hud, field } = rig({ objects: () => lawn, creatures: () => forest });
    hud.update(readout(), 1);
    expect(field('veg-plants')).toBe('plants 1234');
    expect(field('eco-worms')).toBe('worms 12 of 40');
    expect(field('eco-aphids')).toBe('aphids 80 of 150');
    expect(field('eco-flies')).toBe('flies 30 of 50');
    expect(field('eco-cost')).toBe('eco 0.4+0.3+0.2ms');
    expect(field('eco-resources')).toBe('sites 96 wet 4');
    // §2.9: the terrain-edit seam is not built in v1 and the sheet says so.
    expect(field('eco-ground')).toBe('ground edits off');
  });

  it('a plant count that was never taken is an empty line, not `plants 0`', () => {
    // `plants 0` would say the ground here is bare — a fact about the
    // world — when all that is true is that this readout carries no
    // plant families to count.
    const { plants: _dropped, ...noPlants } = lawn;
    const { hud, field } = rig({ objects: () => noPlants });
    hud.update(readout(), 1);
    expect(field('veg-plants')).toBe('');
    expect(field('veg-grass')).toBe('grass 25000');
  });

  it('says `sites off` when the resources layer is off, never a count of nothing', () => {
    const { hud, field } = rig({ creatures: () => ({ ...forest, resources: null }) });
    hud.update(readout(), 1);
    expect(field('eco-resources')).toBe('sites off');
    expect(field('eco-resources')).not.toContain('0');
  });

  it('prints the bore count only from a seam that says it is built', () => {
    let ground = { built: false, applied: 12 };
    const { hud, field } = rig({ creatures: () => ({ ...forest, ground }) });
    hud.update(readout(), 1);
    // Twelve bores went to a no-op editor: nothing was edited, and the
    // line does not print how many times nothing happened.
    expect(field('eco-ground')).toBe('ground edits off');
    ground = { built: true, applied: 12 };
    hud.update(readout(), 1);
    expect(field('eco-ground')).toBe('ground edits 12');
  });

  it('re-reads the hook every refresh, so a species switched off drops to 0 of its cap on the line', () => {
    let worms = forest.worms;
    const { hud, field } = rig({ creatures: () => ({ ...forest, worms }) });
    hud.update(readout(), 1);
    expect(field('eco-worms')).toBe('worms 12 of 40');
    worms = { resident: 0, near: 0, full: 0, cap: 40 };
    hud.update(readout(), 1);
    expect(field('eco-worms')).toBe('worms 0 of 40');
  });

  it('rounds the cost to a tenth, and to whole milliseconds only when the tenths would not fit', () => {
    let cost = { thinkMs: 1.26, moveMs: 0.04, drawMs: 9.95 };
    const { hud, field } = rig({ creatures: () => ({ ...forest, ...cost }) });
    hud.update(readout(), 1);
    expect(field('eco-cost')).toBe('eco 1.3+0.0+9.9ms');
    // Past ten milliseconds a part the tenths push the line to eighteen
    // characters, and a system costing that much is not read to a tenth.
    cost = { thinkMs: 12.34, moveMs: 3.2, drawMs: 1.05 };
    hud.update(readout(), 1);
    expect(field('eco-cost')).toBe('eco 12+3+1ms');
  });
});

describe('the ecology block: its width and its place', () => {
  it('holds every line to the FRAME column\'s widest at the largest values the caps allow', () => {
    // Ultra-high caps from the species table: worms 60, aphids 300,
    // flies 80. Costs of 99.9 ms a part, which is a phone that has
    // already stopped. Sites in the thousands and a long session's
    // bores, which the compact count keeps short.
    const worst: CreaturesReadout = {
      worms: { resident: 60, near: 60, full: 60, cap: 60 },
      aphids: { resident: 300, near: 300, full: 300, cap: 300 },
      flies: { resident: 80, near: 80, full: 80, cap: 80 },
      thinkMs: 99.9, moveMs: 99.9, drawMs: 99.9, rigs: 440,
      resources: { sites: 9_999, waterEdges: 99 },
      ground: { built: true, applied: 999_999 },
    };
    const { hud, field } = rig({ objects: () => ({ ...lawn, plants: 60_000 }), creatures: () => worst });
    hud.update(readout(), 1);
    expect(field('eco-worms')).toBe('worms 60 of 60');
    expect(field('eco-aphids')).toBe('aphids 300 of 300');
    expect(field('eco-flies')).toBe('flies 80 of 80');
    expect(field('eco-cost')).toBe('eco 100+100+100ms');
    expect(field('eco-resources')).toBe('sites 9999 wet 99');
    expect(field('eco-ground')).toBe('ground edits 1.0M');
    expect(field('veg-plants')).toBe('plants 60k');
    for (const name of [...ECO_FIELDS, 'veg-plants']) {
      expect((field(name) ?? '').length, `${name}: "${field(name)}"`).toBeLessThanOrEqual(WIDEST);
    }
  });

  it('keeps a count short past ten thousand, so a long session cannot grow the line', () => {
    const { hud, field } = rig({
      creatures: () => ({ ...forest, resources: { sites: 25_000, waterEdges: 999 }, ground: { built: true, applied: 12_345_678 } }),
    });
    hud.update(readout(), 1);
    expect(field('eco-resources')).toBe('sites 25k wet 999');
    expect(field('eco-ground')).toBe('ground edits 12M');
    expect((field('eco-resources') ?? '').length).toBeLessThanOrEqual(WIDEST);
    expect((field('eco-ground') ?? '').length).toBeLessThanOrEqual(WIDEST);
  });

  it('sits in the CAMERA column under the clock, in order, and never in FRAME or a column of its own', () => {
    // FRAME is fifteen lines and a heading, and at the design canvas the
    // sheet's bottom edge already meets the stick's ring; seven lines
    // there would bury it. CAMERA is five lines and the widest column on
    // the sheet, so these cost it neither height nor width — the clock
    // moved there for the same reason.
    const { uiLayer, hud, el } = rig({ objects: () => lawn, creatures: () => forest, weather: true });
    hud.update(readout(), 1);
    const frame = must(el('mean-fps'), 'mean field').parentElement;
    const camera = must(el('camera-above'), 'above line').parentElement;
    expect(camera).not.toBe(frame);
    const order = ['weather-clock', 'veg-plants', ...ECO_FIELDS].map((name) => must(el(name), name));
    for (const line of order) expect(line.parentElement, line.dataset.field).toBe(camera);
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${order[i - 1].dataset.field} before ${order[i].dataset.field}`,
      ).toBeTruthy();
    }
    // The clock still follows `above`, and the block follows the clock.
    expect(must(el('camera-above'), 'above').compareDocumentPosition(order[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No column of its own.
    for (const heading of ['ECO', 'CREATURES', 'ECOLOGY', 'PLANTS']) expect(uiLayer.textContent).not.toContain(heading);
    // And the weather's FRAME lines are still FRAME's.
    expect(must(el('weather-sky'), 'sky').parentElement).toBe(frame);
  });

  it('folded, the HUD writes only the summary: the block is not touched and the hook is not asked', () => {
    let asked = 0;
    const { hud, field } = rig({
      creatures: () => {
        asked += 1;
        return forest;
      },
    });
    hud.update(readout(), 1);
    expect(field('eco-worms')).toBe('worms 12 of 40');
    const askedWhileOpen = asked;
    expect(askedWhileOpen).toBeGreaterThan(0);
    hud.collapsed = true;
    for (let i = 0; i < 10; i += 1) hud.update(readout(25, 15, 0), 1 / HUD_HZ);
    expect(field('summary')).toBe('25.0 fps · low 15.0');
    expect(field('eco-worms')).toBe('worms 12 of 40');
    expect(asked).toBe(askedWhileOpen);
    hud.collapsed = false;
    hud.update(readout(45, 40), 0.016);
    expect(asked).toBeGreaterThan(askedWhileOpen);
  });
});

describe('the four new layer rows', () => {
  const NEW_LAYERS: readonly WorldLayerId[] = ['resources', 'worms', 'aphids', 'flies'];

  it('exist, are built, come after vegetation, and toggle through the hook', () => {
    const { hud, box, toggled, toggles } = rig({ built: BUILT_LAYERS });
    const vegetation = box('vegetation');
    for (const id of NEW_LAYERS) {
      const b = box(id);
      expect(b.type).toBe('checkbox');
      expect(b.disabled, id).toBe(false);
      expect(b.checked, id).toBe(false);
      expect(must(b.parentElement, `${id} row`).textContent, id).toBe(id);
      // In the plan's order: after vegetation.
      expect(vegetation.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING, `${id} after vegetation`).toBeTruthy();
    }
    // The player's row is still the one that reads "not built".
    expect(box('player').disabled).toBe(true);
    expect(must(box('player').parentElement, 'player row').textContent).toContain('not built');

    for (const id of NEW_LAYERS) {
      const b = box(id);
      b.checked = true;
      b.dispatchEvent(new Event('change'));
    }
    expect(toggled).toEqual(NEW_LAYERS.map((id) => [id, true]));
    expect(toggles.enabled()).toEqual(NEW_LAYERS);

    // The model wins over the DOM at the next refresh.
    const worms = box('worms');
    worms.checked = false;
    hud.update(readout(), 1);
    expect(worms.checked).toBe(true);
    toggles.setEnabled('worms', false);
    hud.update(readout(), 1);
    expect(worms.checked).toBe(false);
  });

  it('read "not built" and refuse to come on in a build that does not name them', () => {
    // The scene decides what is built at the moment it constructs the
    // toggles (`vegetation` only when the landcover landed); a build
    // that leaves these out gets four honest rows, not four live ones.
    const { box } = rig({ built: ['terrain', 'vegetation'] });
    for (const id of NEW_LAYERS) {
      const b = box(id);
      expect(b.disabled, id).toBe(true);
      expect(must(b.parentElement, `${id} row`).textContent).toContain('not built');
    }
  });
});

/**
 * THE FINDER (Joshua, 2026-09-08: "I don't see any worms in the game...
 * can you make a simple 3D finder I can turn on to find them better?").
 *
 * The switch is a TOOL, not a world layer, so it is not in the plan's
 * list; the line says which animal is nearest and which way to fly; and
 * GO is dead until there is somewhere to go, because an unavailable
 * action must never look functional.
 */
const finderOff: FinderReadout = { on: false, pins: 0, nearest: null };
const finderOn = (over: Partial<FinderReadout> = {}): FinderReadout => ({
  on: true,
  pins: 41,
  nearest: { species: 'worm', metres: 12.4, bearing: 45, under: false },
  ...over,
});

describe('the finder', () => {
  it('is absent entirely from a world that has no creatures to find', () => {
    const { field, finderBox, goButton } = rig({ creatures: () => forest });
    expect(field('eco-find')).toBeNull();
    expect(finderBox()).toBeNull();
    expect(goButton()).toBeNull();
  });

  it('adds ONE switch, and it is not one of the world layers', () => {
    const { finderBox, box } = rig({ built: BUILT_LAYERS, finder: () => finderOff });
    expect(finderBox()).not.toBeNull();
    // Every world layer still has its own row, and `finder` is not among them.
    for (const id of BUILT_LAYERS) expect(box(id)).not.toBeNull();
    expect(BUILT_LAYERS).not.toContain('finder' as WorldLayerId);
  });

  it('says off while it is off, and names the nearest animal when it is on', () => {
    let state = finderOff;
    const { hud, field } = rig({ finder: () => state });
    hud.update(readout(), 1);
    expect(field('eco-find')).toBe('find off');
    state = finderOn();
    hud.update(readout(), HUD_HZ);
    expect(field('eco-find')).toBe('find worm 12m NE');
  });

  it('says so when the animal is underground — the reason it cannot be seen', () => {
    const words = finderWords(finderOn({ nearest: { species: 'worm', metres: 3.2, bearing: 190, under: true } }));
    expect(words).toBe('under worm 3m S');
  });

  it('says nothing near rather than pretending a distance', () => {
    expect(finderWords(finderOn({ nearest: null }))).toBe('find nothing near');
  });

  it('holds every state the table can actually produce to the column width', () => {
    // ONLY A BURROWER IS EVER `under`, and the earthworm is the only one
    // in the table with a burrow — which is what keeps the longest state
    // inside the column: `under worm 40m NE` is seventeen characters at
    // the farthest reach the table has (the housefly's 40 m) and a
    // two-letter bearing. `under aphid ...` would be eighteen, and is
    // unreachable rather than merely unlikely, so the species table is
    // asked here rather than trusted.
    expect(CREATURE_SPECIES.aphid.burrow).toBeNull();
    expect(CREATURE_SPECIES.housefly.burrow).toBeNull();
    expect(CREATURE_SPECIES.earthworm.burrow).not.toBeNull();
    const reach = Math.max(...CREATURE_IDS.map((id) => CREATURE_SPECIES[id].population.reachM));

    const states: FinderReadout[] = [
      finderOff,
      finderOn({ nearest: null }),
      finderOn({ nearest: { species: 'worm', metres: reach, bearing: 45, under: true } }),
      finderOn({ nearest: { species: 'aphid', metres: reach, bearing: 315, under: false } }),
      finderOn({ nearest: { species: 'fly', metres: 0.4, bearing: 0, under: false } }),
    ];
    for (const state of states) {
      const words = finderWords(state);
      expect(words.length, words).toBeLessThanOrEqual(WIDEST);
    }
    expect(finderWords(states[2])).toBe('under worm 40m NE');
  });

  it('carries the tap back to the owner and follows the model, not the click', () => {
    let state = finderOff;
    const { hud, finderBox, finderToggles } = rig({ finder: () => state });
    const box = must(finderBox(), 'the finder switch');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(finderToggles).toEqual([true]);
    // The owner has not agreed yet, so the box goes back to what the model says.
    hud.update(readout(), 1);
    expect(box.checked).toBe(false);
    state = finderOn();
    hud.update(readout(), HUD_HZ);
    expect(box.checked).toBe(true);
  });

  it('GO is dead until there is somewhere to go, and never looks otherwise', () => {
    let state = finderOff;
    const { hud, goButton, goes } = rig({ finder: () => state });
    const go = must(goButton(), 'the go button');
    hud.update(readout(), 1);
    expect(go.disabled).toBe(true);
    expect(Number(go.style.opacity)).toBeLessThan(1);

    // On, but the simulation is holding nothing: still nowhere to go.
    state = finderOn({ nearest: null });
    hud.update(readout(), HUD_HZ);
    expect(go.disabled).toBe(true);

    state = finderOn();
    hud.update(readout(), HUD_HZ);
    expect(go.disabled).toBe(false);
    expect(Number(go.style.opacity)).toBe(1);
    go.dispatchEvent(new Event('click'));
    expect(goes).toHaveLength(1);
  });

  it('prints nothing at all when the hook is absent', () => {
    expect(finderWords(null)).toBe('');
  });
});
