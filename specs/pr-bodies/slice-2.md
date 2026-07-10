# Slice 2 — Sim refactor: atoms, persistence + cap, energy, bond springs

**Branch:** `feat/element-bonds-2-sim` → base `feat/element-bonds-1-chemistry`

## Summary

Replaces the inline-script particle field with the modular sim: particles are now atoms with element identity and bond lists, the `life`-decay mechanic is deleted (atoms persist; population bounded only by the configurable cap), bonds form/break through chemistry.js's energy gates and act as spring constraints, and rendering moves to pre-cached CPK sprites with symbol labels. Spawn is a hydrogen-only placeholder until slice 3 wires presets.

Build plan: [specs/element-bonds-build-plan.md](../element-bonds-build-plan.md) (D1, D3–D5, D7).

## Changes

- `js/sim.js` — headless kinetics core: pointer forces, equipartition thermal jitter (1/√mass), bond springs + axis damping, energy-gated form/break with re-bond cooldown + break impulse, affinity-scaled pair attraction (encounter driver), O(n²) scan with rejects, cap enforcement (`setCap` trims + cleans bonds), `respawn`/`burst`/`stats`
- `js/main.js` — canvas renderer (sprite cache: glow + CPK disc + symbol), controls wiring, `window.__pulse.stats()` probe
- `index.html` — markup + styles only; controls: Max atoms (50–500, default 250), Temperature (5–100, default 40) replacing Density/Link-range; bonds stat added; module script tag
- `tests/sim.test.mjs` — 10 tests

**Calibration notes (headless probes, captured in repo history):** `ENERGY_SCALE` set so mean free-pair energy ≈ 60 kJ/mol at default temperature; break checks use `max(eRel, bathEnergy(T))` because bond-axis damping artificially cools a bonded pair's raw relative velocity; affinity-scaled attraction added because encounter rate — not formation probability — was the bottleneck. **Validation amendment:** P4's hot-dissociation gate moved to seawater (O–H breaks at max temp) since the calibrated model honestly reproduces N≡N refusing to dissociate; that resilience is now P4's survivor-bias gate (see validation/02, 03).

## Test plan

- [x] `npm test` — 29/29 (19 slice-1 + 10 new): persistence over 600 frames (same atom ids, zero decay), spawnTo/burst/setCap cap invariants, dangling-bond cleanup after trim, valence never exceeded + no duplicate bonds over 1200 frames, noble gases (He in sun mix) never bond, captureFactor/bathEnergy/radius helpers.
- [x] Live: 250 H atoms → 113 H₂ at 60fps, console clean, overloaded=0 (`__pulse.stats()`).
- Pre-existing failures: none (00-baseline).

## Validation scenarios that become exercisable

P2 (persistence + cap via UI). S2 (render health).
