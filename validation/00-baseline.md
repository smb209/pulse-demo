# 00 — Baseline observations

Captured 2026-07-10, before any slice merges (baseline commit `5052363`). Re-read before validation runs to confirm the substrate hasn't shifted.

## Schema / data state

No database. All state is in-memory per page load. Nothing persists across reloads (and nothing in this feature changes that).

## API / library state

No dependencies, no package.json, no modules. One file: `index.html` (453 lines, inline script). Key contracts the feature replaces:

- `spawn()` `index.html:286-298` — particle factory with `life` decay field
- `settle()` `index.html:300-311` — population set-point trim
- link pass `index.html:405-426` — cosmetic O(n²) proximity lines
- physics loop `index.html:361-403` — pointer forces, damping, jitter, wall bounce

## UI state

Dark glass panel: 3 mode buttons (Attract/Repel/Vortex), Density slider (40–400), Link range slider (0–200), Burst button. Stats: FPS + orb count. Panel is a left sidebar ≥721px, bottom sheet ≤720px. Verified today at desktop and 375×812: 60fps, no console errors.

## Environment

- Test command: none exists at baseline. From slice 1: `npm test` (`node --test 'tests/*.test.mjs'`, zero deps). Node v-check at pre-check time.
- Dev server: `preview_start` name `pulse-demo` → `python3 -m http.server 4173 --bind 0.0.0.0 --directory pulse-demo` (run from `/Users/snappytwo/dontwork`)
- State reset: page reload (no persistent state)
- Integration model: preview_* UI driving + `window.__pulse.stats()` read probe (exists from slice 2)

## Pre-existing test failures (captured at slice 0)

_No pre-existing test failures on `main` at slice-0 cut — no test harness exists at baseline (first tests land in slice 1)._

Baseline manual verification (this session): page serves 200 on LAN, 60fps both viewports, zero console errors/warnings.
