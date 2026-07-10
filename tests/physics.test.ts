import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BY_SYMBOL } from '../src/elements';
import {
  cleaveCharges, neutralizeOnBond, maxIonCharge, bondFormProbability, samplePreset,
} from '../src/chemistry';
import {
  applyFormationEnergetics, applyBreakEnergetics, createSim, ENERGY_SCALE, EXO_FRACTION,
} from '../src/sim';

const el = (s: string) => BY_SYMBOL[s];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kinetic = (sym: string, vx = 0, vy = 0) => ({ el: el(sym), vx, vy });
const momentum = (...ps: { el: { mass: number }, vx: number, vy: number }[]) => ps.reduce(
  (m, p) => ({ x: m.x + p.el.mass * p.vx, y: m.y + p.el.mass * p.vy }), { x: 0, y: 0 });
const relKE = (a: ReturnType<typeof kinetic>, b: ReturnType<typeof kinetic>) => {
  const mu = (a.el.mass * b.el.mass) / (a.el.mass + b.el.mass);
  return 0.5 * mu * ((a.vx - b.vx) ** 2 + (a.vy - b.vy) ** 2);
};

// --- J6.1: momentum conservation ------------------------------------------------

test('formation energetics conserve momentum exactly (unequal masses)', () => {
  const h = kinetic('H', 1.2, -0.4), fe = kinetic('Fe', -0.1, 0.3);
  const before = momentum(h, fe);
  applyFormationEnergetics(h, fe, 409, mulberry32(5));
  const after = momentum(h, fe);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
});

test('break energetics conserve momentum exactly (unequal masses)', () => {
  const na = kinetic('Na', 2.0, 1.0), cl = kinetic('Cl', -1.5, 0.5);
  const before = momentum(na, cl);
  applyBreakEnergetics(na, cl, 787);
  const after = momentum(na, cl);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
});

// --- J6.2/6.3: energy direction -------------------------------------------------

test('formation is exothermic: relative KE increases by EXO_FRACTION·E (below cap)', () => {
  const fe = kinetic('Fe'), o = kinetic('O'); // heavy pair → Δv under the cap
  const before = relKE(fe, o);
  applyFormationEnergetics(fe, o, 409, mulberry32(7));
  const gained = relKE(fe, o) - before;
  assert.ok(Math.abs(gained - (409 / ENERGY_SCALE) * EXO_FRACTION) < 1e-6, `gained ${gained}`);
});

test('breaking is endothermic: relative KE decreases, floored at zero', () => {
  const h1 = kinetic('H', 3, 0), h2 = kinetic('H', -3, 0);
  const before = relKE(h1, h2);
  applyBreakEnergetics(h1, h2, 436);
  const after = relKE(h1, h2);
  assert.ok(after < before, 'consumed energy');
  assert.ok(Math.abs((before - after) - Math.min(before, 436 / ENERGY_SCALE)) < 1e-6);
  // slow pair: cannot go below zero relative KE
  const s1 = kinetic('H', 0.1, 0), s2 = kinetic('H', -0.1, 0);
  applyBreakEnergetics(s1, s2, 945);
  assert.ok(relKE(s1, s2) >= 0 && relKE(s1, s2) < 1e-9);
});

// --- J5: homolytic vs heterolytic cleavage ---------------------------------------

test('ionic pairs cleave heterolytically: Na+ / Cl−', () => {
  assert.deepEqual(cleaveCharges(el('Na'), el('Cl'), 0, 0), [1, -1]);
  assert.deepEqual(cleaveCharges(el('Cl'), el('Na'), 0, 0), [-1, 1], 'order-insensitive roles');
  assert.deepEqual(cleaveCharges(el('Mg'), el('O'), 0, 0), [1, -1]);
});

test('covalent and metallic pairs cleave homolytically: neutral radicals', () => {
  assert.deepEqual(cleaveCharges(el('O'), el('H'), 0, 0), [0, 0]); // ΔEN 1.24 < 1.7
  assert.deepEqual(cleaveCharges(el('N'), el('N'), 0, 0), [0, 0]);
  assert.deepEqual(cleaveCharges(el('Fe'), el('Ni'), 0, 0), [0, 0]);
});

test('ion charge caps: repeated cleaving cannot exceed typical ion charge', () => {
  assert.equal(maxIonCharge(el('Na')), 1);
  assert.equal(maxIonCharge(el('He')), 0);
  const [qNa] = cleaveCharges(el('Na'), el('Cl'), 1, 0); // Na already +1
  assert.equal(qNa, 1, 'no Na²⁺');
});

test('charge conservation through cleave and neutralize', () => {
  const [qa, qb] = cleaveCharges(el('K'), el('F'), 0, 0);
  assert.equal(qa + qb, 0);
  assert.deepEqual(neutralizeOnBond(1, -1), [0, 0]);
  assert.deepEqual(neutralizeOnBond(2, -1), [1, 0]);
  assert.deepEqual(neutralizeOnBond(1, 1), [1, 1], 'like charges untouched');
});

