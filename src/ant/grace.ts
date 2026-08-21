/**
 * SPAWN GRACE — five minutes where nothing can kill her, and she can
 * kill nothing.
 *
 * BOTH HALVES, ALWAYS. A shield on its own is five minutes of being
 * immortal in a fight you started, which is worse than no shield at
 * all. The price of not being killable is not being able to kill. She
 * can walk, run, fly, forage and dig at full ability — five minutes to
 * get away, not five minutes of being a supernatural battle ant.
 *
 * IT STARTS WHEN SHE ARRIVES, not when the last queen died. A timer
 * that ran while the player browsed the spawn map would be spent before
 * they got there, which protects nobody — and the point of it is to
 * survive the first minutes in a place you have never seen.
 *
 * THE RULE IS A DEADLINE, NOT A COUNTDOWN.
 *
 *   spawnedAt   07:14:22
 *   endsAt      07:19:22
 *   protected   ⇔  now < endsAt
 *
 * and NOT `left -= dt`. A subtracted timer is a claim about how much
 * time the game has watched pass, which is a different quantity from
 * how much time HAS passed, and every gap between them is a way to keep
 * the shield longer than five minutes: backgrounding the tab, Safari
 * unloading the page, a dropped connection, a device handover, a
 * migration between servers. A deadline survives all of those because
 * it does not depend on being watched. The HUD still shows a countdown
 * — that is presentation, derived from the deadline every frame.
 *
 * The clock is injected rather than read, so this can be handed a
 * SERVER's clock the day there is one. That is the intended end state:
 * the deadline is authoritative and issued by the server, and the
 * client only renders it.
 *
 * AI MUST READ THE SAME STATE. Zero damage in both directions is not
 * enough on its own — a spider that cannot hurt her but can still
 * choose her, chase her and stand over her for five minutes has taken
 * the protection away without ever landing a blow. So grace also says
 * `ignoredByHostiles`, and the day there is a hostile it will be a
 * targeting rule and not merely a damage multiplier.
 *
 * Nothing can hurt her yet and she can hurt nothing, so today this is a
 * deadline and a HUD chip. It exists now because a rule about combat is
 * far easier to honour when combat is written against it than when it
 * is bolted on afterwards.
 */

/** How long she is left alone for. */
export const GRACE_SECONDS = 300;
const GRACE_MS = GRACE_SECONDS * 1000;

/**
 * The authoritative record. Two timestamps and nothing derived.
 *
 * Shaped to be handed over intact — stored, reloaded, or one day sent
 * down from a server — because anything DERIVED from these (seconds
 * left, a boolean) is only true at the instant it was computed.
 */
export interface GraceRecord {
  /** Epoch milliseconds she entered the world. */
  readonly spawnedAt: number;
  /** Epoch milliseconds the protection lapses. */
  readonly endsAt: number;
}

export class Grace {
  private record: GraceRecord | null = null;
  /** Latched so the end can be announced once, not every frame after. */
  private announced = false;

  /**
   * @param clock the authority on what time it is. Injected so that a
   *   server's clock can replace the device's without touching a rule.
   */
  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Fresh queen, fresh five minutes — from now, whenever now is. */
  begin(): GraceRecord {
    const spawnedAt = this.clock();
    this.record = { spawnedAt, endsAt: spawnedAt + GRACE_MS };
    this.announced = false;
    return this.record;
  }

  /**
   * Take up a deadline decided elsewhere — a reload, or a server.
   *
   * Refuses anything that would grant MORE than a full grace period, so
   * a tampered store or a confused clock cannot mint protection. An
   * already-expired record is accepted and simply reads as over.
   */
  resume(record: GraceRecord | null): boolean {
    if (!record) return false;
    const { spawnedAt, endsAt } = record;
    if (!Number.isFinite(spawnedAt) || !Number.isFinite(endsAt)) return false;
    if (endsAt - spawnedAt > GRACE_MS) return false;
    if (endsAt - this.clock() > GRACE_MS) return false;
    this.record = { spawnedAt, endsAt };
    this.announced = !this.active;
    return true;
  }

  /** The record itself, to store or to send. Null before the first spawn. */
  get issued(): GraceRecord | null {
    return this.record;
  }

  get active(): boolean {
    return this.record !== null && this.clock() < this.record.endsAt;
  }

  /** How long is left, in real seconds. Derived, never stored. */
  get seconds(): number {
    if (this.record === null) return 0;
    return Math.max(0, (this.record.endsAt - this.clock()) / 1000);
  }

  /** Nothing may harm her. */
  get shielded(): boolean {
    return this.active;
  }

  /**
   * And she may harm nothing. The same deadline, deliberately: read as
   * one value so no future change can protect her without also
   * disarming her.
   */
  get disarmed(): boolean {
    return this.active;
  }

  /**
   * Hostile AI must not even CONSIDER her: no acquiring, no chasing, no
   * circling while the clock runs down. Being unkillable is no use if
   * something can simply wait beside you.
   */
  get ignoredByHostiles(): boolean {
    return this.active;
  }

  /** For combat maths, when there is combat. Zero or one, both ways. */
  get damageReceivedMultiplier(): number {
    return this.active ? 0 : 1;
  }

  get damageDealtMultiplier(): number {
    return this.active ? 0 : 1;
  }

  /**
   * True EXACTLY ONCE, on the first read after the deadline passes.
   *
   * Latched rather than computed, because "it just ended" is a moment
   * and the HUD needs to catch it whichever frame it lands on — a game
   * that misses it silently drops the player from protected to
   * ecosystem rules with no warning at all.
   */
  takeExpiry(): boolean {
    if (this.record === null || this.announced || this.active) return false;
    this.announced = true;
    return true;
  }

  /** Give it up early — walking into a fight is a choice she can make. */
  end(): void {
    if (this.record === null) return;
    const now = this.clock();
    this.record = { spawnedAt: this.record.spawnedAt, endsAt: now };
  }

  /** Forget it entirely. A new queen has not spawned yet. */
  clear(): void {
    this.record = null;
    this.announced = false;
  }
}
