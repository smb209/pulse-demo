import { describe, it, expect } from 'vitest';
import { makeEmptyLevel, validateLevel, newId } from './levelStore';
import { LEVELS } from './content';

describe('levelStore', () => {
  it('makeEmptyLevel produces a valid, complete level', () => {
    const l = makeEmptyLevel();
    expect(validateLevel(l)).toBeNull();
    expect(l.emitters.length).toBeGreaterThan(0);
    expect(l.zones.length).toBeGreaterThan(0);
    expect(l.objective.formula).toBeTruthy();
  });

  it('newId is unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });

  it('validateLevel rejects malformed input', () => {
    expect(validateLevel(null)).toMatch(/level object/i);
    expect(validateLevel({ id: 'x', name: 'y', emitters: [], zones: [], objective: { formula: 'H2' } })).toMatch(/emitter/i);
    expect(validateLevel({ id: 'x', name: 'y', emitters: [{}], zones: [], objective: { formula: 'H2' } })).toMatch(/zone/i);
    expect(validateLevel({ id: 'x', name: 'y', emitters: [{}], zones: [{}] })).toMatch(/objective/i);
  });

  it('the built-in campaign levels round-trip through JSON and stay valid', () => {
    for (const lvl of LEVELS) {
      const clone = JSON.parse(JSON.stringify(lvl));
      expect(validateLevel(clone)).toBeNull();
    }
  });
});
