---
name: element-bonds — Build Plan
description: Slice plan + design decisions for turning Pulse's colored orbs into chemical elements (H–Pb) with energy-gated bonding and preset distributions
status: draft
spec: (this doc is the spec)
---

# element-bonds — Build Plan

Status: draft · Owner: smb209 · Date: 2026-07-10

Operator OKs this doc before any feature code lands. Per-slice unit tests + structural verification are the per-PR contract; full validation runs against the stack tip per the structured-feature-dev skill.

## Audit (current state, verified 2026-07-10)

The whole app is one file, `index.html` (453 lines), served statically by `python3 -m http.server 4173 --bind 0.0.0.0` (`.claude/launch.json` → `pulse-demo` config). Git repo initialized today; baseline commit `5052363`.

- **Particle model** — `index.html:286-298` (`spawn()`). Particles have position, velocity, radius, a random color from a 3-color `PALETTE` (`index.html:265`), and a `life` field: `Infinity` for calm particles, `1` (decaying) for burst particles. **Missing:** element identity, energy, bond list, valence tracking.
- **Decay/timeout** — `index.html:396-399`. Burst particles lose `0.008·dt` life per frame and are spliced out at 0. **This is the behavior the feature removes** — nodes must persist; population is bounded by a configurable cap instead.
- **Population control** — `index.html:300-311` (`settle()`), driven by the Density slider (`index.html:347-351`, range 40–400). Trims calm particles above target. Reusable as the cap-enforcement mechanism with different semantics (cap = hard max, not a set-point that culls).
- **Link rendering** — `index.html:405-426`. Draws distance-faded lines between ALL particle pairs within `linkDist`, O(n²), purely cosmetic. **This is the seam where chemistry goes:** replace "proximity implies a line" with "a bond object implies a line," keep the O(n²) neighbor scan as the bond-formation candidate pass.
- **Physics loop** — `index.html:361-403` (`step()`). Pointer force field (attract/repel/vortex), damping 0.985, thermal jitter `±0.02` (`index.html:381-383`), wall bounce. Velocity is already the natural substrate for node energy (½mv²) and the jitter constant is the natural temperature knob.
- **Controls** — `index.html:337-357`. Mode buttons, two sliders, burst button; glass panel reflows desktop-sidebar ↔ mobile-bottom-sheet at 720px (`index.html:96-121`). Pattern extends cleanly to a preset picker + more sliders.
- **Test/build infra** — none. No package.json, no test runner, no build step. Single-file inline `<script>` means nothing is importable or unit-testable today.

## Design decisions

### D1. Split the single file into ES modules, no build step

**Choice:** `index.html` + `js/elements.js` (data), `js/chemistry.js` (pure bonding logic), `js/sim.js` (physics + bond integration), `js/main.js` (UI wiring). Plain `<script type="module">`, still zero-dependency, still served statically.

- **Why:** the chemistry rules are the correctness-critical core and must be unit-testable. Pure modules run under `node --test` with no tooling. The audit shows nothing is testable today.
- **Why not keep one file:** inline scripts can't be imported by a test runner without HTML parsing hacks.
- **Why not a bundler/framework:** demo stays a "python -m http.server away from running" artifact; a build step kills that.
- **Reversible:** yes — modules can be re-inlined mechanically.

### D2. Element set = Z 1–82, properties table hand-curated

**Choice:** all 82 elements H→Pb in `elements.js`, each with: symbol, name, Z, atomic mass, CPK color, category (alkali, noble gas, transition metal, …), Pauling electronegativity (null for He/Ne/Ar), covalent radius (drives draw radius), and `maxBonds` (valence capacity: H=1, O=2, N=3, C=4, halogens=1, noble gases=0, alkali=1, alkaline-earth=2, Al=3, Si=4, transition metals=2, Pb=2, …).

- **Why CPK colors:** it's the convention chemists already know (H white, O red, N blue, C gray, S yellow…) — the demo reads as chemistry at a glance. The Electric Cyan palette stays for the UI chrome; the canvas becomes CPK.
- **Why maxBonds as a single integer:** real valence is context-dependent (S can be 2/4/6), but a single "typical bonding capacity" keeps the sim legible and the table auditable. Documented per-element in the file.
- **Reversible:** yes — it's a data table.

### D3. Bonding = property-derived affinity × energy gate, with a curated override list

**Choice:** `chemistry.js` computes pair affinity **from element properties** (general rules), then a small override table boosts ~15 chemically famous pairs so the presets produce recognizable nature.

General rules (in priority order):
1. Either partner a noble gas → affinity 0.
2. Either partner at full valence → no new bond (existing bonds unaffected).
3. Metal + nonmetal with |ΔEN| ≥ 1.7 → **ionic**, affinity scales with ΔEN (Na–Cl, Mg–O strong).
4. Nonmetal + nonmetal → **covalent**, affinity scales with (3.5 − ΔEN)/3.5 and both partners' EN > 2 (O–O, N–N, C–H, C–O…).
5. Metal + metal → weak **metallic** clustering affinity (0.15) so Fe/Ni/Mg clump rather than bond-network.

