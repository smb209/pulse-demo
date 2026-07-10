// Pure bonding logic + preset distributions. No DOM, no canvas — unit-tested under vitest.
// Model per build plan D3: property-derived pair affinity (rules 1-5) with a curated
// override table of real bond energies, energy-gated in both directions (Boltzmann-flavored).
// Energies are kJ/mol throughout; the sim maps kinetic energy into this scale (ENERGY_SCALE in sim.ts).

import { BY_SYMBOL, type ChemElement } from './elements';

export type BondType = 'none' | 'ionic' | 'covalent' | 'metallic';
export type Rng = () => number;

// --- pair affinity -----------------------------------------------------

export const IONIC_EN_GAP = 1.7;

export function pairKey(a: ChemElement, b: ChemElement): string {
  return a.symbol < b.symbol ? `${a.symbol}|${b.symbol}` : `${b.symbol}|${a.symbol}`;
}

// Real bond (dissociation / lattice-representative) energies, kJ/mol.
// These pairs are the "famous chemistry" the presets should reliably produce.
export const BOND_ENERGIES: Record<string, number> = {
  'H|H': 436, 'O|O': 498, 'N|N': 945, 'H|O': 463, 'C|H': 413, 'C|O': 799,
  'Cl|Na': 787, 'O|Si': 452, 'Fe|O': 409, 'Cl|H': 431, 'C|C': 347,
  'O|S': 522, 'Mg|O': 394, 'Ca|O': 402, 'Al|O': 512, 'C|N': 305,
};

// Bond type under the general rules. 'none' when no bond can ever form.
export function classifyBond(a: ChemElement, b: ChemElement): BondType {
  if (a.noble || b.noble) return 'none';
  if (a.maxBonds === 0 || b.maxBonds === 0) return 'none';
  const gap = Math.abs((a.en ?? 0) - (b.en ?? 0));
  if (a.metal !== b.metal && gap >= IONIC_EN_GAP) return 'ionic';
  if (!a.metal && !b.metal) return 'covalent';
  if (a.metal && b.metal) return 'metallic';
  // metal + nonmetal below the ionic gap: polar-covalent-ish, treat as covalent
  return 'covalent';
}

// Intrinsic affinity 0..1 — "how much these two want each other," before energy gating.
export function affinity(a: ChemElement, b: ChemElement): number {
  const type = classifyBond(a, b);
  if (type === 'none') return 0;
  if (BOND_ENERGIES[pairKey(a, b)]) {
    // curated pairs: scale with real bond energy, floor high enough to dominate
    return Math.min(1, 0.55 + BOND_ENERGIES[pairKey(a, b)] / 2000);
  }
  const gap = Math.abs((a.en ?? 0) - (b.en ?? 0));
  if (type === 'ionic') {
    // stronger pull with bigger electronegativity gap (max plausible gap ~3.2)
    return Math.min(1, 0.35 + (gap - IONIC_EN_GAP) / 3);
  }
  if (type === 'metallic') return 0.15;
  // covalent: likelier when both partners are electron-hungry and well matched
  const avgEn = ((a.en ?? 0) + (b.en ?? 0)) / 2;
  const match = Math.max(0, (3.5 - gap) / 3.5);
  const hunger = Math.max(0, Math.min(1, (avgEn - 1.4) / 2.0));
  return 0.6 * match * hunger;
}

// Bond energy for a bondable pair (kJ/mol): curated value or a type-derived estimate.
// Curated energies describe the pair's FULL bond (N≡N 945, O=O 498); a lower-order bond
// is weaker: E(order) = E_full · (order/maxOrder)^1.5. That puts an N–N single at ~182
// (real: ~160) and an O–O single at ~176 (real: ~146) — without it, order-1 chain links
// inherit the triple-bond energy and hot fields accrete unbreakable N-blobs.
export function bondEnergy(a: ChemElement, b: ChemElement, order?: number): number {
  const type = classifyBond(a, b);
  if (type === 'none') return 0;
  const full = maxBondOrder(a, b);
  const scale = order ? Math.pow(Math.min(order, full) / full, 1.5) : 1;
  const curated = BOND_ENERGIES[pairKey(a, b)];
  if (curated) return curated * scale;
  const gap = Math.abs((a.en ?? 0) - (b.en ?? 0));
  if (type === 'ionic') return (300 + 120 * (gap - IONIC_EN_GAP)) * scale;
  if (type === 'metallic') return 110 * scale;
  return (180 + 90 * (((a.en ?? 0) + (b.en ?? 0)) / 2)) * scale;
}

// --- energy gates ------------------------------------------------------

