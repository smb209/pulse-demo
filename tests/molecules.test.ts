import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BY_SYMBOL } from '../src/elements';
import { analyzeMolecules, formulaOf, KNOWN_MOLECULES } from '../src/chemistry';

// hand-built graphs: atoms are plain {el} objects, bonds {a, b, order}
const atom = (sym: string) => ({ el: BY_SYMBOL[sym] });
type TestAtom = ReturnType<typeof atom>;
const bond = (a: TestAtom, b: TestAtom, order = 1) => ({ a, b, order });

test('H-O-H is recognized as H₂O', () => {
  const O = atom('O'), h1 = atom('H'), h2 = atom('H');
  const r = analyzeMolecules([bond(h1, O), bond(h2, O)]);
  assert.deepEqual(r.molecules, { 'H₂O': 1 });
  assert.equal(r.named, 1);
  assert.equal(r.components, 1);
});

test('H-O-O-H is H₂O₂, NOT water', () => {
  const o1 = atom('O'), o2 = atom('O'), h1 = atom('H'), h2 = atom('H');
  const r = analyzeMolecules([bond(h1, o1), bond(o1, o2), bond(o2, h2)]);
  assert.deepEqual(r.molecules, { 'H₂O₂': 1 });
  assert.ok(!('H₂O' in r.molecules), 'no false water');
});

test('O=C=O is CO₂ (Hill order: C before O)', () => {
  const C = atom('C'), o1 = atom('O'), o2 = atom('O');
  const r = analyzeMolecules([bond(o1, C, 2), bond(o2, C, 2)]);
  assert.deepEqual(r.molecules, { 'CO₂': 1 });
});

test('N≡N is N₂; two separate H-H are H₂ ×2', () => {
  const n1 = atom('N'), n2 = atom('N');
  assert.deepEqual(analyzeMolecules([bond(n1, n2, 3)]).molecules, { 'N₂': 1 });
  const r = analyzeMolecules([
    bond(atom('H'), atom('H')),
    bond(atom('H'), atom('H')),
  ]);
  assert.deepEqual(r.molecules, { 'H₂': 2 });
  assert.equal(r.components, 2);
});

test('Na-Cl displays as NaCl despite alphabetical canonical form', () => {
  const r = analyzeMolecules([bond(atom('Na'), atom('Cl'))]);
  assert.deepEqual(r.molecules, { 'NaCl': 1 });
  assert.equal(KNOWN_MOLECULES['ClNa'], 'NaCl');
});

test('CH₄: carbon with four hydrogens', () => {
  const C = atom('C');
  const r = analyzeMolecules(['H', 'H', 'H', 'H'].map(s => bond(atom(s), C)));
  assert.deepEqual(r.molecules, { 'CH₄': 1 });
});

test('unknown clusters fall back to a Hill formula, counted but unnamed', () => {
  const fe1 = atom('Fe'), fe2 = atom('Fe'), O = atom('O');
  const r = analyzeMolecules([bond(fe1, O), bond(fe2, O)]);
  assert.deepEqual(r.molecules, { 'Fe₂O': 1 });
  assert.equal(r.named, 0);
  assert.equal(r.components, 1);
});

test('free atoms are not components; empty bond list is empty result', () => {
  const r = analyzeMolecules([]);
  assert.deepEqual(r.molecules, {});
  assert.equal(r.components, 0);
});

test('mixed field: multiple molecule species counted independently', () => {
  const O = atom('O'), h1 = atom('H'), h2 = atom('H');
  const n1 = atom('N'), n2 = atom('N');
  const na = atom('Na'), cl = atom('Cl');
  const r = analyzeMolecules([
    bond(h1, O), bond(h2, O),
    bond(n1, n2, 3),
    bond(na, cl),
  ]);
  assert.deepEqual(r.molecules, { 'H₂O': 1, 'N₂': 1, 'NaCl': 1 });
  assert.equal(r.named, 3);
});

test('formulaOf: Hill ordering with unicode subscripts', () => {
  assert.equal(formulaOf({ C: 1, H: 4 }), 'CH₄');
  assert.equal(formulaOf({ O: 2, C: 1 }), 'CO₂');
  assert.equal(formulaOf({ H: 2, O: 1 }), 'H₂O');
  assert.equal(formulaOf({ Cl: 1, Na: 1 }), 'ClNa');
  assert.equal(formulaOf({ Si: 1, O: 2 }), 'O₂Si');
});
