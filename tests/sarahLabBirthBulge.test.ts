import { describe, expect, it } from 'vitest';
import { birthBulgeLine, birthOpenLine } from '../src/sarahlab/sarahLabTool';

// The birth bulge is its own slider (Joshua, 2026-11-02): the opening no longer pushes the area out by itself.
describe('birth bulge line', () => {
  it('reads none at zero and centimetres out otherwise', () => {
    expect(birthBulgeLine(0)).toBe('BIRTH BULGE · none');
    expect(birthBulgeLine(50, 5)).toBe('BIRTH BULGE 50% · 2.5 cm out');
    expect(birthBulgeLine(100, 5)).toBe('BIRTH BULGE 100% · 5.0 cm out');
  });
  it('clamps to the slider range', () => {
    expect(birthBulgeLine(-4)).toBe('BIRTH BULGE · none');
    expect(birthBulgeLine(140, 5)).toBe('BIRTH BULGE 100% · 5.0 cm out');
  });
  it('leaves the opening line as it was', () => {
    expect(birthOpenLine(100)).toBe('BIRTH OPENING 100% · 10.0 cm across');
  });
});
