import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, samplePreset } from '../js/chemistry.js';
import { createSim } from '../js/sim.js';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Slice 3 wiring contract: a sim spawned through samplePreset reproduces the preset
// mix (the same math the UI's respawn path uses). Large cap to beat sampling noise.
test('sim respawn through each preset reproduces its mix within ±2pp (n=8000)', () => {
  for (const preset of PRESETS) {
    const rng = mulberry32(31);
    const sim = createSim({
      width: 1000, height: 700, cap: 8000, temperature: 40,
      sampleElement: () => samplePreset(preset.id, rng), rng,
    });
    sim.respawn();
    const s = sim.stats();
    assert.equal(s.atoms, 8000);
    for (const [sym, pct] of Object.entries(preset.mix)) {
      const got = ((s.byElement[sym] ?? 0) / 8000) * 100;
      assert.ok(Math.abs(got - pct) <= 2, `${preset.id}/${sym}: got ${got.toFixed(2)}, want ${pct}`);
    }
    for (const sym of Object.keys(s.byElement)) {
      assert.ok(preset.mix[sym] !== undefined, `${preset.id} spawned off-mix element ${sym}`);
    }
  }
});

test('burst draws from the active sampler (cap-guarded preset injection)', () => {
  const rng = mulberry32(3);
  const sim = createSim({
    width: 1000, height: 700, cap: 300, temperature: 40,
    sampleElement: () => samplePreset('sun', rng), rng,
  });
  sim.spawnTo(200);
  assert.equal(sim.burst(500, 350, 100), 100);
  const s = sim.stats();
  assert.equal(s.atoms, 300);
  // sun mix: everything spawned must be H/He/O/C/Fe/Ne, overwhelmingly H
  for (const sym of Object.keys(s.byElement)) {
    assert.ok(['H', 'He', 'O', 'C', 'Fe', 'Ne'].includes(sym), `off-mix ${sym}`);
  }
  assert.ok(s.byElement.H / s.atoms > 0.85);
});
