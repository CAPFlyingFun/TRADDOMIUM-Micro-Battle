/**
 * STAGE H PHASE 1 — the Queen's decision brain, proved without moving her.
 *
 * Nothing here needs a scene, a renderer or a flight model: the brain
 * is fed a sense snapshot and asked what it decided. That is the point
 * of the layer — the executor that turns an Intent into a FlightDemand
 * is Phase 2, and these tests must still pass unchanged when it lands.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WorldPoint } from '../src/world/coords';
import { MissionBrain, type Sense } from '../src/ant/autonomy/missionBrain';
import { autonomyConfig } from '../src/ant/autonomy/autonomyConfig';
import {
  straightLineTrip, timeUntilDry,
  type Mission, type TripEstimator,
} from '../src/ant/autonomy/mission';

const CFG = autonomyConfig();
const HERE: WorldPoint = { wx: 0, wz: 0 };

const at = (wx: number, wz: number): WorldPoint => ({ wx, wz });

const waypoint = (over: Partial<Mission> = {}): Mission => ({
  id: 'A', label: 'A', at: at(100_000, 0), satisfies: [], arriveWithin: 500,
  ...over,
});

const sense = (over: Partial<Sense> = {}): Sense => ({
  at: HERE,
  thirst: 1,
  // A DELIBERATELY ROUND TEST CLOCK, not the shipped one. The game's
  // queen carries two hours (castes.ts, `thirstRate`); 1/2000 makes a
  // full tank 2,000 seconds so `dryIn` below reads off in whole
  // minutes. The brain never sees the caste table — it is handed a
  // drain — so the two cannot drift apart.
  thirstDrain: 1 / 2000,
  stamina: 1,
  staminaSpent: false,
  motion: 'flying',
  act: 'none',
  medium: 'air',
  tier: 'run',
  paceShare: 0.75,
  wingsWet: false,
  drinkable: false,
  nearestFresh: null,
  nearestWatercourse: { range: 20_000, bearing: 0 },
  ...over,
});

/** An estimator that says whatever the test wants, ignoring geometry. */
const fixedEta = (etaSeconds: number): TripEstimator =>
  () => ({ etaSeconds, distance: 1 });

/**
 * THE ESTIMATOR THE BEHAVIOUR TESTS RUN ON — a straight line at the
 * speed the config assumes, which is what the game ships.
 *
 * Most of these tests used to run on `fixedEta`, and could not any
 * more: the brain now asks the estimator HOW FAR THE WATER IS as well
 * as how far the destination is, and a flat estimator answers 5,000
 * seconds for the puddle two hundred metres away exactly as readily as
 * for the waypoint a kilometre off. Every candidate then fails the
 * reachability test and she is permanently in `water_critical`.
 *
 * `fixedEta` survives only where the test is ABOUT the estimator.
 */
const flies = straightLineTrip(CFG.assumedSpeed);

/** Thirst that leaves her this many seconds from dry, at the test drain. */
const dryIn = (seconds: number): number => seconds / 2000;

/**
 * UNDER THE FLOOR, with time in hand to reach the water two hundred
 * metres off that `sense` puts there by default.
 *
 * Twelve minutes: below the fifteen-minute trigger, and comfortably
 * more than the 200 m flight (500 s) plus the 90 s reserve. Water she
 * cannot reach is its own test, not the background of every other one.
 */
const LOW = dryIn(12 * 60);

/** Run the brain long enough for both the plan and think passes to fire. */
function run(brain: MissionBrain, s: Sense, seconds = 2, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) brain.update(step, s);
}

describe('with water enough for the trip', () => {
  it('keeps navigating', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 1 }));
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
  });

  it('and says nothing to the player', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense());
    expect(brain.takeNotice()).toBeNull();
  });
});

describe('under the low-water floor', () => {
  it('detours to seek water', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission).not.toBeNull();
  });

  it('and tells the player, once', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }), 10);
    expect(brain.takeNotice()).toBe('Very Thirsty! Stopping for water first.');
    // Ten seconds is fifty think passes. Exactly one message.
    expect(brain.takeNotice()).toBeNull();
    run(brain, sense({ thirst: LOW }), 10);
    expect(brain.takeNotice()).toBeNull();
  });
});

/**
 * The rule that stops the autonomy arguing with itself: a destination
 * that already answers thirst is never interrupted to look for thirst.
 */
describe('when the destination is itself water', () => {
  it('does not build a redundant detour', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ id: 'river', label: 'river', satisfies: ['hydration'] }));
    run(brain, sense({ thirst: 0.05 }), 10);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
    expect(brain.takeNotice()).toBeNull();
  });
});