Override boosts (bond energies normalized from real kJ/mol): H–H 436, O=O 498, N≡N 945, O–H 463, C–H 413, C=O 799, Na–Cl 787(lattice-ish), Si–O 452, Fe–O 409, H–Cl 431, C–C 347, S–O 522, Mg–O 394, Ca–O 402, Al–O 512.

**Energy gate (both directions), Boltzmann-flavored:**
- **Formation:** on close approach, `P(bond) = affinity · exp(−E_act / E_rel)` clamped — a pair needs *some* relative kinetic energy to react (activation), so a frozen field bonds slowly.
- **Breaking:** each frame per bond, `P(break) = exp(−E_bond / E_rel)` — hot atoms shake bonds apart; N≡N (945) survives temperatures that shatter O–H (463). "Bond with the same probabilities as in nature, based on the energy of the node at that point in time" maps to exactly these two expressions.
- Node energy = ½·mass·|v|², with mass from the element table — heavy atoms at the same speed carry more bond-breaking punch, which is physically right.

- **Why hybrid rules+overrides:** pure property-derived rules get directionally-right behavior for all 3,403 pairs without an 82×82 table; the override list makes the famous molecules (H₂O, N₂, CO₂, NaCl, SiO₂) reliably emerge in presets.
- **Why not full quantum-accurate chemistry:** it's a 60fps canvas demo; the bar is "recognizably nature," not simulation-grade.
- **Reversible:** yes — affinity function is one pure function with locked unit tests.

### D4. Bonds are spring constraints, rendered by order

**Choice:** a bond is `{a, b, order, energy}`. Bonded atoms get a spring force toward rest length = sum of covalent radii; bonds render as solid lines (double/triple = parallel strokes), replacing the cosmetic proximity-links entirely. The Link-range slider is removed; a Temperature slider takes its place.

- **Why remove cosmetic links:** two line systems on one canvas is unreadable; bonds ARE the links now.
- **Reversible:** yes.

### D5. Persistence: no decay; hard configurable cap

**Choice:** delete the `life` mechanic entirely. All atoms persist forever. A **Max atoms** slider (50–500, default 250) is the only population bound. Preset selection respawns the field to the cap; Burst injects a preset-weighted handful only while below cap (at cap it flashes the counter instead).

- **Why 500 ceiling:** bond-candidate scan is O(n²); 500 atoms ≈ 125k pair checks/frame — measured-safe territory for the existing loop, and validation gate P5 enforces ≥30fps at cap.
- **Why respawn-on-preset:** mixing "sun" leftovers into "atmosphere" makes distribution validation meaningless.
- **Reversible:** yes.

### D6. Five presets, atom-count fractions from real data

| Preset | Composition (atom %) |
|---|---|
| **Earth's atmosphere** | N 78.1 · O 20.9 · Ar 0.93 · C 0.04 (CO₂ carbon) · Ne trace |
| **The Sun** | H 91.2 · He 8.7 · O 0.06 · C 0.03 · Fe/Ne traces |
| **Bulk Earth** | O 51 · Fe 16 · Mg 15.5 · Si 14.6 · S 2.5 · Al 1.4 · Ca 1.0 · Ni 0.8 |
| **Human body** | H 62 · O 24 · C 12 · N 1.1 · Ca 0.22 · P 0.22 · K/S/Na/Cl traces |
| **Seawater** | H 66.2 · O 33.1 · Cl 0.34 · Na 0.28 · Mg 0.03 · S/Ca/K traces |

(Human body + Seawater are the "2 others" — chosen because both are H/O-dominated but diverge visibly: body grows CH/CN organics, seawater grows H₂O + dissolved NaCl.)

