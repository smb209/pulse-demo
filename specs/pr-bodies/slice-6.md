# Slice 6 — Physically accurate splitting + electrical charges

**Branch:** `feat/element-bonds-6-physics` → base `feat/element-bonds-5-vite`

## Summary
Implements J5–J7: momentum-conserving reaction impulses (Δv ∝ 1/mass), endothermic
breaking (bond energy consumed from relative KE, floored at 0), exothermic formation
(EXO_FRACTION=0.25 of bond energy released as fragment KE, capped Δv 2.5 — enables
combustion chain reactions), heterolytic cleavage for ionic pairs (Na⁺/Cl⁻ with per-element
ion-charge caps) vs homolytic for covalent/metallic, softened inverse-square Coulomb forces
among ions (240 px range), barrierless ion recombination + charge neutralization on bond,
ion ring/sign badges in the renderer, ions + meanSpeed in stats/probe.

## Test plan
- [x] `tsc --noEmit` clean; vitest 54/54 (12 new in tests/physics.test.ts)
- [x] Momentum conserved exactly through both energetics (unequal masses)
- [x] Energy direction: formation +EXO·E relative KE; break −E floored at 0
- [x] NaCl heterolytic / O–H homolytic / charge caps / global charge conservation under dynamics
- [x] Ion recombination barrierless at 2 kJ/mol where neutral pairs are frozen out
- [x] Ignition: H/O mix at T=40 forms >40 bonds in 20 s; seawater regime unchanged; no runaway (meanSpeed bounded)
- [x] Live: console clean, field forms N₂/NO normally
