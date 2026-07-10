# 04 — Results

**Verdict: GREEN** — all structural and integration gates pass at the stack tip (`feat/element-bonds-4-molecules`, after two validation-driven fix commits). The five presets spawn within tolerance, atoms persist with zero decay under a hard configurable cap, the right chemistry emerges everywhere it should (N₂-dominated air, H₂ sun, 40+ H₂O in seawater, silicates in bulk Earth, organics in the body), temperature gates bonding in both directions with an honest N≡N survivor bias, and the app holds 60–61 fps at the 500-atom ceiling on desktop and mobile-emulated viewports with a clean console throughout. Validation surfaced two real defects — order-1 N–N chain links inheriting the full 945 kJ/mol triple-bond energy (runaway N-blobs at max heat), and hot-churn re-formation pushing hot equilibrium to 0.53·B₀ — both root-caused, fixed, regression-tested, and re-verified live. Run executed agent-driven (free, local, no side effects) per the two-phase-verdict allowance.

Evidence: `/tmp/pulse-demo-validation/element-bonds/<scenario>/`. Stack tip: `git log --oneline` on `feat/element-bonds-4-molecules`.

## Per-scenario results

| Scenario | Result | Evidence | Notes |
|---|---|---|---|
| S1 unit suite | PASS — 42/42, 0 skipped | `s1/test-output.txt` | includes 2 regression tests added during validation |
| S2 idle render health | PASS (after fix) | `s2/notes.md` + transcript screenshots | first run found the order-energy bug + Chrome slider restoration; re-run clean, 60 fps |
| P1 preset distributions | PASS (1 flake) | `p1/*.json` | all species within gates on 5 presets; body first-draw H/C ~2σ outliers, FLAKE re-rolls 3/3 pass |
| P2 persistence + cap | PASS | `p2/counts.json` | 12 hands-off samples flat at 120; 10× burst spam max 120; trim to 80 in <2 s, no dangling bonds |
| P3 chemistry sanity | PASS | `p3/*.json` | air: 65% N–N/O–O, 0 Ar bonds, N₂ 78 + O₂ 5 named; sun: 105 H₂, 0 He bonds; sea: O–H modal, 40 H₂O; earth: 75 Si–O, 27 Fe–O; body: 32 C–H, 68 O–H; overloaded = 0 everywhere |
| P4 energy gating | PASS (after tuning) | `p4/bonds-timeline.json` | seawater B_hot 0.28·B₀, B_cold 1.08·B₀; atmosphere N–N share 53.7%→82.4% hot (survivor bias); first attempt missed at 0.38→0.53, kinetics tuned + 3-seed headless confirm |
| P5 responsive + perf | PASS | `p5/perf.json` + screenshots | 61 fps at 500 atoms both viewports; no horizontal overflow at 375 px; controls operable; console clean |

## Global gates

| Gate | Status |
|---|---|
| GG.1 unit tests green at tip | PASS (42/42) |
| GG.2 200 on localhost + LAN (192.168.50.95:4173) | PASS |
| GG.3 module graph loads, no 404s | PASS (`preview_network` clean) |
| GG.4 no new console/server errors | PASS (every check empty) |
| GG.5 job queues | N/A (none in project) |
| GG.6 one dispatch per action (P2 spam by design) | PASS |
| GG.7 pre-existing failures restated | none existed at slice 0 (no harness on `main`) |

## Pre-existing failures

None — `main` had no test harness at slice-0 cut (00-baseline).

## Anomalies / flakes

- **P1/body first draw**: H 68.8% (Δ6.8 pp), C 6.8% (Δ5.2 pp) — ~2σ sampling noise at n=250. FLAKE policy applied: 3 re-rolls all within gates. Logged, not a defect.
- **Headless-tab fps reads 0** when the preview tab is backgrounded (rAF throttling). Environment artifact; fps gates measured with rAF-burst sampling after foregrounding. Not a sim defect.
- **Emergent NOx/HOx trace species** (N₂O, NO, HO, H₂O₂) appear alongside the headline molecules. Chemically plausible (they exist in real atmospheres/water); left as a feature.

## Validation-driven fixes (committed on the stack tip)

1. **Order-scaled bond energy** — `bondEnergy` now applies `E·(order/maxOrder)^1.5`; an order-1 N–N link is ~182 kJ/mol (real ≈160) instead of inheriting N≡N's 945. Without it, max-temp fields accreted unbreakable N₅₉O₈-style blobs. Regression test added; symptom re-exercised live (blobs gone, hot air dissociates to N₂-dominant survivors).
2. **Kinetics tuning** — capture window 0.5→0.35·E_bond, BREAK_RATE 0.12→0.18 after live P4 showed hot churn re-forming O₂/H₂ to 0.53·B₀. Verified across 3 headless seeds (hot 0.15–0.25, cold ≥1.06) and live (0.28 / 1.08).
3. **`autocomplete="off"` on sliders** — Chrome restored stale slider values across reload, silently changing sim temperature.

## What was demonstrably proven

82-element table with valence/EN/mass/CPK invariants; affinity rules 1–5 including noble-gas inertness under live dynamics; energy gates monotone with real bond-energy ordering (N≡N toughest); preset sampler convergence (±2 pp at n=10 k) and live spawn fidelity; zero-decay persistence; hard cap under burst spam and live trim; molecule recognizer correctness on hand-built graphs (H₂O vs H₂O₂ etc.) and live emergence of N₂/O₂/H₂O/CH₄/SiO₂-family species; 60 fps at the 500-atom ceiling on both form factors over LAN-served static files.

## Follow-ups (not blockers)

- Merge order: slices 1→4 into `main` (operator; local branches per approved plan). Slice N+1 rebases onto `main` before N merges — or simply fast-forward `main` to the stack tip since the stack is linear.
- Temperature slider could display a pseudo-Kelvin scale for extra chemistry flavor.
- Bond rendering could tint by bond type (ionic vs covalent) — deliberately out of scope.
- Spatial hashing would lift the 500-atom ceiling if ever wanted; O(n²) is fine at current scale.
