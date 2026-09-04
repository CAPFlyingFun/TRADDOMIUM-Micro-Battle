import { describe, expect, it } from 'vitest';
import { AppStateMachine, canTransition, type AppState } from '../src/app/AppState';

describe('AppState transitions', () => {
  it('walks the front-door path boot → menu → session → loading → playing → paused → playing', () => {
    const sm = new AppStateMachine();
    expect(sm.get()).toBe('boot');
    for (const next of ['menu', 'session', 'loading', 'playing', 'paused', 'playing'] as const) {
      sm.set(next);
      expect(sm.get()).toBe(next);
    }
  });

  it('throws on an illegal transition and keeps the old state', () => {
    const sm = new AppStateMachine();
    expect(() => sm.set('playing')).toThrow(/illegal transition boot → playing/);
    expect(sm.get()).toBe('boot');
  });

  it('lets every state fall back to the menu (the SceneManager fallback lands there)', () => {
    const states: AppState[] = ['boot', 'session', 'loading', 'playing', 'paused'];
    for (const from of states) expect(canTransition(from, 'menu')).toBe(true);
  });

  it('allows re-asserting the current state without notifying listeners', () => {
    const sm = new AppStateMachine('menu');
    let calls = 0;
    sm.onChange(() => calls++);
    sm.set('menu');
    expect(calls).toBe(0);
    sm.set('session');
    expect(calls).toBe(1);
  });

  it('notifies listeners with (next, prev) and honours unsubscribe', () => {
    const sm = new AppStateMachine('boot');
    const seen: string[] = [];
    const off = sm.onChange((next, prev) => seen.push(`${prev}>${next}`));
    sm.set('menu');
    off();
    sm.set('session');
    expect(seen).toEqual(['boot>menu']);
  });
});
