// Pure bonding logic + preset distributions. No DOM, no canvas — unit-tested under node --test.
// Model per build plan D3: property-derived pair affinity (rules 1-5) with a curated
// override table of real bond energies, energy-gated in both directions (Boltzmann-flavored).
// Energies are kJ/mol throughout; the sim maps kinetic energy into this scale (ENERGY_SCALE in sim.js).

import { BY_SYMBOL } from './elements.js';

// --- pair affinity -----------------------------------------------------

export const IONIC_EN_GAP = 1.7;

export function pairKey(a, b) {
  return a.symbol < b.symbol ? `${a.symbol}|${b.symbol}` : `${b.symbol}|${a.symbol}`;
}

// Real bond (dissociation / lattice-representative) energies, kJ/mol.
// These pairs are the "famous chemistry" the presets should reliably produce.
export const BOND_ENERGIES = {
  'H|H': 436, 'O|O': 498, 'N|N': 945, 'H|O': 463, 'C|H': 413, 'C|O': 799,
  'Cl|Na': 787, 'O|Si': 452, 'Fe|O': 409, 'Cl|H': 431, 'C|C': 347,
  'O|S': 522, 'Mg|O': 394, 'Ca|O': 402, 'Al|O': 512, 'C|N': 305,
};

// Bond type under the general rules. 'none' when no bond can ever form.
export function classifyBond(a, b) {
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
export function affinity(a, b) {
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

// Bond energy for any bondable pair (kJ/mol): curated value or a type-derived estimate.
export function bondEnergy(a, b) {
  const type = classifyBond(a, b);
  if (type === 'none') return 0;
  const curated = BOND_ENERGIES[pairKey(a, b)];
  if (curated) return curated;
  const gap = Math.abs((a.en ?? 0) - (b.en ?? 0));
  if (type === 'ionic') return 300 + 120 * (gap - IONIC_EN_GAP);
  if (type === 'metallic') return 110;
  return 180 + 90 * (((a.en ?? 0) + (b.en ?? 0)) / 2);
}

// --- energy gates ------------------------------------------------------

export const ACTIVATION_ENERGY = 40; // kJ/mol — approach energy needed to react at all

// P(form) per candidate encounter. eRel = relative kinetic energy of the pair, kJ/mol scale.
// Monotone increasing in eRel; 0 for incompatible pairs or exhausted valence.
export function bondFormProbability(a, b, eRel, bondsA = 0, bondsB = 0) {
  if (bondsA >= a.maxBonds || bondsB >= b.maxBonds) return 0;
  const aff = affinity(a, b);
  if (aff === 0 || eRel <= 0) return 0;
  return aff * Math.exp(-ACTIVATION_ENERGY / eRel);
}

// P(break) per check. Monotone increasing in eRel, decreasing in bond energy —
// N≡N (945) survives temperatures that shatter O–H (463).
export function bondBreakProbability(a, b, eRel) {
  if (eRel <= 0) return 0;
  return Math.exp(-bondEnergy(a, b) / eRel);
}

// Max bond order for a pair (parallel-stroke rendering + valence bookkeeping).
const BOND_ORDERS = { 'N|N': 3, 'O|O': 2, 'C|O': 2, 'C|C': 2, 'O|S': 2 };
export function maxBondOrder(a, b) {
  return BOND_ORDERS[pairKey(a, b)] ?? 1;
}

// --- presets (atom-count fractions, %) — build plan D6 ------------------

export const PRESETS = [
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
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

// Weighted sample: returns an element object. rng defaults to Math.random for the sim;
// tests inject a seeded rng.
export function samplePreset(presetId, rng = Math.random) {
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
