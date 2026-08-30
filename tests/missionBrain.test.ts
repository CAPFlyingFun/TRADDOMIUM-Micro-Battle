/**
 * STAGE H PHASE 1 — the Queen's decision brain, proved without moving her.
 *
 * Nothing here needs a scene, a renderer or a flight model: the brain
 * is fed a sense snapshot and asked what it decided. That is the point
 * of the layer — the executor that turns an Intent into a FlightDemand
 * is Phase 2, and these tests must still pass unchanged when it lands.
 */
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
  thirstDrain: 1 / 2000,          // Thirst's real order: ~33 min to empty
  stamina: 1,
  staminaSpent: false,
  motion: 'flying',
  act: 'none',
  wingsWet: false,
  drinkable: false,
  nearestFresh: null,
  nearestWatercourse: { range: 20_000, bearing: 0 },
  ...over,
});

/** An estimator that says whatever the test wants, ignoring geometry. */
const fixedEta = (etaSeconds: number): TripEstimator =>
  () => ({ etaSeconds, distance: 1 });

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

describe('without water enough for the trip', () => {
  it('detours to seek water', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.detourMission).not.toBeNull();
  });

  it('and tells the player, once', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }), 10);
    expect(brain.takeNotice()).toBe('Very Thirsty! Stopping for water first.');
    // Ten seconds is fifty think passes. Exactly one message.
    expect(brain.takeNotice()).toBeNull();
    run(brain, sense({ thirst: 0.2 }), 10);
    expect(brain.takeNotice()).toBeNull();
  });
});

/**
 * The rule that stops the autonomy arguing with itself: a destination
 * that already answers thirst is never interrupted to look for thirst.
 */
describe('when the destination is itself water', () => {
  it('does not build a redundant detour', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint({ id: 'river', label: 'river', satisfies: ['hydration'] }));
    run(brain, sense({ thirst: 0.05 }), 10);
    expect(brain.goal).toBe('navigate');
    expect(brain.detourMission).toBeNull();
    expect(brain.takeNotice()).toBeNull();
  });
});

describe('the detour remembers the destination', () => {
  it('keeps the primary while the errand runs', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: 0.2 }));
    expect(brain.goal).toBe('seek_water');
    expect(brain.primaryMission).toBe(A);
    expect(brain.active).toBe(brain.detourMission);
  });

  it('and resumes it once she has drunk', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: 0.2 }));
    // She reaches water and starts drinking.
    run(brain, sense({ thirst: 0.2, drinkable: true, act: 'drinking' }));
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
   * THE LOOP ITS OWN TEST FOUND. The trip above is 5,000 s and a full
   * tank is 2,000 — so the moment she resumed, the hydration check said
   * unsafe again and sent her back to the water she was standing in.
   * Drink, resume, detour, drink, for ever.
   *
   * A water stop is only worth making if drinking would GAIN her
   * something, and at the drink target it gains nothing. A trip she
   * cannot survive on a full tank is a ROUTE problem — staged stops —
   * and belongs to the Phase 2 planner, not to a thirst rule.
   */
  it('and does not loop when even a full tank cannot reach it', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    const full = sense({ thirst: 0.99, drinkable: true, act: 'drinking' });
    run(brain, sense({ thirst: 0.2 }));
    run(brain, sense({ thirst: 0.2, drinkable: true, act: 'drinking' }));
    const goals = new Set<string>();
    for (let i = 0; i < 40; i++) { run(brain, full, 0.3); goals.add(brain.goal); }
    expect([...goals]).toEqual(['navigate']);
    expect(brain.detourMission).toBeNull();
  });

  it('and says so', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    brain.takeNotice();
    run(brain, sense({ thirst: 0.2, drinkable: true, act: 'drinking' }));
    run(brain, sense({ thirst: 0.99, drinkable: true, act: 'drinking' }));
    expect(brain.takeNotice()).toBe('Hydrated. Resuming destination.');
    expect(brain.takeNotice()).toBeNull();
  });
});

describe('when the water goes away', () => {
  it('replans without losing the destination', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: 0.2 }));
    expect(brain.goal).toBe('seek_water');
    // She arrives at the channel and it is dry — 29.7% of surveyed
    // reaches are, and the drainage promises no better.
    const dry = sense({
      thirst: 0.2,
      at: brain.detourMission!.at,
      nearestFresh: null,
      nearestWatercourse: null,
    });
    run(brain, dry, 3);
    expect(brain.primaryMission).toBe(A);
    expect(['replan', 'navigate']).toContain(brain.goal);
  });

  it('and a drink interrupted by the water vanishing does not strand her', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: 0.2 }));
    run(brain, sense({ thirst: 0.3, drinkable: true, act: 'drinking' }));
    expect(brain.goal).toBe('drink');
    run(brain, sense({ thirst: 0.3, drinkable: false, act: 'none' }), 3);
    expect(brain.primaryMission).toBe(A);
    expect(brain.goal).not.toBe('drink');
  });

  it('and nothing throws when there is no water anywhere at all', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    expect(() => run(brain, sense({
      thirst: 0.1, nearestFresh: null, nearestWatercourse: null,
    }), 10)).not.toThrow();
    expect(brain.primaryMission).toBe(A);
  });
});

