// @vitest-environment jsdom
/**
 * The Performance World as a Scene: what enter() builds and reports, what
 * update() feeds where, that the camera is an instrument rather than a
 * simulated thing, and the save points — a restored camera on enter, a
 * save through the session when the pause overlay opens, and the save
 * point handed to the owner for QUIT. three's scene graph and helpers
 * build without WebGL.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { colorFor } from '../src/actor/playerColor';
import { spawnCapsule } from '../src/actor/spawnCapsule';
import type { AppState } from '../src/app/AppState';
import type { AppHandle, SceneContext } from '../src/app/Scene';
import { Input } from '../src/input/Input';
import { HOST_DEFAULTS } from '../src/net/Host';
import type { MessageHandler, Transport, TransportState } from '../src/net/Transport';
import type { Message, MoveMessage, Snapshot } from '../src/net/protocol';
import { DEFAULT_SPEED, headingOfYaw } from '../src/perf/FreeFlyCamera';
import {
  REMOTE_CAPSULES_ROLE, createPerformanceWorldScene, type PerformanceWorldHooks,
} from '../src/perf/PerformanceWorldScene';
import { PERF_WORLD_SCENE_ID } from '../src/perf/perfTool';
import type { GameSession, SessionSaveState } from '../src/session/GameSession';
import { RemoteMultiplayerSession } from '../src/session/RemoteMultiplayerSession';
import { world } from '../src/world/coords';

const SIXTY = 1 / 60;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** A session whose save() is a spy: the scene never learns which kind it holds. */
function spySession(): GameSession & { readonly save: ReturnType<typeof vi.fn> } {
  return {
    mode: 'solo',
    mapId: 'perf-empty',
    canPauseWorld: true,
    authority: 'local',
    caption: 'Play alone on this device.',
    save: vi.fn(async () => {}),
    leave: async () => {},
  };
}

interface RigOptions {
  readonly session?: GameSession | null;
  readonly resume?: () => SessionSaveState | null;
  readonly identity?: () => { readonly playerId: ReturnType<typeof playerId>; readonly name: string };
  readonly practiceBot?: () => { readonly playerId: ReturnType<typeof playerId>; readonly name: string } | null;
}

