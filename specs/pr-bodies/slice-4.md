# Slice 4 — Molecule recognition + ticker

**Branch:** `feat/element-bonds-4-molecules` → base `feat/element-bonds-3-presets`

## Summary

Adds connected-component molecule recognition over the bond graph with Hill-order formula canonicalization and a known-molecule name table (H₂O, N₂, O₂, CO₂, CH₄, NaCl, SiO₂, Fe₂O₃, …), plus a live ticker pill under the stats showing the top species (e.g. `N₂ ×63 · O₂ ×6 · N₂O ×4`). The probe now exposes `molecules`/`components`/`named`, upgrading P3 to named-molecule assertions.

Build plan: [specs/element-bonds-build-plan.md](../element-bonds-build-plan.md) (slice 4).

## Changes

- `js/chemistry.js` — `analyzeMolecules` (union-find over bonds), `formulaOf` (Hill order, unicode subscripts), `KNOWN_MOLECULES`
- `js/main.js` — ticker renderer on the 500 ms stats cadence; probe includes molecule analysis
- `index.html` — ticker pill markup + styles
- `tests/molecules.test.mjs` — 10 tests

## Test plan

- [x] `npm test` — 41/41: H-O-H → H₂O while H-O-O-H → H₂O₂ (count-based, no false water), CO₂ Hill order, N₂ triple, NaCl display name vs ClNa canonical key, CH₄, unknown clusters fall back to formula (Fe₂O), empty graph, multi-species field, subscript formatting.
- [x] Live (atmosphere): 45+ N₂ and O₂ molecules recognized, plus emergent trace NOx species (N₂O, NO — plausible atmospheric chemistry); ticker renders; console clean; 60 fps at 410 atoms / 293 bonds.
- Pre-existing failures: none (00-baseline).

## Validation scenarios that become exercisable

P3 upgraded to named molecules (G-P3.6).
