// @vitest-environment jsdom
/**
 * The Creature Lab as a scene: the bench built, the five placed, the
 * queen held by default; the possess row, OBSERVE, RESET and PREDATION
 * driving the ledger, the label and the policy; the overlay naming
 * every creature; the right thumb's cluster showing only what the held
 * body's medium can honour; a tap on a drawn body taking it; the
 * disturb tool and the camera's presence reaching the bench; and, since
 * Creature Lab D, the block's two solids handed to the simulation, the
 * held body's up handed to the follow camera, and the overlay naming
 * the face under a climber's feet. three's scene graph builds without
 * WebGL under jsdom; the rigs are the loader's honest placeholders, so
 * no file is fetched.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '../src/actor/PlayerId';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import type { Assets } from '../src/assets/assets';
import {
  BLOCK, CREATURE_SPECIES, FACE_NORMALS, LAB_CREATURE_IDS, LAB_FLOOR, MM_PER_UNIT, PILLAR, PILLAR_BOX, SLAB_BOX, WORLD_UP, labSpawns,
  type CreatureId, type CreatureState, type Vec3,
} from '../src/creatures';
import { Input } from '../src/input/Input';
import {
  LAB_ACTION, LAB_BUTTON_ACTION, LAB_FIELD, LAB_HUD_ROLE, LAB_SCENE_ID, LAB_TOOL_ID, OBSERVE_LABEL, POSSESS_ROW, PREDATION_ORDER,
  buildCreatureLabScene, buttonsFor, controlLabel, creatureField, creatureLabTool, nextPredation, possessAction, possessedSpeciesOf,
  predationLabel, type CreatureLabHooks, type CreatureLabScene, type LabButtonKind,
} from '../src/lab';
import { DISTURB_RADIUS, HELD_DURING_A_RUN, rigModeLabel, stressPoolLabel, stressPoolWords } from '../src/lab/labTool';
import { BREAK_HOLD_S, MAX_CREATURES, RECOVERY_S, SETTLE_S, SPAWN_EVERY_S, WINDOW_S } from '../src/lab/stressTest';
import { rigBudgetFor } from '../src/fauna/FaunaView';
import { world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';

const SIXTY = 1 / 60;
/** The rung the Lab builds its view at (`CreatureLabScene.LAB_RUNG`, private there). */
const LAB_RUNG_NAME = 'medium';
const PLAYER = playerId('creature-lab-test-player');

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** The loader's answer for a missing file: a placeholder body of the species' size. No file is fetched. */
const placeholders: Assets['loadModel'] = (path, placeholderFactory) => {
  const placeholder = placeholderFactory();
  placeholder.userData.isPlaceholder = true;
  placeholder.userData.expectedUrl = path;
  return Promise.resolve(placeholder);
};

interface Rig {
  readonly scene: CreatureLabScene;
  readonly uiLayer: HTMLElement;
  readonly host: HTMLElement;
  readonly input: Input;
  readonly backs: () => number;
  readonly field: (name: string) => string;
  readonly button: (action: string) => HTMLButtonElement;
  readonly press: (action: string) => void;
  readonly frame: (n?: number, simDt?: number, rawDt?: number) => void;
  readonly creature: (species: CreatureId) => CreatureState;
  readonly heldSpecies: () => CreatureId | null;
  readonly shownButtons: () => LabButtonKind[];
  readonly key: (code: string, down: boolean) => void;
}

const rigs: Rig[] = [];

function rig(): Rig {
  const app: AppHandle = {
    state: 'menu',
    requestState: () => {},
    session: null,
    startSession: () => {},
    endSession: async () => {},
  };
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const input = new Input();
  const host = document.createElement('div');
  document.body.appendChild(host);
  input.attach(host);
  // uiLayer, input and app only: a lab that reached for the renderer, storage or assets would fail here.
  const ctx = { uiLayer, input, app } as unknown as SceneContext;
  let backs = 0;
  let clock = 0;
  const hooks: CreatureLabHooks = {
    identity: () => ({ playerId: PLAYER, name: 'Tester' }),
    onBack: () => {
      backs += 1;
    },
    loadModel: placeholders,
    now: () => (clock += 0.01),
  };
  const scene = buildCreatureLabScene(ctx, hooks);
  scene.resize(932, 430);
  let elapsed = 0;
  // `rawDt` is separate from `simDt` on purpose (ARCHITECTURE §2.4), and the
  // stress test reads the RAW one — so a test that wants a slow phone says so.
  const frame = (n = 1, simDt = SIXTY, rawDt = SIXTY): void => {
    for (let i = 0; i < n; i += 1) {
      elapsed += simDt;
      scene.update({ rawDt, simDt, elapsed });
      input.endFrame();
    }
  };
  const field = (name: string): string =>
    must(uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`), `field ${name}`).textContent ?? '';
  const button = (action: string): HTMLButtonElement =>
    must(uiLayer.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`), `button ${action}`);
  const press = (action: string): void => {
    const b = button(action);
    expect(b.disabled, `${action} should be enabled to press it`).toBe(false);
    b.click();
  };
  const creature = (species: CreatureId): CreatureState => must(scene.lab.creatureOf(species), `the ${species}`);
  const heldSpecies = (): CreatureId | null => scene.lab.held()?.species ?? null;
  const shownButtons = (): LabButtonKind[] => {
    const cluster = must(uiLayer.querySelector<HTMLElement>('[data-role="lab-held"]'), 'the held cluster');
    if (cluster.hidden) return [];
    const out: LabButtonKind[] = [];
    for (const kind of ['up', 'down', 'primary', 'secondary', 'sprint'] as const) {
      const b = must(cluster.querySelector<HTMLButtonElement>(`button[data-action="${LAB_BUTTON_ACTION[kind]}"]`), kind);
      if (!b.hidden) out.push(kind);
    }
    return out;
  };
  const key = (code: string, down: boolean): void => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  };
  const r: Rig = { scene, uiLayer, host, input, backs: () => backs, field, button, press, frame, creature, heldSpecies, shownButtons, key };
  rigs.push(r);
  return r;
}

async function entered(): Promise<Rig> {
  const r = rig();
  await r.scene.enter();
  await must(r.scene.fauna, 'the fauna view').ready();
  return r;
}

afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.scene.dispose();
    r.input.detach();
    r.uiLayer.remove();
    r.host.remove();
  }
  setOrigin(world(0, 0));
});

/** Every overlay block's text, by species. */
function overlay(r: Rig): Record<CreatureId, string> {
  const out = {} as Record<CreatureId, string>;
  for (const id of LAB_CREATURE_IDS) out[id] = r.field(creatureField(id));
  return out;
}

