# Slice 3 — Presets + control panel v2

**Branch:** `feat/element-bonds-3-presets` → base `feat/element-bonds-2-sim`

## Summary

Wires the five preset distributions (D6) into spawn/respawn/burst and ships the panel v2: preset picker (Air/Sun/Earth/Body/Sea), live legend chips showing the active mix's top elements with CPK swatches, Max-atoms + Temperature sliders, both responsive layouts. Selecting a preset respawns the field (D5); Burst injects preset-weighted atoms, cap-guarded.

Build plan: [specs/element-bonds-build-plan.md](../element-bonds-build-plan.md) (D5, D6).

## Changes

- `js/main.js` — preset state + picker handler (respawn on switch), legend renderer, sampler wired to `samplePreset(currentPreset)`, probe exposes `preset`
- `index.html` — presets group + legend markup; chip/preset-button styles; mobile: presets row spans full width of the bottom sheet
- `tests/presets.test.mjs` — 2 tests

## Test plan

- [x] `npm test` — 31/31: sim respawn through every preset reproduces its mix ±2pp at n=8000 and never spawns off-mix elements; burst draws from the active sampler and respects the cap (sun burst ⇒ >85% H, only mix elements).
- [x] Live (atmosphere): byElement N 197 / O 51 / Ar 2 at 250 atoms (78.8/20.4/0.8% vs spec 78.1/20.9/0.93) ✓; bonds N|N-dominant with some N|O; console clean; screenshot shows CPK field + triple-stroke N≡N + legend.
- Note for validation: headless preview throttles rAF when backgrounded → fps reads 0 unless the tab was recently foregrounded (screenshot first, then sample). Not a sim defect; sim advances via rAF normally when visible.
- Pre-existing failures: none (00-baseline).

## Validation scenarios that become exercisable

P1 (distributions), P3 (chemistry sanity), P4 (energy gating), P5 (responsive/perf).