describe('the detour remembers the destination', () => {
  it('keeps the primary while the errand runs', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: LOW }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.primaryMission).toBe(A);
    expect(brain.active).toBe(brain.detourMission);
  });

  it('and resumes it once she has drunk', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: LOW }));
    // She reaches water and starts drinking.
    run(brain, sense({ thirst: LOW, drinkable: true, act: 'drinking' }));
    expect(brain.goal).toBe('drink');
    // Committed: half a drink does not release her.
    run(brain, sense({ thirst: 0.6, drinkable: true, act: 'drinking' }), 5);
    expect(brain.goal).toBe('drink');
    // Full enough.
    run(brain, sense({ thirst: 0.99, drinkable: true, act: 'drinking' }));
    expect(brain.detourMission).toBeNull();
    expect(brain.primaryMission).toBe(A);
    expect(brain.goal).toBe('navigate');
  });

  /**
   * THE LOOP ITS OWN TEST FOUND, and the reason the trigger changed.
   *
   * The waypoint is a kilometre off, which is 2,500 s at the assumed
   * speed, and a full tank on the test clock is 2,000 — so under the
   * old rule the moment she resumed the hydration check said UNSAFE
   * again and sent her back to the water she was standing in. Drink,
   * resume, detour, drink, for ever.
   *
   * Two guards stop it now and they are not the same guard. `drinkTo`
   * says a stop must GAIN her something, and at the drink target it
   * gains nothing. The floor says the trip's length is not a reason to
   * be thirsty at all. Either alone would pass this test; both are
   * wanted, so the test stays where it was written.
   */
  it('and does not loop when even a full tank cannot reach it', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const full = sense({ thirst: 0.99, drinkable: true, act: 'drinking' });
    run(brain, sense({ thirst: LOW }));
    run(brain, sense({ thirst: LOW, drinkable: true, act: 'drinking' }));
    const goals = new Set<string>();
    for (let i = 0; i < 40; i++) { run(brain, full, 0.3); goals.add(brain.goal); }
    expect([...goals]).toEqual(['navigate']);
    expect(brain.detourMission).toBeNull();
  });

  it('and says so', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    brain.takeNotice();
    run(brain, sense({ thirst: LOW, drinkable: true, act: 'drinking' }));
    run(brain, sense({ thirst: 0.99, drinkable: true, act: 'drinking' }));
    expect(brain.takeNotice()).toBe('Hydrated. Resuming destination.');
    expect(brain.takeNotice()).toBeNull();
  });
});

describe('when the water goes away', () => {
  it('replans without losing the destination', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: LOW }));
    expect(brain.goal).toBe('seek_water');
    // She arrives at the channel and it is dry — 29.7% of surveyed
    // reaches are, and the drainage promises no better.
    const dry = sense({
      thirst: LOW,
      at: brain.detourMission!.at,
      nearestFresh: null,
      nearestWatercourse: null,
    });
    run(brain, dry, 3);
    expect(brain.primaryMission).toBe(A);
    // `replan` while `plan()` owns the way out, then the honest name
    // for an island that has offered her nothing.
    expect(['replan', 'water_critical']).toContain(brain.goal);
  });

  it('and a drink interrupted by the water vanishing does not strand her', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: LOW }));
    run(brain, sense({ thirst: 0.3, drinkable: true, act: 'drinking' }));
    expect(brain.goal).toBe('drink');
    run(brain, sense({ thirst: 0.3, drinkable: false, act: 'none' }), 3);
    expect(brain.primaryMission).toBe(A);
    expect(brain.goal).not.toBe('drink');
  });

  it('and nothing throws when there is no water anywhere at all', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    expect(() => run(brain, sense({
      thirst: 0.1, nearestFresh: null, nearestWatercourse: null,
    }), 10)).not.toThrow();
    expect(brain.primaryMission).toBe(A);
    // And she names the condition rather than quietly flying on as
    // though nothing were wrong.
    expect(brain.goal).toBe('water_critical');
  });
});

/**
 * COMMITMENT — the Beyond Extinction pattern, and the reason its dinos
 * do not flicker between chasing and roaming. Once a valid detour is
 * committed the target is not reselected every tick.
 */
describe('it does not thrash', () => {
  it('holds one water target across many think passes', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    const first = brain.detourMission;
    // The world keeps offering a NEARER candidate every tick. A brain
    // that re-chose would walk its target around for ever.
    for (let i = 0; i < 40; i++) {
      run(brain, sense({
        thirst: LOW,
        nearestWatercourse: { range: 20_000 - i * 400, bearing: 1 },
      }), 0.25);
    }
    expect(brain.detourMission).toBe(first);
    expect(brain.goal).toBe('seek_water');
  });

  it('and does not oscillate between seeking and navigating', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      run(brain, sense({ thirst: LOW }), 0.25);
      seen.add(brain.goal);
    }
    expect([...seen]).toEqual(['seek_water']);
  });
});

/** THE THROTTLE MUST NOT CHANGE THE ANSWER, only when it is noticed. */
describe('think rate', () => {
  it('reaches the same decision at any step size', () => {
    const goals: string[] = [];
    for (const step of [1 / 120, 1 / 60, 1 / 20, 0.25, 0.5]) {
      const brain = new MissionBrain(flies, CFG);
      brain.order(waypoint());
      run(brain, sense({ thirst: LOW }), 3, step);
      goals.push(brain.goal);
    }
    expect(new Set(goals).size).toBe(1);
    expect(goals[0]).toBe('seek_water');
  });

  it('and one big step is not fifty decisions', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    brain.update(10, sense({ thirst: LOW }));
    expect(brain.goal).toBe('seek_water');
    // One transition, so one message — a tick-per-frame brain would
    // have queued dozens.
    expect(brain.takeNotice()).toBe('Very Thirsty! Stopping for water first.');
    expect(brain.takeNotice()).toBeNull();
  });
});

/**
 * THE ESTIMATOR SEAM — the architectural point of Phase 1, and it has
 * MOVED rather than gone.
 *
 * The brain must not know how far anything is or how fast she flies.
 * What changed is which question the estimate answers: it used to
 * decide whether she was thirsty (`missionETA` against her tank), which
 * was unliveable, and now it decides whether a PARTICULAR PUDDLE is
 * worth flying to. The seam is the same and the rule about it is the
 * same — Phase 2 may replace the estimator with a wind- and
 * terrain-aware planner and not one line of the brain may change.
 */