export const ACTIVATION_ENERGY = 40; // kJ/mol — approach energy needed to react at all

// P(form) per candidate encounter. eRel = relative kinetic energy of the pair, kJ/mol scale.
// Monotone increasing in eRel; 0 for incompatible pairs or exhausted valence.
// Oppositely charged ions recombine barrierlessly (no activation term) — J7.
export function bondFormProbability(a: ChemElement, b: ChemElement, eRel: number, bondsA = 0, bondsB = 0, qa = 0, qb = 0): number {
  if (bondsA >= a.maxBonds || bondsB >= b.maxBonds) return 0;
  const aff = affinity(a, b);
  if (aff === 0 || eRel <= 0) return 0;
  if (qa * qb < 0) return Math.max(aff, 0.6);
  return aff * Math.exp(-ACTIVATION_ENERGY / eRel);
}

// --- electrical charges (J7) ----------------------------------------------
// Typical ion charge magnitude per element family; caps how far repeated
// heterolytic events can charge one atom.
export function maxIonCharge(el: ChemElement): number {
  if (el.noble) return 0;
  switch (el.category) {
    case 'alkali metal': return 1;
    case 'alkaline earth': return 2;
    case 'halogen': return 1;
    case 'transition metal':
    case 'post-transition metal':
    case 'lanthanide': return 2;
    default: return el.symbol === 'O' || el.symbol === 'S' ? 2 : 1;
  }
}

// How a breaking bond distributes electrons — the physically-accurate-splitting rule (J5/J6):
// heterolytic for ionic pairs (|ΔEN| ≥ gap): the more electronegative atom takes the electron
// (−1), the other becomes a cation (+1), each capped at the element's typical ion charge.
// Homolytic for covalent/metallic pairs: neutral radicals, charges unchanged.
export function cleaveCharges(a: ChemElement, b: ChemElement, qa: number, qb: number): [number, number] {
  if (classifyBond(a, b) !== 'ionic') return [qa, qb];
  const aTakes = (a.en ?? 0) >= (b.en ?? 0); // more electronegative → anion
  const anion = aTakes ? a : b, cation = aTakes ? b : a;
  let qAnion = aTakes ? qa : qb, qCation = aTakes ? qb : qa;
  // transfer one electron only if both partners stay within their typical ion charge
  if (qAnion - 1 >= -maxIonCharge(anion) && qCation + 1 <= maxIonCharge(cation)) {
    qAnion -= 1;
    qCation += 1;
  }
  return aTakes ? [qAnion, qCation] : [qCation, qAnion];
}

// Charge neutralization when two atoms bond: opposite charges cancel pairwise.
export function neutralizeOnBond(qa: number, qb: number): [number, number] {
  if (qa * qb >= 0) return [qa, qb];
  const cancel = Math.min(Math.abs(qa), Math.abs(qb));
  return [qa - Math.sign(qa) * cancel, qb - Math.sign(qb) * cancel];
}

// P(break) per check. Monotone increasing in eRel, decreasing in bond energy —
// N≡N (945) survives temperatures that shatter O–H (463), but a single N–N chain
// link (order 1 of 3) breaks like the ~180 kJ/mol bond it really is.
export function bondBreakProbability(a: ChemElement, b: ChemElement, eRel: number, order?: number): number {
  if (eRel <= 0) return 0;
  return Math.exp(-bondEnergy(a, b, order) / eRel);
}

// Max bond order for a pair (parallel-stroke rendering + valence bookkeeping).
const BOND_ORDERS: Record<string, number> = { 'N|N': 3, 'O|O': 2, 'C|O': 2, 'C|C': 2, 'O|S': 2 };
export function maxBondOrder(a: ChemElement, b: ChemElement): number {
  return BOND_ORDERS[pairKey(a, b)] ?? 1;
}

// --- molecule recognition (slice 4) --------------------------------------
// Connected components over the bond graph → canonical formula → known-molecule name.
// Formula-count based: H-O-H is H₂O, H-O-O-H is H₂O₂ (different counts), so no
// structural isomer handling is needed at this vocabulary size.

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
function sub(n: number): string {
  return n === 1 ? '' : String(n).split('').map(d => SUBSCRIPTS[+d]).join('');
}

// Hill order: C first, then H, then alphabetical; no C → all alphabetical.
export function formulaOf(counts: Record<string, number>): string {
  const syms = Object.keys(counts).sort();
  const ordered = counts.C
    ? ['C', ...(counts.H ? ['H'] : []), ...syms.filter(s => s !== 'C' && s !== 'H')]
    : syms;
  return ordered.map(s => s + sub(counts[s])).join('');
}

