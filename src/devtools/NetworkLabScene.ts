/**
 * THE NETWORK LAB: the two-capsule milestone (ARCHITECTURE §5) as a
 * scene you can stand in, before any relay exists.
 *
 * One in-process `Host`. Two `Client`s, A and B, each on its own
 * loopback pair, every pair reading ONE shared `NetworkConditions` so
 * the sliders hurt both directions of both links at once. A's capsule
 * is the player's: twin-zone touch or WASD becomes an `Intent`,
 * `Transform.step` moves her, and the pose goes to the host as a move
 * CLAIM. B's capsule is driven by the `ScriptedMover` on a figure-eight
 * and claimed the same way, so the host cannot tell the bot from the
 * person. Each client draws ITS OWN capsule from its local state and
 * the OTHER from its `Replica`, read 100 ms behind receipt; the screen
 * shows A's view, and the HUD says what each client, and the host,
 * currently believes.
 *
 * WHAT THE BUTTONS PROVE. "B: disconnect" hangs B up without a `bye`:
 * the host keeps B's actor for its grace and A never sees a `leave`
 * until it runs out. "B: reconnect" says hello again with the same
 * PlayerId and gets the same actor back — inside the grace; after it, a
 * fresh one. "A: leave" is the clean `bye`, and "A: rejoin" is a new
 * pair and a new actor. "A: teleport (claim)" moves A's local capsule
 * five metres in one claim; the host's travel budget refuses it, the
 * correction comes back carrying the refused `seq`, and the lab snaps
 * A to the host's truth — the authority boundary, on screen.
 *
 * CLOCKS (FrameClock's rule). The lab's clock, the host's, the replica's
 * and the camera's all advance by RAW dt: a network does not pause
 * because a frame stalled, and a replica read by a clamped clock would
 * fall behind the wire it is reading. Only `Transform.step` takes SIM
 * dt, because it is the one thing here that is simulation.
 *
 * HONEST ABOUT SCOPE. The wire is in memory; "bytes" are the JSON text
 * a message would serialise to; latency, jitter and loss are modelled,
 * not measured. The tool's card says so.
 *
 * Everything the lab needs from the app comes through typed hooks
 * (§2.7): who the player is, and what BACK means. It has no session —
 * it is the session, for two capsules.
 */
import * as THREE from 'three';
import { ACTION } from '../app/actions';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import type { ActorState } from '../actor/ActorState';
import { DEBUG_CAPSULE_TUNING, type CapsuleTuning } from '../actor/CapsuleTuning';
import { playerId, type PlayerId } from '../actor/PlayerId';
import { ScriptedMover } from '../actor/ScriptedMover';
import { step, wrapHeading } from '../actor/Transform';
import { PLAYER_PALETTE, colorFor, paletteIndexFor } from '../actor/playerColor';
import { figureEightRoute } from '../actor/routes';
import type { InputSnapshot } from '../input/Input';
import { NEUTRAL_INTENT, type Intent } from '../input/Intent';
import {
  Client, HOST_DEFAULTS, Host, LOOPBACK_SEED, LoopbackTransport, loopbackLink, perfectConditions, seededRandom,
  type ClientState, type HelloMessage, type LoopbackLink, type MessageHandler, type NetworkConditions, type Presence,
  type Transport, type TransportState,
} from '../net';
import { ActorViews } from '../view/ActorViews';
import { DEBUG_CAPSULE_LOOK } from '../view/CapsuleLook';
import { translate, world } from '../world/coords';
import { setOrigin, toLocal } from '../world/origin';
import { NET_LAB_ACTION, NET_LAB_DIALS, NET_LAB_HUD_ROLE, NET_LAB_SCENE_ID, type NetLabAction } from './netLabTool';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Who client A is. Built by integration from the device profile; the lab may not read the profile store itself. */
export interface LabIdentity {
  readonly playerId: PlayerId;
  readonly name: string;
}

export interface NetworkLabHooks {
  identity(): LabIdentity;
  /** BACK was pressed (or Escape). The owner decides where that goes — the hub, normally. */
  onBack(): void;
}

export type NetworkLabWire = (ctx: SceneContext) => NetworkLabHooks;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The same empty world as the Performance World, so a capsule looks the same in both. */
const HORIZON = '#9db6c6';
const GRID_SIZE = 2000;
const GRID_DIVISIONS = 200;
const GRID_CENTRE = 0xc9a94a;
const GRID_LINE = 0x3b4a52;
const FOG_NEAR = 300;
const FOG_FAR = 1500;

/**
 * GAME TUNING (debug). Five metres in one claim: the host banks at most
 * 250 ms of sprint (37.5 units, `Host.burstMs` × top speed × tolerance),
 * so this is refused on any wire the sliders can make.
 */
export const TELEPORT_UNITS = 500;

/** B's identity is fixed so the host's table reads the same on every run. */
const BOT_PLAYER_ID = playerId('net-lab-bot-b');
const BOT_NAME = 'Bot B';

/** Microtask rounds the initial handshake may take on a perfect wire before it is a wiring bug. */
const HANDSHAKE_ROUNDS = 32;

/** Over a lab of two capsules the loopback's fixed seed makes a lossy session the same session every time. */
const LINK_SEED = LOOPBACK_SEED;

