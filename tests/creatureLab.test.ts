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
import { DISTURB_RADIUS } from '../src/lab/labTool';
import { world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';

const SIXTY = 1 / 60;
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
  readonly frame: (n?: number, simDt?: number) => void;
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
  const frame = (n = 1, simDt = SIXTY): void => {
    for (let i = 0; i < n; i += 1) {
      elapsed += simDt;
      scene.update({ rawDt: SIXTY, simDt, elapsed });
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
