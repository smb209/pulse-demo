# 02 — Test plan

Each scenario is independent given [01-pre-check](01-pre-check.md) ran cleanly. Capture path: `/tmp/pulse-demo-validation/element-bonds/<scenario_id>/`. UI actions go through real controls (`preview_click` / `preview_fill`); state reads go through the read-only `window.__pulse.stats()` probe (build-plan D7). No write-path API calls exist in this project, so harness-fidelity risk is limited to "drive the real buttons, not synthetic state mutation."

## S1. Unit suite green (structural)

**Phase:** structural — runs at every slice tip.

**Setup:** working tree at slice tip.

**Action:** `npm test` in `pulse-demo/`.

**Observation:** exit code + full TAP output → `s1/test-output.txt`. Covers: affinity rules 1–5 (noble→0, ionic, covalent, metallic, valence-full blocks), override bond energies, form/break probability monotone in energy, preset tables sum ≈100%, sampler ±2pp at n=10k, cap/persistence invariants (slice 2+), molecule recognizer (slice 4+).

**Time budget:** ~1 min.

---

## S2. Idle render health (structural)

**Phase:** structural — runs at every slice tip from slice 2.

**Setup:** pre-check steps 3–5.

**Action:** load page, let it idle 15 s at default preset/cap. Then `preview_resize` mobile (375×812), idle 10 s.

**Observation:** `preview_console_logs level=warn` (must be empty), `stats().fps` at both viewports, desktop + mobile screenshots → `s2/`.

**Time budget:** ~3 min.

---

## P1. Preset distributions match spec

**Phase:** integration (stack tip).

**Setup:** pre-check clean; cap at default 250.

**Action:** for each of the 5 presets: `preview_click` its button, wait for respawn.

**Observation:** `stats().byElement` → `p1/<preset>.json`. Compare each element's atom-fraction against the build-plan D6 table.

**Time budget:** ~5 min.

---

## P2. Persistence + configurable cap

**Phase:** integration.

**Setup:** pre-check clean; Earth's-atmosphere preset.

**Action:** set Max-atoms slider to 120 (`preview_fill`). Record `stats().atoms` every ~5 s for 60 s with no interaction. Then `preview_click` Burst 10× rapidly. Then lower the slider to 80.

**Observation:** time-series → `p2/counts.json`. Expect: count stable (no decay) during the hands-off window; count never exceeds 120 during bursts; count trims to ≤80 after lowering (trim behavior per D5).

**Time budget:** ~4 min.

---

## P3. Chemistry sanity — the right bonds form

**Phase:** integration.

**Setup:** pre-check clean; temperature at default (moderate).

**Action & observation** (per preset, 60 s settle, then `stats()` → `p3/<preset>.json`):
- **Atmosphere:** bonds exist; ≥60% of bonds are N–N or O–O; Ar participates in zero bonds.
- **Sun:** H–H dominates bond pairs; He participates in zero bonds.
- **Seawater:** O–H is the top bond pair (water forming); Na–Cl present if both spawned.
- **Bulk Earth:** Si–O and Fe–O present (silicates/oxides).
- **Human body:** C–H and O–H both present (organics + water).
- Slice-4 upgrade: assert named molecules from the recognizer (e.g. atmosphere yields N₂ + O₂ counts > 0; seawater yields H₂O count > 0).

**Time budget:** ~10 min (5 presets × 2 min).

---

## P4. Energy gates bonding both directions

> Amended during slice-2 calibration (2026-07-10): the hot-dissociation gate now runs on
> **seawater** (O–H, 463 kJ/mol — breaks at max temp) instead of atmosphere, because the
> calibrated model honestly reproduces N≡N's (945 kJ/mol) resistance to dissociation —
> atmosphere at max temp *keeps* its N₂. That resilience became the survivor-bias gate.

**Phase:** integration.

**Setup:** pre-check clean; **seawater** preset settled 60 s at moderate temperature (bond count B₀ > 0 from P3).

**Action:** drag Temperature slider to max; wait 30 s; record B_hot. Then to minimum available; wait 60 s; record B_cold.

**Observation:** `p4/bonds-timeline.json`. Expect B_hot ≪ B₀ (hot shakes O–H apart) and B_cold ≥ B₀·0.8 (cooling lets bonds re-form and survive). Survivor bias on **atmosphere**: at max temp, the N–N share of surviving bonds rises while the N–O + O–O share falls (triple bond outlives the rest) — capture both shares at settle and at hot.

**Time budget:** ~5 min.

---

## P5. Responsive + performance at cap

**Phase:** integration.

**Setup:** pre-check clean.

**Action:** set Max-atoms to 500 (ceiling). Desktop viewport: idle 15 s. Mobile 375×812: idle 15 s, tap-drag the canvas, operate the preset picker and both sliders.

**Observation:** `stats().fps` both viewports (gate: ≥30 at cap), controls respond, screenshots → `p5/`. `preview_console_logs` clean throughout.

**Time budget:** ~5 min.

---

# v2 scenarios (features 1–7, unattended run 2026-07-10)

Timed live scenarios drive real UI controls, then advance the clock with `__pulse.step(frames)`
(J13 — hidden preview tabs suspend rAF entirely, so wall-clock waits cannot advance the sim).

## V-S1. Toolchain structural — `tsc --noEmit` clean (strict) + `vitest run` green + `vite build` succeeds. Every slice tip.
## V-P6. Salt ion cycle — salt preset via UI; settle → heat 100 → expect free Na⁺/Cl⁻ ions (net 0); cool 15 → NaCl recombines via Coulomb + barrierless recombination.
## V-P7. Injection — select O chip (real click), Burst; exactly the burst count of O atoms appears (cap-guarded), O₂ forms from the injected oxygen.
## V-P8. Reset — wreck cap/temp/mode/injector, click Reset; controls + outputs back to 250/40/Attract/Mix, field respawned, preset preserved.
## V-P9. Bar graph — settled burn field, real ticker click opens the card; rows sum sensibly (top-8 + other = 100% of total), tooltip carries exact counts.
## V-P10. Combustion — burn preset outpaces Air early (exothermic chains); H₂O/CO₂/CH₄ family appears.
## V-P11. Physics conservation — momentum exact through break/formation energetics; formation +EXO·E, break −E floored at 0 (unit-level, tests/physics.test.ts).
