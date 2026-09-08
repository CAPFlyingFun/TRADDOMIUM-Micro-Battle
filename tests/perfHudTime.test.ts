// @vitest-environment jsdom
/**
 * THE TIME SLIDER (Joshua, 2026-09-08: "add a time slider from midnight
 * to midnight and for solo play, time can be changed, but live
 * multiplayer won't be").
 *
 * It exists because the island's sky is the island's REAL sky, and he
 * kept testing in the Hawaiian evening: a correct world at 3 a.m. is a
 * black screen, and the models he was looking for were in it.
 *
 * Three rules are pinned here. Midnight is at BOTH ends and is one
 * moment. In a room the control is disabled and says whose clock it is,
 * because a slider that moves without moving the sun is exactly what
 * §2.9 forbids. And whenever an hour is held, the sheet says `held`
 * beside the clock — the honesty that lets a held hour be a saved
 * setting at all, since the standing rule is that the sky is the
 * island's or it says so.
 */
import { describe, expect, it } from 'vitest';
import {
  HUD_HZ, PerfHud, TIME_STEP_HOURS, type PerfReadout, type TimeReadout, type WeatherReadout,
} from '../src/perf/PerfHud';
import { LayerToggles } from '../src/perf/layerToggles';
import { heldHourMs, kauaiClock, kauaiLocalHours } from '../src/world/weather/solar';

function readout(): PerfReadout {
  return {
    frame: { meanFps: 60, lowFps: 30, simDt: 1 / 60, frames: 120 },
    camera: { x: 1, y: 2, z: 3, facing: 0, pitch: 0, speed: 1000 },
    aboveGround: 320,
  };
}

const weather = (over: Partial<WeatherReadout> = {}): WeatherReadout => ({
  sky: 'clear', rainMmHr: 0, cloud: 0.1, source: 'live', clock: '19:40', sunElevationDeg: -8, ...over,
});

function rig(time: TimeReadout | null, sky: WeatherReadout = weather()) {
  const uiLayer = document.createElement('div');
  document.body.appendChild(uiLayer);
  const changes: Array<number | null> = [];
  const toggles = new LayerToggles([]);
  let current = time;
  const hud = new PerfHud(uiLayer, {
    layers: () => toggles.list(),
    onLayerToggle: () => {},
    weather: () => sky,
    ...(time === null ? {} : {
      time: () => current!,
      onTimeChange: (hour: number | null) => { changes.push(hour); },
    }),
  });
  const el = <T extends HTMLElement>(action: string): T | null =>
    uiLayer.querySelector<T>(`[data-action="${action}"]`);
  const field = (name: string): string | null =>
    uiLayer.querySelector<HTMLElement>(`[data-field="${name}"]`)?.textContent ?? null;
  return {
    hud, uiLayer, changes, field,
    slider: () => el<HTMLInputElement>('time'),
    live: () => el<HTMLButtonElement>('time-live'),
    set: (next: TimeReadout) => { current = next; },
    refresh: () => hud.update(readout(), HUD_HZ),
  };
}

const solo = (over: Partial<TimeReadout> = {}): TimeReadout =>
  ({ hour: 19.5, held: false, allowed: true, clock: '19:30', ...over });

