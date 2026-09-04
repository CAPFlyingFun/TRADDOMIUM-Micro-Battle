/**
 * THE PRACTICE BOT AGAINST A REAL AUTHORITY.
 *
 * The bot is only worth anything if the HOST believes it: a scripted
 * player whose claims are refused stands still on every screen, which is
 * the exact failure the multiplayer probe caught once already (the
 * camera 84 units from its own capsule). So this drives the real
 * `PracticeBot` through a real `Host` over a loopback wire and asks the
 * authority itself, not the bot, where the capsule ended up.
 *
 * Four things are pinned here, and each of them would be a bot that
 * looks alive in a readout and dead on screen if it broke:
 *
 *  1. It stands where the AUTHORITY spawned it before it claims a step.
 *  2. Every claim of a full patrol loop is ACCEPTED — the travel budget
 *     pays for a capsule at patrol pace, sprint leg included.
 *  3. It goes somewhere and comes back: the host's own copy travels, and
 *     a full period returns it to the spawn.
 *  4. It leaves when its time is up, and `restart()` genuinely rejoins
 *     on a fresh link rather than pretending on a dead one.
 *
 * Every millisecond is simulated: the test owns the clock, pumps the
 * wire and ticks the host.
 */
import { describe, expect, it } from 'vitest';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { playerId } from '../src/actor/PlayerId';
import { Host } from '../src/net/Host';
import { LoopbackTransport, loopbackLink, type LoopbackLink } from '../src/net/LoopbackTransport';
import { PRACTICE_BOT_NAME, PracticeBot } from '../src/net/PracticeBot';
import { networkConditions } from '../src/net/NetworkConditions';
import { seededRandom } from '../src/net/seededRandom';
import { patrolRoute } from '../src/actor/routes';
import type { Transport } from '../src/net/Transport';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const BOT_ID = playerId('practice-bot-test');
/** One patrol loop, as `patrolRoute` builds it: four sides, the back leg, the strafes, the corners, the sprint. */
const PERIOD = patrolRoute(DEBUG_CAPSULE_TUNING).reduce((total, leg) => total + leg.seconds, 0);

/** One host, one clock, and as many fresh loopback links as the bot asks for. */
class BotLab {
  clock = 0;
  readonly link: LoopbackLink;
  readonly host = new Host(() => this.clock);
  private readonly ends: LoopbackTransport[] = [];
  /** How many links the bot has asked to open. A restart must ask for a new one. */
  links = 0;

  constructor() {
    this.link = loopbackLink(() => this.clock, networkConditions({}), seededRandom(11));
  }

  /** The factory the bot is given: a fresh pair each time, with the host already listening on its end. */
  open = (): Transport => {
    const [hostEnd, botEnd] = LoopbackTransport.pair(this.link);
    this.ends.push(hostEnd, botEnd);
    this.links += 1;
    void this.host.attach(hostEnd);
    return botEnd;
  };

  /** Advance the clock, pumping every wire end and ticking the host — no bot frames. */
  async run(ms: number, stepMs = 10): Promise<void> {
    const end = this.clock + ms;
    while (this.clock < end) {
      this.clock = Math.min(end, this.clock + stepMs);
      await flush();
      for (const t of this.ends) t.pump(this.clock);
      this.host.tick(this.clock);
    }
    await flush();
  }

  /** Frames: the clock moves, the wire is pumped, and THEN the bot gets its update, as a scene's loop does. */
  async frames(bot: PracticeBot, seconds: number, stepMs = 50): Promise<void> {
    const steps = Math.round((seconds * 1000) / stepMs);
    for (let i = 0; i < steps; i += 1) {
      await this.run(stepMs, stepMs);
      bot.update(stepMs / 1000, stepMs / 1000);
    }
    await flush();
  }

  /** Run until a promise settles, so a handshake can complete on simulated time. */
  async until<T>(p: Promise<T>): Promise<T> {
    let settled = false;
    void p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const deadline = this.clock + 500;
    while (!settled && this.clock < deadline) await this.run(10);
    if (!settled) throw new Error('nothing settled within 500 ms of simulated time');
    return p;
  }
}

function makeBot(lab: BotLab, seconds = PERIOD * 2): PracticeBot {
  return new PracticeBot({
    openTransport: lab.open,
    identity: { playerId: BOT_ID },
    now: () => lab.clock,
    seconds,
  });
}

describe('the practice bot joins a room as a real player', () => {
  it('says hello under its own id and is called what it is', async () => {
    const lab = new BotLab();
    const bot = makeBot(lab);
    await lab.until(bot.start());
    await lab.frames(bot, 0.5);

    expect(lab.host.presence(BOT_ID)).toBe('connected');
    const [actor] = lab.host.actorsOf(BOT_ID);
    expect(actor).toBeDefined();
    // The name is on the capsule, so nobody has to wonder whether there is somebody there.
    expect(actor.name).toBe(PRACTICE_BOT_NAME);
    expect(bot.readout.name).toBe(PRACTICE_BOT_NAME);
    bot.close();
  });

  it('stands where the authority spawned it before it claims a single step', async () => {
    const lab = new BotLab();
    const bot = makeBot(lab);

    // Before the welcome it has no position at all, and says so rather
    // than offering the origin as if it were one.
    expect(bot.readout.at).toBeNull();
    expect(bot.readout.phase).toBe('idle');

    await lab.until(bot.start());
    const spawn = lab.host.actorsOf(BOT_ID)[0].at;

    // Frame by frame until it first has a position, so what is read is the
    // position it ADOPTED and not one it has since walked away from.
    let at = bot.readout.at;
    for (let i = 0; i < 20 && at === null; i += 1) {
      await lab.frames(bot, 0.05, 50);
      at = bot.readout.at;
    }
    expect(at).not.toBeNull();
    // Its first position IS the authority's spawn, to within one frame of
    // patrol walking — not a guess of its own, and nowhere near the
    // hundred units the authority spaces players by.
    expect(Math.hypot((at?.wx ?? 0) - spawn.wx, (at?.wz ?? 0) - spawn.wz)).toBeLessThan(2);
    expect(bot.readout.phase).toBe('walking');
    bot.close();
  });
});