describe('the trip estimate is an input, not a calculation', () => {
  it('drives the water decision purely from the estimator', () => {
    const asked: WorldPoint[] = [];
    const spy: TripEstimator = (from, to) => {
      asked.push(to);
      return flies(from, to);
    };
    const brain = new MissionBrain(spy, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    expect(brain.goal).toBe('seek_water');
    // It priced the WATER, not only the waypoint — that is the
    // reachability test doing its work through the seam.
    expect(asked.some((to) => to.wx !== waypoint().at.wx)).toBe(true);
  });

  it('so the SAME world with a different ETA decides differently', () => {
    // Identical senses, identical missions, identical config. Only the
    // estimator differs, and it alone decides whether the water two
    // hundred metres away is water she can reach.
    const world = sense({ thirst: LOW });

    const quick = new MissionBrain(fixedEta(10), CFG);
    quick.order(waypoint());
    run(quick, world);

    const hopeless = new MissionBrain(fixedEta(100_000), CFG);
    hopeless.order(waypoint());
    run(hopeless, world);

    expect(quick.goal).toBe('seek_water');
    expect(hopeless.goal).toBe('water_critical');
  });

  it('and geometry alone cannot flip it', () => {
    // The water is ten kilometres off, which no queen reaches on twelve
    // minutes — but an estimator that says it is a ten-second hop is
    // the only authority the brain has, and it must believe it.
    const brain = new MissionBrain(fixedEta(10), CFG);
    brain.order(waypoint());
    run(brain, sense({
      thirst: LOW,
      nearestWatercourse: { range: 1_000_000, bearing: 0 },
    }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission?.label).toBe('channel');
  });

  it('and an unreachable route reads as unreachable rather than as fine', () => {
    // The point of the test since it was written: an infinite estimate
    // must not read as FINE. What it now means is that she does not set
    // off for it — she says so and keeps flying.
    const brain = new MissionBrain(
      () => ({ etaSeconds: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY }),
      CFG,
    );
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    expect(brain.goal).toBe('water_critical');
    expect(brain.detourMission).toBeNull();
  });
});

/**
 * SHE DOES NOT STOP FOR WATER WITH THREE QUARTERS OF A TANK.
 *
 * Joshua, 2026-08-31, watching her at 81% and 45 minutes in hand: "it
 * was alternating between water, path, water, path... annoying every 3
 * minutes from 55m to 52m (Water break). Need to make sure it only
 * triggers below 15m remaining."
 *
 * The rule was "will I still be wet when I arrive", which is right and
 * on its own unliveable: a cross-island trip is ninety minutes and she
 * carries about fifty-five, so the answer is NO from the moment she
 * sets off and stays NO however much she drinks. `drinkTo` stopped the
 * instant loop and only set its period — a minute and a half, the time
 * to fall from full to 95%.
 */
describe('the floor under the water errand', () => {
  it('leaves a queen with plenty alone, however long the trip', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: dryIn(45 * 60) }));
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBe(null);
  });

  it('and still stops her when she is actually short', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({
      thirst: dryIn(10 * 60),
      nearestFresh: { range: 2_000, bearing: 0 },
      nearestWatercourse: { range: 2_000, bearing: 0 },
    }));
    expect(brain.goal).toBe('seek_water');
  });

  it('and the floor is fifteen minutes, which is the whole of the fix', () => {
    expect(CFG.thirstFloor).toBe(15 * 60);
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    // A minute the safe side of it.
    run(brain, sense({ thirst: dryIn(16 * 60) }));
    expect(brain.goal).toBe('navigate');
  });

  it('and the length of the trip is no longer part of the question', () => {
    // THE HALF THAT WENT. This used to assert the opposite — fourteen
    // minutes of water and a one-minute hop was a hop she made first,
    // because the trigger asked "will I still be wet when I arrive".
    // That clause is gone: fourteen minutes of water is a problem she
    // should not be carrying into anything, however short the leg in
    // front of her happens to be, and keeping the clause is what made
    // every long flight a permanent water emergency.
    const short = new MissionBrain(flies, CFG);
    short.order(waypoint({ at: at(2_000, 0) }));      // 20 m, a 50 s hop
    const world = sense({
      thirst: dryIn(14 * 60),
      nearestFresh: { range: 2_000, bearing: 0 },
    });
    run(short, world);
    expect(short.goal).toBe('seek_water');

    // And the same queen with a fifty-kilometre destination decides the
    // same thing, which is the point: the trip is not in the rule.
    const far = new MissionBrain(flies, CFG);
    far.order(waypoint({ at: at(5_000_000, 0) }));
    run(far, world);
    expect(far.goal).toBe('seek_water');
  });

  it('and cannot alternate water and path at a comfortable level', () => {
    // THE SYMPTOM, as a test. Drink to full, resume, and the errand
    // must not come straight back.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({
      thirst: dryIn(10 * 60),
      nearestFresh: { range: 2_000, bearing: 0 },
      nearestWatercourse: { range: 2_000, bearing: 0 },
    }));
    expect(brain.goal).toBe('seek_water');
    // She drinks her fill and sets off again.
    run(brain, sense({ thirst: 1, drinkable: true, act: 'drinking' }), 4);
    expect(brain.goal).toBe('navigate');
    // And a minute and a half later — the old loop's whole period —
    // she is still going.
    run(brain, sense({ thirst: dryIn(52 * 60) }), 4);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBe(null);
  });
});

