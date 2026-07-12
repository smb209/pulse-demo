# Reaction Foundry — design notes & backlog

Living tracker for the `?game=1` puzzle mode. Code lives in `src/game/`
(`content.ts` = tools + levels, `types.ts` = contracts, `game.ts` = engine).

## Design principles

- **Grounded in the real sim.** Every tool maps to physics the engine already models
  (energy-gated bonding, bond-break kinetics, temperature, ions/Coulomb, diffusion). No fake
  mechanics.
- **Climb the periodic table.** Levels progress by element: start light (H), add the next
  element each stage (H→O for water, then C, N, Na/Cl, metals…). `LevelDef.featured` names it.
- **Teach something true.** Every level carries a real scientific fact tied to its reactants,
  products, or the method needed to solve it (`LevelDef.fact`, revealed on completion).
- **Data-driven.** Add a tool → one `TOOL_TYPES` entry. Add a level → one `LEVELS` entry.
  Elements/reactions come from `elements.ts` / `chemistry.ts`.

## Tools implemented

| Tool | Hook | Science |
|------|------|---------|
| Fan | `force` (directional) | conveyor / gas flow |
| Deflector | `force` (radial repel) | barrier / redirection |
| Catalyst | `formBoost` (all pairs) | lowers activation energy |
| O–H Catalyst | `formBoost` (pair-selective) | selective catalysis / enzyme specificity |
| Heater | `force` (thermal kicks) | Arrhenius: heat speeds reactions & breaks bonds |
| Cooler | `force` (damping) | condensation / bond stabilisation |
| Shredder | `breakBoost` | photodissociation / plasma |
| Contaminant (getter) | `adsorb` | catalyst poison / adsorption surface |

Aiming: press-drag on placement sets direction (fan) or intensity/size (others), clamped.

## Levels roadmap

1. **Hydrogen Run** (H) — collect H₂. Intro to emit→bond→route→collect. Shredder hazard.
2. **First Water** (O) — collect H₂O. Needs heat to crack H₂ + selective O–H catalyst.
   Getter contamination hazard.
3. _(next)_ **Carbon** — CO₂ or CH₄ (combustion / methane).
4. _(next)_ **Nitrogen** — NH₃ (Haber process — pressure/temperature/catalyst).
5. _(next)_ **Salt** (Na, Cl) — ionic bonding; unlock charged plates + ionizer.
6. _(next)_ **Metals / oxides** — rust, thermite.

## Backlog — tool/obstacle ideas (grounded)

- **Charged plates** (`force` by `atom.charge`) — steer ions. Needs an ionic level.
- **Ionizer beam** — strip/add charge to neutrals so charged plates matter for any gas.
- **Molecular sieve / membrane** — pass by mass/size (Graham's law). Enables separation levels.
- **Centrifuge well** — spin; fling heavy out, keep light central (isotope-style separation).
- **Turbulent mixer** — inject relative velocity (fixes co-moving streams that won't react).
- **Cold trap / condenser** — phase-selective collection.

## Balance pass (2026-07-12)

- **L1 fixed.** Was self-solving (baseline 9/10 by pure diffusion). Root cause: over a long
  run, gas diffuses to *any* tank. Fix = **low cap (80)** so the sim recycles the oldest
  atoms fast → gas can't slowly drift across the board; only *actively fanned* gas reaches
  the tank. Layout: emitters along the bottom, tank in the top-right corner, shredder in the
  bottom flow path. Baseline now 0; a 3-fan lift wins. par tightened to {3, 50}.
- **L2 (First Water) is winnable but not tightly gated.** The H–O affinity is strong, so
  water forms readily via attraction — you *cannot* make the selective catalyst required for
  *formation* without fighting the chemistry, and low-cap recycling kills water before it
  crosses to a distant tank. Current compromise: cap 260 + cool ambient (water persists) +
  tank near the mixing zone; baseline 0 (needs routing), catalyst+heater+fan wins. Fans-only
  is marginal (~4/5). This is the honest ceiling without the reactant-budget idea below.

## Next big lever — reaction equations + reactant budget (operator idea, 2026-07-12)

Both levels now carry a balanced `reaction` equation (shown in the HUD). The **mols/reactant
budget** idea would fix the balance tension *and* ground the star rating:

- Emitters emit a **finite budget** of reactant atoms (in "mols"/units), then stop — instead
  of infinite streams. No more "wait long enough and diffusion wins".
- Stars = **yield / atom economy**: product collected vs the stoichiometric maximum the
  budget allows (from the balanced equation). Wasting reactants (byproducts, adsorbed by a
  getter, cracked by a shredder, recycled) costs stars.
- Makes tools genuinely required (limited material → must convert efficiently before it runs
  out) and teaches real stoichiometry / limiting-reagent thinking.
- Data model: `LevelDef.budget` (per-element mols) + emitters draw from it; track consumed;
  compute theoretical max product from the equation; score = collected / theoretical.

## Setup phase + reactant budget — SHIPPED (2026-07-12)

Levels now run **setup → run → done**. Setup: place/aim tools, rotate aimable emitters,
then ▶ Start. Emitters carry a finite `mols` budget (labelled on the board) and stop when
spent; a `settleSeconds` grace period lets stragglers react, then the run is scored.
**Stars are yield-based**: win = collect the objective; ★★/★★★ scale with pushing yield
past it; the result card shows "collected X of Y possible · Z% yield" (Y = stoichiometric
max from the balanced equation). This retired the cap/par balance hacks:
- L1: fixed emitters, corner tank, shredder hazard — a good fan chain hits ~53% yield (★★★),
  baseline fails.
- L2: whole chamber is the collector; catalyst+heater required (baseline = 0 water).
  **Water is inherently low-yield & noisy in this sim (~3–5 of 54 theoretical)** — objective
  set to 3 so the catalyst reliably clears it; 3-star is a stretch. This is the honest ceiling.

## Deferred / to-do

- [ ] **Level select screen** (currently `?level=N` + a Next button on win).
- [ ] **Placement restrictions** — allow a tool only inside a marked region, or cap material
      introduced per region. Data model: per-palette-entry `placeIn` rect(s).
- [ ] **Re-aim existing tools** — dragging a placed tool only moves it; add a rim handle to
      rotate/rescale vs a centre handle to move.
- [ ] **Charged-region level** (pairs with ionizer) so electric fields actually shine.
- [ ] **Persist stars per level** (localStorage) once there's a level select.

## Sim realism — VSEPR bond angles (2026-07-12)

Bonds were length-only springs, so multiple bonds on one atom pointed anywhere (H's
orbited O randomly). Added a soft, momentum-conserving angle force in `sim.ts` that drives
each central atom's bonds toward the angle its **steric number** wants (bonding neighbours
+ lone pairs, lone pairs ≈ (valence − bonds)/2 from a main-group `VALENCE` table).
Live-sim measured angles: **H₂O 102–106°** (real 104.5° bent), **CO₂ 175–180°** (linear —
C has no lone pairs), trigonal C ~120°. Stiffness `ANGLE_K` ≪ `SPRING_K` so shape emerges
without rigidifying. `window.__pulse.geometry()` reports live per-molecule angles.

## Known limitations

- Charge fields only move actual ions; neutral gas (H₂/N₂) is unaffected — the sim has no
  molecular dipole model. Ionizer + ionic levels are the intended path.
- Fixed logical board (960×600, letterboxed) keeps difficulty screen-independent.