describe('the authority pays for everything the bot claims', () => {
  it('accepts every claim of a whole patrol loop, refusing none', async () => {
    // THE TRAVEL-BUDGET PROOF. The host earns an actor
    // walkSpeed x sprintFactor x tolerance units of travel a second and
    // caps the bank at burstMs of it; the patrol spends walkSpeed / 2 on
    // its long legs and walkSpeed x sprintFactor on the short sprint. If
    // that arithmetic were ever wrong the bot would be a statue, and this
    // is the test that would say so.
    const lab = new BotLab();
    const bot = makeBot(lab);
    await lab.until(bot.start());
    await lab.frames(bot, PERIOD);

    expect(lab.host.stats.claimsAccepted).toBeGreaterThan(100);
    expect(lab.host.stats.claimsRefused).toBe(0);
    expect(bot.readout.refusedClaims).toBe(0);
    bot.close();
  });

  it('travels on the authority’s own copy, and a full loop brings it home', async () => {
    const lab = new BotLab();
    const bot = makeBot(lab);
    await lab.until(bot.start());
    const spawn = lab.host.actorsOf(BOT_ID)[0].at;

    // A quarter of the way round: it is somewhere else, on the HOST's copy.
    await lab.frames(bot, PERIOD / 4);
    const away = lab.host.actorsOf(BOT_ID)[0].at;
    expect(Math.hypot(away.wx - spawn.wx, away.wz - spawn.wz)).toBeGreaterThan(50);

    // All the way round: back where it started. The route closes, so a
    // player who looked away for a minute finds it where they left it.
    await lab.frames(bot, (PERIOD * 3) / 4);
    const home = lab.host.actorsOf(BOT_ID)[0].at;
    expect(Math.hypot(home.wx - spawn.wx, home.wz - spawn.wz)).toBeLessThan(5);
    bot.close();
  });
});

describe('the practice bot leaves, and can be sent back in', () => {
  it('goes when its time is up and stops claiming', async () => {
    const lab = new BotLab();
    const bot = makeBot(lab, 4);
    await lab.until(bot.start());
    await lab.frames(bot, 3);
    expect(bot.readout.phase).toBe('walking');
    expect(bot.readout.secondsLeft).toBeGreaterThan(0);
    expect(lab.host.stats.claimsAccepted).toBeGreaterThan(0);

    await lab.frames(bot, 2);
    expect(bot.readout.phase).toBe('gone');
    expect(bot.readout.secondsLeft).toBe(0);
    // It said goodbye, so the authority dropped it now rather than
    // holding a scripted stranger through its whole grace window.
    expect(lab.host.presence(BOT_ID)).toBe('absent');

    // And nothing more goes out: further frames are silent. The baseline is
    // taken AFTER it has gone, because the seconds before it went were
    // honest claims.
    const claimedWhenGone = lab.host.stats.claimsAccepted;
    await lab.frames(bot, 2);
    expect(lab.host.stats.claimsAccepted).toBe(claimedWhenGone);
  });

  it('restarts on a FRESH link, with its five minutes back and its route from the top', async () => {
    const lab = new BotLab();
    const bot = makeBot(lab, 4);
    await lab.until(bot.start());
    await lab.frames(bot, 5);
    expect(bot.readout.phase).toBe('gone');
    expect(lab.links).toBe(1);

    await lab.until(bot.restart());
    await lab.frames(bot, 0.5);
    // A link that has said `bye` cannot be reopened, so a genuine restart
    // has to have asked for another one.
    expect(lab.links).toBe(2);
    expect(bot.readout.phase).toBe('walking');
    expect(bot.readout.secondsLeft).toBeGreaterThan(3);
    expect(lab.host.presence(BOT_ID)).toBe('connected');
    bot.close();
  });

  it('is safe to close twice, and closing one that never started is not an error', () => {
    const lab = new BotLab();
    const bot = makeBot(lab);
    expect(() => {
      bot.close();
      bot.close();
    }).not.toThrow();
    expect(bot.readout.phase).toBe('gone');
    // It never asked for a link, because it never started.
    expect(lab.links).toBe(0);
  });

  it('refuses a lifetime that is not a positive number of seconds', () => {
    const lab = new BotLab();
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new PracticeBot({
        openTransport: lab.open,
        identity: { playerId: BOT_ID },
        now: () => lab.clock,
        seconds,
      })).toThrow(/seconds/);
    }
  });
});