describe('the provisional estimator', () => {
  it('is a straight line at the assumed speed, and says so', () => {
    const trip = straightLineTrip(40)(HERE, at(4000, 0));
    expect(trip.distance).toBeCloseTo(4000, 6);
    expect(trip.etaSeconds).toBeCloseTo(100, 6);
    // NOT JUDGED, rather than judged free and fine. Phase 2 fills these.
    expect(trip.staminaCost).toBeUndefined();
    expect(trip.viable).toBeUndefined();
  });

  it('and refuses to divide by a standstill', () => {
    expect(straightLineTrip(0)(HERE, at(10, 0)).etaSeconds)
      .toBe(Number.POSITIVE_INFINITY);
  });
});

describe('time until dry', () => {
  it('is the reserve over the drain', () => {
    expect(timeUntilDry(1, 1 / 2000)).toBeCloseTo(2000, 6);
    expect(timeUntilDry(0.5, 1 / 2000)).toBeCloseTo(1000, 6);
  });

  it('and is forever when nothing is draining her', () => {
    expect(timeUntilDry(1, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(timeUntilDry(1, -1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('wet wings outrank travel', () => {
  it('because she cannot take off until they dry', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense({ wingsWet: true, motion: 'swimming' }));
    expect(brain.goal).toBe('wait_wings');
  });

  it('and she carries on the moment they are', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ wingsWet: true, motion: 'swimming' }));
    run(brain, sense({ wingsWet: false, motion: 'flying' }));
    expect(brain.goal).toBe('navigate');
    expect(brain.primaryMission).toBe(A);
  });

  it('but wet wings on dry land do not stop her walking', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense({ wingsWet: true, motion: 'walking' }));
    expect(brain.goal).toBe('navigate');
  });
});

describe('arriving, and switching off', () => {
  it('completes the mission when she reaches it', () => {
    const brain = new MissionBrain(fixedEta(1), CFG);
    const A = waypoint({ at: at(1000, 0), arriveWithin: 500 });
    brain.order(A);
    run(brain, sense({ at: at(1100, 0) }));
    expect(brain.goal).toBe('mission_complete');
    expect(brain.primaryMission).toBeNull();
  });

  /**
   * And it STAYS complete. The first cut fell straight through to `off`
   * on the next think pass, so arrival lasted a fifth of a second and
   * nothing downstream could ever have seen it.
   */
  it('and rests there until she is ordered somewhere else', () => {
    const brain = new MissionBrain(fixedEta(1), CFG);
    brain.order(waypoint({ at: at(1000, 0), arriveWithin: 500 }));
    run(brain, sense({ at: at(1100, 0) }), 10);
    expect(brain.goal).toBe('mission_complete');
    const B = waypoint({ id: 'B', label: 'B', at: at(9000, 0) });
    brain.order(B);
    run(brain, sense({ at: at(1100, 0) }));
    expect(brain.goal).toBe('navigate');
    expect(brain.primaryMission).toBe(B);
  });

  it('and a cancel drops everything, committed drink included', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    run(brain, sense({ thirst: LOW, drinkable: true, act: 'drinking' }));
    expect(brain.goal).toBe('drink');
    brain.cancel();
    expect(brain.goal).toBe('off');
    expect(brain.primaryMission).toBeNull();
    expect(brain.detourMission).toBeNull();
  });

  it('and an idle brain with no orders does nothing at all', () => {
    const brain = new MissionBrain(fixedEta(1), CFG);
    run(brain, sense(), 5);
    expect(brain.goal).toBe('off');
    expect(brain.intent.target).toBeNull();
  });
});

/**
 * THE SEAM PHASE 2 PLUGS INTO. A request, never a control: the brain
 * says where and why, the executor decides the FlightDemand.
 */
describe('the intent it publishes', () => {
  it('names a target while travelling', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense());
    const intent = brain.intent;
    expect(intent.goal).toBe('navigate');
    expect(intent.target).toEqual(A.at);
    expect(intent.arrivalRadius).toBe(A.arriveWithin);
    expect(intent.desiredAction).toBe('navigate');
  });

  it('points at the WATER while detouring, not the destination', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: LOW }));
    expect(brain.intent.target).toEqual(brain.detourMission!.at);
    expect(brain.intent.target).not.toEqual(A.at);
  });

  it('and asks for a drink rather than a place once she is there', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW }));
    run(brain, sense({ thirst: LOW, drinkable: true, act: 'drinking' }));
    expect(brain.intent.desiredAction).toBe('drink');
    expect(brain.intent.target).toBeNull();
  });

  it('and never names a control — that is Phase 2\'s job', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense());
    const keys = Object.keys(brain.intent).sort();
    expect(keys).toEqual(['arrivalRadius', 'desiredAction', 'goal', 'target']);
  });
});

describe('the brain reads the lower layers and never writes them', () => {
  it('has no way to set a Motion or an Act', () => {
    const brain = new MissionBrain(fixedEta(60), CFG) as unknown as Record<string, unknown>;
    expect(brain.setMotion).toBeUndefined();
    expect(brain.setAct).toBeUndefined();
  });

  it('and takes stamina in, ready for Phase 2, without deciding on it', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    run(brain, sense({ stamina: 0.01, staminaSpent: true }));
    // Phase 1 does not route around exhaustion — it is exposed, not used.
    expect(brain.goal).toBe('navigate');
    expect(brain.debug(sense({ stamina: 0.01 })).stamina).toBe(0.01);
  });
});

