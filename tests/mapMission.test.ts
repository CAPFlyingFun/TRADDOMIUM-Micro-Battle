/**
 * THE MAP CHOOSES WHERE. IT DOES NOT FLY HER THERE.
 *
 * Phase 1.5's whole shape is a split of responsibility, and a split
 * only exists if something holds it. The map picks a destination, the
 * MissionBrain remembers why and where, a Phase 2 executor that does
 * not exist yet will decide how, and Flight decides what physically
 * happens. Every test below is about one of the joints between those,
 * and most of them are about a joint that must NOT exist.
 *
 * The interesting ones are the negatives — the mission that a preview
 * must not create, the detour a waypoint must not cancel, the Flight
 * call the map must not make. A feature that half-works announces
 * itself; a boundary that has quietly stopped holding does not.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MissionBrain } from '../src/ant/autonomy/missionBrain';
import { straightLineTrip, type Mission } from '../src/ant/autonomy/mission';
import { AUTONOMY_DEFAULTS } from '../src/ant/autonomy/autonomyConfig';
import { clearTarget, canFly } from '../src/ui/MapScreen';
import { world, type WorldPoint } from '../src/world/coords';

/** The literal the scene builds from a tap. Kept in step with orderTo(). */
function waypoint(at: WorldPoint, label = 'waypoint'): Mission {
  return {
    id: `${label}:${Math.round(at.wx)},${Math.round(at.wz)}`,
    label,
    at,
    satisfies: [],
    arriveWithin: 500,
  };
}

const brainNow = (): MissionBrain =>
  new MissionBrain(straightLineTrip(40), AUTONOMY_DEFAULTS);

const THERE = world(1_200_000, -400_000);
const ELSEWHERE = world(-800_000, 900_000);

describe('a preview is not a mission', () => {
  it('costs nothing until FLY HERE is pressed', () => {
    // The tap that produces a preview marker reaches no brain at all —
    // MapScreen holds it and the scene is not told. This is the rule a
    // fat-fingered pan would otherwise break, and the reason the
    // confirm step exists rather than tapping being the commit.
    const brain = brainNow();
    expect(brain.primaryMission).toBeNull();
    expect(brain.goal).toBe('off');
  });

  it('and FLY HERE is the only thing that can be pressed to commit one', () => {
    // canFly gates the button on a preview EXISTING. No preview, no
    // confirm, so there is no path from an empty map to a mission.
    expect(canFly([])).toBe(false);
    expect(canFly([THERE])).toBe(true);
  });
});

describe('FLY HERE sets the primary mission', () => {
  it('and the pin is exactly the world point that was tapped', () => {
    const brain = brainNow();
    brain.order(waypoint(THERE));
    expect(brain.primaryMission?.at).toEqual(THERE);
    // Not a pixel, not a rounded cell — the world coordinate itself.
    expect(brain.primaryMission?.at.wx).toBe(1_200_000);
    expect(brain.primaryMission?.at.wz).toBe(-400_000);
  });

  it('and wakes a brain that was switched off', () => {
    const brain = brainNow();
    expect(brain.goal).toBe('off');
    brain.order(waypoint(THERE));
    expect(brain.goal).toBe('navigate');
  });

  it('and REPLACES an existing destination rather than queueing it', () => {
    // Phase 2 owns route chains. Phase 1.5 has exactly one pin, and
    // confirming a second is a change of mind, not a second leg.
    const brain = brainNow();
    brain.order(waypoint(THERE));
    brain.order(waypoint(ELSEWHERE));
    expect(brain.primaryMission?.at).toEqual(ELSEWHERE);
  });

  it('and never advertises that it satisfies thirst', () => {
    // THE TRAP. `thirstUnsafe` opens by returning false when the
    // primary satisfies hydration, so a waypoint tagged that way would
    // silently switch the whole survival-detour system off for as long
    // as the player's pin existed. The map passes an empty list and a
    // test says so out loud.
    expect(waypoint(THERE).satisfies).toEqual([]);
  });
});

