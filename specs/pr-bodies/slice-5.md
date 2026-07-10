# Slice 5 — TypeScript + Vite migration

**Branch:** `feat/element-bonds-5-vite` → base `feat/element-bonds-4-molecules`

## Summary
Behavior-neutral migration: js/*.js → src/*.ts under `strict` TypeScript, vite dev/build
(port 4173, `--host` for LAN — URL unchanged), vitest replaces node --test (assert bodies
kept; only the `test` import changed). Typed public surface: ChemElement, Atom, Bond,
SimStats, Preset, MoleculeReport. Judgement calls J1–J4 in specs/element-bonds-v2-judgement-calls.md.

## Test plan
- [x] `tsc --noEmit` clean (strict)
- [x] `vitest run` 42/42 (same tests as v1 tip)
- [x] `vite build` succeeds (16.9 kB js)
- [x] Live: vite dev serves localhost + LAN 200, console clean, sim runs
- launch.json: python http.server → `npm run dev --prefix pulse-demo`