/**
 * PACE, SENSED FOR PHASE 2 — the same footing stamina is on.
 *
 * The route planner's first move on an unsafe trip is to change pace
 * before it inserts a stop, so the brain has to be able to SEE the
 * pace. Phase 1 reads it and decides nothing on it; these tests hold
 * that it arrives intact and that nothing has quietly started routing
 * on it.
 */
describe('pace is sensed, not yet decided on', () => {
  it('reaches the debug intact', () => {
    const brain = new MissionBrain(fixedEta(60), CFG);
    brain.order(waypoint());
    const s = sense({ medium: 'land', tier: 'crawl', paceShare: 0.122 });
    run(brain, s);
    const d = brain.debug(s);
    expect(d.medium).toBe('land');
    expect(d.tier).toBe('crawl');
    expect(d.paceShare).toBeCloseTo(0.122, 6);
  });

  it('and changing it alone changes no decision', () => {
    const goals: string[] = [];
    for (const tier of ['crawl', 'walk', 'run', 'sprint'] as const) {
      const brain = new MissionBrain(flies, CFG);
      brain.order(waypoint());
      run(brain, sense({ thirst: LOW, tier }));
      goals.push(brain.goal);
    }
    // The ETA comes from the estimator, and the estimator is what a
    // pace change must go through — not a shortcut inside the brain.
    expect(new Set(goals).size).toBe(1);
  });
});

/**
 * THE DEADLOCK: A WATER ERRAND NOBODY IS RUNNING.
 *
 * Joshua's session, 2026-08-31. The first trip was flawless — took off,
 * landed, drank, took off again, made a stamina stop, arrived. Then he
 * plotted a second course while she was sitting on water, and nothing
 * ever happened again: "Autopilot did start but waited until the dry
 * timer was up…. Nothing… I manually drank… nothing, I reset a new
 * path… nothing."
 *
 * His screenshot names it. `AI navigate · pri waypoint · det water` over
 * `AP hold 1m`: the brain says it is navigating, a water detour is still
 * set, and the executor is holding over that detour a metre away.
 *
 * `wait_wings` came out into `navigate` whatever it had been doing, so
 * an errand interrupted by wet wings was forgotten by the state machine
 * while its `detour` object survived. Nothing serves a detour from
 * `navigate`, so it was never advanced, never satisfied and never
 * cleared — and `active` prefers the detour, so every later order went
 * behind a mission that could not finish.
 */