describe('the time slider', () => {
  it('is absent entirely from a world with no sky to hold', () => {
    const r = rig(null);
    expect(r.slider()).toBeNull();
    expect(r.live()).toBeNull();
  });

  it('runs midnight to midnight in quarter hours', () => {
    const r = rig(solo());
    const slider = r.slider()!;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('24');
    expect(slider.step).toBe(String(TIME_STEP_HOURS));
    // 96 positions across the day: fine enough for dawn, coarse enough for a thumb.
    expect(24 / TIME_STEP_HOURS).toBe(96);
  });

  it('reports a drag, and folds the far end of the slider onto midnight', () => {
    const r = rig(solo());
    const slider = r.slider()!;
    slider.value = '13.25';
    slider.dispatchEvent(new Event('input'));
    expect(r.changes).toEqual([13.25]);
    // Both ends of the slider are the same moment.
    slider.value = '24';
    slider.dispatchEvent(new Event('change'));
    expect(r.changes[1]).toBe(0);
  });

  it('gives the island its clock back through LIVE, which is dead while nothing is held', () => {
    const r = rig(solo({ held: false }));
    r.refresh();
    expect(r.live()!.disabled).toBe(true);
    r.set(solo({ held: true, hour: 12, clock: '12:00' }));
    r.refresh();
    expect(r.live()!.disabled).toBe(false);
    r.live()!.dispatchEvent(new Event('click'));
    expect(r.changes).toEqual([null]);
  });

  it('says the time, and says HELD whenever the player is holding it', () => {
    const r = rig(solo({ held: false, clock: '19:30' }));
    r.refresh();
    expect(r.field('time-of-day')).toBe('time 19:30');
    r.set(solo({ held: true, hour: 12, clock: '12:00' }));
    r.refresh();
    expect(r.field('time-of-day')).toBe('time 12:00 held');
  });

  it('IN A ROOM the control is dead and says whose clock it is', () => {
    const r = rig(solo({ allowed: false, held: false, clock: '19:30' }));
    r.refresh();
    const slider = r.slider()!;
    expect(slider.disabled).toBe(true);
    expect(Number(slider.style.opacity)).toBeLessThan(1);
    expect(r.live()!.disabled).toBe(true);
    expect(r.field('time-of-day')).toContain("the room's");
    // And a drag that somehow reaches it changes nothing on the sheet's side.
    r.set(solo({ allowed: false, held: false, clock: '19:31' }));
    r.refresh();
    expect(r.slider()!.disabled).toBe(true);
  });

  it('follows the model, except under a finger: a refresh mid-drag does not fight the thumb', () => {
    const r = rig(solo({ hour: 6, clock: '06:00' }));
    r.refresh();
    expect(r.slider()!.value).toBe('6');

    // A finger is on it and the model has not caught up yet.
    const slider = r.slider()!;
    slider.value = '13';
    slider.dispatchEvent(new Event('input'));
    r.set(solo({ hour: 6, clock: '06:00' }));
    r.refresh();
    expect(slider.value).toBe('13');

    // Finger up: the model is authoritative again.
    slider.dispatchEvent(new Event('change'));
    r.set(solo({ hour: 13, held: true, clock: '13:00' }));
    r.refresh();
    expect(slider.value).toBe('13');
    r.set(solo({ hour: 6, held: true, clock: '06:00' }));
    r.refresh();
    expect(slider.value).toBe('6');
  });
});

describe('the clock line', () => {
  it('prints HELD beside the time, so a held sky is never mistaken for the island\'s', () => {
    const r = rig(solo(), weather({ clock: '12:00', sunElevationDeg: 72, heldTime: true }));
    r.refresh();
    expect(r.field('weather-clock')).toBe('12:00 held · sun 72° · live');
  });

  it('says nothing extra while the island keeps its own time', () => {
    const r = rig(solo(), weather({ clock: '19:40', sunElevationDeg: -8 }));
    r.refresh();
    expect(r.field('weather-clock')).toBe('19:40 · sun −8° · live');
  });
});

describe('heldHourMs: the one rule for an hour on the island', () => {
  // 2026-09-08 06:31 UTC is 20:31 the evening before, HST — which is
  // exactly when Joshua reported that the game was dark.
  const NIGHT = Date.UTC(2026, 8, 8, 6, 31);

  it('reads back as the hour asked for', () => {
    for (const hour of [0, 6, 12.25, 18.5, 23.75]) {
      expect(kauaiLocalHours(heldHourMs(NIGHT, hour))).toBeCloseTo(hour, 6);
    }
  });

  it('prints the wall clock the slider shows', () => {
    expect(kauaiClock(heldHourMs(NIGHT, 12))).toBe('12:00');
    expect(kauaiClock(heldHourMs(NIGHT, 13.25))).toBe('13:15');
    expect(kauaiClock(heldHourMs(NIGHT, 0))).toBe('00:00');
  });

  it('stays on the island\'s own day, not the UTC one', () => {
    // 20:31 HST on the 7th is already the 8th in UTC. Holding the hour
    // at noon must give the 7th's noon — the day the player is in.
    const noon = heldHourMs(NIGHT, 12);
    const onIsland = new Date(noon - 10 * 3_600_000);
    expect(onIsland.getUTCDate()).toBe(7);
    expect(noon).toBeLessThan(NIGHT);
  });

  it('wraps rather than throwing, so both ends of the slider are midnight', () => {
    expect(kauaiClock(heldHourMs(NIGHT, 24))).toBe('00:00');
    expect(heldHourMs(NIGHT, 24)).toBe(heldHourMs(NIGHT, 0));
    expect(kauaiClock(heldHourMs(NIGHT, -1))).toBe('23:00');
  });

  it('does not drift: the held moment is the same however long real time runs on', () => {
    const held = heldHourMs(NIGHT, 12);
    // Ten minutes later in the real world, the same hour of the same day.
    expect(heldHourMs(NIGHT + 600_000, 12)).toBe(held);
  });

  it('keeps the season: the same hour is a different Unix moment on a different day', () => {
    const june = Date.UTC(2026, 5, 8, 6, 31);
    expect(heldHourMs(june, 12)).not.toBe(heldHourMs(NIGHT, 12));
    expect(kauaiClock(heldHourMs(june, 12))).toBe('12:00');
  });
});
