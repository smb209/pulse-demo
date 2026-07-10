# Pulse — elemental bonding playground

An interactive particle sim where every node is a real chemical element (H through Pb, Z = 1–82)
and bonds form and break the way they do in nature: probabilistically, gated by the kinetic
energy of the atoms involved. Watch N₂ triple bonds shrug off heat that shatters water, detonate
a salt crystal into an ion storm, or inject pure oxygen into a combustion chamber and see what
happens.

Zero runtime dependencies. TypeScript + Vite + canvas 2D. ~17 kB built.

## Quick start

```bash
npm install
npm run dev     # serves on http://localhost:4173 and your LAN (--host)
```

Other scripts: `npm test` (vitest, 60 tests) · `npm run typecheck` · `npm run build`.

## What you're looking at

- **Atoms** are drawn in standard CPK colors, sized by covalent radius, labeled with their symbol.
- **Bonds** form when two compatible atoms meet with enough energy (activation gate) but not too
  much (capture window), and break when the thermal bath or a collision exceeds the bond's real
  dissociation energy — N≡N at 945 kJ/mol outlives O–H at 463, which outlives a single N–N link
  at ~180. Bond order renders as parallel strokes (see N₂'s triple line).
- **Reactions conserve momentum exactly** (impulses ∝ 1/mass) and **exchange real energy**:
  formation is exothermic (released energy kicks the fragments — combustion chain-reacts),
  breaking is endothermic.
- **Ions**: ionic pairs (|ΔEN| ≥ 1.7, e.g. Na–Cl) cleave heterolytically into charged ions that
  feel Coulomb forces and recombine barrierlessly. Ion rings and +/− badges mark them on canvas.
- **Molecules** are recognized live via connected components + Hill-formula canonicalization —
  the ticker names them (H₂O, CO₂, CH₄, NaCl, …); click it for a ranked bar chart of the mix.

## Environments

| Preset | Mix (atom %) | Why it's here |
|---|---|---|
| Air | N 78 · O 21 · Ar 1 | Earth's atmosphere; N₂/O₂ form, Ar stays inert |
| Sun | H 91 · He 9 | H₂ everywhere, helium bonds with nothing |
| Earth | O 51 · Fe 16 · Mg 15.5 · Si 14.6 · … | bulk-Earth silicates and oxides |
| Body | H 62 · O 24 · C 12 · N 1 · … | organics + water |
| Sea | H 66 · O 33 · trace NaCl | water assembly, dissolved salt |
| Salt | Na 50 · Cl 50 | ionic bonding demo — heat it, then cool it |
| Burn | H 55 · O 30 · C 15 | exothermic combustion chains |
| Soup | H 55 · C 15 · O 15 · N 12 · … | primordial organics assembly |

## Controls

- **Presets** respawn the field at half the atom cap (the other half is your injection budget).
- **Click the canvas** to inject the element selected in the *Click injects* row (`Mix` = the
  preset's own distribution). Overfilling past the cap is allowed — the oldest atoms decay away
  (~12/s) until the field is back at the ceiling.
- **Temperature** drives the thermal bath both ways: hot dissociates (weakest bonds first),
  cold lets everything re-form.
- **Burst** detonates: every bond snaps at once and the fragments are ejected along their bond
  axes with several times the bond energy, momentum-conserving. Try it on Salt.
- **Attract / Repel / Vortex** shape the pointer force field; **Reset** restores the control
  baseline and respawns.

## How the chemistry works

`src/chemistry.ts` is pure and fully unit-tested: pair affinity is derived from element
properties (noble gases inert; metal+nonmetal with a large electronegativity gap → ionic;
nonmetal pairs → covalent; metal–metal → weak clustering) with ~15 curated real bond energies
so the famous molecules reliably emerge. Formation and breaking probabilities are
Boltzmann-flavored in the pair's relative kinetic energy (½μ|Δv|², mapped to kJ/mol).
`src/sim.ts` owns the kinetics: encounters, springs, thermal bath, cooldowns, Coulomb forces,
and the energy-conserving reaction impulses.

It is a demo, not a simulator: no orbitals, no photons, no third-body recombination — see the
build docs for the honest list of simplifications.

## Project docs

Built as a structured-feature-dev campaign — one approved build plan, nine stacked slices, and
a two-phase validation run whose verdicts and evidence live in the repo:

- [`specs/element-bonds-build-plan.md`](specs/element-bonds-build-plan.md) — design decisions D1–D7 and the slice plan
- [`specs/element-bonds-v2-judgement-calls.md`](specs/element-bonds-v2-judgement-calls.md) — every autonomous call (J1–J17) from the unattended v2 run
- [`specs/pr-bodies/`](specs/pr-bodies/) — one reviewable PR body per slice
- [`validation/`](validation/) — baseline, test plan, pass/fail gates, and the GREEN results docs
