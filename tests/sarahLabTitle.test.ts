import { describe, expect, it } from 'vitest';
import { labTitle } from '../src/sarahlab/sarahLabTool';

describe('the Character Lab header names its build (Joshua, 2026-10-25)', () => {
  it('reads an alpha as v0.N, the way he wrote it', () => {
    expect(labTitle('1.0.0-alpha.127')).toBe('CHARACTER LAB v0.127');
    expect(labTitle('1.0.0-alpha.9')).toBe('CHARACTER LAB v0.9');
  });
  it('shows any other version as it is, and no number when the build has none', () => {
    expect(labTitle('1.2.0')).toBe('CHARACTER LAB v1.2.0');
    expect(labTitle('unversioned')).toBe('CHARACTER LAB');
    expect(labTitle('')).toBe('CHARACTER LAB');
  });
});
