/**
 * WHAT THE SWEEP CAME BACK WITH: the things in reach, nearest first,
 * each with how far away it is and how brightly the pulse is holding it.
 *
 * HORIZONTAL DISTANCE ONLY, like every other reach in this project
 * (`creatures/finder.ts` says the same thing in the same words): a
 * camera sixty metres up is still standing over what is under it, and
 * sorting by the three-dimensional distance would call the worm beneath
 * your feet the furthest thing in the world.
 *
 * WHY TWO CAPS, AND WHY THE SLOTS ARE DEALT ROUND THE KINDS. The case
 * that decides whether this feature is usable at all is a lawn: ten
 * thousand blades of grass and three worms, all inside six metres, which
 * is not a pathological input — it is a Kaua'i meadow at the density
 * `world/objects` already plants. Take the nearest two dozen and you get
 * two dozen blades of grass and no worms, so the antennae would be a
 * machine for finding grass, and what he asked to see was the insects.
 *
 * So the total is DEALT ONE SLOT AT A TIME ROUND THE KINDS, in the
 * contract's own order — creature, plant, material — nearest first
 * within each kind. Three worms are therefore in the first nine picks
 * whatever the lawn is doing, and creature is first in the rotation
 * because on a screen that fits two dozen names the living things are
 * the ones worth the odd slot. Unused capacity spills: with no animals
 * in reach the plants and the materials divide the whole allowance
 * between them, up to their own cap. And the per-kind cap is what stops
 * a lawn taking the entire budget when it is the only thing there —
 * ten identical GRASS labels is already past what a 932x430 screen
 * wants to carry.
 *
 * A CAP IS A MAXIMUM, NOT A QUOTA (the rule the detail rungs already
 * follow): a deal that runs out of candidates stops early rather than
 * reaching for something further away to fill the number.
 *
 * NOTHING IS ALLOCATED PER FRAME. The scratch, the pool of sightings and
 * the returned array are all made once and refilled, and the nearest few
 * of each kind are found by insertion into a list of ten rather than by
 * sorting the lawn — ten thousand candidates cost one distance and at
 * most ten compares each, and no sort at all.
 *
 * Pure: no three, no DOM, no storage.
 */
import { distanceSquared, type WorldPoint } from '../world/coords';
import { SENSE_KINDS, type SenseKind, type SenseThing, type Sighting } from './senseTypes';

/**
 * The most things of ONE kind a sweep reports. GAME TUNING.
 *
 * Ten grass blades say "grass here" as well as a hundred do, and this is
 * the number that keeps the lawn from filling the screen when it is the
 * only thing in reach.
 */
export const PER_KIND_CAP = 10;

/**
 * The most things a sweep reports at all. GAME TUNING.
 *
 * About what a 932x430 phone screen carries before names begin stacking
 * on one another — and the far half of them is already faint, because
 * the pulse's falloff has been dimming them the whole way out.
 *
 * Deliberately less than three per-kind caps (3 x 10 > 24), so both
 * numbers actually bite. A per-kind cap that could never be reached
 * would be a number that lies about what it does.
 */
export const TOTAL_CAP = 24;

export interface SenseCaps {
  /** The most of any one `SenseKind`. */
  readonly perKind: number;
  /** The most in total. */
  readonly total: number;
}

export const SENSE_CAPS: SenseCaps = Object.freeze({ perKind: PER_KIND_CAP, total: TOTAL_CAP });

/**
 * The pulse, as much of it as the selection needs: how far the sweep has
 * reached, and how lit a thing at a distance is. `SensePulse` satisfies
 * it as it stands, so the two modules do not have to know each other.
 *
 * `strengthAt` MUST BE MONOTONE in distance — nothing further out
 * brighter than something nearer. The caps are decided from distance
 * alone, which is only sound because of that.
 */
export interface SenseEnvelope {
  readonly front: number;
  strengthAt(distance: number): number;
}

/** The pool's objects, before they are handed out as readonly `Sighting`s. */
interface MutableSighting {
  id: string;
  kind: SenseKind;
  name: string;
  at: WorldPoint;
  height: number;
  size: number;
  distance: number;
  strength: number;
}

/** The nearest few of one kind, kept sorted by distance while the candidates go by. */
interface KindSlots {
  readonly index: number[];
  readonly d2: number[];
  count: number;
}

const KIND_COUNT = SENSE_KINDS.length;

/**
 * Which slot a kind is dealt from. Built from `SENSE_KINDS` rather than
 * written out, so the rotation follows the contract's order and cannot
 * drift from it.
 */
const KIND_SLOT: Readonly<Record<SenseKind, number>> = (() => {
  const map = {} as Record<SenseKind, number>;
  SENSE_KINDS.forEach((kind, i) => {
    map[kind] = i;
  });
  return Object.freeze(map);
})();

function blankSighting(): MutableSighting {
  return {
    id: '',
    kind: 'material',
    name: '',
    // Replaced on every fill; never read before it is written.
    at: null as unknown as WorldPoint,
    height: 0,
    size: 0,
    distance: 0,
    strength: 0,
  };
}

/**
 * One sweep's worth of picking, kept alive between frames because its
 * scratch is.
 *
 * THE RETURNED ARRAY IS THIS OBJECT'S OWN and is refilled by the next
 * `select`. Read it in the frame you asked for it; never store it, never
 * hand it to something that outlives the frame. That is the whole price
 * of not allocating two dozen sightings sixty times a second.
 */