/** HUD refreshes per second: readable, and cheap in the scene measuring the wire. */
const HUD_HZ = 5;

// ---------------------------------------------------------------------------
// The wire, metered
// ---------------------------------------------------------------------------

export interface TrafficCount {
  messages: number;
  /** Length of the message as JSON text: what a real wire would carry, give or take framing. */
  bytes: number;
}

const sizeOf = (msg: unknown): number => JSON.stringify(msg)?.length ?? 0;

/**
 * A transport that counts what passes. Receipts are counted once, on a
 * subscription of its own, so however many listeners a client attaches
 * the number stays the number of messages that landed.
 */
class MeteredTransport implements Transport {
  readonly sent: TrafficCount = { messages: 0, bytes: 0 };
  readonly received: TrafficCount = { messages: 0, bytes: 0 };

  constructor(readonly inner: LoopbackTransport) {
    inner.onMessage((msg) => {
      this.received.messages += 1;
      this.received.bytes += sizeOf(msg);
    });
  }

  get state(): TransportState {
    return this.inner.state;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  disconnect(): void {
    this.inner.disconnect();
  }

  send(msg: unknown): void {
    this.inner.send(msg);
    this.sent.messages += 1;
    this.sent.bytes += sizeOf(msg);
  }

  onMessage(cb: MessageHandler): () => void {
    return this.inner.onMessage(cb);
  }

  onClose(cb: () => void): () => void {
    return this.inner.onClose(cb);
  }
}

export interface Rate {
  readonly messagesPerSecond: number;
  readonly bytesPerSecond: number;
}

/** A per-second rate from a running total, settled once a second so the readout holds still long enough to read. */
class RateMeter {
  private windowSeconds = 0;
  private lastMessages = 0;
  private lastBytes = 0;
  private rate: Rate = { messagesPerSecond: 0, bytesPerSecond: 0 };

  sample(total: TrafficCount, dt: number): void {
    this.windowSeconds += dt;
    if (this.windowSeconds < 1) return;
    this.rate = {
      messagesPerSecond: (total.messages - this.lastMessages) / this.windowSeconds,
      bytesPerSecond: (total.bytes - this.lastBytes) / this.windowSeconds,
    };
    this.lastMessages = total.messages;
    this.lastBytes = total.bytes;
    this.windowSeconds = 0;
  }

  read(): Rate {
    return this.rate;
  }
}

// ---------------------------------------------------------------------------
// One peer: a client, its wire, and the capsule it moves locally
// ---------------------------------------------------------------------------

export interface PeerReadout {
  readonly label: string;
  readonly name: string;
  readonly state: ClientState;
  readonly actorId: string | null;
  readonly color: string | null;
  /** Every actor the client's replica holds, its own included: what "the world" is to this client. */
  readonly known: readonly string[];
  readonly out: Rate;
  readonly in: Rate;
  /** Claims the host acknowledged with a different truth: refused, and snapped back. */
  readonly corrections: number;
  readonly teleports: number;
  /** What the host thinks of this player, and how long a lingering one has left. */
  readonly presence: Presence;
  readonly graceLeftMs: number | null;
}

class LabPeer {
  readonly client: Client;
  /** The capsule as THIS client moves it; the host's truth may disagree and win. */
  local: ActorState | null = null;
  corrections = 0;
  teleports = 0;
  private transport: MeteredTransport;
  private hostEnd: LoopbackTransport;
  private hostAttached = false;
  private lastClaim: ActorState | null = null;
  private hungUpAt: number | null = null;
  /** A hello is out and its welcome will name the actor the local capsule starts from. */
  private awaitingWelcome = false;
  private readonly outRate = new RateMeter();
  private readonly inRate = new RateMeter();

  constructor(
    readonly label: string,
    readonly hello: HelloMessage,
    private readonly now: () => number,
    private readonly link: LoopbackLink,
    private readonly host: Host,
    private readonly tuning: CapsuleTuning,
  ) {
    this.client = new Client(now);
    const [hostEnd, clientEnd] = LoopbackTransport.pair(link);
    this.hostEnd = hostEnd;
    this.transport = new MeteredTransport(clientEnd);
    this.client.onCorrection((truth) => {
      // THE SNAP: the authority's word replaces the local guess.
      this.local = truth;
      this.lastClaim = null;
      this.corrections += 1;
    });
  }

  get state(): ClientState {
    return this.client.state;
  }

  /** The first hello. Resolves on welcome — which, on a modelled wire, needs the owner to pump. */
  async join(): Promise<void> {
    await this.attachHostEnd();
    this.awaitingWelcome = true;
    await this.client.connect(this.transport, this.hello);
  }

  /**
   * Hello again, same PlayerId. On the same wire when the host is still
   * listening on it (a hang-up leaves it attached, so the host can hand
   * the same actor back); on a fresh pair when it is not (after a `bye`
   * the host closed its end and forgot the player).
   */
  async rejoin(): Promise<void> {
    this.awaitingWelcome = true;
    if (this.hostEnd.state !== 'open') {
      const [hostEnd, clientEnd] = LoopbackTransport.pair(this.link);
      this.hostEnd = hostEnd;
      this.hostAttached = false;
      this.transport = new MeteredTransport(clientEnd);
      await this.attachHostEnd();
      await this.client.reconnect(this.transport);
      return;
    }
    await this.client.reconnect();
  }

