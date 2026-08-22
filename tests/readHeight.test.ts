import { describe, expect, it } from 'vitest';
import { readHeight } from '../src/ui/FlightHud';

describe('reading a height back', () => {
  it('stays in centimetres while they still mean something', () => {
    expect(readHeight(10)).toBe('10 cm');
    expect(readHeight(82)).toBe('82 cm');
    expect(readHeight(99)).toBe('99 cm');
  });

  it('drops to millimetres down where an ant actually flies', () => {
    // One world unit is a centimetre, so whole centimetres turned the
    // entire takeoff and every hover into "0 cm".
    expect(readHeight(0)).toBe('0.0 mm');
    expect(readHeight(0.33)).toBe('3.3 mm');
    expect(readHeight(0.99)).toBe('9.9 mm');
    // And a tenth of a centimetre from there up to a body length or so.
    expect(readHeight(1)).toBe('1.0 cm');
    expect(readHeight(2.4)).toBe('2.4 cm');
    expect(readHeight(9.9)).toBe('9.9 cm');
  });

  it('turns over to metres at a hundred', () => {
    // The brief's own examples: 82 cm, 1.4 m, 12.7 m.
    expect(readHeight(100)).toBe('1.0 m');
    expect(readHeight(140)).toBe('1.4 m');
    expect(readHeight(1270)).toBe('12.7 m');
  });

  it('keeps the tenth a long way up, and drops it when it stops mattering', () => {
    expect(readHeight(1000)).toBe('10.0 m');
    expect(readHeight(4820)).toBe('48.2 m');
    // A hundred metres up, the tenth is only ever twitching.
    expect(readHeight(12_340)).toBe('123 m');
  });

  it('survives a negative, which is her below the ground she predicted', () => {
    expect(readHeight(-40)).toBe('-40 cm');
    expect(readHeight(-250)).toBe('-2.5 m');
  });
});