export class SenseSelection {
  private readonly slots: KindSlots[] = [];
  private readonly taken: number[] = [];
  private readonly cursor: number[] = [];
  private readonly pool: MutableSighting[] = [];
  private readonly out: MutableSighting[] = [];

  constructor() {
    for (let k = 0; k < KIND_COUNT; k += 1) {
      this.slots.push({ index: [], d2: [], count: 0 });
      this.taken.push(0);
      this.cursor.push(0);
    }
  }

  /** What the last `select` found. Nearest first. */
  get sightings(): readonly Sighting[] {
    return this.out;
  }

  /** Report nothing — the pulse went out, or the sweep is being torn down. */
  clear(): void {
    this.out.length = 0;
  }

  /**
   * Everything the sweep has reached, nearest first.
   *
   * `radius` is the sweep's own reach; the envelope's front is where it
   * has got to so far, and the smaller of the two is what is actually
   * lit. A thing the wave has not arrived at yet is not a sighting and
   * must not hold a slot that a nearer thing wants.
   */
  select(
    things: readonly SenseThing[],
    origin: WorldPoint,
    radius: number,
    envelope: SenseEnvelope,
    caps: SenseCaps = SENSE_CAPS,
  ): readonly Sighting[] {
    this.out.length = 0;

    const perKind = Math.min(Math.floor(caps.perKind), Math.floor(caps.total));
    const total = Math.floor(caps.total);
    if (!(perKind >= 1) || !(total >= 1)) return this.out;

    const reach = Math.min(radius, envelope.front);
    if (!(reach > 0)) return this.out;
    const reach2 = reach * reach;

    for (let k = 0; k < KIND_COUNT; k += 1) this.slots[k].count = 0;

    const n = things.length;
    for (let i = 0; i < n; i += 1) {
      const thing = things[i];
      // Through `coords`, never by taking the points apart: this is the
      // seam the two point types exist to keep shut.
      const d2 = distanceSquared(thing.at, origin);
      if (d2 > reach2) continue;
      this.offer(this.slots[KIND_SLOT[thing.kind]], i, d2, perKind);
    }

    this.deal(total);
    this.merge(things, envelope);
    return this.out;
  }

  /**
   * Keep this candidate if it is one of the nearest `cap` of its kind.
   *
   * An insertion into a list of ten, not a sort of ten thousand: the
   * common case is a candidate further away than everything already
   * held, which costs one compare and returns.
   */
  private offer(slot: KindSlots, index: number, d2: number, cap: number): void {
    if (slot.count >= cap && d2 >= slot.d2[cap - 1]) return;
    let i = slot.count < cap ? slot.count : cap - 1;
    while (i > 0 && slot.d2[i - 1] > d2) {
      slot.d2[i] = slot.d2[i - 1];
      slot.index[i] = slot.index[i - 1];
      i -= 1;
    }
    slot.d2[i] = d2;
    slot.index[i] = index;
    if (slot.count < cap) slot.count += 1;
  }

  /** Deal the total round the kinds, one slot at a time, until it runs out or they do. */
  private deal(total: number): void {
    for (let k = 0; k < KIND_COUNT; k += 1) this.taken[k] = 0;
    let given = 0;
    let dealt = true;
    while (given < total && dealt) {
      dealt = false;
      for (let k = 0; k < KIND_COUNT && given < total; k += 1) {
        if (this.taken[k] >= this.slots[k].count) continue;
        this.taken[k] += 1;
        given += 1;
        dealt = true;
      }
    }
  }

  /**
   * The dealt picks, nearest first.
   *
   * Each kind was dealt a PREFIX of an already-sorted list, so this is a
   * three-way merge and there is no sort anywhere in the frame.
   */
  private merge(things: readonly SenseThing[], envelope: SenseEnvelope): void {
    for (let k = 0; k < KIND_COUNT; k += 1) this.cursor[k] = 0;
    let written = 0;
    for (;;) {
      let pick = -1;
      let pickD2 = Infinity;
      for (let k = 0; k < KIND_COUNT; k += 1) {
        if (this.cursor[k] >= this.taken[k]) continue;
        const d2 = this.slots[k].d2[this.cursor[k]];
        if (d2 < pickD2) {
          pickD2 = d2;
          pick = k;
        }
      }
      if (pick < 0) break;

      const slot = this.slots[pick];
      const thing = things[slot.index[this.cursor[pick]]];
      this.cursor[pick] += 1;

      const distance = Math.sqrt(pickD2);
      const strength = envelope.strengthAt(distance);
      // The front's own edge comes back as a nought. A sighting lit to
      // nothing would claim the sweep found something the player cannot
      // see, so it is not one.
      if (strength <= 0) continue;

      while (this.pool.length <= written) this.pool.push(blankSighting());
      const s = this.pool[written];
      s.id = thing.id;
      s.kind = thing.kind;
      s.name = thing.name;
      s.at = thing.at;
      s.height = thing.height;
      s.size = thing.size;
      s.distance = distance;
      s.strength = strength;
      this.out[written] = s;
      written += 1;
    }
    this.out.length = written;
  }
}
