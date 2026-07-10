# Slice 1 — Element data + chemistry engine (pure, tested)

**Branch:** `feat/element-bonds-1-chemistry` → base `main`

## Summary

Lands the correctness-critical core of the element-bonds feature as pure, DOM-free ES modules: the 82-element table (H–Pb) and the bonding engine (property-derived affinity + curated real bond energies + Boltzmann-flavored energy gates), plus the five preset distributions and their weighted sampler. No runtime behavior changes — `index.html` doesn't import these yet (that's slice 2).

Build plan: [specs/element-bonds-build-plan.md](../element-bonds-build-plan.md) (decisions D2, D3, D6). Spec + validation docs co-land here per the SFD skill.

## Changes

- `js/elements.js` — 82 elements with mass, Pauling EN, covalent radius, maxBonds, category, CPK color
- `js/chemistry.js` — `classifyBond` (rules 1–5), `affinity`, `bondEnergy` (+15 curated real energies), `bondFormProbability` / `bondBreakProbability` (energy gates), `maxBondOrder`, `PRESETS` + `samplePreset`
- `package.json` — zero-dep, `npm test` = `node --test 'tests/*.test.mjs'`
- `tests/chemistry.test.mjs` — 19 tests
- `specs/`, `validation/` — build plan, PR bodies dir, validation skeleton (00–04)

## Test plan

- [x] `npm test` — 19/19 pass: table integrity (82 contiguous Z, sane properties), affinity rules 1–5 (noble=0, valence gate, ionic Na–Cl, covalent set, weak metallic), symmetry/bounds, curated energies (N≡N 945…), gate monotonicity in energy, N–N outlasting O–H at equal energy, bond orders, preset sums ≈100%, sampler ±2pp @ n=10k, headline-chemistry sanity (Sun >90% H, bulk Earth O-first by atoms).
- Pre-existing failures at slice 0: none (no harness existed — see validation/00-baseline.md).

## Validation scenarios that become exercisable

S1 (unit suite green).