function rig(initial: AppState, options: RigOptions = {}) {
  const states: AppState[] = [initial];
  const app: AppHandle = {
    get state() {
      return states[states.length - 1];
    },
    requestState: (next) => {
      states.push(next);
    },
    session: options.session ?? null,
    startSession: () => {},
    endSession: async () => {},
  };
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const input = new Input();
  // The scene reads `uiLayer`, `input` and `app` only. The rest of the
  // context is deliberately absent, so a scene that starts reaching for the
  // renderer, storage or assets fails loudly here instead of quietly
  // coupling to them.
  const ctx = { uiLayer, input, app } as unknown as SceneContext;

  const fractions: number[] = [];
  let pauses = 0;
  let savePoint: (() => Promise<void>) | null = null;
  const hooks: PerformanceWorldHooks = {
    // What the shell does with PAUSE: the overlay opens and requests `paused`.
    onPause: () => {
      pauses += 1;
      app.requestState('paused');
    },
    onLoadProgress: (fraction) => {
      fractions.push(fraction);
    },
    resume: options.resume,
    onSavePoint: (save) => {
      savePoint = save;
    },
    identity: options.identity,
    practiceBot: options.practiceBot,
  };
  const scene = createPerformanceWorldScene(hooks)(ctx);
  const field = (name: string): string =>
    must(uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`), `field ${name}`).textContent ?? '';
  const frame = (simDt = SIXTY): void => scene.update({ rawDt: SIXTY, simDt, elapsed: 0 });
  return { scene, states, app, uiLayer, input, fractions, pauses: () => pauses, savePoint: () => savePoint, field, frame };
}

/** The world's START pose, as the scene places it. */
const START = { x: 0, y: 25, z: 80, yaw: 0, pitch: -0.22 };

describe('PerformanceWorldScene', () => {
  it('enters quickly, reports rising milestone progress ending at 1, and moves loading → playing', async () => {
    const { scene, states, fractions } = rig('loading');
    expect(scene.name).toBe(PERF_WORLD_SCENE_ID);
    await scene.enter();
    expect(fractions.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < fractions.length; i += 1) expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(states).toEqual(['loading', 'playing']);
  });

  it('opened from the menu as a dev tool, it leaves the app state to the hub', async () => {
    const { scene, states } = rig('menu');
    await scene.enter();
    expect(states).toEqual(['menu']);
  });

  it('builds a lit ground grid under a horizon sky, a HUD, and a PAUSE button that asks its owner', async () => {
    const { scene, uiLayer, pauses } = rig('loading');
    await scene.enter();
    expect(scene.three.children.some((o) => o instanceof THREE.GridHelper)).toBe(true);
    expect(scene.three.children.some((o) => o instanceof THREE.DirectionalLight)).toBe(true);
    expect(scene.three.background).toBeInstanceOf(THREE.Color);
    expect(scene.three.fog).not.toBeNull();
    expect(uiLayer.querySelector('[data-role="perf-hud"]')).not.toBeNull();
    const pause = must(uiLayer.querySelector<HTMLButtonElement>('[data-action="pause"]'), 'pause button');
    expect(pause.textContent).toBe('Pause');
    pause.click();
    expect(pauses()).toBe(1);
  });

  it('feeds raw dt to the FRAME readout and sim dt to the SIM readout, as two different numbers', async () => {
    const { scene, field } = rig('loading');
    await scene.enter();
    for (let i = 0; i < 119; i += 1) scene.update({ rawDt: SIXTY, simDt: SIXTY, elapsed: i * SIXTY });
    // The v0 stall: raw 2.0 s, sim clamped to 0.1 s. The 2 s frame also
    // trips the HUD's refresh, so the readout is current after this call.
    scene.update({ rawDt: 2.0, simDt: 0.1, elapsed: 2 });
    expect(field('low-fps')).toBe('95th low 0.5 fps');
    expect(field('sim-dt')).toBe('100.0 ms');
    // Paused: sim dt 0, raw still ticking. Enough frames for one refresh.
    for (let i = 0; i < 13; i += 1) scene.update({ rawDt: SIXTY, simDt: 0, elapsed: 2 });
    expect(field('sim-dt')).toBe('paused');
    expect(field('low-fps')).toBe('95th low 0.5 fps');
  });

  it('flies the camera by raw dt even while the simulation is paused', async () => {
    const { scene, input } = rig('loading');
    const host = document.createElement('div');
    input.attach(host);
    await scene.enter();
    const start = scene.camera.position.clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    scene.update({ rawDt: 1, simDt: 0, elapsed: 0 });
    // One second of wall-clock at the default speed, along the view.
    expect(start.distanceTo(scene.camera.position)).toBeCloseTo(DEFAULT_SPEED, 6);
    expect(scene.camera.position.z).toBeLessThan(start.z);
    input.detach();
  });

  it('resizes its camera and disposes everything it added', async () => {
    const { scene, uiLayer } = rig('loading');
    await scene.enter();
    scene.resize(932, 430);
    expect((scene.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(932 / 430, 9);
    expect(uiLayer.children.length).toBe(2);
    scene.dispose();
    expect(scene.three.children.length).toBe(0);
    expect(uiLayer.children.length).toBe(0);
  });
});

describe('PerformanceWorldScene save points', () => {
  const saved: SessionSaveState = { camera: { at: world(1_200, -340), height: 55, yaw: 0.7, pitch: -0.3 } };

  it('starts at START when there is nothing to resume, whether the hook is absent or answers null', async () => {
    for (const options of [{}, { resume: () => null }]) {
      const { scene } = rig('loading', options);
      await scene.enter();
      const p = scene.camera.position;
      expect([p.x, p.y, p.z]).toEqual([START.x, START.y, START.z]);
      expect(scene.camera.rotation.y).toBe(START.yaw);
      expect(scene.camera.rotation.x).toBeCloseTo(START.pitch, 9);
    }
  });

  it('applies a restored camera: the saved WorldPoint, height, yaw and pitch, converted at the render boundary', async () => {
    const { scene } = rig('loading', { resume: () => saved });
    await scene.enter();
    const p = scene.camera.position;
    // The floating origin sits at 0 in this world, so local equals world here — and this is the one place that conversion happens.
    expect([p.x, p.y, p.z]).toEqual([1_200, 55, -340]);
    expect(scene.camera.rotation.y).toBeCloseTo(0.7, 9);
    expect(scene.camera.rotation.x).toBeCloseTo(-0.3, 9);
  });

  it('saves the camera through the session once when the pause overlay opens, and not again until it opens again', async () => {
    const session = spySession();
    const { scene, uiLayer, app, frame } = rig('loading', { session });
    await scene.enter();
    frame();
    expect(session.save).not.toHaveBeenCalled();

    must(uiLayer.querySelector<HTMLButtonElement>('[data-action="pause"]'), 'pause button').click();
    expect(app.state).toBe('paused');
    // The overlay opened between frames; the next frame notices and saves — once.
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.save).toHaveBeenCalledWith({
      camera: { at: world(START.x, START.z), height: START.y, yaw: START.yaw, pitch: START.pitch },
    });
    for (let i = 0; i < 5; i += 1) frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);

    app.requestState('playing');
    frame();
    expect(session.save).toHaveBeenCalledTimes(1);
    // Escape opens the same overlay without touching this scene's button: the state is what is watched.
    app.requestState('paused');
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(2);
  });

  it('hands its save point to the owner, and that writes the pose the player last saw — after flying while paused', async () => {
    const session = spySession();
    const { scene, app, input, savePoint, frame } = rig('loading', { session });
    const host = document.createElement('div');
    input.attach(host);
    await scene.enter();
    expect(savePoint()).not.toBeNull();

    app.requestState('paused');
    frame(0);
    expect(session.save).toHaveBeenCalledTimes(1);
    // The instrument keeps flying under the pause menu; QUIT must not lose that.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    scene.update({ rawDt: 1, simDt: 0, elapsed: 0 });
    const p = scene.camera.position.clone();
    expect(p.distanceTo(new THREE.Vector3(START.x, START.y, START.z))).toBeCloseTo(DEFAULT_SPEED, 6);

    await must(savePoint(), 'save point')();
    expect(session.save).toHaveBeenCalledTimes(2);
    expect(session.save).toHaveBeenLastCalledWith({
      camera: { at: world(p.x, p.z), height: p.y, yaw: START.yaw, pitch: expect.closeTo(START.pitch, 9) },
    });
    input.detach();
  });

  it('with no session there is nothing to save through, and a pause is not an error', async () => {
    const { scene, app, frame, savePoint } = rig('loading', { session: null });
    await scene.enter();
    app.requestState('paused');
    expect(() => frame(0)).not.toThrow();
    await expect(must(savePoint(), 'save point')()).resolves.toBeUndefined();
  });
});

/**
 * The world when the session is a networked one: the local player is the
 * camera, claimed as a debug capsule, and everyone else is drawn from the
 * replica. A fake wire, so every assertion is about what the SCENE does.
 */
describe('PerformanceWorldScene on a networked session', () => {
  /** jsdom has no 2D context; a silent stand-in keeps the name label from logging "not implemented". */
  const quietContext = (): CanvasRenderingContext2D =>
    ({
      font: '',
      fillStyle: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      clearRect: () => {},
      fillRect: () => {},
      measureText: (text: string) => ({ width: text.length * 26 }),
      fillText: () => {},
    }) as unknown as CanvasRenderingContext2D;

  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => quietContext());
  });
  afterAll(() => vi.restoreAllMocks());

  const me = playerId('perf-device');
  const them = playerId('other-device');
  const mine = spawnCapsule(me, 'Keeper', colorFor(me), world(0, 0), actorId('capsule-1'));
  const theirs = spawnCapsule(them, 'Other', colorFor(them), world(400, 0), actorId('capsule-2'));
  /** The practice bot, as the authority would spawn it: its own player, its own actor. */
  const botId = playerId('practice-bot-1');
  const botCapsule = spawnCapsule(botId, 'Practice Bot', colorFor(botId), world(100, 0), actorId('capsule-3'));

  /** The smallest wire that satisfies the contract; `deliver` is the relay speaking. */
  class FakeTransport implements Transport {
    state: TransportState = 'closed';
    readonly sent: Message[] = [];
    private readonly handlers = new Set<MessageHandler>();
    private readonly closers = new Set<() => void>();

    async connect(): Promise<void> {
      this.state = 'open';
    }

    disconnect(): void {
      if (this.state === 'closed') return;
      this.state = 'closed';
      for (const cb of [...this.closers]) cb();
    }

    send(msg: unknown): void {
      this.sent.push(msg as Message);
    }

    onMessage(cb: MessageHandler): () => void {
      this.handlers.add(cb);
      return () => {
        this.handlers.delete(cb);
      };
    }

    onClose(cb: () => void): () => void {
      this.closers.add(cb);
      return () => {
        this.closers.delete(cb);
      };
    }

    deliver(msg: Message): void {
      for (const cb of [...this.handlers]) cb(msg);
    }

    kind(k: Message['kind']): Message[] {
      return this.sent.filter((m) => m.kind === k);
    }

    moves(): MoveMessage[] {
      return this.sent.filter((m): m is MoveMessage => m.kind === 'move');
    }
  }

  const snapshot = (tick: number, actors: readonly ActorState[]): Snapshot => ({ tick, actors });

  /** Enough microtask turns for a handshake whose transport is already open. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  function netRig() {
    const transport = new FakeTransport();
    // The REAL multiplayer session, holding a fake wire: this is also the
    // test that the scene can find a transport on the session it is given
    // without knowing which class it is.
    const session = new RemoteMultiplayerSession('perf-empty', {
      relayUrl: 'ws://127.0.0.1:8787/room/abcde',
      createTransport: () => transport,
    });
    const r = rig('loading', { session, identity: () => ({ playerId: me, name: 'Keeper' }) });
    /** One frame long enough to trip both the claim cadence and the HUD refresh. */
    const second = (): void => r.scene.update({ rawDt: 1, simDt: SIXTY, elapsed: 1 });
    const capsules = (): string[] => {
      const group = r.scene.three.children.find((o) => o.name === 'remote-actors');
      return group === undefined ? [] : group.children.map((o) => o.name);
    };
    /**
     * The instrumentation list as a probe reads it: one row per capsule
     * MESH, carrying that mesh's own render position (REMOTE_CAPSULES_ROLE).
     */
    const drawn = (): Array<{ capsule: string; lx: number; lz: number }> =>
      [...r.uiLayer.querySelectorAll<HTMLElement>(`[data-role="${REMOTE_CAPSULES_ROLE}"] [data-capsule]`)].map((row) => ({
        capsule: row.dataset.capsule ?? '',
        lx: Number(row.dataset.lx),
        lz: Number(row.dataset.lz),
      }));
    return { ...r, transport, session, second, capsules, drawn };
  }

  /**
   * The same rig, but the session opens a SECOND link because the player
   * asked for a practice bot on the room screen. Two transports, because
   * the bot is a second PLAYER: one connection speaks for one player
   * (`net/Host.onHello`).
   */
  function botRig() {
    const mine_ = new FakeTransport();
    const bots = new FakeTransport();
    const links = [mine_, bots];
    let handed = 0;
    const session = new RemoteMultiplayerSession('perf-empty', {
      relayUrl: 'ws://127.0.0.1:8787/room/abcde',
      practiceBot: true,
      createTransport: () => links[Math.min(handed++, links.length - 1)],
    });
    const r = rig('loading', {
      session,
      identity: () => ({ playerId: me, name: 'Keeper' }),
      practiceBot: () => ({ playerId: botId, name: 'Practice Bot' }),
    });
    const second = (): void => r.scene.update({ rawDt: 1, simDt: SIXTY, elapsed: 1 });
    return { ...r, mine: mine_, bots, session, second };
  }

  it('builds no practice bot, and throws nothing, when the room was not asked for one', async () => {
    // Every multiplayer session HAS the method; only one the player asked
    // a bot from answers with a link. Reading the method's existence as
    // "yes" built a bot with no wire, and `probe:multiplayer` reported it
    // as an uncaught page error on BOTH browsers of an ordinary room.
    const { scene, uiLayer, transport, second } = netRig();
    await scene.enter();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    second();
    expect(uiLayer.querySelector('[data-role="bot-hud"]')).toBeNull();
    // And exactly one hello went out: the player's own.
    expect(transport.kind('hello')).toHaveLength(1);
  });

  it('opens a SECOND link for the practice bot, and shows its panel', async () => {
    const { scene, uiLayer, mine: playerLink, bots, second } = botRig();
    await scene.enter();
    await flush();

    // Two players, two connections, two hellos — each on its own wire.
    expect(playerLink.kind('hello')).toHaveLength(1);
    expect(bots.kind('hello')).toEqual([
      { kind: 'hello', playerId: botId, name: 'Practice Bot', color: colorFor(botId) },
    ]);

    const panel = uiLayer.querySelector('[data-role="bot-hud"]');
    expect(panel).not.toBeNull();
    second();
    // It says what it is, before it has been anywhere.
    expect(panel?.textContent).toContain('not a person');
  });

  it('takes the practice bot down with the world, on its own link', async () => {
    const { scene, uiLayer, bots } = botRig();
    await scene.enter();
    // The authority welcomes the bot, so there is a session to say goodbye
    // to: a handshake that never completed has nothing to hang up.
    bots.deliver({ kind: 'welcome', yourId: botId, snapshot: snapshot(1, [botCapsule]) });
    await flush();

    scene.dispose?.();
    expect(uiLayer.querySelector('[data-role="bot-hud"]')).toBeNull();
    // A scripted stranger left standing in the room for the grace window
    // is somebody else's confusion.
    expect(bots.kind('bye')).toEqual([{ kind: 'bye', playerId: botId }]);
  });

  it('says hello on the session’s own wire, then claims the camera pose as a capsule', async () => {
    const { scene, transport, second, field } = netRig();
    await scene.enter();
    await flush();
    expect(transport.kind('hello')).toEqual([{ kind: 'hello', playerId: me, name: 'Keeper', color: colorFor(me) }]);
    // Nothing is claimed before the authority has welcomed us.
    second();
    expect(transport.moves()).toEqual([]);
    expect(field('session')).toBe('Connecting…');

    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    second();
    // THE LOCAL PLAYER IS THE CAMERA, and where it joins is the
    // authority's to say: the camera stands over the actor the welcome
    // named, at its own flying height. A claim from START would be 84
    // units from that actor in one step — more than the travel budget
    // allows — and would be refused, and so would every one after it,
    // because the gap would never close.
    // The heading claimed is the direction the camera LOOKS, not its yaw:
    // a three camera looks down its own −Z and an actor's heading faces
    // +wz, so the two are half a turn apart and claiming the yaw raw
    // pointed the capsule backwards on every other screen
    // (`FreeFlyCamera.headingOfYaw`).
    expect(transport.moves()).toEqual([
      { kind: 'move', actorId: mine.id, at: mine.at, height: START.y, heading: headingOfYaw(START.yaw), seq: 0 },
    ]);
    expect(headingOfYaw(START.yaw)).toBeCloseTo(Math.PI, 12);
    // The look and the height are the player's; only the ground position came from the wire.
    expect(scene.camera.position.x).toBeCloseTo(mine.at.wx);
    expect(scene.camera.position.y).toBeCloseTo(START.y);
    expect(scene.camera.position.z).toBeCloseTo(mine.at.wz);
    expect(scene.camera.rotation.y).toBeCloseTo(START.yaw);
    expect(scene.camera.rotation.x).toBeCloseTo(START.pitch);
  });

  /**
   * The regression `scripts/probe-multiplayer.mjs` found: two browsers
   * connected, each drawing the other, and neither able to move on the
   * other's screen, because every claim was a refused 84-unit jump from
   * the spawn point to START. The camera adopts the spawn ONCE — a later
   * correction is still not allowed to move it (the camera is an
   * instrument), which the refusal test below pins.
   */
  it('joins where the authority spawned it, and claims are accepted from there on', async () => {
    const { scene, transport, second } = netRig();
    await scene.enter();
    await flush();
    // Somewhere far from START, as a second player's spawn point is.
    const far = spawnCapsule(me, 'Keeper', colorFor(me), world(4000, -2500), actorId('capsule-9'));
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [far]) });
    await flush();
    second();
    const [first] = transport.moves();
    expect(first?.at).toEqual(far.at);
    // AND THE FIRST CLAIM IS ONE THE AUTHORITY CAN PAY FOR, measured
    // against its own numbers rather than against a comment: an actor
    // earns travel at top speed with the host's tolerance and banks
    // `burstMs` of it, and that bank is all a first claim has to spend.
    const budget =
      DEBUG_CAPSULE_TUNING.walkSpeed *
      DEBUG_CAPSULE_TUNING.sprintFactor *
      HOST_DEFAULTS.tolerance *
      (HOST_DEFAULTS.burstMs / 1000);
    const asked = Math.hypot(first.at.wx - far.at.wx, first.at.wz - far.at.wz, first.height - far.height);
    expect(asked).toBeLessThan(budget);
  });

  it('draws every other player’s capsule and never its own', async () => {
    const { scene, transport, second, capsules } = netRig();
    await scene.enter();
    await flush();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    second();
    expect(capsules()).toEqual([]);

    transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [mine, theirs]) });
    second();
    expect(capsules()).toEqual([`capsule:${theirs.id}`]);

    // Gone means gone: the scene is derived from the list, every frame.
    transport.deliver({ kind: 'leave', playerId: them });
    second();
    expect(capsules()).toEqual([]);
  });

  it('says one honest line about the link, and keeps the world running when it dies', async () => {
    const { scene, transport, second, field, capsules } = netRig();
    await scene.enter();
    await flush();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [mine, theirs]) });
    second();
    expect(field('session')).toBe('Connected · 1 other player');

    // The relay drops. The world does not.
    transport.disconnect();
    const before = scene.camera.position.clone();
    // A quarter second: enough to refresh the HUD, not enough to reach the
    // rejoin cadence, so this is what a player sees the moment it happens.
    expect(() => scene.update({ rawDt: 0.25, simDt: SIXTY, elapsed: 2 })).not.toThrow();
    expect(field('session')).toBe('Connection lost · 1 other player last seen');
    // The world keeps drawing and the camera keeps flying; the capsule that
    // was on screen is still on screen, stale and honestly labelled as such.
    expect(scene.camera.position.equals(before)).toBe(true);
    expect(capsules()).toEqual([`capsule:${theirs.id}`]);

    // And it does not sit there: the same identity is offered again.
    second();
    second();
    expect(field('session')).toBe('Connecting… · 1 other player last seen');
  });

  it('counts a refused claim in the same line rather than snapping the camera back', async () => {
    const { scene, transport, second, field } = netRig();
    await scene.enter();
    await flush();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    second();
    const claimed = scene.camera.position.clone();
    // The authority answers the claim with a different truth — somewhere
    // the camera is not — which is what a refusal looks like on the wire.
    transport.deliver({
      kind: 'snapshot',
      snapshot: snapshot(2, [{ ...mine, at: world(-45, 30), height: 0 }]),
      ackSeq: 0,
    });
    second();
    expect(field('session')).toBe('Connected · no other players · claim→ack 0 ms · 1 claim refused');
    // A travel budget written for a walking capsule does not fight the hand
    // flying a benchmark camera.
    expect(scene.camera.position.equals(claimed)).toBe(true);
  });

  it('says goodbye and takes its capsules with it when the world is disposed', async () => {
    const { scene, transport, second, capsules } = netRig();
    await scene.enter();
    await flush();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [mine, theirs]) });
    second();
    expect(capsules().length).toBe(1);

    scene.dispose();
    expect(transport.kind('bye')).toEqual([{ kind: 'bye', playerId: me }]);
    expect(transport.state).toBe('closed');
    expect(scene.three.children.length).toBe(0);
  });

  /**
   * The probe seam, which is the only way `npm run probe:multiplayer` can
   * tell "the snapshot arrived" from "the capsule is on screen": every row
   * is read off a mesh that is genuinely in the scene, and it moves when
   * the mesh does.
   */
  it('publishes what is actually drawn — one row per capsule mesh, at that mesh’s own position', async () => {
    const { scene, transport, second, capsules, drawn, uiLayer } = netRig();
    await scene.enter();
    await flush();
    transport.deliver({ kind: 'welcome', yourId: me, snapshot: snapshot(1, [mine]) });
    await flush();
    second();
    expect(drawn()).toEqual([]);

    transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [mine, theirs]) });
    second();
    expect(drawn()).toEqual([{ capsule: `capsule:${theirs.id}`, lx: theirs.at.wx, lz: theirs.at.wz }]);
    expect(drawn().length).toBe(capsules().length);

    // The truth is the mesh: when the other player moves, the row moves
    // with it, and when they leave there is no row to read.
    const walked: ActorState = { ...theirs, at: world(theirs.at.wx + 12, theirs.at.wz - 5) };
    transport.deliver({ kind: 'snapshot', snapshot: snapshot(3, [mine, walked]) });
    second();
    second();
    expect(drawn()[0]?.lx).toBeCloseTo(walked.at.wx, 1);
    expect(drawn()[0]?.lz).toBeCloseTo(walked.at.wz, 1);

    scene.dispose();
    expect(uiLayer.querySelector(`[data-role="${REMOTE_CAPSULES_ROLE}"]`)).toBeNull();
  });

  it('in a solo session no network code runs at all, whatever the session is carrying', async () => {
    const transport = new FakeTransport();
    // A solo session that happens to hold a wire: the scene must not reach
    // for it, because a solo world has no authority to claim to.
    const session: GameSession = { ...spySession(), transport } as GameSession;
    const { scene, field, uiLayer } = rig('loading', { session, identity: () => ({ playerId: me, name: 'Keeper' }) });
    await scene.enter();
    await flush();
    for (let i = 0; i < 3; i += 1) scene.update({ rawDt: 1, simDt: SIXTY, elapsed: i });
    expect(transport.sent).toEqual([]);
    expect(transport.state).toBe('closed');
    expect(scene.three.children.some((o) => o.name === 'remote-actors')).toBe(false);
    expect(field('session')).toBe('Solo');
    // No wire, so no instrumentation either: a solo benchmark pays nothing for it.
    expect(uiLayer.querySelector(`[data-role="${REMOTE_CAPSULES_ROLE}"]`)).toBeNull();
  });

  it('a multiplayer session with no relay says so rather than pretending to be solo', async () => {
    // The honest mock: multiplayer, no URL, so no transport exists at all.
    const session = new RemoteMultiplayerSession('perf-empty');
    const { scene, field } = rig('loading', { session, identity: () => ({ playerId: me, name: 'Keeper' }) });
    await scene.enter();
    scene.update({ rawDt: 1, simDt: SIXTY, elapsed: 1 });
    expect(field('session')).toBe('Not connected');
  });
});
