import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BY_SYMBOL } from '../src/elements';
import { samplePreset, PRESET_BY_ID } from '../src/chemistry';
import { createSim } from '../src/sim';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('burst element override injects that element only, still cap-guarded (J9)', () => {
  const rng = mulberry32(4);
  const sim = createSim({
    width: 900, height: 700, cap: 150, temperature: 40,
    sampleElement: () => samplePreset('sun', rng), rng,
  });
  sim.spawnTo(100);
  const added = sim.burst(450, 350, 40, BY_SYMBOL.O);
  assert.equal(added, 40);
  const s = sim.stats();
  assert.equal(s.byElement.O, 40, 'exactly the injected oxygens');
  assert.equal(sim.burst(450, 350, 40, BY_SYMBOL.O), 10, 'cap guard still applies');
  assert.equal(sim.stats().atoms, 150);
});

test('reactive presets behave as designed: salt makes NaCl, burn makes water/CO-family', () => {
  for (const [presetId, expectPair] of [['salt', 'Cl|Na'], ['burn', 'H|O']] as const) {
    const rng = mulberry32(17);
    const sim = createSim({
      width: 900, height: 700, cap: 200, temperature: 40,
      sampleElement: () => samplePreset(presetId, rng), rng,
    });
    sim.respawn();
    for (let f = 0; f < 2400; f++) sim.step();
    const s = sim.stats();
    assert.ok((s.byBondPair[expectPair] ?? 0) > 0, `${presetId}: expected ${expectPair}, got ${JSON.stringify(s.byBondPair)}`);
    assert.equal(s.overloaded, 0);
  }
});

test('reactive presets are livelier than Air at equal settle time (the J8 point)', () => {
  const settleBonds = (presetId: string) => {
    const rng = mulberry32(29);
    const sim = createSim({
      width: 900, height: 700, cap: 200, temperature: 40,
      sampleElement: () => samplePreset(presetId, rng), rng,
    });
    sim.respawn();
    for (let f = 0; f < 900; f++) sim.step(); // short window: measures reaction SPEED
    return sim.stats().bonds;
  };
  const air = settleBonds('atmosphere');
  const burn = settleBonds('burn');
  assert.ok(burn > air, `burn (${burn}) should outpace air (${air}) early`);
});

test('soup preset spawns only its mix and builds organics', () => {
  const rng = mulberry32(41);
  const sim = createSim({
    width: 900, height: 700, cap: 200, temperature: 40,
    sampleElement: () => samplePreset('soup', rng), rng,
  });
  sim.respawn();
  for (let f = 0; f < 2400; f++) sim.step();
  const s = sim.stats();
  for (const sym of Object.keys(s.byElement)) {
    assert.ok(PRESET_BY_ID.soup.mix[sym] !== undefined, `off-mix ${sym}`);
  }
  assert.ok((s.byBondPair['C|H'] ?? 0) + (s.byBondPair['C|O'] ?? 0) + (s.byBondPair['C|N'] ?? 0) > 0, 'carbon chemistry present');
});