- **Why atom fractions not mass fractions:** nodes are atoms; spawning by mass % would over-count heavy elements (bulk Earth by mass is Fe-first; by atoms it's O-first).
- **Reversible:** yes — data table.

### D7. Validation instrumentation: `window.__pulse` read-only debug hook

**Choice:** `main.js` exposes `window.__pulse = { stats() }` returning `{atoms, byElement, bonds, byBondPair, fps, temperature, cap}`. Validation drives the app through real UI controls (`preview_click`/`preview_fill`, per the validation-harness-fidelity convention) and reads state through this hook only.

- **Why:** distribution/bond assertions need numbers a screenshot can't give; a read-only probe doesn't bypass any UI-layer behavior.
- **Reversible:** yes; it's additive.

## Slice plan

Topology: **stacked** (each layer depends on the previous — data → engine → sim → presets/UI → polish). Branch base for slice N = slice N−1's branch.

### Slice 1 — Element data + chemistry engine (pure, tested)

**Branch:** `feat/element-bonds-1-chemistry` (off `main`)

**Files:**
- `js/elements.js` — 82-element table (D2)
- `js/chemistry.js` — `affinity(a,b)`, `bondCapacityLeft(atom)`, `bondFormProbability(a,b,eRel)`, `bondBreakProbability(bond,eRel)`, preset distribution tables + `samplePreset(name)` (D3, D6)
- `package.json` — name + `"test": "node --test tests/"` only; no dependencies
- `tests/chemistry.test.mjs` — see test strategy
- `specs/`, `validation/` docs co-land here

**Testable after this slice:** every chemistry contract (affinity rules 1–5, override energies, energy-gate monotonicity, preset fractions sum to 100, sampler convergence). Validation S1 exercisable.

**Dependencies:** none.

### Slice 2 — Sim refactor: atoms, persistence, energy, bonds

**Branch:** `feat/element-bonds-2-sim` (off slice 1)

**Files:**
- `js/sim.js` — particle loop extracted from `index.html:361-403`; atoms carry element + bond list; `life` mechanic deleted; cap enforcement (D5); bond formation/break sampling each frame using chemistry.js; bond spring forces (D4)
- `js/main.js` — canvas/render extracted; atoms drawn with CPK color + covalent-radius sizing + symbol label; bonds drawn by order; `window.__pulse` hook (D7)
- `index.html` — becomes markup + styles + module script tags; old inline script removed
- `tests/sim.test.mjs` — cap invariant, persistence invariant, bond-list/valence consistency (sim logic that's pure enough to test headless)

**Testable after this slice:** app runs with hydrogen-only placeholder spawn; scenarios P2 (persistence/cap) exercisable.

**Dependencies:** slice 1.

### Slice 3 — Presets + control panel v2

**Branch:** `feat/element-bonds-3-presets` (off slice 2)

**Files:**
- `index.html` / `js/main.js` — preset picker (5 buttons), **Max atoms** slider (50–500), **Temperature** slider replacing Link range, legend chip-row of the preset's top elements with CPK swatches; both responsive layouts (existing 720px breakpoint pattern)
- Burst becomes preset-weighted injection, cap-guarded (D5)
- `tests/` — preset→spawn integration assertions

**Testable after this slice:** P1 (distributions), P3 (chemistry sanity), P4 (energy gating) exercisable.

**Dependencies:** slice 2.

### Slice 4 — Molecule recognition + polish

**Branch:** `feat/element-bonds-4-molecules` (off slice 3)

**Files:**
- `js/chemistry.js` — connected-component scan + formula canonicalization; recognizer for H₂, O₂, N₂, H₂O, CO₂, CH₄, NaCl, SiO₂, FeO/Fe₂O₃
- `js/main.js` — live "molecules" ticker in the stats row (e.g. `H₂O ×12`); bond-order rendering polish
- `tests/molecules.test.mjs` — recognizer against hand-built graphs

**Testable after this slice:** P3 upgraded from bond-pair counting to named-molecule assertions.

**Dependencies:** slice 3.

## Test strategy summary

| Slice | Unit tests added | Validation scenarios exercisable |
|---|---|---|
| 1 | affinity rules (noble=0, ionic, covalent, metallic, valence-full), override energies present, form/break probability monotone in energy, preset tables sum≈100%, sampler ±2pp at n=10k | S1 |
| 2 | cap never exceeded, no atom removed while below cap, bond endpoints alive, valence never exceeded | S1, P2 |
| 3 | preset spawn matches table at sim level | P1, P3, P4, P5 |
| 4 | molecule recognizer on synthetic graphs (H-O-H → H₂O; O=C=O → CO₂; rejects H-O-O-H as water) | P3 (named molecules) |

Concrete scenarios live in [validation/](../validation/README.md).

## Memories that gate this work

_No project memories gate this work._ Two global conventions apply: validation drives the UI path, not direct APIs (validation-harness-fidelity), and the palette decision from earlier this session (Electric Cyan chrome) stays — canvas colors move to CPK per D2.

## Open questions for operator

1. **Local-only git, or create a GitHub repo?** `pulse-demo` has no remote. Default: local stacked branches, "PR" = branch + written PR body in `specs/pr-bodies/`, operator merges locally. Say the word and I'll `gh repo create` instead.
2. **Old "rainbow" mode:** D4/D5 replace the palette orbs and decay entirely. If you want a legacy toggle, that's a follow-up slice — default is full replacement.
3. **Default cap 250 / ceiling 500** — sized for 60fps on this Mac; bump only if validation P5 shows headroom.

None of these block the validation skeleton; #1 affects only merge mechanics.

## Out of scope (named explicitly)

- Chemical accuracy beyond "recognizably nature": no orbital hybridization, no charge/ion rendering, no reaction enthalpy bookkeeping, no catalysis.
- Elements beyond Pb (Z>82), isotopes, radioactivity/decay chains (ironic, given we're *removing* decay).
- Sound, WebGL/GPU renderer, offscreen-canvas workers — canvas 2D stays.
- Saving/sharing field state.
- Light mode for the canvas (CPK is calibrated for dark backgrounds).

## Cost ceiling

Free; local static demo, `node --test`, preview tools. No external services, no budget concern.

## Slice merge order

1. Each slice branches off the prior slice's branch; PR body written per slice in `specs/pr-bodies/slice-N.md`.
2. Merge order 1→4; before merging slice N into `main`, slice N+1 rebases onto `main` (local equivalent of retarget-before-merge).
3. No remote unless operator answers open question #1 with "GitHub."
