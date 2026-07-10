# Slice 7 — Reactive presets, element injector, reset

**Branch:** `feat/element-bonds-7-presets-injector` → base `feat/element-bonds-6-physics`

## Summary
J8–J10 + J13: three reactive playground presets (Salt Na/Cl 50/50, Burn H/O/C 55/30/15,
Soup primordial mix), injector chip row (canvas click + Burst inject the selected element,
Mix = preset-weighted default), Reset button (cap 250 / temp 40 / Attract / Mix / respawn,
preset kept), probe gains `inject` field and `step(frames)` time-acceleration for validation
(hidden tabs suspend rAF entirely).

## Test plan
- [x] tsc clean; vitest 58/58 (4 new in tests/injector.test.ts)
- [x] Burst element override injects exactly that element, cap-guarded
- [x] Salt → Cl|Na bonds; Burn → H|O; Soup → C-chemistry, on-mix only
- [x] Burn outpaces Air at equal settle time (the "less stable environments" point)
- [x] Live salt cycle via UI controls + step(): settle → hot 100 gives 82⁺/82⁻ free ions
      (net 0), cool 15 recombines to 100 NaCl + 10 Cl₂
