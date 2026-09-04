/**
 * A PRACTICE BOT: a scripted player that joins the same room as you, so
 * a person alone in a room has somebody to watch.
 *
 * Joshua asked for it on 2026-09-04 after joining a room on his phone
 * and being the only one in it: "have for 5 minutes a 'fake' AI player
 * randomly move around… but also have the AI player draw what it's doing
 * on the screen as well (controls) so I can see location and buttons".
 * That is the whole brief, and it is a TEST INSTRUMENT — it exists to
 * make replication visible to one pair of eyes, not to populate a game.
 *
 * IT IS A REAL PLAYER, NOT A DRAWING. It opens its own link to the same
 * relay, says its own `hello` under its own PlayerId, and claims its
 * poses through the same `NetworkedWorld` the person's own camera claims
 * through. The authority cannot tell it from a phone, and neither can
 * the replica: what you see is your own client receiving snapshots off
 * the wire and drawing a capsule from them. A bot faked locally would
 * prove nothing at all — it would draw a capsule whether or not a single
 * byte crossed the network, which is the exact question it was asked to
 * answer.
 *
 * ITS THUMBS ARE A SCRIPT. `ScriptedMover` hands out an `Intent` per
 * frame and `Transform.step` moves it, which is what the player's own
 * body will be driven by in Phase 7 and what `autonomy/` will drive in
 * Phase 9 — the mover is a sibling of the thumbs (`input/Intent.ts`),
 * so nothing here is a special case that would have to be unpicked
 * later. The route closes on itself (`actor/routes.ts`, `patrolRoute`)
 * so the bot patrols a box beside you rather than walking into the fog.
 *
 * WHERE IT STARTS IS THE AUTHORITY'S TO SAY. Like the free-fly camera
 * (`perf/PerformanceWorldScene.ts`), it stands on the actor the welcome
 * names before it claims anything. A bot that started walking from the
 * origin while the authority had spawned it a hundred units away would
 * claim a hundred-unit step it cannot pay the travel budget for, be
 * refused, and stand still on every screen for ever.
 *
 * IT LEAVES. Five minutes, counted on the RAW clock, then a clean `bye`.
 * A test player that outstayed its welcome would be a stranger in the
 * room with nobody able to say where it came from. `restart()` sends it
 * back in on a fresh link, which is why the transport arrives as a
 * FACTORY and not as an object: a link that has said goodbye cannot be
 * reopened, and pretending otherwise is how a "reconnect" that never
 * reconnects gets written.
 *
 * TWO CLOCKS, KEPT APART (ARCHITECTURE §2.4). The route walks on SIM dt,
 * because it is simulation and should hold where it is if a world ever
 * genuinely pauses. The five minutes and the wire run on RAW dt, because
 * a relay does not pause when a frame stalls. They are separate
 * parameters from the moment they are read.
 *
 * Pure: no socket, no timer, no `three`, no DOM. It is driven by
 * `update()` from whatever loop owns the frame and reaches the wire only
 * through the injected `Transport`.
 */
import { DEBUG_CAPSULE_TUNING, type CapsuleTuning } from '../actor/CapsuleTuning';
import { ScriptedMover, type Leg } from '../actor/ScriptedMover';
import { step } from '../actor/Transform';
import { colorFor } from '../actor/playerColor';
import { patrolRoute } from '../actor/routes';
import type { ActorState } from '../actor/ActorState';
import { NEUTRAL_INTENT, type Intent } from '../input/Intent';
import { world, type WorldPoint } from '../world/coords';
import { NetworkedWorld, type NetworkIdentity, type NetworkedWorldState } from './NetworkedWorld';
import type { Transport } from './Transport';

/**
 * GAME TUNING (debug), and Joshua's number: five minutes. Long enough to
 * fly around, open the pause menu, come back and still find it walking;
 * short enough that a phone left on a desk is not holding a socket open
 * to the relay all afternoon.
 */