export const KNOWN_MOLECULES: Record<string, string> = {
  'H₂': 'H₂', 'O₂': 'O₂', 'N₂': 'N₂', 'H₂O': 'H₂O', 'CO₂': 'CO₂', 'CH₄': 'CH₄',
  'ClNa': 'NaCl', 'O₂Si': 'SiO₂', 'FeO': 'FeO', 'Fe₂O₃': 'Fe₂O₃', 'MgO': 'MgO',
  'CaO': 'CaO', 'ClH': 'HCl', 'CO': 'CO', 'H₃N': 'NH₃', 'H₂O₂': 'H₂O₂', 'H₂S': 'H₂S',
};

// bonds: [{a, b, ...}] where a/b carry .el.symbol and stable identity.
// Returns { molecules: {display → count}, components, named } — named = count of
// components whose formula is in KNOWN_MOLECULES.
export interface BondLike { a: { el: ChemElement }, b: { el: ChemElement } }
export interface MoleculeReport { molecules: Record<string, number>; components: number; named: number }

export function analyzeMolecules(bonds: BondLike[]): MoleculeReport {
  type Node = BondLike['a'];
  const parent = new Map<Node, Node>();
  const find = (x: Node): Node => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  for (const bd of bonds) {
    if (!parent.has(bd.a)) parent.set(bd.a, bd.a);
    if (!parent.has(bd.b)) parent.set(bd.b, bd.b);
    const ra = find(bd.a), rb = find(bd.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const comps = new Map<Node, Record<string, number>>(); // root → {sym → count}
  for (const atom of parent.keys()) {
    const root = find(atom);
    let c = comps.get(root);
    if (!c) comps.set(root, c = {});
    c[atom.el.symbol] = (c[atom.el.symbol] ?? 0) + 1;
  }
  const molecules: Record<string, number> = {};
  let named = 0;
  for (const counts of comps.values()) {
    const formula = formulaOf(counts);
    const display = KNOWN_MOLECULES[formula];
    if (display) named++;
    const key = display ?? formula;
    molecules[key] = (molecules[key] ?? 0) + 1;
  }
  return { molecules, components: comps.size, named };
}

// --- presets (atom-count fractions, %) — build plan D6 ------------------

export interface Preset { id: string; name: string; mix: Record<string, number> }

export const PRESETS: Preset[] = [
  {
    id: 'atmosphere', name: "Earth's atmosphere",
    mix: { N: 78.08, O: 20.95, Ar: 0.93, C: 0.02, Ne: 0.02 },
  },
  {
    id: 'sun', name: 'The Sun',
    mix: { H: 91.2, He: 8.7, O: 0.05, C: 0.03, Fe: 0.01, Ne: 0.01 },
  },
  {
    id: 'earth', name: 'Bulk Earth',
    mix: { O: 51.0, Fe: 16.0, Mg: 15.5, Si: 14.6, S: 1.6, Al: 0.6, Ca: 0.4, Ni: 0.3 },
  },
  {
    id: 'body', name: 'Human body',
    mix: { H: 62.0, O: 24.0, C: 12.0, N: 1.1, Ca: 0.25, P: 0.25, K: 0.1, S: 0.1, Na: 0.1, Cl: 0.1 },
  },
  {
    id: 'seawater', name: 'Seawater',
    mix: { H: 66.2, O: 33.1, Cl: 0.3, Na: 0.25, Mg: 0.05, S: 0.05, Ca: 0.025, K: 0.025 },
  },
  // --- reactive playgrounds (J8): chosen to demo bonding, not to mirror nature ---
  {
    id: 'salt', name: 'Salt flats',
    mix: { Na: 50, Cl: 50 },
  },
  {
    id: 'burn', name: 'Combustion chamber',
    mix: { H: 55, O: 30, C: 15 },
  },
  {
    id: 'soup', name: 'Primordial soup',
    mix: { H: 55, C: 15, O: 15, N: 12, S: 2, P: 1 },
  },
];

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(PRESETS.map(p => [p.id, p]));

// Weighted sample: returns an element object. rng defaults to Math.random for the sim;
// tests inject a seeded rng.
export function samplePreset(presetId: string, rng: Rng = Math.random): ChemElement {
  const preset = PRESET_BY_ID[presetId];
  if (!preset) throw new Error(`unknown preset: ${presetId}`);
  const entries = Object.entries(preset.mix);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [symbol, w] of entries) {
    roll -= w;
    if (roll <= 0) return BY_SYMBOL[symbol];
  }
  return BY_SYMBOL[entries[entries.length - 1][0]];
}
