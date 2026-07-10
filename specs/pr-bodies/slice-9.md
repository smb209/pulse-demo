# Slice 9 — Soft cap (½-init, oldest-decay) + Burst = detonation

**Branch:** `feat/element-bonds-9-burst-decay` → base `feat/element-bonds-8-molecule-chart`

## Summary
Operator follow-up, J15+J16. Fields now initialize at HALF the max-atoms cap so injection
always has room; injection overshoots the cap freely (hard bound 1.5×cap) and the sim decays
the OLDEST atoms back to the cap at ~12 atoms/s. The Burst button no longer injects — it
detonates: every bond breaks simultaneously and each pair is ejected along its bond axis
with the bond's energy (momentum-conserving, heterolytic ionization applies — detonating
salt makes an ion storm).

## Originating finding
"It initializes at max atoms but then the click does nothing" — diagnosis: respawn filled to
85% but a few clicks hit the hard cap and silently no-oped; root cause is cap-as-blocker
semantics. Fixed with ½-init + soft-cap FIFO decay so clicks ALWAYS work.

## Test plan
- [x] tsc clean; vitest 60/60 (soft-cap decay incl. oldest-first eviction; detonate momentum
      <1e-6, energy ejection ≥1.5× meanSpeed, charge balance, cooldown recovery; hard bound)
- [x] Live: init 125 → inject to 305 → decay to exactly 250 oldest-first; Burst 269→0 bonds,
      meanSpeed ×1.9, recovery to 265; console clean
