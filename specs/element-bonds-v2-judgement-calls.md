# element-bonds v2 — Judgement calls (unattended run)

Operator requested 7 features "unattended, best shot" on 2026-07-10 — the SFD plan-approval
pause is waived by that instruction; everything else (slices, per-slice tests, validation,
results) still applies. This file logs every call I made without asking. Newest at the bottom.

## J1 — Slice order: TypeScript/Vite migration goes FIRST
The migration (feature 2) is the foundation; doing it last would mean converting the new
features' code twice. Slices: 5 = TS/Vite, 6 = physics (features 7+4 together), 7 = presets +
injection + reset (3+5+6), 8 = bar graph (1). Stacked on the v1 stack tip.

## J2 — Vitest replaces node --test
Vite project → vitest is the native runner (shares vite config, runs TS directly). The 42
existing tests keep their `node:assert/strict` bodies — only the `test` import changes — so
the migration diff stays reviewable.

## J3 — Vite dev server keeps port 4173 with `--host`
The LAN URL (`http://192.168.50.95:4173`) survives the migration. `.claude/launch.json` moves
from python http.server to `npm run dev`. Dev server (not a build) serves the demo — HMR is a
feature during a live demo, and the machine is the host anyway.

## J4 — TypeScript strict mode ON, pragmatic `!` for DOM lookups
`strict: true` catches real bugs in physics code; `document.getElementById('x')!` assertions
are acceptable in a single-page app whose markup we own.

## J5 — Features 7 and 4 are one slice (they're one physics system)
"Physically accurate splitting" and "electrical charges" share a mechanism: how a bond breaks
determines whether ions form. Homolytic cleavage (covalent/metallic pairs) → neutral radicals;
heterolytic cleavage (ionic pairs, |ΔEN| ≥ 1.7) → ion pair (Na⁺/Cl⁻). Splitting them into two
slices would put half a mechanism in each.

## J6 — "Physically accurate splitting" interpreted as three laws
1. **Momentum conservation**: break/formation impulses are equal-and-opposite in momentum
   (Δv ∝ 1/mass), replacing v1's equal-Δv impulse.
2. **Endothermic breaking**: dissociation CONSUMES the bond energy from the pair's relative
   kinetic energy (v1 wrongly ADDED an impulse on break).
3. **Exothermic formation**: bond formation RELEASES its energy as kinetic energy of the
   fragments (momentum-conserving kick). This is what makes combustion chain reactions work.
   An `EXO_FRACTION` scales the release and a per-event velocity cap keeps integration stable —
   both calibrated headless; values documented in sim.ts.
Not modeled (out of scope, logged): quantized vibrational states, photon emission, third-body
requirements for recombination.

## J7 — Charge model: ions only from heterolytic splits, Coulomb forces, barrierless recombination
Atoms carry integer charge (capped at the element's typical ion charge: alkali +1, alkaline
earth +2, halogens −1, O −2 tendency capped at −1 per single event). Charged atoms feel
pairwise Coulomb force (like repels, opposite attracts). Oppositely charged pairs skip the
activation gate when bonding (ion recombination is barrierless) and neutralize on bond
formation. No standing partial charges / dipoles on neutral molecules — too subtle to read
in a particle demo and easy to get wrong.