  /** Hang up without a word: what a dropped signal looks like to the host. */
  hangUp(): void {
    this.transport.disconnect();
    this.hungUpAt = this.now();
  }

  /** The clean goodbye. */
  leave(): void {
    this.client.leave();
  }

  /** Move the local capsule by SIM dt. Nothing is sent here. */
  step(intent: Intent, simDt: number): void {
    if (this.local === null || simDt <= 0) return;
    this.local = step(this.local, intent, simDt, this.tuning);
  }

  /** Five metres sideways in one claim. Honest movement never does this; the host must refuse it. */
  teleport(): void {
    if (this.local === null) return;
    this.local = { ...this.local, at: translate(this.local.at, TELEPORT_UNITS, 0) };
    this.teleports += 1;
  }

  /** Send the pose as a claim, if there is anything new to claim. A standing capsule says nothing. */
  claim(): void {
    const pose = this.local;
    if (pose === null || this.client.state !== 'connected' || this.transport.state !== 'open') return;
    if (this.lastClaim !== null && samePose(this.lastClaim, pose)) return;
    this.client.sendMove(pose);
    this.lastClaim = pose;
  }

  /** Deliver what the wire holds for both ends of this peer's link, oldest first. */
  pumpToHost(nowMs: number): void {
    this.hostEnd.pump(nowMs);
  }

  /**
   * Deliver the host's messages, then read what they meant. A welcome
   * names the actor the authority handed out — or back — and the local
   * capsule starts from it. Read off the client's state here, in the
   * same call that delivered it, rather than from a promise callback
   * that would land a microtask later than the message it answers.
   */
  pumpToClient(nowMs: number): void {
    this.transport.inner.pump(nowMs);
    if (!this.awaitingWelcome || this.client.state !== 'connected') return;
    this.awaitingWelcome = false;
    this.local = this.client.self();
    this.lastClaim = null;
    this.hungUpAt = null;
  }

  meter(dt: number): void {
    this.outRate.sample(this.transport.sent, dt);
    this.inRate.sample(this.transport.received, dt);
  }

  /** The other actors, read smoothly from the replica at the lab's clock. */
  remotes(nowMs: number): ActorState[] {
    return this.client.remotes(nowMs);
  }

  readout(): PeerReadout {
    const presence = this.host.presence(this.hello.playerId);
    const graceLeftMs =
      presence === 'lingering' && this.hungUpAt !== null
        ? Math.max(0, HOST_DEFAULTS.graceMs - (this.now() - this.hungUpAt))
        : null;
    return {
      label: this.label,
      name: this.hello.name,
      state: this.client.state,
      actorId: this.client.actorId,
      color: this.local?.color ?? null,
      known: this.client.replica.ids(),
      out: this.outRate.read(),
      in: this.inRate.read(),
      corrections: this.corrections,
      teleports: this.teleports,
      presence,
      graceLeftMs,
    };
  }

  close(): void {
    if (this.client.state === 'connected') this.client.leave();
    this.transport.disconnect();
    if (this.hostAttached) this.host.detach(this.hostEnd);
    this.hostAttached = false;
  }

  private async attachHostEnd(): Promise<void> {
    if (this.hostAttached) return;
    await this.host.attach(this.hostEnd);
    this.hostAttached = true;
  }
}

function samePose(a: ActorState, b: ActorState): boolean {
  return a.at.wx === b.at.wx && a.at.wz === b.at.wz && a.height === b.height && a.heading === b.heading;
}

// ---------------------------------------------------------------------------
// The lab: host, two peers, one clock, one set of dials
// ---------------------------------------------------------------------------

export interface HostReadout {
  readonly claimsAccepted: number;
  readonly claimsRefused: number;
  readonly connections: number;
}

export interface LabReadout {
  readonly a: PeerReadout;
  readonly b: PeerReadout;
  readonly host: HostReadout;
  readonly conditions: Readonly<NetworkConditions>;
  /** Milliseconds on the lab's clock. */
  readonly nowMs: number;
}

export class NetworkLab {
  private nowMs = 0;
  readonly conditions: NetworkConditions = perfectConditions();
  readonly host: Host;
  readonly a: LabPeer;
  readonly b: LabPeer;
  private readonly mover: ScriptedMover;

  constructor(identity: LabIdentity, tuning: CapsuleTuning = DEBUG_CAPSULE_TUNING) {
    const now = (): number => this.nowMs;
    const link = loopbackLink(now, this.conditions, seededRandom(LINK_SEED));
    this.host = new Host(now, { tuning });
    const aColor = colorFor(identity.playerId);
    // The slot after A's: two capsules that must be told apart may not share a colour.
    const bColor = PLAYER_PALETTE[(paletteIndexFor(identity.playerId) + 1) % PLAYER_PALETTE.length];
    const helloA: HelloMessage = { kind: 'hello', playerId: identity.playerId, name: identity.name, color: aColor };
    const helloB: HelloMessage = { kind: 'hello', playerId: BOT_PLAYER_ID, name: BOT_NAME, color: bColor };
    this.a = new LabPeer('A', helloA, now, link, this.host, tuning);
    this.b = new LabPeer('B', helloB, now, link, this.host, tuning);
    this.mover = new ScriptedMover(figureEightRoute(tuning));
  }

