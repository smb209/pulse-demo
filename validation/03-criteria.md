# 03 — Validation criteria

Gates AND-ed within a scenario; run passes only if all scenario + global gates pass. `FLAKE` policy: re-run affected scenario 3×, pass if ≥2/3; log the flake in 04-results. Physics-with-randomness caveat: P3/P4 assertions are statistical — thresholds below already include slack; a miss is a real miss, not tuning noise.

## Per-scenario gates

### S1
- [ ] G-S1.1 `npm test` exit 0 at stack tip; zero skipped tests.

### S2
- [ ] G-S2.1 Console clean (no errors/warnings) at desktop and mobile idle.
- [ ] G-S2.2 FPS ≥ 55 desktop, ≥ 30 mobile-emulated at default cap 250.

### P1
- [ ] G-P1.1 For each preset: every element with spec share ≥ 5% is within ±5 pp of the D6 table.
- [ ] G-P1.2 For each preset: every element with spec share < 5% is within ±2 pp.
- [ ] G-P1.3 No element outside the preset's table appears.

### P2
- [ ] G-P2.1 Hands-off 60 s: atom count varies by 0 (no decay, no spontaneous spawn).
- [ ] G-P2.2 Burst spam at cap 120: `stats().atoms ≤ 120` at every sample.
- [ ] G-P2.3 Lowering cap to 80 trims to ≤ 80 within 5 s.

### P3
- [ ] G-P3.1 Atmosphere: total bonds > 0; N–N + O–O ≥ 60% of bonds; Ar bond count = 0.
- [ ] G-P3.2 Sun: H–H is the modal bond pair; He bond count = 0.
- [ ] G-P3.3 Seawater: O–H is the modal bond pair.
- [ ] G-P3.4 Bulk Earth: Si–O ≥ 1 and Fe–O ≥ 1.
- [ ] G-P3.5 Human body: C–H ≥ 1 and O–H ≥ 1.
- [ ] G-P3.6 (slice 4+) Recognizer reports N₂>0 & O₂>0 (atmosphere), H₂O>0 (seawater).
- [ ] G-P3.7 No atom ever exceeds its element's maxBonds (probe exposes max observed).

### P4 (amended with the slice-2 calibration — hot gate on seawater, survivor bias on atmosphere)
- [ ] G-P4.1 Seawater: B_hot ≤ 0.3 · B₀.
- [ ] G-P4.2 Seawater: B_cold ≥ 0.8 · B₀.
- [ ] G-P4.3 Atmosphere at max temp: N–N share of bonds rises vs settle; N–O + O–O share falls.

### P5
- [ ] G-P5.1 FPS ≥ 30 at 500 atoms, both viewports.
- [ ] G-P5.2 All controls operable at mobile width; no layout overflow (snapshot check).
- [ ] G-P5.3 Console clean for the whole scenario.

## Global gates

- [ ] **GG.1** Per-slice unit tests green at stack tip.
- [ ] **GG.2** Page serves 200 on localhost and LAN IP at stack tip.
- [ ] **GG.3** No build step to break; module graph loads (no 404s in `preview_network`).
- [ ] **GG.4** No new console/server errors during the whole run.
- [ ] **GG.5** N/A (no job queues in this project) — recorded as N/A, not silently dropped.
- [ ] **GG.6** One dispatch per scenario action; Burst-spam in P2 is by design.
- [ ] **GG.7** Pre-existing failures from 00-baseline (none) restated in verdict.

## Verdict mapping

Standard two-phase-verdict states: **GREEN** (S+P all pass), **GREEN-STRUCTURAL** (S pass, P deferred pending operator authorization), **YELLOW** (documented scenario miss, operator decides), **RED** (design-level failure — e.g. P4 inverted means the energy model is wrong, stop), **BLOCKED** (pre-check halt).

---

# v2 gates

- [ ] G-V-S1: tsc strict clean, vitest 59/59, vite build green at stack tip.
- [ ] G-V-P6.1 hot salt: ≥ 20 free ions of each sign; net charge exactly 0.
- [ ] G-V-P6.2 cold salt: NaCl count ≥ 2× hot NaCl count AND remaining free ions ≤ 25% of hot ion count.
- [ ] G-V-P7 (amended J15): burst adds exactly its count of the selected element (overshoot per G-V-P12); O₂ > 0 within 15 sim-seconds.
- [ ] G-V-P8 (amended J15): after Reset — cap 250, temp 40, inject mix, Attract active, atoms = 125 (half of cap), preset unchanged.
- [ ] G-V-P12 (J15): fresh field = 50% of cap; injection overshoots freely to ≤1.5×cap; over-cap population decays OLDEST-first back to exactly cap.
- [ ] G-V-P13 (J16): Burst breaks 100% of bonds, momentum conserved (<1e-6), meanSpeed rises ≥1.5×, net charge 0, field re-forms after cooldown.
- [ ] G-V-P9: chart total equals `components`; row percentages ≤ 100 and top-8+other counts sum to total.
- [ ] G-V-P10: burn settle bonds > air settle bonds at equal (short) settle time.
- [ ] G-V-P11: momentum deltas < 1e-9 through both energetics; energy signs correct.
- [ ] Amended G-P2.1 (J14): hands-off count constant (no decay); the fill-to-cap expectation is dropped — cap is a ceiling.