// --- J7: ion recombination is barrierless ----------------------------------------

test('oppositely charged ions skip the activation gate', () => {
  const cold = 2; // far too cold for activated formation
  const neutral = bondFormProbability(el('Na'), el('Cl'), cold, 0, 0, 0, 0);
  const ions = bondFormProbability(el('Na'), el('Cl'), cold, 0, 0, 1, -1);
  assert.ok(neutral < 1e-6, `neutral pair frozen out, got ${neutral}`);
  assert.ok(ions >= 0.6, `ion pair recombines, got ${ions}`);
});

// --- integration: charges + energetics under full dynamics ------------------------

test('salt-like field: heat creates ion pairs, net charge stays zero, valence holds', () => {
  const rng = mulberry32(13);
  const mix = () => (rng() < 0.5 ? el('Na') : el('Cl'));
  const sim = createSim({ width: 900, height: 700, cap: 150, temperature: 40, sampleElement: mix, rng });
  sim.spawnTo(150); // full density: this test asserts chemistry, not spawn policy
  for (let f = 0; f < 1800; f++) sim.step(); // settle: NaCl forms
  assert.ok(sim.stats().byBondPair['Cl|Na'] > 0, 'salt formed');
  sim.setTemperature(100);
  for (let f = 0; f < 1800; f++) sim.step(); // hot: heterolytic breaks
  const hot = sim.stats();
  assert.ok(hot.ions.positive > 0 && hot.ions.negative > 0, `ions exist when hot: ${JSON.stringify(hot.ions)}`);
  assert.equal(hot.ions.net, 0, 'charge conserved globally');
  assert.equal(hot.overloaded, 0);
  assert.ok(hot.meanSpeed < 30, `speeds bounded, got ${hot.meanSpeed}`);
});

test('detonate: breaks every bond, conserves momentum, ejects with bond energy (J16)', () => {
  const rng = mulberry32(19);
  const sim = createSim({
    width: 900, height: 700, cap: 150, temperature: 40,
    sampleElement: () => samplePreset('seawater', rng), rng,
  });
  sim.spawnTo(150);
  for (let f = 0; f < 1800; f++) sim.step();
  const bondsBefore = sim.bonds.length;
  assert.ok(bondsBefore > 20, `field settled with bonds, got ${bondsBefore}`);
  const speedBefore = sim.stats().meanSpeed;
  const pBefore = momentum(...sim.atoms);
  const broken = sim.detonate();
  const pAfter = momentum(...sim.atoms);
  assert.equal(broken, bondsBefore, 'every bond broken');
  assert.equal(sim.bonds.length, 0);
  assert.ok(Math.abs(pAfter.x - pBefore.x) < 1e-6 && Math.abs(pAfter.y - pBefore.y) < 1e-6, 'momentum conserved');
  assert.ok(sim.stats().meanSpeed > speedBefore * 2.5, `fragments FLY apart (J17): ${speedBefore} → ${sim.stats().meanSpeed}`);
  assert.equal(sim.stats().ions.net, 0, 'heterolytic charges balance');
  for (let f = 0; f < 900; f++) sim.step(); // past the re-bond cooldown
  assert.ok(sim.bonds.length > 0, 'field recovers after the cooldown');
});

test('regime stability: seawater at default temp stays in the v1 envelope despite exothermic kicks', () => {
  const rng = mulberry32(7);
  const sim = createSim({
    width: 1200, height: 800, cap: 250, temperature: 40,
    sampleElement: () => samplePreset('seawater', rng), rng,
  });
  sim.spawnTo(250); // full density: this test asserts chemistry, not spawn policy
  for (let f = 0; f < 3600; f++) sim.step();
  const s = sim.stats();
  assert.ok(s.bonds > 60 && s.bonds < 280, `settle bonds in envelope, got ${s.bonds}`);
  assert.ok(s.meanSpeed < 5, `thermalized, meanSpeed ${s.meanSpeed}`);
  assert.equal(s.overloaded, 0);
});

test('exothermic chain: H/O mix at moderate temp ignites (bond count grows fast)', () => {
  const rng = mulberry32(3);
  const mix = () => (rng() < 0.66 ? el('H') : el('O'));
  const sim = createSim({ width: 900, height: 700, cap: 200, temperature: 40, sampleElement: mix, rng });
  sim.spawnTo(200); // full density: this test asserts chemistry, not spawn policy
  for (let f = 0; f < 1200; f++) sim.step();
  const s = sim.stats();
  assert.ok(s.bonds > 40, `combustion products formed, got ${s.bonds}`);
  assert.ok((s.byBondPair['H|O'] ?? 0) > 0, 'water bonds present');
  assert.equal(s.overloaded, 0);
  assert.ok(s.meanSpeed < 30, `no runaway, meanSpeed ${s.meanSpeed}`);
});