  get clockMs(): number {
    return this.nowMs;
  }

  /** Both hellos, settled on the perfect wire the lab starts with. Throws if a welcome never comes: that is a wiring bug. */
  async open(): Promise<void> {
    await this.settle(this.a.join());
    await this.settle(this.b.join());
  }

  /**
   * One frame. Raw dt drives the clock and the wire; sim dt drives the
   * capsules. Order matters: claims go out before the host ticks so a
   * perfect wire shows this frame's pose in this frame's snapshot, and
   * the host's snapshots land after it has ticked.
   */
  advance(rawDt: number, simDt: number, intentA: Intent): void {
    this.nowMs += Math.max(0, rawDt) * 1000;
    this.a.step(intentA, simDt);
    this.b.step(this.mover.next(simDt), simDt);
    this.a.claim();
    this.b.claim();
    this.pumpAll();
    this.a.meter(rawDt);
    this.b.meter(rawDt);
  }

  /** What client A's screen shows: her own capsule as she moves it, everyone else as the replica reads them. */
  viewOf(peer: LabPeer): ActorState[] {
    const own = peer.local;
    const others = peer.remotes(this.nowMs);
    return own === null ? others : [own, ...others];
  }

  /** Hello again. Resolves when the welcome lands, which on a slow wire is some frames from now. */
  rejoin(peer: LabPeer): Promise<void> {
    return peer.rejoin();
  }

  readout(): LabReadout {
    return {
      a: this.a.readout(),
      b: this.b.readout(),
      host: {
        claimsAccepted: this.host.stats.claimsAccepted,
        claimsRefused: this.host.stats.claimsRefused,
        connections: this.host.connectionCount,
      },
      conditions: this.conditions,
      nowMs: this.nowMs,
    };
  }

  close(): void {
    this.a.close();
    this.b.close();
  }

  private pumpAll(): void {
    this.a.pumpToHost(this.nowMs);
    this.b.pumpToHost(this.nowMs);
    this.host.tick(this.nowMs);
    this.a.pumpToClient(this.nowMs);
    this.b.pumpToClient(this.nowMs);
  }

  /**
   * Pump between microtasks until `pending` settles: the handshake on a
   * wire that delivers only when asked. Bounded, so a welcome that never
   * comes is an error to read rather than a scene that never enters.
   */
  private async settle(pending: Promise<void>): Promise<void> {
    let done = false;
    const mark = (): void => {
      done = true;
    };
    pending.then(mark, mark);
    for (let round = 0; round < HANDSHAKE_ROUNDS; round += 1) {
      await Promise.resolve();
      if (done) break;
      this.pumpAll();
    }
    if (!done) throw new Error('NetworkLab: the welcome never came on a perfect in-process wire');
    await pending;
  }
}

// ---------------------------------------------------------------------------
// The thumbs: twin-zone touch, WASD, mouse drag
// ---------------------------------------------------------------------------

/**
 * A drag that STARTS on the left half of the screen is a stick; one that
 * starts on the right half looks. Decided where the finger lands, so a
 * stick pulled across the middle stays a stick (FreeFlyCamera's rule).
 * v0's MoveStick numbers: full deflection at 64 px, a 12 % dead zone.
 */
const STICK_RADIUS_PX = 64;
const STICK_DEAD_ZONE = 0.12;

export interface Thumbs {
  /** −1..1, screen axes: x right, y DOWN (screen), before the dead zone. */
  readonly stickX: number;
  readonly stickY: number;
  /** Pixels of look drag this frame. */
  readonly lookDx: number;
  readonly lookDy: number;
  /** A look drag is in progress: the camera tightens up. */
  readonly dragging: boolean;
  readonly sprint: boolean;
}

interface TouchStart {
  readonly x: number;
  readonly y: number;
}

class ThumbReader {
  private viewportWidth = 1;
  private readonly starts = new Map<number, TouchStart>();

  resize(width: number): void {
    this.viewportWidth = Math.max(1, width);
  }