describe('an errand interrupted by wet wings', () => {
  const thirsty = (over: Partial<Sense> = {}): Sense => sense({
    thirst: dryIn(5 * 60),
    nearestFresh: { range: 2_000, bearing: 0 },
    nearestWatercourse: { range: 2_000, bearing: 0 },
    ...over,
  });

  /**
   * Thirsty enough to start the errand, then soaked, then WATERED —
   * by hand, which is what Joshua did — and only then dry.
   *
   * The order is the whole reproduction. While she is still thirsty the
   * broken machine healed itself: it fell out into `navigate`, found
   * her thirsty on the next think, and started a fresh errand. It is
   * the queen who has ALREADY drunk who gets stranded, because nothing
   * sends her back to a state that would clear the detour.
   */
  const stranded = (brain: MissionBrain): void => {
    run(brain, thirsty());
    run(brain, thirsty({ motion: 'swimming', wingsWet: true }));
    // She drank while she waited. Thirst is fine now.
    run(brain, sense({ thirst: 1, motion: 'swimming', wingsWet: true }));
    // And the wings dry.
    run(brain, sense({ thirst: 1, motion: 'swimming', wingsWet: false }));
  };

  it('starts the errand and remembers it through the wait', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, thirsty());
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission).not.toBe(null);
    run(brain, thirsty({ motion: 'swimming', wingsWet: true }));
    expect(brain.goal).toBe('wait_wings');
    expect(brain.detourMission).not.toBe(null);
  });

  it('and does not strand it when she comes out no longer thirsty', () => {
    // THE DEADLOCK. `active` prefers the detour, so a detour the brain
    // has stopped thinking about is a destination the executor flies to
    // for ever — Joshua's `AI navigate · det water` over `AP hold 1m`.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    stranded(brain);
    expect(brain.detourMission).toBe(null);
    expect(brain.active?.label).toBe('A');
  });

  it('and a new order is not stuck behind a dead one', () => {
    // What Joshua actually did next: plotted a fresh course and watched
    // it be ignored, because the stale detour outranked it for ever.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    stranded(brain);
    brain.order(waypoint({ id: 'B', label: 'B', at: at(-200_000, 0) }));
    run(brain, sense({ thirst: 1 }));
    expect(brain.active?.label).toBe('B');
    expect(brain.detourMission).toBe(null);
  });

  it('and a queen who is STILL thirsty keeps the SAME errand', () => {
    // The other half, and the identity is the point. `serveWater` says
    // COMMITTED: the target is not reselected, only handed off or
    // abandoned. Coming out of the wait into `navigate` and letting the
    // thirst check start a fresh errand looks the same from outside and
    // is not — it throws away a target already chosen and walked
    // toward, and does it again every time she gets her wings wet.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, thirsty());
    const chosen = brain.detourMission;
    expect(chosen).not.toBe(null);
    run(brain, thirsty({ motion: 'swimming', wingsWet: true }));
    run(brain, thirsty({ motion: 'swimming', wingsWet: false }));
    expect(brain.goal).not.toBe('navigate');
    expect(brain.detourMission).toBe(chosen);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────
 * THE HYDRATION SPECIFICATION, 2026-09-01.
 *
 * Joshua's list, as tests. TEST A — a full tank is 120 minutes — is
 * not here: it belongs to the thirst system rather than the brain and
 * lives in tests/thirst.test.ts, which is the only place the duration
 * is written down.
 *
 * The rest are B to M, in his order.
 * ─────────────────────────────────────────────────────────────────
 */
describe('B — fifteen minutes is the trigger, and the only one', () => {
  it('leaves her alone at sixteen minutes and stops her at fourteen', () => {
    const easy = new MissionBrain(flies, CFG);
    easy.order(waypoint());
    run(easy, sense({ thirst: dryIn(16 * 60) }));
    expect(easy.goal).toBe('navigate');

    const short = new MissionBrain(flies, CFG);
    short.order(waypoint());
    run(short, sense({ thirst: dryIn(14 * 60) }));
    expect(short.goal).toBe('seek_water');
  });

  it('and the threshold is a config dial, not a number in a rule', () => {
    // Half an hour, and she stops at twenty-nine minutes.
    const half = autonomyConfig({ thirstFloor: 30 * 60 });
    const brain = new MissionBrain(flies, half);
    brain.order(waypoint());
    run(brain, sense({ thirst: dryIn(29 * 60) }));
    expect(brain.goal).toBe('seek_water');
  });
});

describe('C — the mission ETA is not a reason to be thirsty', () => {
  it('flies a trip four times longer than her tank without stopping', () => {
    // The old rule stopped her here on the first think pass, at 100% of
    // a full tank, and again every ninety seconds for the rest of the
    // flight. Two hours of water, an eight-hour leg, and she goes.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ at: at(20_000_000, 0) }));   // 200 km
    run(brain, sense({ thirst: 1 }), 10);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
    expect(brain.takeNotice()).toBeNull();
  });

  it('and an UNREACHABLE destination is not a reason either', () => {
    const brain = new MissionBrain(
      (from, to) => ({
        ...flies(from, to),
        // The destination cannot be flown at all; the water still can.
        etaSeconds: to.wx > 1_000_000 ? Number.POSITIVE_INFINITY : flies(from, to).etaSeconds,
      }),
      CFG,
    );
    brain.order(waypoint({ at: at(5_000_000, 0) }));
    run(brain, sense({ thirst: 1 }), 5);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
  });
});

describe('E — she stops at water on the way, not water nearby', () => {
  /** A kilometre due east. `+wz is SOUTH`, so east is `sin(b) = 1`. */
  const EAST = waypoint({ at: at(100_000, 0) });

  it('takes the further candidate when it is the one along the route', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(EAST);
    run(brain, sense({
      thirst: LOW,
      // Fifty metres BEHIND her — closest, and a hundred metres of
      // backtracking.
      nearestWatercourse: { range: 5_000, bearing: -Math.PI / 2 },
      // A hundred metres AHEAD — twice as far and free.
      waterAhead: [{ range: 10_000, bearing: Math.PI / 2 }],
    }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission!.at.wx).toBeCloseTo(10_000, 3);
  });

  it('and still takes the nearest when nothing is ahead of her', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(EAST);
    run(brain, sense({
      thirst: LOW,
      nearestWatercourse: { range: 5_000, bearing: -Math.PI / 2 },
    }));
    expect(brain.detourMission!.at.wx).toBeCloseTo(-5_000, 3);
  });

  it('and the LIVE window still outranks the drainage', () => {
    // The distinction the whole water system is built on: `nearestFresh`
    // is water that EXISTS, the drainage is a candidate. The window is
    // 256 m, so live water is never an expensive stop anyway.
    const brain = new MissionBrain(flies, CFG);
    brain.order(EAST);
    run(brain, sense({
      thirst: LOW,
      nearestFresh: { range: 3_000, bearing: -Math.PI / 2 },
      waterAhead: [{ range: 10_000, bearing: Math.PI / 2 }],
    }));
    expect(brain.detourMission!.label).toBe('water');
    expect(brain.detourMission!.id).toBe('water:sim');
  });
});

describe('F — what a stop costs the trip', () => {
  const EAST = waypoint({ at: at(100_000, 0) });
  const costOf = (world: Sense): number => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(EAST);
    run(brain, world);
    return brain.debug(world).candidate!.cost;
  };

  it('is nothing at all for water directly on the line', () => {
    expect(costOf(sense({
      thirst: LOW,
      nearestWatercourse: { range: 10_000, bearing: Math.PI / 2 },
    }))).toBeCloseTo(0, 3);
  });

  it('and twice the range for water directly behind her', () => {
    expect(costOf(sense({
      thirst: LOW,
      nearestWatercourse: { range: 5_000, bearing: -Math.PI / 2 },
    }))).toBeCloseTo(10_000, 3);
  });

  it('and the sideways detour, which is neither', () => {
    // A hundred metres off the line at right angles: there and back is
    // 200 m of flying, less the little the leg itself shortens by.
    const cost = costOf(sense({
      thirst: LOW,
      nearestWatercourse: { range: 10_000, bearing: 0 },
    }));
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(20_000);
  });

  it('and with nowhere to be it is simply the range', () => {
    // No primary, so no corridor. Nearest is the whole of the question.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const world = sense({
      thirst: LOW,
      nearestWatercourse: { range: 7_000, bearing: 2 },
    });
    run(brain, world);
    brain.cancel();
    expect(brain.debug(world).candidate).toBeNull();
  });
});