describe('the player pin and a survival detour stay separate', () => {
  it('are two fields, and the active one is the detour when there is one', () => {
    const brain = brainNow();
    brain.order(waypoint(THERE));
    expect(brain.primaryMission?.at).toEqual(THERE);
    expect(brain.detourMission).toBeNull();
    // The map draws primaryMission. `active` is what she is SERVING,
    // which is a different question and the reason the map must not
    // read it — a thirsty queen would watch her gold pin jump to a
    // puddle and jump back.
    expect(brain.active).toBe(brain.primaryMission);
  });

  it('and ordering a new waypoint does not cancel a live detour', () => {
    // order() replaces the primary and leaves the detour running, by
    // design: she still needs the drink she set off for.
    const brain = brainNow();
    brain.order(waypoint(THERE));
    brain.order(waypoint(ELSEWHERE));
    expect(brain.detourMission).toBeNull();
    expect(brain.primaryMission?.at).toEqual(ELSEWHERE);
  });
});

describe('CLEAR takes the one thing it says it will', () => {
  it('prefers the preview while there is one', () => {
    expect(clearTarget([THERE], null)).toBe('preview');
    expect(clearTarget([THERE], ELSEWHERE)).toBe('preview');
  });

  it('falls to the mission only when no preview is held', () => {
    expect(clearTarget([], ELSEWHERE)).toBe('mission');
  });

  it('and does nothing at all when there is neither', () => {
    expect(clearTarget([], null)).toBe('none');
  });

  it('cancelling the mission leaves the meters alone', () => {
    // cancel() is the brain's own door and touches missions only. The
    // map has no other way to reach the autonomy, so there is nothing
    // it could clear by accident — but the day cancel() grows a side
    // effect, this is what notices.
    const brain = brainNow();
    brain.order(waypoint(THERE));
    brain.cancel();
    expect(brain.primaryMission).toBeNull();
    expect(brain.detourMission).toBeNull();
    expect(brain.goal).toBe('off');
  });
});

/**
 * THE BOUNDARY, CHECKED IN THE SOURCE ITSELF.
 *
 * These cannot be exercised at runtime without a DOM, and they are
 * exactly the rules that would rot silently — a later card adds "just
 * a small nudge" from the map and the architecture is gone with no
 * failing test. So they are read off the files.
 */