  read(input: InputSnapshot): Thumbs {
    let lookDx = 0;
    let lookDy = 0;
    let dragging = false;
    if (input.pointer.down) {
      lookDx += input.pointer.dx;
      lookDy += input.pointer.dy;
      dragging = true;
    }

    let stickX = 0;
    let stickY = 0;
    const live = new Set<number>();
    for (const t of input.touches) {
      live.add(t.id);
      let start = this.starts.get(t.id);
      if (!start) {
        // First sight of this touch may already carry movement: the landing point is behind it.
        start = { x: t.x - t.dx, y: t.y - t.dy };
        this.starts.set(t.id, start);
      }
      if (start.x < this.viewportWidth / 2) {
        stickX += (t.x - start.x) / STICK_RADIUS_PX;
        stickY += (t.y - start.y) / STICK_RADIUS_PX;
      } else {
        lookDx += t.dx;
        lookDy += t.dy;
        dragging = true;
      }
    }
    for (const id of this.starts.keys()) {
      if (!live.has(id)) this.starts.delete(id);
    }

    const keys = input.keys;
    const held = (...codes: string[]): boolean => codes.some((c) => keys.has(c));
    const axis = (negative: boolean, positive: boolean): number => (positive ? 1 : 0) - (negative ? 1 : 0);
    stickX += axis(held('KeyA', 'ArrowLeft'), held('KeyD', 'ArrowRight'));
    // Screen y grows downward: W is a stick pushed UP.
    stickY += axis(held('KeyW', 'ArrowUp'), held('KeyS', 'ArrowDown'));

    return {
      stickX: clampUnit(stickX),
      stickY: clampUnit(stickY),
      lookDx,
      lookDy,
      dragging,
      sprint: held('ShiftLeft', 'ShiftRight'),
    };
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * Camera-relative movement (CLAUDE.md: "camera-relative stick, steering
 * is looking"). The stick names a direction ON SCREEN; the intent it
 * becomes is in the capsule's own frame: turn toward that direction as
 * fast as the tuning allows, and walk once she is roughly facing it, so
 * she arcs into a new direction rather than sliding sideways.
 *
 * Screen-right is a quarter turn BELOW the camera's facing in heading
 * terms: three's camera looking along +z has world −x on its right, and
 * −x is heading −π/2 in the (sin h, cos h) convention.
 */
export function intentFrom(thumbs: Thumbs, heading: number, cameraHeading: number, simDt: number, tuning: CapsuleTuning): Intent {
  const reach = Math.min(1, Math.hypot(thumbs.stickX, thumbs.stickY));
  if (reach <= STICK_DEAD_ZONE) return NEUTRAL_INTENT;
  // Rescaled from the dead zone's edge so the smallest push is the smallest step (v0's MoveStick).
  const push = (reach - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  const want = wrapHeading(cameraHeading - Math.atan2(thumbs.stickX, -thumbs.stickY));
  const error = wrapHeading(want - heading);
  const turn = simDt > 0 ? clampUnit(error / (tuning.turnRate * simDt)) : Math.sign(error);
  const forward = push * Math.max(0, Math.cos(error));
  return { forward, strafe: 0, turn, sprint: thumbs.sprint };
}

// ---------------------------------------------------------------------------
// The follow camera: an orbit on a WORLD bearing
// ---------------------------------------------------------------------------

/**
 * v0's FollowCamera, reduced to the flat plane: the camera orbits the
 * capsule on a world bearing and follows her position, and never turns
 * because she turned — she comes onto the view, the view holds still.
 * The OFFSET from her is what is smoothed, not the camera's position, so
 * her own motion carries the camera rigidly and a drag still eases.
 *
 * v0's measured feel, carried: rest 26° above the horizon inside a
 * 10°–80° arc; 0.008 rad/px of yaw and 0.006 rad/px of pitch; follow
 * rate 6, tightened to 14 while dragging. The boom is scaled to the
 * capsule: v0 held 7.8 units off a 1-unit ant, about five body lengths,
 * and a 16-unit capsule gets the same five.
 */
const REST_ELEVATION = THREE.MathUtils.degToRad(26);
const MIN_ELEVATION = THREE.MathUtils.degToRad(10);
const MAX_ELEVATION = THREE.MathUtils.degToRad(80);
const YAW_PER_PX = 0.008;
const PITCH_PER_PX = 0.006;
const FOLLOW_RATE = 6;
const DRAG_RATE = 14;
const BOOM = 5 * (DEBUG_CAPSULE_LOOK.length + 2 * DEBUG_CAPSULE_LOOK.radius);
/**
 * The view aims at her NAME, not her feet: the readouts sit across the
 * top of the screen, and aiming at her middle put the label under them
 * (measured on the 932 × 430 canvas). Aimed here she stands, label and
 * all, in the clear band between the panels and the buttons.
 */
const AIM_HEIGHT =
  DEBUG_CAPSULE_LOOK.radius * 2 + DEBUG_CAPSULE_LOOK.length + DEBUG_CAPSULE_LOOK.labelGap + DEBUG_CAPSULE_LOOK.labelHeight / 2;

export class OrbitFollowCamera {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  /** Where the camera stands relative to her, radians about +Y. π puts it behind a capsule at heading 0. */
  private bearing = Math.PI;
  private elevation = REST_ELEVATION;
  private readonly offset = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private placed = false;

  /** Pixels of drag. A rightward drag turns the view right, which walks the camera the other way round her. */
  look(dxPx: number, dyPx: number): void {
    this.bearing = wrapHeading(this.bearing - dxPx * YAW_PER_PX);
    this.elevation = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, this.elevation + dyPx * PITCH_PER_PX));
  }

  /** The direction the camera looks along the plane, in the capsule's heading convention. */
  facingHeading(): number {
    return wrapHeading(this.bearing + Math.PI);
  }

  /** `dt` is RAW: the camera is an instrument and keeps easing while the simulation stands still. */
  update(actor: ActorState, dt: number, dragging: boolean): void {
    // THE RENDER BOUNDARY for the camera: one conversion, here.
    const at = toLocal(actor.at);
    this.target.set(at.lx, actor.height, at.lz);
    const flat = Math.cos(this.elevation) * BOOM;
    this.want.set(Math.sin(this.bearing) * flat, Math.sin(this.elevation) * BOOM, Math.cos(this.bearing) * flat);
    if (!this.placed) {
      this.offset.copy(this.want);
      this.placed = true;
    } else {
      const rate = dragging ? DRAG_RATE : FOLLOW_RATE;
      const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
      this.offset.lerp(this.want, 1 - Math.exp(-rate * stepDt));
    }
    this.camera.position.copy(this.target).add(this.offset);
    this.aim.copy(this.target);
    this.aim.y += AIM_HEIGHT;
    this.camera.lookAt(this.aim);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

type DialAction = typeof NET_LAB_ACTION.latency | typeof NET_LAB_ACTION.jitter | typeof NET_LAB_ACTION.drop;
type ButtonAction = Exclude<NetLabAction, DialAction>;

interface NetLabHudHooks {
  readout(): LabReadout;
  onDial(dial: DialAction, value: number): void;
  onButton(action: ButtonAction): void;
  onBack(): void;
}

const GOLD = '#c9a94a';
const PARCHMENT = '#e8e2c8';
const PANEL = 'rgba(6,9,12,0.72)';
const FONT = '12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace';

const CSS = {
  root: 'position:absolute;inset:0;pointer-events:none;',
  panel:
    `position:absolute;display:flex;align-items:flex-start;gap:14px;padding:8px 10px;pointer-events:auto;` +
    `background:${PANEL};color:${PARCHMENT};font:${FONT};border:1px solid ${GOLD};border-radius:6px;`,
  heading: `color:${GOLD};letter-spacing:0.06em;margin-bottom:2px;white-space:nowrap;`,
  line: 'white-space:nowrap;',
  buttons: 'position:absolute;right:10px;bottom:10px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:440px;pointer-events:auto;',
  button:
    `min-height:40px;padding:6px 12px;font:${FONT};color:${PARCHMENT};background:#1a2014;` +
    `border:1px solid ${GOLD};border-radius:6px;`,
  note: `position:absolute;right:10px;bottom:98px;max-width:440px;text-align:right;font:${FONT};color:${PARCHMENT};` +
    `text-shadow:0 1px 2px #000;pointer-events:none;`,
  slider: 'display:block;width:150px;margin:0 0 2px 0;',
} as const;

interface ButtonSpec {
  readonly action: ButtonAction;
  readonly label: string;
  /** When the button does something. Disabled otherwise: an unavailable action must never look functional. */
  readonly enabled: (r: LabReadout) => boolean;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: NET_LAB_ACTION.bDisconnect, label: 'B: disconnect', enabled: (r) => r.b.state === 'connected' },
  { action: NET_LAB_ACTION.bReconnect, label: 'B: reconnect', enabled: (r) => r.b.state === 'disconnected' },
  { action: NET_LAB_ACTION.aLeave, label: 'A: leave', enabled: (r) => r.a.state === 'connected' },
  { action: NET_LAB_ACTION.aRejoin, label: 'A: rejoin', enabled: (r) => r.a.state === 'left' || r.a.state === 'disconnected' },
  { action: NET_LAB_ACTION.aTeleport, label: 'A: teleport (claim)', enabled: (r) => r.a.state === 'connected' },
];

interface DialSpec {
  readonly action: DialAction;
  readonly label: string;
  readonly max: number;
  readonly unit: string;
  readonly read: (c: Readonly<NetworkConditions>) => number;
}

const DIALS: readonly DialSpec[] = [
  { action: NET_LAB_ACTION.latency, label: 'latency', max: NET_LAB_DIALS.latencyMaxMs, unit: 'ms', read: (c) => c.latencyMs },
  { action: NET_LAB_ACTION.jitter, label: 'jitter', max: NET_LAB_DIALS.jitterMaxMs, unit: 'ms', read: (c) => c.jitterMs },
  { action: NET_LAB_ACTION.drop, label: 'drop', max: NET_LAB_DIALS.dropMaxPercent, unit: '%', read: (c) => c.dropRate * 100 },
];

/** Every readout line, by `data-field`, so a test or a probe reads the words a player reads. */
type Field =
  | 'a-name' | 'a-state' | 'a-actor' | 'a-actors' | 'a-out' | 'a-in' | 'a-corrections'
  | 'b-name' | 'b-state' | 'b-actor' | 'b-actors' | 'b-out' | 'b-in' | 'b-corrections'
  | 'host-a' | 'host-b' | 'host-claims' | 'host-links' | 'clock';

export const TELEPORT_NOTE =
  `Teleport claims ${TELEPORT_UNITS} units in one move. The host's travel budget refuses it and A snaps back to the host's truth.`;
export const WIRE_NOTE = 'In-process loopback. Bytes are JSON text; delay and loss are modelled, not measured.';

class NetLabHud {
  private readonly root: HTMLElement;
  private readonly fields = new Map<Field, HTMLElement>();
  private readonly buttons = new Map<ButtonAction, HTMLButtonElement>();
  private readonly dialLabels = new Map<DialAction, HTMLElement>();
  private readonly dialInputs = new Map<DialAction, HTMLInputElement>();
  private sinceRefresh = Infinity;

  constructor(
    uiLayer: HTMLElement,
    private readonly hooks: NetLabHudHooks,
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = NET_LAB_HUD_ROLE;
    this.root.style.cssText = CSS.root;

    const readouts = el(doc, 'div', `${CSS.panel}top:8px;left:10px;`);
    this.column(doc, readouts, 'CLIENT A', ['a-name', 'a-state', 'a-actor', 'a-actors', 'a-out', 'a-in', 'a-corrections']);
    this.column(doc, readouts, 'CLIENT B (scripted)', ['b-name', 'b-state', 'b-actor', 'b-actors', 'b-out', 'b-in', 'b-corrections']);
    this.column(doc, readouts, 'HOST', ['host-a', 'host-b', 'host-claims', 'host-links', 'clock']);
    this.root.appendChild(readouts);

    const wire = el(doc, 'div', `${CSS.panel}top:8px;right:10px;flex-direction:column;gap:4px;`);
    const wireHead = el(doc, 'div', CSS.heading);
    wireHead.textContent = 'WIRE (both links, both ways)';
    wire.appendChild(wireHead);
    for (const dial of DIALS) wire.appendChild(this.dial(doc, dial));
    const wireNote = el(doc, 'div', `${CSS.line}opacity:0.7;max-width:170px;white-space:normal;`);
    wireNote.textContent = WIRE_NOTE;
    wire.appendChild(wireNote);
    this.root.appendChild(wire);

    const note = el(doc, 'div', CSS.note);
    note.textContent = TELEPORT_NOTE;
    this.root.appendChild(note);

    const buttons = el(doc, 'div', CSS.buttons);
    for (const spec of BUTTONS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.action = spec.action;
      button.textContent = spec.label;
      button.style.cssText = CSS.button;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.hooks.onButton(spec.action);
        this.refreshNow();
      });
      this.buttons.set(spec.action, button);
      buttons.appendChild(button);
    }
    const back = doc.createElement('button');
    back.type = 'button';
    back.dataset.action = ACTION.back;
    back.textContent = 'Back to hub';
    back.style.cssText = CSS.button;
    back.addEventListener('click', () => this.hooks.onBack());
    buttons.appendChild(back);
    this.root.appendChild(buttons);

    uiLayer.appendChild(this.root);
  }

  /** Every frame with RAW dt; the DOM is written HUD_HZ times a second. */
  update(rawDt: number): void {
    this.sinceRefresh += rawDt;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.refreshNow();
  }

  refreshNow(): void {
    this.sinceRefresh = 0;
    this.render(this.hooks.readout());
  }

  dispose(): void {
    this.root.remove();
    this.fields.clear();
    this.buttons.clear();
    this.dialLabels.clear();
    this.dialInputs.clear();
  }

  private column(doc: Document, parent: HTMLElement, heading: string, fields: readonly Field[]): void {
    const col = doc.createElement('div');
    const head = el(doc, 'div', CSS.heading);
    head.textContent = heading;
    col.appendChild(head);
    for (const field of fields) {
      const line = el(doc, 'div', CSS.line);
      line.dataset.field = field;
      col.appendChild(line);
      this.fields.set(field, line);
    }
    parent.appendChild(col);
  }

  private dial(doc: Document, spec: DialSpec): HTMLElement {
    const wrap = doc.createElement('label');
    wrap.style.cssText = 'display:block;';
    const label = el(doc, 'div', CSS.line);
    label.dataset.field = `dial-${spec.label}`;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(spec.max);
    input.step = '1';
    input.value = '0';
    input.dataset.action = spec.action;
    input.style.cssText = CSS.slider;
    input.addEventListener('input', () => {
      this.hooks.onDial(spec.action, Number(input.value));
      this.refreshNow();
    });
    wrap.append(label, input);
    this.dialLabels.set(spec.action, label);
    this.dialInputs.set(spec.action, input);
    return wrap;
  }

  private set(field: Field, text: string): void {
    const node = this.fields.get(field);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private render(r: LabReadout): void {
    this.peer('a', r.a);
    this.peer('b', r.b);
    this.set('host-a', `A ${presenceWords(r.a)}`);
    this.set('host-b', `B ${presenceWords(r.b)}`);
    this.set('host-claims', `claims ok ${r.host.claimsAccepted} · refused ${r.host.claimsRefused}`);
    this.set('host-links', `links ${r.host.connections}`);
    this.set('clock', `clock ${(r.nowMs / 1000).toFixed(1)} s`);
    for (const spec of BUTTONS) {
      const button = this.buttons.get(spec.action);
      if (!button) continue;
      const enabled = spec.enabled(r);
      button.disabled = !enabled;
      button.style.opacity = enabled ? '1' : '0.45';
    }
    for (const spec of DIALS) {
      const value = spec.read(r.conditions);
      const label = this.dialLabels.get(spec.action);
      if (label) label.textContent = `${spec.label} ${Math.round(value)} ${spec.unit}`;
      // The dials are the truth; the slider follows them, never the other way round.
      const input = this.dialInputs.get(spec.action);
      if (input && this.root.ownerDocument.activeElement !== input) input.value = String(Math.round(value));
    }
  }

  private peer(prefix: 'a' | 'b', p: PeerReadout): void {
    this.set(`${prefix}-name`, `${p.label} · ${p.name}`);
    this.set(`${prefix}-state`, stateWords(p.state));
    this.set(`${prefix}-actor`, p.actorId === null ? 'actor —' : `actor ${p.actorId}${p.color ? ` ${p.color}` : ''}`);
    this.set(`${prefix}-actors`, `${p.known.length} known${p.known.length > 0 ? `: ${p.known.join(', ')}` : ''}`);
    this.set(`${prefix}-out`, `out ${rateWords(p.out)}`);
    this.set(`${prefix}-in`, `in  ${rateWords(p.in)}`);
    this.set(`${prefix}-corrections`, `refused ${p.corrections} claim${p.corrections === 1 ? '' : 's'} (snapped back)`);
  }
}

function stateWords(state: ClientState): string {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting — waiting for welcome';
    case 'disconnected':
      return 'disconnected — link dropped, no bye';
    case 'left':
      return 'left — said bye';
    case 'idle':
      return 'idle';
  }
}

function presenceWords(p: PeerReadout): string {
  if (p.presence === 'lingering') {
    return p.graceLeftMs === null ? 'lingering' : `lingering, ${(p.graceLeftMs / 1000).toFixed(1)} s of grace left`;
  }
  return p.presence;
}

function rateWords(rate: Rate): string {
  return `${rate.messagesPerSecond.toFixed(0)} msg/s · ${(rate.bytesPerSecond / 1000).toFixed(1)} kB/s`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  return node;
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** The scene, with the lab reachable for a test that wants the numbers behind the words. */
export interface NetworkLabScene extends AppScene {
  readonly lab: NetworkLab;
}

/** Where the rendered origin sits: the host spawns its first capsule here (`HOST_DEFAULTS.spawn(0)`). */
const SPAWN = world(0, 0);

export function buildNetworkLabScene(ctx: SceneContext, hooks: NetworkLabHooks): NetworkLabScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color(HORIZON);
  three.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);