function playersIn(blocks: Record<CreatureId, string>): CreatureId[] {
  return LAB_CREATURE_IDS.filter((id) => / · PLAYER · /.test(blocks[id]));
}

/** A click on the canvas as the Input delivers it: pointer down, then up, at the same spot. */
function click(host: HTMLElement, x: number, y: number): void {
  for (const type of ['pointerdown', 'pointerup']) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    host.dispatchEvent(e);
  }
}

describe('labTool: the names', () => {
  it('is a scene tool under its own id, outside the world: prefix', () => {
    expect(creatureLabTool.id).toBe(LAB_TOOL_ID);
    expect(creatureLabTool.sceneId).toBe(LAB_SCENE_ID);
    expect(LAB_SCENE_ID).toBe('lab:creatures');
    expect(LAB_SCENE_ID.startsWith('world:')).toBe(false);
  });

  it('names the possess row by species and reads the species back off the action', () => {
    expect(POSSESS_ROW.map((e) => e.label)).toEqual(['QUEEN', 'WORKER', 'WORM', 'APHID', 'FLY']);
    for (const entry of POSSESS_ROW) {
      expect(possessAction(entry.species)).toBe(`lab:possess:${entry.species}`);
      expect(possessedSpeciesOf(possessAction(entry.species))).toBe(entry.species);
    }
    expect(possessedSpeciesOf('lab:possess:dragon')).toBeNull();
    expect(possessedSpeciesOf(LAB_ACTION.reset)).toBeNull();
  });

  it('cycles predation OFF → NORMAL → FORCE → OFF and labels it', () => {
    expect(PREDATION_ORDER).toEqual(['off', 'normal', 'force']);
    expect(nextPredation('off')).toBe('normal');
    expect(nextPredation('normal')).toBe('force');
    expect(nextPredation('force')).toBe('off');
    expect(predationLabel('force')).toBe('PREDATION: FORCE');
  });

  it('labels control by the species name and the observer words', () => {
    expect(controlLabel(CREATURE_SPECIES.queen)).toBe('CONTROL: WINGED QUEEN');
    expect(controlLabel(CREATURE_SPECIES.earthworm)).toBe('CONTROL: EARTHWORM');
    expect(controlLabel(null)).toBe(OBSERVE_LABEL);
    expect(OBSERVE_LABEL).toBe('CONTROL: NONE (OBSERVE)');
  });

  it('offers a medium only the buttons its body honours', () => {
    expect(buttonsFor('ground', false)).toEqual(['primary', 'sprint']);
    expect(buttonsFor('ground', true)).toEqual(['up', 'down', 'primary', 'secondary', 'sprint']);
    expect(buttonsFor('soil', false)).toEqual(['up', 'down', 'primary', 'sprint']);
    expect(buttonsFor('air', false)).toEqual(['up', 'down', 'primary', 'secondary', 'sprint']);
    expect(buttonsFor('plant', false)).toEqual(['primary', 'secondary', 'sprint']);
  });
});