export const PRACTICE_BOT_SECONDS = 300;

/**
 * What the bot is called over its head, and it says what it is. A person
 * reading a name off a capsule must never have to wonder whether there
 * is somebody there — the honesty rule (CLAUDE.md) applies to a capsule's
 * label as much as to a caption. Bounded by `MAX_ACTOR_NAME`.
 */
export const PRACTICE_BOT_NAME = 'Practice Bot';

/** Where the bot is in its five minutes. */
export type PracticeBotPhase =
  /** Built, nothing opened yet. */
  | 'idle'
  /** The link is up (or trying); the authority has not yet named its actor, so it has not moved. */
  | 'joining'
  /** Walking its route and claiming poses. */
  | 'walking'
  /** Its time ran out, or it was closed. It has said goodbye. */
  | 'gone';

/** Everything a panel may show about the bot. Every field measured; nothing promised. */
export interface PracticeBotReadout {
  readonly phase: PracticeBotPhase;
  /** The link, in `NetworkedWorld`'s own words. */
  readonly link: NetworkedWorldState;
  readonly name: string;
  /** What its thumbs are asking for THIS frame. The control diagram is drawn from exactly this. */
  readonly intent: Intent;
  /** Where it is, in world coordinates; null until the authority has named its spawn. */
  readonly at: WorldPoint | null;
  /** Radians, actor convention. Zero before it has a position. */
  readonly heading: number;
  /** Seconds of its five minutes left, never negative. */
  readonly secondsLeft: number;
  /** Claim-to-acknowledgement in milliseconds; absent until one has been measured. */
  readonly roundTripMs?: number;
  /** Claims the authority answered with a different truth. Should stay zero: see the header. */
  readonly refusedClaims: number;
}

export interface PracticeBotOptions {
  /**
   * Opens a NEW link to the room. A factory rather than a transport
   * because a link that has said `bye` cannot be reopened, and
   * `restart()` must genuinely start again.
   */
  readonly openTransport: () => Transport;
  /** Who the bot is on the wire. Its name defaults to `PRACTICE_BOT_NAME`; its colour to the shared derivation. */
  readonly identity: Pick<NetworkIdentity, 'playerId'> & Partial<NetworkIdentity>;
  /** RAW wall-clock milliseconds, monotonic — the same clock the network is read on. */
  readonly now: () => number;
  /** Its route. Defaults to the patrol built from `tuning`. */
  readonly route?: readonly Leg[];
  /** How it moves. Defaults to the debug capsule's numbers, which is what the authority validates against. */
  readonly tuning?: CapsuleTuning;
  /** How long it stays. Defaults to `PRACTICE_BOT_SECONDS`. */
  readonly seconds?: number;
}

export class PracticeBot {
  private readonly openTransport: () => Transport;
  private readonly identity: NetworkIdentity;
  private readonly now: () => number;
  private readonly tuning: CapsuleTuning;
  private readonly route: readonly Leg[];
  private readonly seconds: number;

  private net: NetworkedWorld | null = null;
  private mover: ScriptedMover;
  /** Its own body. Null until the authority has named a spawn to stand on. */
  private local: ActorState | null = null;
  private intent: Intent = NEUTRAL_INTENT;
  private remaining: number;
  private phase: PracticeBotPhase = 'idle';

  constructor(options: PracticeBotOptions) {
    this.openTransport = options.openTransport;
    this.now = options.now;
    this.tuning = options.tuning ?? DEBUG_CAPSULE_TUNING;
    this.route = options.route ?? patrolRoute(this.tuning);
    const seconds = options.seconds ?? PRACTICE_BOT_SECONDS;
    if (!(Number.isFinite(seconds) && seconds > 0)) {
      throw new Error(`PracticeBot: seconds must be > 0, got ${seconds}`);
    }
    this.seconds = seconds;
    this.remaining = seconds;
    this.mover = new ScriptedMover(this.route);
    this.identity = {
      playerId: options.identity.playerId,
      name: options.identity.name ?? PRACTICE_BOT_NAME,
      color: options.identity.color ?? colorFor(options.identity.playerId),
    };
  }