  const lab = new NetworkLab(hooks.identity());
  const orbit = new OrbitFollowCamera();
  const thumbs = new ThumbReader();
  const views = new ActorViews(three);

  let grid: THREE.GridHelper | null = null;
  let light: THREE.DirectionalLight | null = null;
  let hud: NetLabHud | null = null;
  let offEscape: (() => void) | null = null;

  const onButton = (action: ButtonAction): void => {
    switch (action) {
      case NET_LAB_ACTION.bDisconnect:
        lab.b.hangUp();
        return;
      case NET_LAB_ACTION.bReconnect:
        // Resolves when the welcome lands, frames from now on a slow wire; the HUD shows "connecting" meanwhile.
        void lab.rejoin(lab.b).catch(() => {});
        return;
      case NET_LAB_ACTION.aLeave:
        lab.a.leave();
        return;
      case NET_LAB_ACTION.aRejoin:
        void lab.rejoin(lab.a).catch(() => {});
        return;
      case NET_LAB_ACTION.aTeleport:
        lab.a.teleport();
        return;
    }
  };

  const onDial = (dial: DialAction, value: number): void => {
    const sane = Number.isFinite(value) ? Math.max(0, value) : 0;
    switch (dial) {
      case NET_LAB_ACTION.latency:
        lab.conditions.latencyMs = Math.min(NET_LAB_DIALS.latencyMaxMs, sane);
        return;
      case NET_LAB_ACTION.jitter:
        lab.conditions.jitterMs = Math.min(NET_LAB_DIALS.jitterMaxMs, sane);
        return;
      case NET_LAB_ACTION.drop:
        lab.conditions.dropRate = Math.min(NET_LAB_DIALS.dropMaxPercent, sane) / 100;
        return;
    }
  };

