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

## Deferred / to-do

- [ ] **Level select screen** (currently `?level=N` + a Next button on win).
- [ ] **Placement restrictions** — allow a tool only inside a marked region, or cap material
      introduced per region (operator idea). Data model: per-palette-entry `placeIn` rect(s).
- [ ] **Re-aim existing tools** — dragging a placed tool currently only moves it. Add a rim
      handle to rotate/rescale vs a centre handle to move.
- [ ] **Balance pass** — level 1 & 2 are winnable but tools optimise more than hard-gate; add
      byproduct penalties and tighter pars for real puzzle pressure.
- [ ] **First Water tuning** — verify the heat + O–H-catalyst solution reliably beats the
      H₂-hogs-hydrogen problem across placements.
- [ ] **Charged-region level** (pairs with ionizer) so electric fields actually shine.
- [ ] **Persist stars per level** (localStorage) once there's a level select.

## Known limitations

- Charge fields only move actual ions; neutral gas (H₂/N₂) is unaffected — the sim has no
  molecular dipole model. Ionizer + ionic levels are the intended path.
- Fixed logical board (960×600, letterboxed) keeps difficulty screen-independent.