  get readout(): PracticeBotReadout {
    const status = this.net?.status;
    const roundTripMs = status?.roundTripMs;
    return {
      phase: this.phase,
      link: status?.state ?? 'idle',
      name: this.identity.name,
      intent: this.intent,
      at: this.local === null ? null : world(this.local.at.wx, this.local.at.wz),
      heading: this.local?.heading ?? 0,
      secondsLeft: Math.max(0, this.remaining),
      ...(roundTripMs === undefined ? {} : { roundTripMs }),
      refusedClaims: status?.refusedClaims ?? 0,
    };
  }

  /**
   * Open a link and say hello. Never rejects — `NetworkedWorld.connect()`
   * puts a relay it cannot reach in the status, and a bot that could not
   * join must not take the world down with it.
   */
  async start(): Promise<void> {
    if (this.phase !== 'idle') return;
    this.phase = 'joining';
    let transport: Transport;
    try {
      transport = this.openTransport();
    } catch {
      // A world that could not open a second link is still a world. The
      // caller fires this with `void` (a handshake is no reason to hold a
      // loading screen open), so a throw here would surface as an
      // unhandled rejection in the middle of a frame loop rather than as
      // a line in the panel — which is what the readout is for.
      this.phase = 'gone';
      return;
    }
    this.net = new NetworkedWorld({
      transport,
      identity: this.identity,
      now: this.now,
      // THE BOT IS A SIMULATED ACTOR, NOT AN INSTRUMENT. When the
      // authority refuses a claim it also says where the actor really is,
      // and the bot takes that word: `NetworkedWorld` re-arms the claim
      // latch on a correction, so a bot that ignored the truth would
      // re-claim the same refused pose twenty times a second for ever.
      // The camera does the opposite on purpose (a hand flying a
      // benchmark must not be fought by a walking capsule's budget); the
      // module comment says the choice belongs to the owner, and for a
      // walking bot the answer is to snap.
      onCorrection: (truth) => {
        this.local = truth;
      },
    });
    await this.net.connect();
  }

  /**
   * One frame. `simDt` walks the route, `rawDt` spends the five minutes —
   * see the header on why they are two parameters.
   */
  update(simDt: number, rawDt: number): void {
    const net = this.net;
    if (net === null || this.phase === 'gone') return;

    this.remaining -= Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.close();
      return;
    }

    // Stand on the actor the authority named, once. Until then there is
    // nothing to claim and the thumbs are still: a bot that walked from a
    // position the authority never gave it would be refused every step.
    if (this.local === null) {
      const mine = net.localActor();
      if (mine === null) {
        net.update(null);
        return;
      }
      this.local = mine;
      this.phase = 'walking';
    }

    this.intent = this.mover.next(simDt);
    this.local = step(this.local, this.intent, Number.isFinite(simDt) && simDt > 0 ? simDt : 0, this.tuning);
    net.update({ at: this.local.at, height: this.local.height, heading: this.local.heading });
  }

  /**
   * Send it back in for another five minutes, on a FRESH link. Safe to
   * call at any time: a bot still walking is shown the door first, so
   * there is never a moment with two of it in the room.
   */
  async restart(): Promise<void> {
    this.close();
    this.mover = new ScriptedMover(this.route);
    this.local = null;
    this.intent = NEUTRAL_INTENT;
    this.remaining = this.seconds;
    this.phase = 'idle';
    await this.start();
  }

  /** A clean goodbye. Safe to call twice, and safe on a link that never opened. */
  close(): void {
    this.net?.close();
    this.net = null;
    this.local = null;
    this.intent = NEUTRAL_INTENT;
    this.phase = 'gone';
  }
}