describe('CreatureLabScene', () => {
  it('constructs, enters, and builds the bench, the animals, the HUD and the stick', async () => {
    const r = await entered();
    expect(r.scene.name).toBe(LAB_SCENE_ID);
    const bench = must(r.scene.three.getObjectByName('lab:bench'), 'the bench');
    expect(bench.getObjectByName('lab:floor')).toBeInstanceOf(THREE.Mesh);
    // The block is its two solids (Creature Lab D): the slab on its pillar, each with its edges.
    expect(bench.getObjectByName('lab:pillar')).toBeInstanceOf(THREE.Mesh);
    expect(bench.getObjectByName('lab:slab')).toBeInstanceOf(THREE.Mesh);
    expect(bench.getObjectByName('lab:pillar-edges')).toBeInstanceOf(THREE.LineSegments);
    expect(bench.getObjectByName('lab:slab-edges')).toBeInstanceOf(THREE.LineSegments);
    expect(bench.getObjectByName('lab:puddle')).toBeInstanceOf(THREE.Mesh);
    expect(bench.getObjectByName('lab:bounds')).toBeInstanceOf(THREE.LineSegments);
    expect(bench.getObjectByName('lab:sun')).toBeInstanceOf(THREE.DirectionalLight);
    expect(bench.getObjectByName('lab:sky')).toBeInstanceOf(THREE.HemisphereLight);
    for (const family of ['grass', 'flower', 'broadleaf', 'shrub', 'fern']) {
      expect(bench.getObjectByName(`lab:plant:${family}`), family).not.toBeUndefined();
    }
    expect(r.scene.three.getObjectByName('fauna')).not.toBeUndefined();
    expect(r.uiLayer.querySelector(`[data-role="${LAB_HUD_ROLE}"]`)).not.toBeNull();
    expect(r.uiLayer.querySelector('[data-control="stick"]')).not.toBeNull();
    // The floor is the world's floor: sampled from labFloorAt, flat under the block (tests/labMeshes.test.ts has the rest).
    const floor = bench.getObjectByName('lab:floor') as THREE.Mesh;
    const position = floor.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(10_000);
  });

  it('hands the simulation the bench\'s two solids as its climbables', async () => {
    const r = await entered();
    const climbables = r.scene.lab.simWorld.climbables;
    expect(climbables).toBe(r.scene.lab.world.climbables);
    expect(climbables).toEqual([PILLAR_BOX, SLAB_BOX]);
    expect(climbables!.map((b) => b.id)).toEqual(['lab:pillar', 'lab:slab']);
  });

  it('spawns the five, exactly one each, and the queen is held by the local player by default', async () => {
    const r = await entered();
    for (const id of LAB_CREATURE_IDS) expect(r.scene.lab.sim.placed(id), id).toBe(1);
    r.frame();
    expect(r.scene.lab.sim.creatures().length).toBe(5);
    expect(r.heldSpecies()).toBe('queen');
    expect(r.scene.lab.ledger.creatureOf(PLAYER)).toBe(r.scene.lab.idOf('queen'));
    expect(r.scene.lab.ledger.size).toBe(1);
    expect(r.field(LAB_FIELD.control)).toBe('CONTROL: WINGED QUEEN');
    expect(r.button(possessAction('queen')).getAttribute('aria-pressed')).toBe('true');
    expect(r.button(possessAction('worker')).getAttribute('aria-pressed')).toBe('false');
    expect(r.scene.cameraMode).toBe('follow');
    expect(r.scene.camera).toBe(r.scene.follow.camera);
    r.frame(8);
    const blocks = overlay(r);
    expect(playersIn(blocks)).toEqual(['queen']);
    for (const id of ['worker', 'earthworm', 'aphid', 'housefly'] as const) expect(blocks[id]).toMatch(/ · AI · /);
  });

  it('the possess row moves the ledger and the label; the released one reads AI on the next refresh', async () => {
    const r = await entered();
    r.frame(8);
    r.press(possessAction('earthworm'));
    expect(r.heldSpecies()).toBe('earthworm');
    expect(r.scene.lab.ledger.size).toBe(1);
    expect(r.field(LAB_FIELD.control)).toBe('CONTROL: EARTHWORM');
    expect(r.button(possessAction('earthworm')).getAttribute('aria-pressed')).toBe('true');
    expect(r.button(possessAction('queen')).getAttribute('aria-pressed')).toBe('false');
    r.frame(8);
    expect(playersIn(overlay(r))).toEqual(['earthworm']);
    // The ids never change hands: the same five objects, the same ids, whoever is held.
    const before = LAB_CREATURE_IDS.map((id) => r.creature(id));
    for (const species of ['aphid', 'housefly', 'worker', 'queen'] as const) {
      r.press(possessAction(species));
      r.frame(2);
      expect(r.heldSpecies()).toBe(species);
      expect(playersIn(overlay(r)).length).toBeLessThanOrEqual(1);
    }
    LAB_CREATURE_IDS.forEach((id, i) => expect(r.creature(id)).toBe(before[i]));
    expect(r.scene.lab.sim.creatures().length).toBe(5);
  });

  it('OBSERVE clears the ledger, reads the observer words, and hands the view to the free camera', async () => {
    const r = await entered();
    r.frame(2);
    r.press(LAB_ACTION.observe);
    expect(r.scene.lab.ledger.size).toBe(0);
    expect(r.heldSpecies()).toBeNull();
    expect(r.field(LAB_FIELD.control)).toBe(OBSERVE_LABEL);
    expect(r.scene.cameraMode).toBe('free');
    expect(r.scene.camera).toBe(r.scene.free.camera);
    expect(r.field(LAB_FIELD.camera)).toBe('CAMERA: FREE');
    // Nothing to follow: the toggle is not available, and the cluster is gone.
    expect(r.button(LAB_ACTION.camera).disabled).toBe(true);
    expect(r.shownButtons()).toEqual([]);
    r.frame(8);
    expect(playersIn(overlay(r))).toEqual([]);
    // Possessing again brings the control camera back with the control.
    r.press(possessAction('aphid'));
    expect(r.scene.cameraMode).toBe('follow');
    expect(r.button(LAB_ACTION.camera).disabled).toBe(false);
  });

  it('the camera toggle swaps follow and free while someone is held, and the free camera starts where the lens was', async () => {
    const r = await entered();
    r.frame(3);
    const lens = r.scene.follow.camera.position.clone();
    r.press(LAB_ACTION.camera);
    expect(r.scene.cameraMode).toBe('free');
    expect(r.scene.camera).toBe(r.scene.free.camera);
    expect(r.scene.free.camera.position.distanceTo(lens)).toBeLessThan(1e-6);
    expect(r.heldSpecies()).toBe('queen');
    r.press(LAB_ACTION.camera);
    expect(r.scene.cameraMode).toBe('follow');
    expect(r.field(LAB_FIELD.camera)).toBe('CAMERA: FOLLOW');
  });

  it('PREDATION cycles OFF → NORMAL → FORCE → OFF on the button, and the simulation reads the policy', async () => {
    const r = await entered();
    expect(r.field(LAB_FIELD.predation)).toBe('PREDATION: OFF');
    expect(r.scene.lab.predation).toBe('off');
    expect(r.scene.lab.simWorld.policy?.predation).toBe('off');
    r.press(LAB_ACTION.predation);
    expect(r.field(LAB_FIELD.predation)).toBe('PREDATION: NORMAL');
    expect(r.scene.lab.simWorld.policy?.predation).toBe('normal');
    r.press(LAB_ACTION.predation);
    expect(r.field(LAB_FIELD.predation)).toBe('PREDATION: FORCE');
    expect(r.scene.lab.simWorld.policy?.predation).toBe('force');
    r.press(LAB_ACTION.predation);
    expect(r.field(LAB_FIELD.predation)).toBe('PREDATION: OFF');
  });

  it('the overlay has a block per creature naming it, its needs, its height and the worm\'s ground edits', async () => {
    const r = await entered();
    r.frame(8);
    const blocks = overlay(r);
    for (const id of LAB_CREATURE_IDS) {
      const text = blocks[id];
      expect(text.startsWith(CREATURE_SPECIES[id].name.toUpperCase()), id).toBe(true);
      expect(text).toContain(` · ${CREATURE_SPECIES[id].medium}`);
      expect(text).toMatch(/hunger \d+% · fatigue \d+% · alarm \d+%/);
      expect(text).toMatch(/speed \d+\.\d mm\/s · AGL -?\d+ mm/);
      expect(text).toMatch(/think \d+\.\d\d\/\d+\.\d\d s/);
      expect(text).toMatch(/at -?\d+\.\d,-?\d+\.\d/);
    }
    // The worm is under the litter corner, and the lab's editor is the unbuilt one.
    expect(blocks.earthworm).toContain('underground');
    expect(blocks.earthworm).toContain('ground edits OFF');
    expect(blocks.aphid).toContain(`host ${must(r.creature('aphid').hostId, 'the aphid\'s host')}`);
    expect(blocks.housefly).toMatch(/airborne|on ground/);
    // The overlay is a switch.
    const panel = must(r.uiLayer.querySelector<HTMLElement>('[data-role="lab-overlay"]'), 'the overlay');
    expect(panel.hidden).toBe(false);
    expect(r.field(LAB_FIELD.debug)).toBe('DEBUG: ON');
    r.press(LAB_ACTION.debug);
    expect(panel.hidden).toBe(true);
    expect(r.field(LAB_FIELD.debug)).toBe('DEBUG: OFF');
    expect(r.scene.debug).toBe(false);
  });

  it('the overlay names the face under a climber\'s feet, and AGL is height over the floor', async () => {
    const r = await entered();
    r.frame(2);
    const queen = r.creature('queen');
    /** Put the held queen somewhere by hand and read her block off the overlay, refreshed by the possess row (no frame: nothing moves her). */
    const wordAt = (wx: number, wz: number, height: number, up: Vec3): string => {
      queen.at = world(wx, wz);
      queen.height = height;
      queen.up = up;
      r.press(possessAction('queen'));
      return overlay(r).queen;
    };
    const east = PILLAR.size / 2;
    // On the pillar's east face, a skin outside it, halfway up.
    expect(wordAt(east + 1e-6, 0, LAB_FLOOR + 5, FACE_NORMALS[0])).toMatch(/AGL 50 mm · on wall/);
    // Under the slab, outside the pillar's footprint, feet on the underside.
    expect(wordAt(6, 0, SLAB_BOX.min.y - 1e-6, FACE_NORMALS[3])).toMatch(/on ceiling/);
    // On the slab's top: 200 mm over the floor, which is true — the block is not in the ground.
    const onTop = wordAt(0, 0, LAB_FLOOR + BLOCK.height + 1e-6, WORLD_UP);
    expect(onTop).toMatch(/on top/);
    expect(onTop).toMatch(new RegExp(`AGL ${Math.round(BLOCK.height * MM_PER_UNIT)} mm`));
    // Back on the floor: the old word.
    expect(wordAt(14, 0, LAB_FLOOR, WORLD_UP)).toMatch(/AGL 0 mm · on ground/);
  });

  it('the follow camera is handed the held body\'s up each frame', async () => {
    const r = await entered();
    r.frame(2);
    const update = vi.spyOn(r.scene.follow, 'update');
    const queen = r.creature('queen');
    // On the ground the target's up is the one shared WORLD_UP object.
    r.frame(1, 0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].up).toBe(WORLD_UP);
    // Stood by hand on the pillar's east face: the target carries that face's normal.
    queen.at = world(PILLAR.size / 2 + 1e-6, 0);
    queen.height = LAB_FLOOR + 5;
    queen.up = FACE_NORMALS[0];
    r.frame(1, 0);
    expect(update).toHaveBeenCalledTimes(2);
    const target = update.mock.calls[1][1];
    expect(target.up).toBe(FACE_NORMALS[0]);
    expect(target.at).toBe(queen.at);
    expect(target.height).toBe(queen.height);
    update.mockRestore();
  });

  it('shows the right thumb only the buttons the held medium can use', async () => {
    const r = await entered();
    const expected: Record<CreatureId, LabButtonKind[]> = {
      queen: ['up', 'down', 'primary', 'secondary', 'sprint'],
      worker: ['primary', 'sprint'],
      earthworm: ['up', 'down', 'primary', 'sprint'],
      aphid: ['primary', 'secondary', 'sprint'],
      housefly: ['up', 'down', 'primary', 'secondary', 'sprint'],
    };
    for (const id of LAB_CREATURE_IDS) {
      r.press(possessAction(id));
      expect(r.shownButtons(), id).toEqual(expected[id]);
      const species = CREATURE_SPECIES[id];
      expect(expected[id]).toEqual([...buttonsFor(species.medium, species.flight !== null)]);
    }
    // The worm's UP and DOWN say what they do to a worm.
    r.press(possessAction('earthworm'));
    expect(r.button(LAB_BUTTON_ACTION.up).textContent).toBe('SURFACE');
    expect(r.button(LAB_BUTTON_ACTION.down).textContent).toBe('BURROW');
    r.press(possessAction('aphid'));
    expect(r.button(LAB_BUTTON_ACTION.secondary).textContent).toBe('B · DROP');
    r.press(LAB_ACTION.observe);
    expect(r.shownButtons()).toEqual([]);
  });

  it('the thumbs move the held body and the AI keeps its hands off it, while the other four keep living', async () => {
    const r = await entered();
    r.frame(2);
    const queen = r.creature('queen');
    const start = queen.at;
    const others = (['worker', 'earthworm', 'aphid', 'housefly'] as const).map((id) => r.creature(id));
    const thoughtsBefore = others.map((c) => c.sinceThink);
    r.key('KeyW', true);
    r.frame(60);
    r.key('KeyW', false);
    expect(Math.hypot(queen.at.wx - start.wx, queen.at.wz - start.wz)).toBeGreaterThan(0.5);
    // The brain writes no target while the player holds her.
    expect(queen.target).toBeNull();
    expect(queen.behaviour).toBe('wander');
    // The overlay reads her moving.
    expect(overlay(r).queen).toMatch(/speed [1-9]\d*\.\d mm\/s|speed 0\.[1-9]/);
    // Somebody else thought since: the four are simulated, not frozen.
    const thought = others.some((c, i) => c.sinceThink !== thoughtsBefore[i] || c.behaviourS > 0);
    expect(thought).toBe(true);
  });

  it('RESET rebuilds the five at their deterministic spawns and holds the queen again, without a reload', async () => {
    const r = await entered();
    r.press(possessAction('housefly'));
    r.key('KeyE', true);
    r.frame(90);
    r.key('KeyE', false);
    r.press(LAB_ACTION.predation);
    const simBefore = r.scene.lab.sim;
    const fly = r.creature('housefly');
    expect(fly.height).toBeGreaterThan(labSpawns()[4].height);
    r.press(LAB_ACTION.reset);
    expect(r.scene.lab.sim).not.toBe(simBefore);
    expect(r.heldSpecies()).toBe('queen');
    expect(r.scene.cameraMode).toBe('follow');
    expect(r.field(LAB_FIELD.control)).toBe('CONTROL: WINGED QUEEN');
    for (const spawn of labSpawns()) {
      const c = r.creature(spawn.species);
      expect(c.id).toBe(spawn.id);
      expect(c.at.wx).toBe(spawn.at.wx);
      expect(c.at.wz).toBe(spawn.at.wz);
      expect(c.height).toBe(spawn.height);
      expect(c.heading).toBe(spawn.heading);
      expect(c.lengthMm).toBe(spawn.lengthMm);
      expect(c.hunger).toBe(spawn.hunger);
      expect(c.behaviour).toBe(spawn.behaviour);
      expect(c.alarm).toBe(0);
    }
    // The lab's own options are not the bench's: the policy stays where the tester put it.
    expect(r.scene.lab.predation).toBe('normal');
    expect(r.scene.disturbArmed).toBe(false);
    r.frame(8);
    expect(playersIn(overlay(r))).toEqual(['queen']);
    expect(r.scene.lab.sim.creatures().length).toBe(5);
  });

  it('a tap on a drawn body takes it, and a tap on nothing takes nobody', async () => {
    const r = await entered();
    r.press(LAB_ACTION.observe);
    r.frame(8);
    // The fly, perched on the flower in the free camera's view, at the pixels the overlay prints for it.
    const line = overlay(r).housefly;
    const px = /px (\d+),(\d+)/.exec(line);
    expect(px, line).not.toBeNull();
    const x = Number(px![1]);
    const y = Number(px![2]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(932);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(430);
    r.scene.tap(x, y);
    expect(r.heldSpecies()).toBe('housefly');
    expect(r.scene.cameraMode).toBe('follow');
    expect(r.field(LAB_FIELD.control)).toBe('CONTROL: HOUSEFLY');
    // Far from every body: nothing changes hands.
    r.press(LAB_ACTION.observe);
    r.frame(2);
    r.scene.tap(2, 2);
    expect(r.heldSpecies()).toBeNull();
  });

  it('a click on the canvas reaches the lab as a tap through the Input', async () => {
    const r = await entered();
    r.press(LAB_ACTION.observe);
    r.frame(8);
    const px = must(/px (\d+),(\d+)/.exec(overlay(r).housefly), 'the fly\'s pixels');
    click(r.host, Number(px[1]), Number(px[2]));
    r.frame();
    expect(r.heldSpecies()).toBe('housefly');
  });

  it('DISTURB arms the next tap, which lands a tool disturbance on the bench and disarms', async () => {
    const r = await entered();
    r.press(LAB_ACTION.observe);
    r.frame(2);
    expect(r.scene.lab.world.disturbances().length).toBe(0);
    r.press(LAB_ACTION.disturb);
    expect(r.scene.disturbArmed).toBe(true);
    expect(r.field(LAB_FIELD.disturb)).toBe('DISTURB: TAP THE BENCH');
    // The free camera looks at the block from the corner: the middle of the screen is bench.
    r.scene.tap(466, 215);
    expect(r.scene.disturbArmed).toBe(false);
    const standing = r.scene.lab.world.disturbances();
    expect(standing.length).toBe(1);
    expect(standing[0].source).toBe('tool');
    expect(standing[0].radius).toBe(DISTURB_RADIUS);
    expect(Math.abs(standing[0].at.wx)).toBeLessThan(50);
    expect(Math.abs(standing[0].at.wz)).toBeLessThan(50);
    // A tap is an event: it expires on the bench's clock.
    r.frame(120);
    expect(r.scene.lab.world.disturbances().length).toBe(0);
    // Armed, a tap on a body disturbs the body rather than taking it.
    r.frame(8);
    const px = must(/px (\d+),(\d+)/.exec(overlay(r).housefly), 'the fly\'s pixels');
    r.press(LAB_ACTION.disturb);
    r.scene.tap(Number(px[1]), Number(px[2]));
    expect(r.heldSpecies()).toBeNull();
    const onFly = r.scene.lab.world.disturbances();
    expect(onFly.length).toBe(1);
    expect(onFly[0].at).toBe(r.creature('housefly').at);
  });

  it('CAMERA DISTURBS is off by default and, on, puts the active eye into the bench each frame', async () => {
    const r = await entered();
    r.frame(2);
    expect(r.scene.cameraDisturbs).toBe(false);
    expect(r.field(LAB_FIELD.cameraDisturbs)).toBe('CAM DISTURBS: OFF');
    expect(r.scene.lab.world.disturbances().some((d) => d.source === 'camera')).toBe(false);
    r.press(LAB_ACTION.cameraDisturbs);
    r.frame(2);
    const eye = r.scene.lab.world.disturbances().find((d) => d.source === 'camera');
    expect(eye).not.toBeUndefined();
    const lens = r.scene.camera.position;
    expect(eye!.at.wx).toBeCloseTo(lens.x, 6);
    expect(eye!.at.wz).toBeCloseTo(lens.z, 6);
    expect(eye!.height).toBeCloseTo(lens.y, 6);
    expect(r.field(LAB_FIELD.cameraDisturbs)).toBe('CAM DISTURBS: ON');
    // It survives a reset — the switch is the lab's, not the bench's — and goes when switched off.
    r.press(LAB_ACTION.reset);
    r.frame(2);
    expect(r.scene.lab.world.disturbances().some((d) => d.source === 'camera')).toBe(true);
    r.press(LAB_ACTION.cameraDisturbs);
    expect(r.scene.lab.world.disturbances().some((d) => d.source === 'camera')).toBe(false);
  });

  it('prints the frame lines as numbers', async () => {
    const r = await entered();
    r.frame(20);
    expect(r.field(LAB_FIELD.fps)).toMatch(/^\d+ fps$/);
    expect(r.field(LAB_FIELD.frameMs)).toMatch(/^frame \d+\.\d ms$/);
    expect(r.field(LAB_FIELD.aiMs)).toMatch(/^ai \d+\.\d\d ms$/);
    expect(r.field(LAB_FIELD.animMs)).toMatch(/^anim \d+\.\d\d ms$/);
  });

  it('BACK and Escape ask the owner; dispose takes the HUD and the stick down', async () => {
    const r = await entered();
    r.press('back');
    expect(r.backs()).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(r.backs()).toBe(2);
    r.scene.dispose();
    expect(r.uiLayer.querySelector(`[data-role="${LAB_HUD_ROLE}"]`)).toBeNull();
    expect(r.uiLayer.querySelector('[data-control="stick"]')).toBeNull();
    expect(r.scene.three.getObjectByName('lab:bench')).toBeUndefined();
    expect(r.scene.three.getObjectByName('fauna')).toBeUndefined();
  });
});

