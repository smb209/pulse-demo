import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BY_SYMBOL } from '../src/elements';
import { samplePreset } from '../src/chemistry';
import { createSim, captureFactor, bathEnergy, drawRadius, restLength } from '../src/sim';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSim(overrides: { seed?: number; preset?: string; cap?: number } = {}) {
  const rng = mulberry32(overrides.seed ?? 11);
  return createSim({
    width: 1000, height: 700, cap: overrides.cap ?? 120, temperature: 40,
    sampleElement: () => samplePreset(overrides.preset ?? 'seawater', rng),
    rng,
  });
}

// --- persistence (the feature's headline invariant) -----------------------

test('atoms persist: no decay, no spontaneous removal over 600 frames', () => {
  const sim = makeSim();
  sim.respawn();
  assert.equal(sim.atoms.length, 120);
  const ids = new Set(sim.atoms.map(a => a.id));
  for (let f = 0; f < 600; f++) sim.step();
  assert.equal(sim.atoms.length, 120, 'count unchanged');
  for (const a of sim.atoms) assert.ok(ids.has(a.id), 'same atoms, not replacements');
});

// --- cap enforcement --------------------------------------------------------

test('spawnTo never exceeds cap', () => {
  const sim = makeSim();
  sim.spawnTo(999);
  assert.equal(sim.atoms.length, 120);
});

test('burst below cap adds exactly what fits; at cap adds zero', () => {
  const sim = makeSim();
  sim.spawnTo(110);
  assert.equal(sim.burst(500, 350, 30), 10, 'only 10 slots left');
  assert.equal(sim.atoms.length, 120);
  assert.equal(sim.burst(500, 350, 30), 0, 'at cap');
  assert.equal(sim.atoms.length, 120);
});

test('setCap trims atoms and leaves no dangling bonds', () => {
  const sim = makeSim();
  sim.respawn();
  for (let f = 0; f < 400; f++) sim.step(); // let bonds form
  assert.ok(sim.bonds.length > 0, 'bonds formed during warmup');
  sim.setCap(60);
  assert.ok(sim.atoms.length <= 60);
  const alive = new Set(sim.atoms);
  for (const bd of sim.bonds) {
    assert.ok(alive.has(bd.a) && alive.has(bd.b), 'bond endpoints alive');
  }
  for (const a of sim.atoms) {
    for (const bd of a.bonds) assert.ok(sim.bonds.includes(bd), 'atom bond list consistent');
  }
});

// --- chemistry invariants under dynamics ------------------------------------

test('valence never exceeded, no duplicate pair bonds (1200 frames, seawater)', () => {
  const sim = makeSim({ seed: 23 });
  sim.respawn();
  for (let f = 0; f < 1200; f++) {
    sim.step();
    if (f % 200 === 0) {
      const s = sim.stats();
      assert.equal(s.overloaded, 0, `overloaded atom at frame ${f}`);
    }
  }
  const seen = new Set();
  for (const bd of sim.bonds) {
    const k = bd.a.id < bd.b.id ? `${bd.a.id}:${bd.b.id}` : `${bd.b.id}:${bd.a.id}`;
    assert.ok(!seen.has(k), 'duplicate bond between same atoms');
    seen.add(k);
  }
  assert.equal(sim.stats().overloaded, 0);
  assert.ok(sim.stats().maxLoadRatio <= 1);
});

test('bonds actually form at moderate temperature and correct pairs appear', () => {
  const sim = makeSim({ seed: 5 });
  sim.respawn();
  for (let f = 0; f < 2400; f++) sim.step();
  const s = sim.stats();
  assert.ok(s.bonds > 10, `expected a lively field, got ${s.bonds} bonds`);
  const pairs = Object.keys(s.byBondPair);
  assert.ok(pairs.every(k => ['H|O', 'H|H', 'O|O', 'Cl|Na', 'Cl|H', 'H|Na', 'Mg|O', 'O|S', 'Ca|O', 'H|Mg', 'H|K', 'K|O', 'Mg|S', 'Na|O', 'Cl|Mg', 'Cl|K', 'Cl|Ca', 'H|Ca', 'Ca|Mg', 'K|Na', 'Ca|Na', 'Ca|K', 'Mg|Na', 'K|Mg', 'Ca|Ca', 'K|K', 'Na|Na', 'Mg|Mg', 'S|S', 'H|S', 'Na|S', 'K|S', 'Ca|S'].includes(k)), `unexpected pair in ${pairs}`);
});

test('noble gases never bond under dynamics (sun preset: He present)', () => {
  const sim = makeSim({ preset: 'sun', seed: 9, cap: 200 });
  sim.respawn();
  for (let f = 0; f < 1200; f++) sim.step();
  const s = sim.stats();
  assert.ok((s.byElement.He ?? 0) > 0, 'He actually spawned');
  for (const k of Object.keys(s.byBondPair)) {
    assert.ok(!k.includes('He'), `helium bonded: ${k}`);
  }
});

// --- kinetics helpers ---------------------------------------------------------

test('captureFactor: 1 at rest, monotone decreasing in energy', () => {
  assert.ok(Math.abs(captureFactor(0, 400) - 1) < 1e-9);
  let prev = 2;
  for (const e of [10, 50, 200, 800, 3200]) {
    const c = captureFactor(e, 400);
    assert.ok(c < prev, `decreasing at ${e}`);
    prev = c;
  }
  assert.equal(captureFactor(100, 0), 0);
});

test('bathEnergy is quadratic in temperature and calibrated near 60 at T=40', () => {
  assert.ok(Math.abs(bathEnergy(40) - 60.8) < 1);
  assert.ok(Math.abs(bathEnergy(80) / bathEnergy(40) - 4) < 1e-9);
  assert.equal(bathEnergy(0), 0);
});

test('drawRadius and restLength scale with covalent radius', () => {
  const H = { el: BY_SYMBOL.H }, Cs = { el: BY_SYMBOL.Cs };
  assert.ok(drawRadius(BY_SYMBOL.Cs) > drawRadius(BY_SYMBOL.H) * 2);
  assert.ok(restLength(H, Cs) > restLength(H, H));
});
