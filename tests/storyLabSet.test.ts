/**
 * THE STORY LAB'S SET: nobody and nothing stands in the furniture. The
 * chair's whole base and Sarah's feet are on the aisle's floor, the push-in
 * ends inside the room looking at Jack, and the wide is the picture's
 * camera.
 */
import { describe, expect, it } from 'vitest';
import {
  AISLE, CHAIR_FOOTPRINT, CLOSE_ON_JACK, JACK_CHAIR, JACK_HEAD_SEATED, PICTURE_CAMERA, ROOM, SARAH_STAND, WIDE, onAisle,
} from '../src/storylab/storyLabSet';

describe('storyLabSet', () => {
  it("Jack's chair stands wholly on the aisle, clear of both runs of cabinets and the desk", () => {
    expect(onAisle(JACK_CHAIR.at, CHAIR_FOOTPRINT)).toBe(true);
    expect(JACK_CHAIR.at[0] - CHAIR_FOOTPRINT).toBeGreaterThanOrEqual(AISLE.left);
    expect(JACK_CHAIR.at[2] - CHAIR_FOOTPRINT).toBeGreaterThanOrEqual(AISLE.deskFront);
  });

  it('the old placement, stage (720, 1200) taken literally, would have been in the cabinets', () => {
    expect(onAisle([-0.43, 0, -3.05], CHAIR_FOOTPRINT)).toBe(false);
  });

  it('Sarah stands on the aisle, and does not stand in the chair', () => {
    expect(onAisle(SARAH_STAND.at, 0.2)).toBe(true);
    const d = Math.hypot(SARAH_STAND.at[0] - JACK_CHAIR.at[0], SARAH_STAND.at[2] - JACK_CHAIR.at[2]);
    expect(d).toBeGreaterThan(CHAIR_FOOTPRINT + 0.25);
  });

  it('WIDE is the picture camera, and PUSH IN ends inside the room looking at Jack', () => {
    expect(WIDE.position).toEqual(PICTURE_CAMERA.position);
    const p = CLOSE_ON_JACK.position;
    expect(p[0]).toBeGreaterThan(ROOM.xl);
    expect(p[0]).toBeLessThan(ROOM.xr);
    expect(p[2]).toBeGreaterThan(ROOM.zBack);
    expect(p[2]).toBeLessThan(0);
    expect(CLOSE_ON_JACK.target).toEqual(JACK_HEAD_SEATED);
  });
});