describe('the stress test on the bench (Joshua, 2026-09-10)', () => {
  /** The panel's text, or '' when the panel is not up. */
  const panel = (r: Rig): string => {
    const node = r.uiLayer.querySelector<HTMLElement>('[data-role="lab-stress-panel"]');
    return node === null || node.hidden ? '' : node.textContent ?? '';
  };
  const placedTotal = (r: Rig): number =>
    LAB_CREATURE_IDS.reduce((total, id) => total + r.scene.lab.sim.placed(id), 0);

  /**
   * THE PANEL STANDS CLEAR OF THE TOOLS, and STOP is therefore
   * pressable. A PROXY, and honest about being one: jsdom lays nothing
   * out, so this pins the two style numbers a Chromium measurement
   * turned into a rule rather than the geometry itself. Measured at
   * 810 × 374, 932 × 430 and 667 × 375, the right-hand column — three
   * tool rows and the perf line — runs to y 156. The panel is `left:156
   * width:400` with `pointer-events:auto`, and it is later in the DOM,
   * so anywhere it overlaps a button it does not merely cover the button
   * but takes its taps. At top 96 that cost STOP a 22 px sliver with two
   * buttons in the stress row and ALL of it once POOL made three — the
   * one control that abandons a seven-minute run, unpressable.
   */
  it('stands below the tool column, so STOP is not a button the panel eats', async () => {
    const r = await entered();
    const node = must(r.uiLayer.querySelector<HTMLElement>('[data-role="lab-stress-panel"]'), 'the stress panel');
    // jsdom re-serialises cssText with spaces after the colons, so the
    // declarations are compared with the whitespace taken out.
    const css = (el: HTMLElement): string => el.style.cssText.replace(/\s+/g, '');
    const top = Number(/top:(\d+)px/.exec(css(node))?.[1] ?? -1);
    expect(top).toBeGreaterThanOrEqual(156);
    // And the report scrolls inside the panel while the buttons under it do not,
    // so COPY is never parked below thirty lines of report on a phone.
    const report = must(r.uiLayer.querySelector<HTMLElement>(`[data-field="${LAB_FIELD.stressReport}"]`), 'the report');
    expect(css(report)).toContain('overflow:auto');
    expect(css(report)).toContain('min-height:0');
    expect(css(node)).toContain('overflow:hidden');
  });
  /**
   * THE RIGS THE VIEW IS HOLDING RIGHT NOW, summed across the five —
   * asked of `FaunaView` itself rather than worked out from the pool
   * sizes, because a buried worm is placed, poolled and not drawn. This
   * is what a census taken on the NEXT frame will read: the scene files
   * the run's frame before the renderer runs again.
   */
  const rigsDrawn = (r: Rig): number => {
    const cost = must(r.scene.fauna, 'the fauna view').cost;
    return LAB_CREATURE_IDS.reduce((total, id) => total + (cost.rigsLent[id] ?? 0), 0);
  };
  /** A `  label   N` line of the report, or −1 when the block is not printed at all. */
  const reported = (text: string, label: string): number => {
    // A trailing note is allowed: several of these lines say what the
    // tier IS beside its number ("(animated every frame)"). And the two
    // mesh tiers print against their CAP — `13/13` — so the count is the
    // first half of what may be a pair.
    const found = new RegExp(`^ {2}${label} +(\\d+)(?:/\\d+)?(?: {2,}\\(.*\\))?$`, 'm').exec(text);
    return found === null ? -1 : Number(found[1]);
  };
  /** The CAP beside a reported count, or -1 where the line prints none. */
  const cappedAt = (text: string, label: string): number => {
    const found = new RegExp(`^ {2}${label} +\\d+/(\\d+)(?: {2,}\\(.*\\))?$`, 'm').exec(text);
    return found === null ? -1 : Number(found[1]);
  };
  /**
   * STOP THE RUN AND SIT OUT THE RECOVERY, one frame at a time, and
   * answer with the report and with the view's rig count as it stood on
   * the frame BEFORE the report was built — which is the frame the
   * report's census was taken from.
   *
   * The recovery's ten seconds are spent eight frames a second rather
   * than sixty: `rawDt` is the run's clock and `simDt` is the bench's,
   * they are separate values (ARCHITECTURE §2.4), and the run does not
   * care how many frames its ten seconds took.
   */
  const settle = (r: Rig): { readonly text: string; readonly lentBefore: number } => {
    r.press(LAB_ACTION.stress);
    let lentBefore = -1;
    for (let i = 0; i < 200; i += 1) {
      const before = rigsDrawn(r);
      r.frame(1, SIXTY, 1 / 8);
      if (panel(r).includes('DRAWN AT THE END')) {
        lentBefore = before;
        break;
      }
    }
    return { text: panel(r), lentBefore };
  };

  it('offers the run and the two options that change its answer, and hides the panel until there is one', async () => {
    const r = await entered();
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS TEST');
    expect(r.field(LAB_FIELD.rigs)).toBe(rigModeLabel('all'));
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('mix'));
    expect(panel(r)).toBe('');
    expect(placedTotal(r)).toBe(LAB_CREATURE_IDS.length);
  });

  it('holds the room still when it starts, so two runs are two readings of one test', async () => {
    const r = await entered();
    // Leave the room as unlike the test position as the buttons allow.
    r.press(LAB_ACTION.predation);
    r.press(LAB_ACTION.cameraDisturbs);
    r.press(possessAction('housefly'));
    r.frame(4);
    expect(r.heldSpecies()).toBe('housefly');

    r.press(LAB_ACTION.stress);
    r.frame(1);
    expect(r.heldSpecies()).toBeNull();
    expect(r.scene.cameraMode).toBe('free');
    expect(r.scene.lab.predation).toBe('off');
    expect(r.scene.cameraDisturbs).toBe(false);
    expect(r.scene.debug).toBe(false);
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS: WARMING UP');
    expect(panel(r)).toContain('WARMING UP');
  });

  /**
   * AND KEEPS IT STILL — the hole Baseline B fell through.
   *
   * That run (alpha.42, 400 creatures at 60 fps) reported `predation
   * NORMAL` where Baseline A had reported `predation OFF`. `startStress`
   * had set it off, as it always did; nothing stopped a thumb from
   * cycling the button a moment later, and `conditions()` was read when
   * the REPORT was written, so it printed the value it found at the end
   * with no sign it had ever been anything else. Two runs that were not
   * the same test went into the record as though they were.
   */
  it('refuses the room-holding buttons mid-run, and the HUD greys them so it is not a dead tap', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(1);
    for (const action of HELD_DURING_A_RUN) {
      const button = r.button(action);
      expect(button.disabled, `${action} while running`).toBe(true);
      // Pressed anyway — a disabled button can still be clicked by a probe,
      // and the SCENE's refusal is the half that has to be correct.
      button.click();
    }
    r.button(possessAction('worker')).click();
    r.frame(1);
    expect(r.scene.lab.predation).toBe('off');
    expect(r.scene.cameraDisturbs).toBe(false);
    expect(r.scene.debug).toBe(false);
    expect(r.heldSpecies()).toBeNull();
    expect(placedTotal(r)).toBeGreaterThanOrEqual(LAB_CREATURE_IDS.length);

    // And they come back when the run is over, so the Lab is a Lab again.
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + RECOVERY_S + 2));
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS: DONE');
    for (const action of HELD_DURING_A_RUN) {
      // The camera button has its own reason to be off: nobody is held.
      if (action === LAB_ACTION.camera) continue;
      expect(r.button(action).disabled, `${action} once done`).toBe(false);
    }
  });

  it('names a condition that moved under the run instead of printing the value it ended on', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 1));
    // Reach past the button, the way something the refusal does not cover
    // one day might. The snapshot is what makes this catchable at all.
    r.scene.lab.setPredation('force');
    r.frame(60 * (RECOVERY_S + BREAK_HOLD_S + 4), SIXTY, 1 / 4);
    const text = panel(r);
    expect(text).toContain('STRESS TEST COMPLETE');
    // The run STARTED at OFF, so that is what it is recorded as — and the
    // drift is named rather than silently overwriting it.
    expect(text).toMatch(/predation\s+OFF/);
    expect(text).toContain('CHANGED DURING THE RUN');
    expect(text).toContain('ended FORCE');
  });

  it('spawns nothing during the warm-up, then about one a second, each with its own skeleton', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    const fauna = must(r.scene.fauna, 'the fauna view');
    // The settle plus four of the window's five seconds: still the bench's own five.
    r.frame(60 * (SETTLE_S + WINDOW_S - 1));
    expect(placedTotal(r)).toBe(LAB_CREATURE_IDS.length);
    // Six more seconds — the last of the window, then five of spawning: one a
    // second, give or take the frame the clock lands on.
    r.frame(60 * 6);
    const crowd = placedTotal(r) - LAB_CREATURE_IDS.length;
    expect(crowd).toBeGreaterThanOrEqual(5);
    expect(crowd).toBeLessThanOrEqual(7);
    // The HUD paints at `HUD_HZ`, so its count is the bench's or one behind it —
    // never ahead, and never adrift.
    const shown = Number(/insects\s+(\d+)/.exec(panel(r))?.[1] ?? -1);
    expect(shown).toBeLessThanOrEqual(crowd);
    expect(shown).toBeGreaterThanOrEqual(crowd - 1);
    // RIGS: ALL means a rig apiece — the bench's own body of a species, plus its crowd.
    const lent = LAB_CREATURE_IDS.reduce((total, id) => total + fauna.poolSize(id), 0);
    expect(lent).toBe(LAB_CREATURE_IDS.length + crowd);
    expect(SPAWN_EVERY_S).toBe(1);
  });

  it('runs to a report: the thresholds, the recovery, and the copyable block', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    // A phone at eight frames a second: under every threshold at once, so the
    // run records all four, holds, and settles.
    const slow = 1 / 8;
    for (let i = 0; i < 400 && r.scene.lab.sim.placed('queen') >= 0; i += 1) {
      r.frame(1, SIXTY, slow);
      if (r.field(LAB_FIELD.stress) === 'STRESS: DONE') break;
    }
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS: DONE');
    const text = panel(r);
    expect(text).toContain('STRESS TEST COMPLETE');
    expect(text).toContain('SUSTAINED AT 30+ FPS');
    expect(text).toContain('Total insects');
    expect(text).toContain('INSECTS AT EACH THRESHOLD');
    expect(text).toContain('below 10 fps');
    expect(text).toContain(`FPS after ${RECOVERY_S} s hold`);
    expect(text).toContain('do not collide with or avoid one another');
    // The conditions name the run, so a pasted report can be placed.
    expect(text).toContain('one animated skeleton per insect');
    expect(text).toContain('predation  OFF');
    expect(text).toContain('932 × 430 css px');
    // And the buttons to do it again are there now, and were not before.
    for (const action of [LAB_ACTION.stressCopy, LAB_ACTION.stressAgain, LAB_ACTION.stressReset]) {
      expect(r.button(action).hidden, action).toBe(false);
    }
  });

  it('RUN AGAIN is the same test: the same creatures, in the same order', async () => {
    const speciesOf = (r: Rig): string[] => {
      const out: string[] = [];
      for (const id of LAB_CREATURE_IDS) for (let i = 0; i < r.scene.lab.sim.placed(id) - 1; i += 1) out.push(id);
      return out.sort();
    };
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(60 * (WINDOW_S + 8));
    const first = speciesOf(r);
    expect(first.length).toBeGreaterThan(4);

    r.press(LAB_ACTION.stress);   // stop
    r.press(LAB_ACTION.stressAgain);
    r.frame(60 * (WINDOW_S + 8));
    expect(speciesOf(r)).toEqual(first);
  });

  it('RESET takes the crowd away, gives the rung its pools back and puts the queen back in hand', async () => {
    const r = await entered();
    const fauna = must(r.scene.fauna, 'the fauna view');
    r.press(LAB_ACTION.stress);
    r.frame(60 * (WINDOW_S + 6));
    expect(placedTotal(r)).toBeGreaterThan(LAB_CREATURE_IDS.length);

    r.press(LAB_ACTION.stressReset);
    r.frame(2);
    expect(placedTotal(r)).toBe(LAB_CREATURE_IDS.length);
    expect(panel(r)).toBe('');
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS TEST');
    expect(r.heldSpecies()).toBe('queen');
    expect(fauna.poolSize('aphid')).toBeGreaterThan(0);
  });

  it('RIGS names which question is being asked, and never lends past the run\'s ceiling', async () => {
    const r = await entered();
    r.press(LAB_ACTION.rigs);
    expect(r.field(LAB_FIELD.rigs)).toBe(rigModeLabel('rung'));
    r.press(LAB_ACTION.stress);
    r.frame(60 * (WINDOW_S + 6));
    // At RIGS: RUNG the LENDING is the detail ladder's budget and the rest
    // of the crowd draws as impostors. The assertion is about what is lent
    // and not about `poolSize`: every species' pool is the whole rung
    // budget now, because the allocation is by distance across species and
    // the nearest thirteen bodies may all be of one kind.
    const lent = rigsDrawn(r);
    expect(lent).toBeLessThan(placedTotal(r));
    expect(lent).toBeLessThanOrEqual(rigBudgetFor(LAB_RUNG_NAME));
    expect(MAX_CREATURES).toBeGreaterThan(100);
  });

  // ─── the census (Joshua, 2026-09-10: "how many creatures were drawn as
  //     full rigs versus impostors") ────────────────────────────────────

  it('counts what was DRAWN, not only what was placed — live, and in the report', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 12));

    // THE LIVE LINE, while the crowd is arriving. At RIGS: ALL every drawn
    // body carries a skeleton, so the impostor half of the split is zero —
    // and that zero is a count, not the absence of one.
    const live = /^drawn +(\d+)(?:\/\d+)? rigs · (\d+)(?:\/\d+)? reduced$/m.exec(panel(r));
    expect(live, `the live block should carry a drawn line:\n${panel(r)}`).not.toBeNull();
    const shownRigs = Number(must(live, 'the live census')[1]);
    expect(shownRigs).toBeGreaterThan(LAB_CREATURE_IDS.length);
    expect(Number(must(live, 'the live census')[2])).toBe(0);

    // THE REPORT'S BLOCK, and the frame it is a census OF: the run is
    // handed the previous frame's drawing, because `rawDt` is the previous
    // frame's duration — the two halves of one reading.
    const { text, lentBefore } = settle(r);
    expect(lentBefore).toBeGreaterThan(0);
    expect(reported(text, 'full rigs')).toBe(lentBefore);
    expect(reported(text, 'impostors')).toBe(0);
    expect(reported(text, 'peak full rigs')).toBeGreaterThanOrEqual(lentBefore);
    // Not everyone placed is drawn — a buried worm is neither rig nor
    // impostor — so the census is the VIEW's number and never the bench's.
    expect(reported(text, 'full rigs')).toBeLessThanOrEqual(placedTotal(r));
    expect(text).toContain('WHERE THE FRAME WENT');
    expect(text).toContain('pool       all five, mixed');
  });

  it('at RIGS: RUNG the report splits the crowd into the rung\'s pools and the impostors past them', async () => {
    const r = await entered();
    r.press(LAB_ACTION.rigs);
    r.press(LAB_ACTION.stress);
    // Long enough that the crowd outgrows the rung's pools, which is the
    // whole point of this run: the same insects, drawn two ways.
    r.frame(60 * (SETTLE_S + WINDOW_S + 20));
    // The budget is what caps the skeletons; `poolTotal` is only how many
    // clones exist to lend from, and since the pools became budget-sized
    // that is five times the budget rather than a ceiling on anything.
    const pools = rigBudgetFor(LAB_RUNG_NAME);
    expect(pools).toBeLessThan(placedTotal(r));

    const { text, lentBefore } = settle(r);
    const rigs = reported(text, 'full rigs');
    const impostors = reported(text, 'impostors');
    expect(rigs).toBe(lentBefore);
    // The rung's budget is a ceiling on the skeletons; everything past it
    // is twenty triangles, and the report says so rather than reporting a
    // crowd that all looked the same.
    expect(rigs).toBeLessThanOrEqual(pools);
    expect(impostors).toBeGreaterThan(0);
    expect(rigs + impostors).toBeGreaterThan(pools);
    expect(rigs + impostors).toBeLessThanOrEqual(placedTotal(r));
    expect(text).toContain('RUNG (medium)');
  });

  it('THE REPORT SAYS WHAT THE LADDER WAS ALLOWED, not only what it spent', async () => {
    // Joshua, 2026-09-10, with 1,077 insects in the one-metre room: "LOD
    // still not correct and rendering as a procedural too close". The
    // centre was right, the radii were right, and the ladder had spent
    // thirteen of thirteen full rigs with hundreds of bodies inside the
    // radius asking for one — which the bench printed as a bare "13".
    const r = await entered();
    r.press(LAB_ACTION.rigs);
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 20));
    const { text } = settle(r);
    // THE CAP, beside the count, on both mesh tiers.
    expect(cappedAt(text, 'full rigs')).toBe(rigBudgetFor(LAB_RUNG_NAME));
    expect(cappedAt(text, 'reduced')).toBe(rigBudgetFor(LAB_RUNG_NAME) * 2);
    // AND THE DEMAND: how many were inside each tier's radius before any
    // budget refused them. The bench camera stands outside its own room,
    // so LOD0's count may honestly be zero — what may not happen is the
    // line being absent, which is the state that could not be diagnosed.
    expect(text).toMatch(/^ {2}inside LOD0 {9}\d+ {3}\(wanted a full rig\)$/m);
    expect(text).toMatch(/^ {2}inside LOD1 {9}\d+ {3}\(wanted the mesh\)$/m);
    expect(reported(text, 'inside LOD1')).toBeGreaterThanOrEqual(reported(text, 'inside LOD0'));
  });

  it('RIGS cycles RUNG → x2 → x4 → ALL, because thirteen was inherited and not measured', async () => {
    // `fullBudgetFor` is the SUM OF `POOL_SIZES`, a clone-pool table
    // sized for an island where a handful of animals are near. It is not
    // a measurement of any phone, and the phone is the instrument — so
    // the multiples are on the button he already has rather than in a
    // number I would have had to guess.
    const r = await entered();
    expect(r.field(LAB_FIELD.rigs)).toBe(rigModeLabel('all'));
    for (const mode of ['rung', 'rung2', 'rung4', 'all'] as const) {
      r.press(LAB_ACTION.rigs);
      expect(r.field(LAB_FIELD.rigs)).toBe(rigModeLabel(mode));
    }
    // And RUNG x2 really is twice the capacity, in the report's own words.
    r.press(LAB_ACTION.rigs);
    r.press(LAB_ACTION.rigs);
    expect(r.field(LAB_FIELD.rigs)).toBe(rigModeLabel('rung2'));
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 20));
    const { text } = settle(r);
    expect(cappedAt(text, 'full rigs')).toBe(rigBudgetFor(LAB_RUNG_NAME) * 2);
    expect(cappedAt(text, 'reduced')).toBe(rigBudgetFor(LAB_RUNG_NAME) * 4);
  });

  // ─── the species pool (Joshua, 2026-09-10: workers only, queens only,
  //     flies only, aphids only, worms only) ──────────────────────────

  it('POOL cycles MIX through the five and back, and the button says which', async () => {
    const r = await entered();
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('mix'));
    for (const id of LAB_CREATURE_IDS) {
      r.press(LAB_ACTION.stressPool);
      expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel(id));
    }
    r.press(LAB_ACTION.stressPool);
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('mix'));
  });

  it('a queens-only run spawns queens and nothing else, and the report names the pool', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stressPool);
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('queen'));
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 8));
    // The bench's own five are placed too, so every species reads one; the
    // crowd is what is past that, and all of it is queens.
    expect(r.scene.lab.sim.placed('queen')).toBeGreaterThan(5);
    for (const id of LAB_CREATURE_IDS) {
      if (id !== 'queen') expect(r.scene.lab.sim.placed(id), id).toBe(1);
    }
    expect(settle(r).text).toContain(`pool       ${stressPoolWords('queen')}`);
  });

  it('POOL is refused while a run is going: the run it would rename is still going', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 4));
    const crowd = placedTotal(r);
    expect(crowd).toBeGreaterThan(LAB_CREATURE_IDS.length);

    r.press(LAB_ACTION.stressPool);
    r.frame(2);
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('mix'));
    expect(r.field(LAB_FIELD.stress)).toBe(`STOP (${crowd - LAB_CREATURE_IDS.length})`);
    expect(placedTotal(r)).toBe(crowd);
    expect(panel(r)).toContain('SPAWNING');
  });

  it('POOL clears a standing report: a mixed run\'s numbers under a button saying QUEEN would be read as the queens\'', async () => {
    const r = await entered();
    r.press(LAB_ACTION.stress);
    r.frame(60 * (SETTLE_S + WINDOW_S + 4));
    expect(settle(r).text).toContain('STRESS TEST COMPLETE');

    r.press(LAB_ACTION.stressPool);
    r.frame(2);
    expect(panel(r)).toBe('');
    expect(r.field(LAB_FIELD.stress)).toBe('STRESS TEST');
    expect(r.field(LAB_FIELD.stressPool)).toBe(stressPoolLabel('queen'));
    // And the bench is back, the way RESET leaves it.
    expect(placedTotal(r)).toBe(LAB_CREATURE_IDS.length);
    expect(r.heldSpecies()).toBe('queen');
  });
});