  return {
    name: NET_LAB_SCENE_ID,
    three,
    camera: orbit.camera,
    lab,

    async enter() {
      // One rendered scene, one origin under it: reset like every other shared singleton.
      setOrigin(SPAWN);

      grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GRID_CENTRE, GRID_LINE);
      three.add(grid);
      light = new THREE.DirectionalLight(0xfff4e0, 1.2);
      light.position.set(200, 400, 100);
      three.add(light);

      await lab.open();
      views.sync(lab.viewOf(lab.a));

      hud = new NetLabHud(ctx.uiLayer, {
        readout: () => lab.readout(),
        onDial,
        onButton,
        onBack: () => hooks.onBack(),
      });
      offEscape = ctx.input.onKeyDown((code) => {
        if (code === 'Escape') hooks.onBack();
      });
    },

    update(frame: FrameInfo) {
      const read = thumbs.read(ctx.input.snapshot());
      if (read.lookDx !== 0 || read.lookDy !== 0) orbit.look(read.lookDx, read.lookDy);
      const own = lab.a.local;
      const intent = own === null ? NEUTRAL_INTENT : intentFrom(read, own.heading, orbit.facingHeading(), frame.simDt, DEBUG_CAPSULE_TUNING);

      lab.advance(frame.rawDt, frame.simDt, intent);

      const shown = lab.viewOf(lab.a);
      views.sync(shown);
      const focus = lab.a.local ?? shown[0];
      if (focus !== undefined) orbit.update(focus, frame.rawDt, read.dragging);
      hud?.update(frame.rawDt);
    },

    resize(width, height) {
      orbit.resize(width, height);
      thumbs.resize(width);
    },

    dispose() {
      offEscape?.();
      offEscape = null;
      hud?.dispose();
      hud = null;
      views.dispose();
      lab.close();
      if (grid) {
        three.remove(grid);
        grid.dispose();
        grid = null;
      }
      if (light) {
        three.remove(light);
        light.dispose();
        light = null;
      }
    },
  };
}

export function createNetworkLabScene(wire: NetworkLabWire): SceneFactory {
  return (ctx) => buildNetworkLabScene(ctx, wire(ctx));
}
