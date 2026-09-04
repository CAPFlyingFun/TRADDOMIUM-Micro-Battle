/**
 * A spawned capsule is a valid ActorState from its first instant, and a
 * bad spawn is loud rather than mended.
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import { MAX_ACTOR_NAME, isActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { mintActorId, spawnCapsule } from '../src/actor/spawnCapsule';
import { ISLAND_SPAN, world } from '../src/world/coords';

const owner = playerId('device-1');

describe('spawnCapsule', () => {
  it('stands on the ground at the given point, facing +wz, and passes the snapshot guard', () => {
    const at = world(120, -40);
    const capsule = spawnCapsule(owner, 'Ant', '#ff8800', at);
    expect(isActorState(capsule)).toBe(true);
    expect(capsule).toMatchObject({ kind: 'capsule', owner, height: 0, heading: 0, color: '#ff8800', name: 'Ant' });
    expect(capsule.at).toEqual({ wx: 120, wz: -40 });
    // A fresh point: the spawn marker and the actor never share an object.
    expect(capsule.at).not.toBe(at);
  });

  it('mints a distinct id per spawn and honours one that is passed in', () => {
    const a = spawnCapsule(owner, 'Ant', '#ff8800', world(0, 0));
    const b = spawnCapsule(owner, 'Ant', '#ff8800', world(0, 0));
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
    expect(mintActorId()).not.toBe(mintActorId());
    const pinned = spawnCapsule(owner, 'Ant', '#ff8800', world(0, 0), actorId('bot-1'));
    expect(pinned.id).toBe('bot-1');
  });

  it('trims the name and lower-cases the colour — normalisation, not guessing', () => {
    const capsule = spawnCapsule(owner, '  Queen ', '#FFB400', world(0, 0));
    expect(capsule.name).toBe('Queen');
    expect(capsule.color).toBe('#ffb400');
  });

  it('refuses a name that would fail the guard', () => {
    expect(() => spawnCapsule(owner, '', '#ff8800', world(0, 0))).toThrow(/name/);
    expect(() => spawnCapsule(owner, '   ', '#ff8800', world(0, 0))).toThrow(/name/);
    expect(() => spawnCapsule(owner, 'x'.repeat(MAX_ACTOR_NAME + 1), '#ff8800', world(0, 0))).toThrow(/name/);
    expect(spawnCapsule(owner, 'x'.repeat(MAX_ACTOR_NAME), '#ff8800', world(0, 0)).name.length).toBe(MAX_ACTOR_NAME);
  });

  it('refuses a colour that is not #rrggbb', () => {
    for (const bad of ['orange', '#ff0', 'ff8800', '#ff88000', '#gg8800']) {
      expect(() => spawnCapsule(owner, 'Ant', bad, world(0, 0)), bad).toThrow(/colour/);
    }
  });

  it('refuses a position off the island or not a number', () => {
    expect(() => spawnCapsule(owner, 'Ant', '#ff8800', world(ISLAND_SPAN, 0))).toThrow(/island/);
    expect(() => spawnCapsule(owner, 'Ant', '#ff8800', world(0, Number.NaN))).toThrow(/island/);
    expect(isActorState(spawnCapsule(owner, 'Ant', '#ff8800', world(ISLAND_SPAN / 2, -ISLAND_SPAN / 2)))).toBe(true);
  });
});