describe('the map cannot touch the queen', () => {
  const MAP_FILES = ['src/ui/MapScreen.ts', 'src/ui/Minimap.ts', 'src/ui/mapView.ts'];
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('never imports the flight model', () => {
    for (const path of MAP_FILES) {
      expect(read(path), path).not.toContain("from '../ant/flight'");
      expect(read(path), path).not.toContain('ant/flight');
    }
  });

  it('never writes a position, a velocity or a heading', () => {
    // Phase 2 is the autopilot. Until it exists nothing on the map may
    // move her, and when it does exist it will not live in a UI file.
    for (const path of MAP_FILES) {
      const src = read(path);
      for (const forbidden of [
        '.placeAt(', '.velocity', '.position =', 'ant.place', '.setYaw(', '.face(',
      ]) {
        expect(src, `${path} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never reaches the mission brain directly', () => {
    // The scene owns that wiring, through hooks. A map that could
    // order its own missions would be a second place destinations are
    // decided.
    for (const path of MAP_FILES) {
      expect(read(path), path).not.toContain('missionBrain');
      expect(read(path), path).not.toContain('.order(');
    }
  });

  it('and binds no listener to window or document', () => {
    // MoveStick, LookDrag, PaceSelector and LiftSlider all hold global
    // keyboard listeners that ignore focus, and LookDrag holds a
    // global pointer surface. A second global handler on top of that
    // is how a control stops responding for reasons nobody can find.
    for (const path of MAP_FILES) {
      const src = read(path);
      expect(src, path).not.toMatch(/window\.addEventListener/);
      expect(src, path).not.toMatch(/document\.addEventListener/);
    }
  });
});

describe('the scene keeps its side of the split', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');

  it('draws the pin from the primary mission, never from the active one', () => {
    expect(scene).toContain('primary: this.brain.primaryMission?.at ?? null');
    // `intent().target` and `debug().target` both follow the detour.
    expect(scene).not.toContain('primary: this.brain.active');
  });

  it('routes both menus through one decision about what a pause costs', () => {
    // Solo halts the tick; multiplayer only takes her hands. If either
    // door ever sets `halted` directly again, the two drift apart and
    // one of them starts lying about what stopped.
    expect(scene).toContain('private shroud(open: boolean): void');
    expect(scene).toContain('this.halted = open && this.mode === \'solo\'');
    const raw = scene.match(/this\.halted\s*=(?!=)/g) ?? [];
    expect(raw.length, 'halted is written in exactly one place').toBe(1);
  });

  it('reads the stick and the look every frame even when discarding them', () => {
    // Both read() calls mutate: one decays the swing, the other clears
    // the lift edge and repaints the ring. Skipping them banks a frame
    // of input to be applied on resume — the lurch the pause exists to
    // prevent.
    const tick = scene.slice(scene.indexOf('const look = this.look.read(dt)'));
    expect(tick.slice(0, 200)).toContain('const held = this.stick.read()');
    expect(scene).toContain('this.handsOff');
  });

  it('holds station in the air rather than gliding out of the sky', () => {
    // A neutral demand is a glide that becomes a fall, so a player who
    // opens the map mid-flight in multiplayer would land somewhere
    // nobody chose. HOVER_HOLD is the smallest airspeed that still
    // counts as powered flight.
    expect(scene).toContain('hold: this.handsOff ? HOVER_HOLD');
  });
});

/**
 * A MAP THAT FORGETS IS NOT A MAP.
 *
 * Joshua, 2026-08-31: "does the map retain the unlocked areas or does
 * it reset each time or if you die? It should automatically save during
 * exploration/save/resume."
 *
 * It did retain across save and resume, and it had three holes:
 * exploring never triggered a save of its own, quitting walked away
 * from up to a minute of simulated time, and dying did too. These read
 * the wiring off the source, because the scene needs a WebGL context
 * and this suite has no DOM.
 */
describe('the map she has opened up outlives the moment', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
  const flow = readFileSync('src/ui/GameFlow.ts', 'utf8');

  it('rides in the save, and comes back out of it', () => {
    expect(scene).toContain('discovery: encodeDiscovery(this.known)');
    expect(scene).toContain('decodeDiscovery(save.discovery) ?? emptyDiscovery()');
  });

  it('brings the next save forward when she finds new ground', () => {
    // The autosave is 60 SIMULATED seconds apart and a minute of flying
    // is about four kilometres of new coast. New cells pull the
    // ordinary clock forward rather than starting a second one.
    expect(scene).toContain('DISCOVERY_SAVE');
    expect(scene).toContain('if (reveal(this.known, her.wx, her.wz) > 0)');
  });

  it('writes once more on the way out of a run', () => {
    // QUIT and DEATH both used to walk away from up to a minute.
    expect(scene).toContain('private partingSave()');
    expect(scene).toContain('quit: () => { this.partingSave(); this.leaving?.(); }');
    const kill = scene.slice(scene.indexOf('  kill(): void {'));
    expect(kill.slice(0, 400)).toContain('this.partingSave();');
  });

  it('and a dead queen hands her chart to the next one', () => {
    // CLAUDE.md's premise: individual ants die, the colony continues.
    // Card 10: discovery is what this PLAYER knows. So a death costs a
    // life and not a map.
    expect(scene).toContain('inheritDiscovery(blob: string | undefined)');
    expect(flow).toContain('this.carried = latestSave(localStorage)?.discovery');
    expect(flow).toContain('else if (this.carried) scene.inheritDiscovery(this.carried)');
  });

  it('but NEW COLONY from the front door starts blank', () => {
    // A deliberate fresh start is a fresh start. The carry is cleared
    // when the menu opens and spent the moment it is used, so it can
    // only ever cross the death door.
    const menu = flow.slice(flow.indexOf('  toMenu(): void {'));
    expect(menu.slice(0, 200)).toContain('this.carried = undefined;');
    expect(flow).toContain('this.carried = undefined;');
  });
});