describe('G — water she cannot reach is not an option', () => {
  it('refuses a candidate that would run her dry on the way', () => {
    // Two hundred metres is 500 s at the assumed speed, and she has
    // 300 s. The old rule would have sent her anyway.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: dryIn(5 * 60) }));
    expect(brain.goal).toBe('water_critical');
    expect(brain.detourMission).toBeNull();
  });

  it('and keeps the reserve on the near side of the decision', () => {
    // The margin is what makes an ETA of exactly her remaining water a
    // no rather than a yes: the estimate is a straight line over a real
    // island and she may have to circle, land and walk the last bit.
    const world = (dry: number): Sense => sense({
      thirst: dryIn(dry),
      nearestWatercourse: { range: 20_000, bearing: 0 },     // 500 s
    });
    const tight = new MissionBrain(flies, CFG);
    tight.order(waypoint());
    run(tight, world(560));                                  // 500 + 90 > 560
    expect(tight.goal).toBe('water_critical');

    const room = new MissionBrain(flies, CFG);
    room.order(waypoint());
    run(room, world(620));                                   // 500 + 90 < 620
    expect(room.goal).toBe('seek_water');
  });

  it('and takes the reachable candidate over the cheaper unreachable one', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ at: at(4_000_000, 0) }));          // 40 km east
    run(brain, sense({
      thirst: dryIn(11 * 60),                                 // 660 s
      // Dead on the line and free — and eight kilometres away.
      waterAhead: [{ range: 800_000, bearing: Math.PI / 2 }],
      // Behind her, so it costs a hundred metres, and she can make it.
      nearestWatercourse: { range: 5_000, bearing: -Math.PI / 2 },
    }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission!.at.wx).toBeCloseTo(-5_000, 3);
  });
});

describe('H — when nothing is in reach, she says so and keeps flying', () => {
  const parched = (over: Partial<Sense> = {}): Sense => sense({
    thirst: dryIn(5 * 60), ...over,
  });

  it('preserves the destination and goes on flying it', () => {
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, parched());
    expect(brain.goal).toBe('water_critical');
    expect(brain.primaryMission).toBe(A);
    expect(brain.intent.target).toEqual(A.at);
    expect(brain.intent.desiredAction).toBe('navigate');
  });

  it('and tells the player once, not once a second', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, parched(), 30);
    expect(brain.takeNotice()).toBe('No water in reach — continuing to destination.');
    expect(brain.takeNotice()).toBeNull();
    run(brain, parched(), 30);
    expect(brain.takeNotice()).toBeNull();
  });

  it('and does not loop — it is a condition, not a flicker', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) { run(brain, parched(), 0.25); seen.add(brain.goal); }
    expect([...seen]).toEqual(['water_critical']);
  });

  it('and leaves it the moment something IS in reach', () => {
    // She is flying while it lasts, so the country under her changes.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, parched());
    expect(brain.goal).toBe('water_critical');
    run(brain, parched({ nearestFresh: { range: 1_000, bearing: 0 } }), 3);
    expect(brain.goal).toBe('seek_water');
  });

  it('and leaves it when she has drunk, whoever poured it', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, parched());
    run(brain, sense({ thirst: 1 }), 3);
    expect(brain.goal).toBe('navigate');
  });

  it('and still ARRIVES while it lasts', () => {
    // A queen who reached her waypoint in this state and did not notice
    // would strand every waypoint behind it in the chain.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ at: at(1_000, 0), arriveWithin: 500 }));
    run(brain, parched());
    expect(brain.goal).toBe('water_critical');
    run(brain, parched({ at: at(1_100, 0) }), 2);
    expect(brain.goal).toBe('mission_complete');
    expect(brain.primaryMission).toBeNull();
  });

  it('and never holds a detour while it lasts', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, parched(), 20);
    expect(brain.detourMission).toBeNull();
    expect(brain.active).toBe(brain.primaryMission);
  });
});

describe('I — a committed errand is not re-decided', () => {
  it('ignores a better candidate offered after she has set off', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ at: at(100_000, 0) }));
    run(brain, sense({ thirst: LOW }));
    const chosen = brain.detourMission;
    expect(chosen).not.toBeNull();
    // The scene keeps finding cheaper water down the corridor as she
    // flies. She has already turned toward one.
    for (let i = 0; i < 40; i++) {
      run(brain, sense({
        thirst: LOW,
        waterAhead: [{ range: 2_000 + i * 100, bearing: Math.PI / 2 }],
      }), 0.25);
    }
    expect(brain.detourMission).toBe(chosen);
    expect(brain.goal).toBe('seek_water');
  });
});

describe('J — fifteen minutes starts the drink; drinkTo ends it', () => {
  const world = (thirst: number): Sense => sense({
    thirst, drinkable: true, act: 'drinking',
    nearestFresh: { range: 1_000, bearing: 0 },
  });

  it('keeps drinking well past the threshold that sent her', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW, nearestFresh: { range: 1_000, bearing: 0 } }));
    run(brain, world(LOW));
    expect(brain.goal).toBe('drink');
    // Twenty minutes in the tank — the trigger is long behind her, and
    // she is still drinking, because the trigger is not the target.
    run(brain, world(dryIn(20 * 60)), 3);
    expect(brain.goal).toBe('drink');
    // Half an hour — nearly a full tank on the test clock, and twice
    // the threshold that sent her. Still drinking.
    run(brain, world(dryIn(30 * 60)), 3);
    expect(brain.goal).toBe('drink');
  });

  it('and stops at drinkTo, which is a drink rather than a limit', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: LOW, nearestFresh: { range: 1_000, bearing: 0 } }));
    run(brain, world(LOW));
    run(brain, world(CFG.drinkTo - 0.001), 2);
    expect(brain.goal).toBe('drink');
    run(brain, world(CFG.drinkTo), 2);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
  });
});