## J8 — Three new "unstable" presets rather than modifying the existing five
Operator said Air/Earth were too stable a *choice*, not wrong data — the real-composition
presets stay untouched (they're the educational anchor). New reactive playgrounds:
- **Salt** (Na 50 / Cl 50): ionic snapping; heat it → ion pairs fly apart, cool → crystals.
- **Burn** (H 55 / O 30 / C 15): stoichiometry-ish combustion — exothermic chain reactions.
- **Soup** (primordial: H 55 / C 15 / O 15 / N 12 / S 2 / P 1): organics assembly.

## J9 — Injection UI: chip row selects what a canvas click injects
`Mix` (preset-weighted, v1 behavior) is the default chip; element chips (O, H, C, N, Na, Cl,
Fe) switch the canvas-click burst to that pure element. The Burst button always injects the
active selection at center. Injection respects the cap (flash on full) — unchanged.

## J10 — Reset restores control baseline but keeps the chosen preset
"Baseline" = cap 250, temperature 40, mode Attract, injector Mix, fresh respawn of the
*current* preset. Rationale: switching preset is already one click; Reset's job is to un-wreck
the current experiment. Full-defaults reset (jump back to Air) would surprise mid-demo.

## J11 — Bar graph is HTML/CSS bars, not a canvas chart library
Feature 1 needs ~8 horizontal bars updated 2×/s. DOM bars with CSS width transitions are
simpler, accessible, and theme-consistent; a chart lib would be the only dependency in an
otherwise dependency-free app. Percentages = share of recognized molecule count (not atoms),
labeled with both % and ×count. Toggled by clicking the ticker pill (desktop + mobile), since
panel space is exhausted; the ticker gets a chevron affordance.

## J12 — v1 chemistry tests updated where v2 physics legitimately changes contracts
Energy-conserving reactions change kinetics constants; any v1 test that hard-coded those
(e.g. bathEnergy calibration) gets updated in the same slice with the reason in the test body.
Contract tests (valence, cap, persistence, noble inertness) must keep passing unmodified.

## J13 — Validation probe gains `__pulse.step(frames)` (time acceleration)
The preview tab suspends requestAnimationFrame entirely when hidden, so timed live
scenarios (settle 60 s, heat 30 s…) cannot advance wall-clock style unless the panel is
visible. The probe now exposes a synchronous `step(frames)` that advances the sim through
the exact same `step()` path the render loop uses — time control, not state mutation, so
harness fidelity is preserved (all controls are still driven through real UI events).
Capped at 36 000 frames/call. The app itself still pauses when hidden (battery-friendly).

## J14 — Cap becomes a true ceiling; respawn fills to 85% (injection was dead)
Live validation of feature 5 exposed a latent v1 bug: the Max-atoms slider both set the cap
AND back-filled to it (`spawnTo(cap)`), so the population always equaled the cap and every
burst/injection was silently blocked. v1's P2 scenario read this as "cap guard works" — it
did, but nothing could ever inject. Fix: the slider only trims (ceiling semantics, exactly
what build-plan D5 promised); respawn fills to 85% of cap so injection always has headroom.
v1's G-P2.1 "count stays exactly at cap after slider" gate is amended accordingly: the
persistence assertion (no decay) is unchanged, the fill-to-cap expectation is dropped.

## J15 — "Initialize at ½ max, oldest removed after decay time" → soft cap with rate-limited FIFO trim
Respawn now fills to 50% of cap (was 85%). Injection always succeeds and may overshoot the
cap; while over cap, the sim sheds the OLDEST atoms at a steady decay rate (~12 atoms/s)
rather than instantly — the field gracefully returns to the ceiling. A hard bound of 1.5×cap
stops unbounded spam (instant oldest-eviction beyond it; the counter flashes only when the
hard bound truncates a burst).

## J16 — Burst button = detonation (photodissociation-style)
Burst no longer injects (canvas clicks + injector chips own injection). It now breaks EVERY
bond simultaneously; each pair is ejected along its bond axis with the FULL bond energy as
kinetic energy (momentum-conserving, per-event Δv capped at 2× the reaction cap for
integrator stability), and ionic pairs cleave heterolytically — detonating salt makes an ion
storm. Re-bond cooldown applies, so the field genuinely scatters before re-forming.

## J17 — Detonation ejects with SEVERAL TIMES the bond energy (operator follow-up)
"Should have said more than the bonding energy" — fragments now fly apart visibly:
DETONATION_BOOST = 4× each bond's energy goes into the ejection (per-event Δv cap raised to
8 px/frame for this path only; ordinary reaction energetics keep their 2.5 cap). Global
damping still settles the field in ~1 s, so it's a burst, not a permanent temperature jump.