/**
 * COMMITMENT — the Beyond Extinction pattern, and the reason its dinos
 * do not flicker between chasing and roaming. Once a valid detour is
 * committed the target is not reselected every tick.
 */
describe('it does not thrash', () => {
  it('holds one water target across many think passes', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    const first = brain.detourMission;
    // The world keeps offering a NEARER candidate every tick. A brain
    // that re-chose would walk its target around for ever.
    for (let i = 0; i < 40; i++) {
      run(brain, sense({
        thirst: 0.2,
        nearestWatercourse: { range: 20_000 - i * 400, bearing: 1 },
      }), 0.25);
    }
    expect(brain.detourMission).toBe(first);
    expect(brain.goal).toBe('seek_water');
  });

  it('and does not oscillate between seeking and navigating', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      run(brain, sense({ thirst: 0.2 }), 0.25);
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
      const brain = new MissionBrain(fixedEta(5000), CFG);
      brain.order(waypoint());
      run(brain, sense({ thirst: 0.2 }), 3, step);
      goals.push(brain.goal);
    }
    expect(new Set(goals).size).toBe(1);
    expect(goals[0]).toBe('seek_water');
  });

  it('and one big step is not fifty decisions', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    brain.update(10, sense({ thirst: 0.2 }));
    expect(brain.goal).toBe('seek_water');
    // One transition, so one message — a tick-per-frame brain would
    // have queued dozens.
    expect(brain.takeNotice()).toBe('Very Thirsty! Stopping for water first.');
    expect(brain.takeNotice()).toBeNull();
  });
});

/**
 * THE ESTIMATOR SEAM — the architectural point of Phase 1.
 *
 * The brain must not know how far anything is or how fast she flies.
 * Phase 2 replaces the estimator with a wind- and terrain-aware planner
 * and NOT ONE THIRST RULE MAY CHANGE. These tests are what will catch
 * it if someone inlines the arithmetic back in.
 */
describe('the trip estimate is an input, not a calculation', () => {
  it('drives the decision purely from the estimator', () => {
    const seenFrom: WorldPoint[] = [];
    const spy: TripEstimator = (from) => {
      seenFrom.push(from);
      return { etaSeconds: 5000, distance: 1 };
    };
    const brain = new MissionBrain(spy, CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    expect(seenFrom.length).toBeGreaterThan(0);
    expect(brain.goal).toBe('seek_water');
  });

  it('so the SAME world with a different ETA decides differently', () => {
    const world = sense({ thirst: 0.2 });
    const patient = new MissionBrain(fixedEta(10), CFG);
    patient.order(waypoint());
    run(patient, world);

    const doomed = new MissionBrain(fixedEta(100_000), CFG);
    doomed.order(waypoint());
    run(doomed, world);

    // Identical senses, identical missions, identical config. Only the
    // estimator differs, and it alone decides.
    expect(patient.goal).toBe('navigate');
    expect(doomed.goal).toBe('seek_water');
  });

  it('and geometry alone cannot flip it', () => {
    // A destination on the far side of the island, but an estimator that
    // says it is quick: the brain must believe the estimator.
    const brain = new MissionBrain(fixedEta(1), CFG);
    brain.order(waypoint({ at: at(5_000_000, 5_000_000) }));
    run(brain, sense({ thirst: 0.15 }));
    expect(brain.goal).toBe('navigate');
  });

  it('and an unreachable route reads as unsafe rather than as fine', () => {
    const brain = new MissionBrain(
      () => ({ etaSeconds: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY }),
      CFG,
    );
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.9 }));
    expect(brain.goal).toBe('seek_water');
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
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    run(brain, sense({ thirst: 0.2, drinkable: true, act: 'drinking' }));
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
    const brain = new MissionBrain(fixedEta(5000), CFG);
    const A = waypoint();
    brain.order(A);
    run(brain, sense({ thirst: 0.2 }));
    expect(brain.intent.target).toEqual(brain.detourMission!.at);
    expect(brain.intent.target).not.toEqual(A.at);
  });

  it('and asks for a drink rather than a place once she is there', () => {
    const brain = new MissionBrain(fixedEta(5000), CFG);
    brain.order(waypoint());
    run(brain, sense({ thirst: 0.2 }));
    run(brain, sense({ thirst: 0.2, drinkable: true, act: 'drinking' }));
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