describe('K — a long crossing is several stops, and nobody plans them', () => {
  it('stops as many times as the flight needs', () => {
    // Two hundred kilometres, which is four times what a full tank
    // covers. No staged plan, no route solve: the fifteen-minute rule
    // fires, she drinks to full, and it fires again later.
    const brain = new MissionBrain(flies, CFG);
    const A = waypoint({ at: at(20_000_000, 0) });
    brain.order(A);
    let thirst = 1;
    let stops = 0;
    let before = brain.goal;
    const STEP = 0.2;
    for (let i = 0; i < 30_000; i++) {
      brain.update(STEP, sense({
        thirst,
        drinkable: true,
        act: brain.goal === 'drink' ? 'drinking' : 'none',
        nearestFresh: { range: 1_000, bearing: 0 },
      }));
      if (brain.goal === 'seek_water' && before !== 'seek_water') stops++;
      before = brain.goal;
      thirst = brain.goal === 'drink'
        ? Math.min(1, thirst + STEP / 8)          // Thirst's FILL_SECONDS
        : Math.max(0, thirst - STEP / 2000);
    }
    expect(stops).toBeGreaterThanOrEqual(3);
    // And she never lost what she was doing while making them.
    expect(brain.primaryMission).toBe(A);
  });
});

describe('L — the boost does not buy her free water', () => {
  it('decides on seconds it is handed, never on a clock of its own', () => {
    const src = readFileSync('src/ant/autonomy/missionBrain.ts', 'utf8');
    // Nothing in the brain knows the travel scale exists, and it has no
    // clock of its own to read: every second it reasons about arrives
    // in the sense or in an estimate. Her thirst is spent out of the
    // budget the scene hands to `Thirst`, so ten times the ground
    // covered is ten times the water drunk.
    for (const word of ['MAX_TRAVEL', 'travelScale', 'Date.now', 'performance.']) {
      expect(src, word).not.toContain(word);
    }
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).toContain('this.thirst.update(plan.budget,');
  });

  it('and the same water decides the same way at any frame rate', () => {
    const goals: string[] = [];
    for (const step of [1 / 120, 1 / 60, 0.2, 0.5, 1]) {
      const brain = new MissionBrain(flies, CFG);
      brain.order(waypoint());
      run(brain, sense({ thirst: LOW }), 4, step);
      goals.push(brain.goal);
    }
    expect(new Set(goals)).toEqual(new Set(['seek_water']));
  });
});

describe('M — the developer line can see the whole decision', () => {
  it('publishes the threshold beside the water she has left', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const world = sense({ thirst: LOW });
    run(brain, world);
    const d = brain.debug(world);
    expect(d.threshold).toBe(CFG.thirstFloor);
    expect(d.dry).toBeCloseTo(12 * 60, 6);
    expect(d.thirst).toBe(LOW);
    expect(d.primary).toBe('A');
    expect(d.detour).toBe('channel');
    expect(d.goal).toBe('seek_water');
  });

  it('and the candidate it weighed, with all four numbers', () => {
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint({ at: at(100_000, 0) }));
    const world = sense({
      thirst: LOW,
      nearestWatercourse: { range: 5_000, bearing: -Math.PI / 2 },
    });
    run(brain, world);
    const chosen = brain.debug(world).candidate!;
    expect(chosen.label).toBe('channel');
    expect(chosen.range).toBeCloseTo(5_000, 6);
    expect(chosen.cost).toBeCloseTo(10_000, 3);
    expect(chosen.eta).toBeCloseTo(5_000 / CFG.assumedSpeed, 6);
    expect(chosen.reachable).toBe(true);
  });

  it('and says WHY when there was nothing she could reach', () => {
    // The one case the line exists for. Without the candidate a queen
    // who saw a stream and rejected it reads exactly like one that
    // never saw a stream at all.
    const brain = new MissionBrain(flies, CFG);
    brain.order(waypoint());
    const world = sense({ thirst: dryIn(5 * 60) });
    run(brain, world);
    const d = brain.debug(world);
    expect(d.goal).toBe('water_critical');
    expect(d.detour).toBeNull();
    expect(d.candidate).not.toBeNull();
    expect(d.candidate!.reachable).toBe(false);
  });

  it('and the scene draws every one of them', () => {
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    const line = scene.slice(scene.indexOf('return `AI ${d.goal}'));
    const row = line.slice(0, 700);
    expect(row).toContain('pri ${d.primary');
    expect(row).toContain('det ${d.detour');
    expect(row).toContain('h2o ${(d.thirst * 100)');
    expect(row).toContain('dry ${secs(d.dry)}/${secs(d.threshold)}');
    expect(row).toContain('cand ${cand}');
    expect(scene).toContain("d.candidate.reachable ? 'ok' : 'FAR'");
    // And it is under the same single toggle as the rest of the
    // register — telemetry, not furniture.
    expect(scene).toContain('ai: settings().showFix ? this.aiLine() : null,');
  });
});
