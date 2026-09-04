// @vitest-environment jsdom
/**
 * The Network Lab as a scene: two clients on one in-process host, both
 * seeing two capsules; a teleport claim refused by the host and snapped
 * back; a hang-up that lingers and re-attaches to the same actor inside
 * the grace and to a fresh one after it; a clean leave; the sliders
 * reaching the shared wire; and every HUD control honest about when it
 * does something. three's scene graph builds without WebGL under jsdom.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { playerId } from '../src/actor/PlayerId';
import { Input } from '../src/input/Input';
import { NEUTRAL_INTENT } from '../src/input/Intent';
import { HOST_DEFAULTS } from '../src/net';
import { listTools, registerTool } from '../src/devtools/DevTool';
import { NET_LAB_ACTION, NET_LAB_HUD_ROLE, NET_LAB_SCENE_ID, netLabTool } from '../src/devtools/netLabTool';
import {
  TELEPORT_UNITS, buildNetworkLabScene, intentFrom, type NetworkLabHooks, type NetworkLabScene, type Thumbs,
} from '../src/devtools/NetworkLabScene';
import { WORLD_SCENE_PREFIX } from '../src/world/WorldLoader';

const SIXTY = 1 / 60;
const A_PLAYER = playerId('net-lab-test-player-a');
const A_NAME = 'Tester';

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** Let every pending microtask run: a reconnect's hello leaves only after the transport's connect() resolves. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function rig() {
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
  input.attach(host);
  // uiLayer, input and app only: a lab that reached for the renderer, storage or assets would fail here.
  const ctx = { uiLayer, input, app } as unknown as SceneContext;
  let backs = 0;
  const hooks: NetworkLabHooks = {
    identity: () => ({ playerId: A_PLAYER, name: A_NAME }),
    onBack: () => {
      backs += 1;
    },
  };
  const scene: NetworkLabScene = buildNetworkLabScene(ctx, hooks);
  let elapsed = 0;
  const run = (frames: number, dt = SIXTY, simDt = dt): void => {
    for (let i = 0; i < frames; i += 1) {
      elapsed += simDt;
      scene.update({ rawDt: dt, simDt, elapsed });
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
  const capsulesOnScreen = (): string[] =>
    scene.three.children.filter((o) => o.name.startsWith('capsule:')).map((o) => o.name.slice('capsule:'.length));
  const teardown = (): void => {
    scene.dispose();
    input.detach();
    uiLayer.remove();
  };
  return { scene, uiLayer, input, run, field, button, press, capsulesOnScreen, backs: () => backs, teardown };
}

describe('netLabTool', () => {
  it('is a plain tool scene, not a world, and its card is honest about scope', () => {
    expect(netLabTool.id).toBe('net-lab');
    expect(netLabTool.title).toBe('Network Lab');
    expect(netLabTool.sceneId).toBe(NET_LAB_SCENE_ID);
    expect(NET_LAB_SCENE_ID.startsWith(WORLD_SCENE_PREFIX)).toBe(false);
    expect(netLabTool.description).toContain('In-process only');
    expect(netLabTool.description).toContain('no server yet');
    registerTool(netLabTool);
    expect(listTools().some((t) => t.id === 'net-lab')).toBe(true);
  });
});

describe('NetworkLabScene', () => {
  it('wires two clients to one host and both see two actors, on screen and in the HUD', async () => {
    const r = rig();
    await r.scene.enter();
    const { lab } = r.scene;
    expect(r.scene.name).toBe(NET_LAB_SCENE_ID);
    expect(lab.a.state).toBe('connected');
    expect(lab.b.state).toBe('connected');
    expect(lab.host.connectionCount).toBe(2);
    expect(lab.host.snapshot().actors).toHaveLength(2);
    expect(lab.a.client.replica.ids().sort()).toEqual(['capsule-1', 'capsule-2']);
    expect(lab.b.client.replica.ids().sort()).toEqual(['capsule-1', 'capsule-2']);
    expect(lab.a.client.actorId).toBe('capsule-1');
    expect(lab.b.client.actorId).toBe('capsule-2');

    // A's view: her own capsule from local state, B's from the replica.
    r.run(1);
    expect(r.capsulesOnScreen().sort()).toEqual(['capsule-1', 'capsule-2']);
    expect(r.scene.three.children.some((o) => o instanceof THREE.GridHelper)).toBe(true);
    expect(r.scene.three.children.some((o) => o instanceof THREE.DirectionalLight)).toBe(true);

    expect(r.uiLayer.querySelector(`[data-role="${NET_LAB_HUD_ROLE}"]`)).not.toBeNull();
    expect(r.field('a-name')).toBe(`A · ${A_NAME}`);
    expect(r.field('a-state')).toBe('connected');
    expect(r.field('b-state')).toBe('connected');
    expect(r.field('a-actor')).toMatch(/^actor capsule-1 #[0-9a-f]{6}$/);
    expect(r.field('b-actor')).toMatch(/^actor capsule-2 #[0-9a-f]{6}$/);
    expect(r.field('a-actors')).toBe('2 known: capsule-1, capsule-2');
    expect(r.field('b-actors')).toBe('2 known: capsule-1, capsule-2');
    expect(r.field('host-links')).toBe('links 2');
    // Two capsules that must be told apart never share a colour.
    expect(must(lab.a.local, 'A local').color).not.toBe(must(lab.b.local, 'B local').color);
    r.teardown();
  });

  it('every control carries a data-action, and only the ones that would do something are enabled', async () => {
    const r = rig();
    await r.scene.enter();
    r.run(1);
    const actions = [...r.uiLayer.querySelectorAll<HTMLElement>('[data-action]')].map((e) => e.dataset.action);
    expect(actions).toEqual(expect.arrayContaining([...Object.values(NET_LAB_ACTION), 'back']));
    expect(r.button(NET_LAB_ACTION.bDisconnect).disabled).toBe(false);
    expect(r.button(NET_LAB_ACTION.bReconnect).disabled).toBe(true);
    expect(r.button(NET_LAB_ACTION.aLeave).disabled).toBe(false);
    expect(r.button(NET_LAB_ACTION.aRejoin).disabled).toBe(true);
    expect(r.button(NET_LAB_ACTION.aTeleport).disabled).toBe(false);
    r.button('back').click();
    expect(r.backs()).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(r.backs()).toBe(2);
    r.teardown();
  });

  it('refuses the teleport claim: the host corrects it, A snaps back, and B never sees the jump', async () => {
    const r = rig();
    await r.scene.enter();
    const { lab } = r.scene;
    r.run(5);
    const before = must(lab.a.local, 'A local').at;
    expect(lab.host.stats.claimsRefused).toBe(0);

    r.press(NET_LAB_ACTION.aTeleport);
    const jumped = must(lab.a.local, 'A local').at;
    expect(jumped.wx - before.wx).toBeCloseTo(TELEPORT_UNITS, 9);
    // The next frame claims it; the host refuses it and answers with the truth; the lab snaps back.
    r.run(1);
    expect(lab.host.stats.claimsRefused).toBe(1);
    expect(lab.a.corrections).toBe(1);
    const truth = must(lab.host.actorsOf(A_PLAYER)[0], 'host truth for A');
    const local = must(lab.a.local, 'A local');
    expect(local.at.wx).toBeCloseTo(truth.at.wx, 9);
    expect(local.at.wz).toBeCloseTo(truth.at.wz, 9);
    expect(local.at.wx).toBeCloseTo(before.wx, 9);

    // B's picture of A never left the neighbourhood of where A really was.
    r.run(20);
    const seenByB = must(lab.b.client.replica.newest(must(lab.a.client.actorId, 'A actor id')), 'B replica of A');
    expect(Math.abs(seenByB.at.wx - truth.at.wx)).toBeLessThan(TELEPORT_UNITS / 10);
    expect(r.field('a-corrections')).toBe('refused 1 claim (snapped back)');
    expect(r.field('host-claims')).toMatch(/refused 1$/);
    r.teardown();
  });

  it('walks A with W: claims accepted, none refused, and B replicates the movement', async () => {
    const r = rig();
    await r.scene.enter();
    const { lab } = r.scene;
    const start = must(lab.a.local, 'A local').at;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    r.run(120); // two seconds
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    const after = must(lab.a.local, 'A local').at;
    const walked = Math.hypot(after.wx - start.wx, after.wz - start.wz);
    // Two seconds at a walk, minus the arc she turns through to face the camera's way first.
    expect(walked).toBeGreaterThan(DEBUG_CAPSULE_TUNING.walkSpeed * 1.5);
    expect(lab.host.stats.claimsRefused).toBe(0);
    expect(lab.host.stats.claimsAccepted).toBeGreaterThan(60);
    expect(lab.a.corrections).toBe(0);
    r.run(15); // let the interpolation delay pass
    const seenByB = must(lab.b.client.replica.newest('capsule-1' as never), 'B replica of A');
    expect(Math.hypot(seenByB.at.wx - after.wx, seenByB.at.wz - after.wz)).toBeLessThan(1e-6);
    r.teardown();
  });

  it('B hangs up: lingers through the grace and comes back to the SAME actor; past the grace, a fresh one', async () => {
    const r = rig();
    await r.scene.enter();
    const { lab } = r.scene;
    r.run(5);
    const originalId = lab.b.client.actorId;
    expect(originalId).toBe('capsule-2');

    r.press(NET_LAB_ACTION.bDisconnect);
    r.run(2);
    expect(lab.b.state).toBe('disconnected');
    expect(lab.host.presence(lab.b.hello.playerId)).toBe('lingering');
    // A still sees both: nobody said leave.
    expect(lab.a.client.replica.ids().sort()).toEqual(['capsule-1', 'capsule-2']);
    r.run(15);
    expect(r.field('b-state')).toMatch(/^disconnected/);
    expect(r.field('host-b')).toMatch(/^B lingering, \d+\.\d s of grace left$/);
    expect(r.field('a-actors')).toBe('2 known: capsule-1, capsule-2');

    // Halfway through the grace: hello again on the same wire.
    r.run(10, 0.5, 0.1);
    r.run(15); // the HUD repaints at 5 Hz; a button's enabled state follows the readout
    r.press(NET_LAB_ACTION.bReconnect);
    await flush();
    r.run(2);
    expect(lab.b.state).toBe('connected');
    expect(lab.b.client.actorId).toBe(originalId);
    expect(lab.host.snapshot().actors).toHaveLength(2);
    expect(lab.a.client.replica.ids().sort()).toEqual(['capsule-1', 'capsule-2']);
    r.run(15);

    // Hang up again and let the whole grace run out: the host drops B and A hears leave.
    r.press(NET_LAB_ACTION.bDisconnect);
    r.run(Math.ceil(HOST_DEFAULTS.graceMs / 500) + 2, 0.5, 0.1);
    expect(lab.host.presence(lab.b.hello.playerId)).toBe('absent');
    expect(lab.a.client.replica.ids()).toEqual(['capsule-1']);
    r.run(15);
    expect(r.field('a-actors')).toBe('1 known: capsule-1');
    expect(r.capsulesOnScreen()).toEqual(['capsule-1']);

    // Back after the grace: a new actor, not the old one.
    r.press(NET_LAB_ACTION.bReconnect);
    await flush();
    r.run(2);
    expect(lab.b.state).toBe('connected');
    expect(lab.b.client.actorId).not.toBe(originalId);
    expect(lab.a.client.replica.ids()).toHaveLength(2);
    r.run(15);
    expect(r.field('a-actors')).toMatch(/^2 known: /);
    r.teardown();
  });

  it('A leaves cleanly: B hears leave at once; A rejoins on a fresh wire as a fresh actor', async () => {
    const r = rig();
    await r.scene.enter();
    const { lab } = r.scene;
    r.run(5);
    r.press(NET_LAB_ACTION.aLeave);
    r.run(2);
    expect(lab.a.state).toBe('left');
    expect(lab.host.presence(A_PLAYER)).toBe('absent');
    expect(lab.b.client.replica.ids()).toEqual(['capsule-2']);
    expect(lab.host.connectionCount).toBe(1);
    r.run(15);
    expect(r.field('a-state')).toBe('left — said bye');
    expect(r.button(NET_LAB_ACTION.aRejoin).disabled).toBe(false);
    expect(r.button(NET_LAB_ACTION.aTeleport).disabled).toBe(true);

    r.press(NET_LAB_ACTION.aRejoin);
    await flush();
    r.run(2);
    expect(lab.a.state).toBe('connected');
    expect(lab.a.client.actorId).toBe('capsule-3');
    expect(lab.host.connectionCount).toBe(2);
    expect(lab.a.client.replica.ids().sort()).toEqual(['capsule-2', 'capsule-3']);
    expect(lab.b.client.replica.ids().sort()).toEqual(['capsule-2', 'capsule-3']);
    r.run(15);
    expect(r.capsulesOnScreen().sort()).toEqual(['capsule-2', 'capsule-3']);
    r.teardown();
  });

  it('the sliders turn the one shared set of dials, clamped to their ranges, and the HUD reads them back', async () => {
    const r = rig();
    await r.scene.enter();
    r.run(1);
    const slider = (action: string): HTMLInputElement =>
      must(r.uiLayer.querySelector<HTMLInputElement>(`input[data-action="${action}"]`), `slider ${action}`);
    const turn = (action: string, value: string): void => {
      const s = slider(action);
      s.value = value;
      s.dispatchEvent(new Event('input'));
    };
    turn(NET_LAB_ACTION.latency, '200');
    turn(NET_LAB_ACTION.jitter, '40');
    turn(NET_LAB_ACTION.drop, '30');
    const { conditions } = r.scene.lab;
    expect(conditions).toEqual({ latencyMs: 200, jitterMs: 40, dropRate: 0.3 });
    expect(r.field('dial-latency')).toBe('latency 200 ms');
    expect(r.field('dial-jitter')).toBe('jitter 40 ms');
    expect(r.field('dial-drop')).toBe('drop 30 %');
    turn(NET_LAB_ACTION.latency, '9999');
    expect(conditions.latencyMs).toBe(400);
    turn(NET_LAB_ACTION.drop, '-5');
    expect(conditions.dropRate).toBe(0);

    // On a slow, lossy wire the session still runs and the replica still converges on the host's truth.
    turn(NET_LAB_ACTION.latency, '200');
    turn(NET_LAB_ACTION.drop, '30');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    r.run(180);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    turn(NET_LAB_ACTION.drop, '0');
    r.run(120);
    const { lab } = r.scene;
    const truth = must(lab.host.actorsOf(A_PLAYER)[0], 'host truth for A');
    const seenByB = must(lab.b.client.replica.newest(truth.id), 'B replica of A');
    expect(Math.hypot(seenByB.at.wx - truth.at.wx, seenByB.at.wz - truth.at.wz)).toBeLessThan(1e-6);
    expect(lab.a.corrections).toBe(0);
    r.teardown();
  });

  it('disposes everything it added: the HUD, the capsules, the grid, the links', async () => {
    const r = rig();
    await r.scene.enter();
    r.run(2);
    r.scene.resize(932, 430);
    expect((r.scene.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(932 / 430, 9);
    expect(r.uiLayer.children.length).toBe(1);
    r.scene.dispose();
    expect(r.uiLayer.children.length).toBe(0);
    expect(r.scene.three.children.length).toBe(0);
    expect(r.scene.lab.host.connectionCount).toBe(0);
    r.input.detach();
    r.uiLayer.remove();
  });
});

describe('intentFrom (camera-relative stick)', () => {
  const thumbs = (stickX: number, stickY: number, sprint = false): Thumbs => ({
    stickX, stickY, lookDx: 0, lookDy: 0, dragging: false, sprint,
  });

  it('a centred or dead-zone stick is neutral', () => {
    expect(intentFrom(thumbs(0, 0), 0, 0, SIXTY, DEBUG_CAPSULE_TUNING)).toBe(NEUTRAL_INTENT);
    expect(intentFrom(thumbs(0.05, -0.05), 0, 0, SIXTY, DEBUG_CAPSULE_TUNING)).toBe(NEUTRAL_INTENT);
  });

  it('pushed up while facing the camera way: full ahead, no turn', () => {
    const i = intentFrom(thumbs(0, -1), 1.2, 1.2, SIXTY, DEBUG_CAPSULE_TUNING);
    expect(i.forward).toBeCloseTo(1, 9);
    expect(i.turn).toBeCloseTo(0, 9);
    expect(i.strafe).toBe(0);
  });

  it('pushed down while facing the camera way: turns about at the full rate and walks nothing yet', () => {
    const i = intentFrom(thumbs(0, 1), 0, 0, SIXTY, DEBUG_CAPSULE_TUNING);
    expect(Math.abs(i.turn)).toBe(1);
    expect(i.forward).toBe(0);
  });

  it('screen-right is a quarter turn below the camera facing, so the turn goes negative; sprint passes through', () => {
    const i = intentFrom(thumbs(1, 0, true), 0, 0, SIXTY, DEBUG_CAPSULE_TUNING);
    expect(i.turn).toBe(-1);
    expect(i.sprint).toBe(true);
    // Already facing that way: no turn, full ahead.
    const facing = intentFrom(thumbs(1, 0), -Math.PI / 2, 0, SIXTY, DEBUG_CAPSULE_TUNING);
    expect(facing.turn).toBeCloseTo(0, 9);
    expect(facing.forward).toBeCloseTo(1, 9);
  });
});
