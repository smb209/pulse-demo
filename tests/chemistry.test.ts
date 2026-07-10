import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ELEMENTS, BY_SYMBOL } from '../src/elements';
import {
  affinity, classifyBond, bondEnergy, bondFormProbability, bondBreakProbability,
  maxBondOrder, pairKey, BOND_ENERGIES, PRESETS, PRESET_BY_ID, samplePreset,
  ACTIVATION_ENERGY, IONIC_EN_GAP,
} from '../src/chemistry';

const el = (s: string) => BY_SYMBOL[s];

// deterministic rng for sampler tests
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- element table integrity -------------------------------------------

test('82 elements, contiguous Z, unique symbols', () => {
  assert.equal(ELEMENTS.length, 82);
  ELEMENTS.forEach((e, i) => assert.equal(e.z, i + 1, `Z gap at index ${i} (${e.symbol})`));
  assert.equal(new Set(ELEMENTS.map(e => e.symbol)).size, 82);
  assert.equal(ELEMENTS[0].symbol, 'H');
  assert.equal(ELEMENTS[81].symbol, 'Pb');
});

test('element properties are physically sane', () => {
  for (const e of ELEMENTS) {
    assert.match(e.cpk, /^#[0-9A-F]{6}$/i, `${e.symbol} CPK color`);
    assert.ok(e.mass > 0 && e.mass < 210, `${e.symbol} mass`);
    assert.ok(e.radius >= 28 && e.radius <= 244, `${e.symbol} covalent radius`);
    assert.ok(Number.isInteger(e.maxBonds) && e.maxBonds >= 0 && e.maxBonds <= 4, `${e.symbol} maxBonds`);
    if (e.noble) {
      assert.equal(e.maxBonds, 0, `${e.symbol} noble maxBonds`);
      assert.equal(e.en, null, `${e.symbol} noble EN`);
    } else {
      assert.ok(e.en !== null && e.en > 0.5 && e.en < 4.1, `${e.symbol} electronegativity`);
    }
  }
  // masses monotone-ish sanity anchors
  assert.ok(el('Pb').mass > el('Fe').mass && el('Fe').mass > el('H').mass);
});

// --- affinity rules 1-5 (build plan D3) ----------------------------------

test('rule 1: noble gases bond with nothing', () => {
  for (const noble of ELEMENTS.filter(e => e.noble)) {
    for (const other of ELEMENTS) {
      assert.equal(affinity(noble, other), 0, `${noble.symbol}-${other.symbol}`);
      assert.equal(classifyBond(noble, other), 'none');
    }
  }
});

test('rule 2: exhausted valence blocks formation', () => {
  const H = el('H'), O = el('O');
  assert.ok(bondFormProbability(H, O, 100, 0, 0) > 0);
  assert.equal(bondFormProbability(H, O, 100, 1, 0), 0, 'H already has 1 bond');
  assert.equal(bondFormProbability(H, O, 100, 0, 2), 0, 'O already has 2 bonds');
});

test('rule 3: big-gap metal+nonmetal is ionic and strong', () => {
  assert.equal(classifyBond(el('Na'), el('Cl')), 'ionic');
  assert.equal(classifyBond(el('K'), el('F')), 'ionic');
  assert.ok(Math.abs(el('Na').en! - el('Cl').en!) >= IONIC_EN_GAP);
  assert.ok(affinity(el('Na'), el('Cl')) > affinity(el('Fe'), el('Ni')), 'ionic beats metallic');
});

test('rule 4: nonmetal pairs are covalent with positive affinity', () => {
  for (const [a, b] of [['O', 'H'], ['C', 'H'], ['N', 'N'], ['O', 'O'], ['C', 'O'], ['S', 'O']]) {
    assert.equal(['covalent'].includes(classifyBond(el(a), el(b))), true, `${a}-${b} type`);
    assert.ok(affinity(el(a), el(b)) > 0.3, `${a}-${b} affinity`);
  }
});

test('rule 5: metal-metal is weak clustering', () => {
  const fe = el('Fe'), ni = el('Ni'), mg = el('Mg');
  assert.equal(classifyBond(fe, ni), 'metallic');
  assert.ok(affinity(fe, ni) > 0 && affinity(fe, ni) < 0.3);
  assert.ok(affinity(fe, mg) < affinity(el('O'), el('H')));
});

test('affinity is symmetric and bounded 0..1', () => {
  const probes = ['H', 'O', 'N', 'C', 'Na', 'Cl', 'Fe', 'Si', 'Ar', 'Au', 'Pb'];
  for (const a of probes) for (const b of probes) {
    const f = affinity(el(a), el(b));
    assert.ok(f >= 0 && f <= 1, `${a}-${b} in range`);
    assert.equal(f, affinity(el(b), el(a)), `${a}-${b} symmetric`);
  }
});

// --- curated bond energies ----------------------------------------------

test('curated bond energies carry real values and sorted keys', () => {
  assert.equal(BOND_ENERGIES['N|N'], 945);
  assert.equal(BOND_ENERGIES['H|H'], 436);
  assert.equal(BOND_ENERGIES['H|O'], 463);
  for (const key of Object.keys(BOND_ENERGIES)) {
    const [x, y] = key.split('|');
    assert.ok(x <= y, `key ${key} sorted`);
    assert.ok(BY_SYMBOL[x] && BY_SYMBOL[y], `key ${key} symbols exist`);
  }
  assert.equal(bondEnergy(el('N'), el('N')), 945);
  assert.equal(bondEnergy(el('O'), el('H')), 463, 'pairKey order-insensitive');
});

test('bondEnergy positive for every bondable pair, zero for noble pairs', () => {
  for (const a of ELEMENTS) for (const b of ELEMENTS) {
    const e = bondEnergy(a, b);
    if (classifyBond(a, b) === 'none') assert.equal(e, 0);
    else assert.ok(e > 0, `${a.symbol}-${b.symbol}`);
  }
});

// --- energy gates ---------------------------------------------------------

test('formation probability is monotone increasing in energy', () => {
  const H = el('H'), O = el('O');
  let prev = 0;
  for (const e of [5, 20, 40, 80, 160, 320]) {
    const p = bondFormProbability(H, O, e);
    assert.ok(p > prev, `P(form) at ${e} kJ/mol`);
    prev = p;
  }
  assert.equal(bondFormProbability(H, O, 0), 0, 'zero energy → no activation');
});

test('break probability is monotone in energy and respects bond strength', () => {
  const N = el('N'), O = el('O'), H = el('H');
  let prev = 0;
  for (const e of [50, 100, 200, 400, 800]) {
    const p = bondBreakProbability(H, O, e);
    assert.ok(p > prev, `P(break) at ${e}`);
    prev = p;
  }
  // N≡N (945 kJ/mol) survives what shatters O-H (463) — the P4 scenario's mechanism
  for (const e of [100, 200, 400]) {
    assert.ok(bondBreakProbability(N, N, e) < bondBreakProbability(H, O, e), `N-N tougher at ${e}`);
  }
});

test('bond energy scales with order: a single N-N chain link is ~180, not 945', () => {
  const N = el('N'), O = el('O');
  const single = bondEnergy(N, N, 1);
  const triple = bondEnergy(N, N, 3);
  assert.equal(triple, 945);
  assert.ok(single > 150 && single < 220, `N-N single ${single}`);
  assert.ok(bondEnergy(O, O, 1) < bondEnergy(O, O, 2), 'O-O single weaker than double');
  // and therefore hot fields can actually shed chain links:
  assert.ok(
    bondBreakProbability(N, N, 300, 1) > bondBreakProbability(N, N, 300, 3) * 5,
    'order-1 N-N breaks far more readily than N≡N'
  );
  // omitted order defaults to full strength (backward compatible)
  assert.equal(bondEnergy(N, N), 945);
});

test('bond orders: N2 triple, O2 double, default single', () => {
  assert.equal(maxBondOrder(el('N'), el('N')), 3);
  assert.equal(maxBondOrder(el('O'), el('O')), 2);
  assert.equal(maxBondOrder(el('C'), el('O')), 2);
  assert.equal(maxBondOrder(el('H'), el('O')), 1);
  assert.equal(maxBondOrder(el('Na'), el('Cl')), 1);
});

// --- presets ---------------------------------------------------------------

test('five presets, all mixes sum to ~100%, all symbols real', () => {
  assert.equal(PRESETS.length, 5);
  const ids = PRESETS.map(p => p.id);
  assert.deepEqual(ids, ['atmosphere', 'sun', 'earth', 'body', 'seawater']);
  for (const p of PRESETS) {
    const sum = Object.values(p.mix).reduce((s, w) => s + w, 0);
    assert.ok(Math.abs(sum - 100) <= 0.5, `${p.id} sums to ${sum}`);
    for (const sym of Object.keys(p.mix)) assert.ok(BY_SYMBOL[sym], `${p.id}: ${sym}`);
  }
});

test('preset headline chemistry: dominant species match nature', () => {
  assert.ok(PRESET_BY_ID.atmosphere.mix.N > 75);
  assert.ok(PRESET_BY_ID.sun.mix.H > 90);
  assert.ok(PRESET_BY_ID.earth.mix.O > PRESET_BY_ID.earth.mix.Fe, 'bulk Earth is O-first by atoms');
  assert.ok(PRESET_BY_ID.body.mix.H > PRESET_BY_ID.body.mix.O);
  assert.ok(Math.abs(PRESET_BY_ID.seawater.mix.H / PRESET_BY_ID.seawater.mix.O - 2) < 0.1, 'seawater ~2:1 H:O');
});

test('sampler converges to the mix (n=10k, ±2pp)', () => {
  const rng = mulberry32(42);
  for (const p of PRESETS) {
    const n = 10000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const e = samplePreset(p.id, rng);
      counts[e.symbol] = (counts[e.symbol] ?? 0) + 1;
    }
    for (const [sym, pct] of Object.entries(p.mix)) {
      const got = ((counts[sym] ?? 0) / n) * 100;
      assert.ok(Math.abs(got - pct) <= 2, `${p.id}/${sym}: got ${got.toFixed(2)} want ${pct}`);
    }
    for (const sym of Object.keys(counts)) assert.ok(p.mix[sym] !== undefined, `${p.id} sampled outside mix: ${sym}`);
  }
});

test('sampler throws on unknown preset', () => {
  assert.throws(() => samplePreset('mars'), /unknown preset/);
});

test('activation energy is the documented constant', () => {
  assert.equal(ACTIVATION_ENERGY, 40);
});

test('pairKey sorts symbols', () => {
  assert.equal(pairKey(el('O'), el('H')), 'H|O');
  assert.equal(pairKey(el('H'), el('O')), 'H|O');
});
