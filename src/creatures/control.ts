/**
 * WHO DRIVES WHOM — control authority as a ledger, not as a flag on the
 * animal.
 *
 * Joshua's Creature Lab brief, §4 and §33: at any time ONE creature is
 * directly controlled and the rest run their AI; possession "changes
 * CONTROL AUTHORITY only" — nothing teleports, nobody respawns, needs
 * and state are preserved; and it must be "future networkable": not
 * "whatever actor this browser happens to be touching" but
 *
 *   ControlAuthority { actorId, controllerId }
 *
 * assigned locally now and by a server later. This file is that record
 * and the book it is kept in.
 *
 * THE CREATURE DOES NOT KNOW WHO DRIVES IT. `CreatureState` carries a
 * body, a word, a target and needs, and not a controller, on purpose:
 * the state is what a server will own and what a save writes, and a
 * "controlledBy" field on it would put a session fact inside a world
 * fact — the thing the session seam (ARCHITECTURE §5) exists to keep
 * apart. The ledger is the session's: it says which creature each
 * player holds, the simulation asks it which intent to feed each body
 * (the player's for a held one, the brain's for the rest), and when
 * authority moves to the session layer or a server the animals do not
 * change at all — the ledger moves, and the records it hands out are
 * plain objects that cross a wire as they stand.
 *
 * THE RULES. A player holds at most one creature: possessing another
 * releases the first, and `possess` says which one so the caller can
 * hand its body back to the brain. A creature has at most one
 * controller: possessing a creature another player holds takes it from
 * them — the book records the latest claim, and a server that wants to
 * refuse a claim checks `controllerOf` before it writes. Observer mode
 * (§29, "CONTROL = NONE / OBSERVE") is simply an empty ledger: every
 * body gets its brain.
 *
 * Pure: no three, no DOM, no session. `src/creatures/` is core.
 */
import type { PlayerId } from '../actor/PlayerId';

/** One line of the book: this creature is driven by this player. Plain, so a server or a save can hold it. */
export interface ControlAuthority {
  readonly creature: string;
  readonly controller: PlayerId;
}

/** What `possess` did: the creature this player let go of, if any, and the one they now hold. */
export interface Possession {
  readonly released: string | null;
  readonly taken: string;
}

export class ControlLedger {
  private readonly byCreature = new Map<string, PlayerId>();
  private readonly byPlayer = new Map<PlayerId, string>();

  /**
   * Give `player` the creature. Their previous creature, if any, is
   * released and named; a creature another player held passes to this
   * one. Possessing what one already holds changes nothing and releases
   * nothing.
   */
  possess(creatureId: string, player: PlayerId): Possession {
    if (creatureId.length === 0) throw new Error('control: a creature id is never empty');
    const held = this.byPlayer.get(player) ?? null;
    if (held === creatureId) return { released: null, taken: creatureId };
    const other = this.byCreature.get(creatureId);
    if (other !== undefined && other !== player) this.byPlayer.delete(other);
    if (held !== null) this.byCreature.delete(held);
    this.byCreature.set(creatureId, player);
    this.byPlayer.set(player, creatureId);
    return { released: held, taken: creatureId };
  }

  /** Let go of whatever `player` holds. Returns the creature released, or null when they held none. */
  release(player: PlayerId): string | null {
    const held = this.byPlayer.get(player);
    if (held === undefined) return null;
    this.byPlayer.delete(player);
    this.byCreature.delete(held);
    return held;
  }

  /** Who drives this creature, or null when its brain does. */
  controllerOf(creatureId: string): PlayerId | null {
    return this.byCreature.get(creatureId) ?? null;
  }

  /** What this player drives, or null when nothing. */
  creatureOf(player: PlayerId): string | null {
    return this.byPlayer.get(player) ?? null;
  }

  /** Is anyone driving this creature? The question the simulation asks per body per frame. */
  isPossessed(creatureId: string): boolean {
    return this.byCreature.has(creatureId);
  }

  /** How many creatures are held. Zero is observer mode. */
  get size(): number {
    return this.byCreature.size;
  }

  /**
   * The whole book as plain records, in creature-id order so two ledgers
   * with the same claims serialise alike. A fresh array of fresh
   * objects: a caller may keep it, and a server may send it.
   */
  records(): readonly ControlAuthority[] {
    const out: ControlAuthority[] = [];
    for (const [creature, controller] of this.byCreature) out.push({ creature, controller });
    out.sort((a, b) => (a.creature < b.creature ? -1 : a.creature > b.creature ? 1 : 0));
    return out;
  }

  /** Everyone lets go: observer mode, and what a lab reset does before it rebuilds the animals. */
  clear(): void {
    this.byCreature.clear();
    this.byPlayer.clear();
  }
}
