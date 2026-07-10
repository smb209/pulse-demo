# Slice 8 — Molecule mix bar graph

**Branch:** `feat/element-bonds-8-molecule-chart` → base `feat/element-bonds-7-presets-injector`

## Summary
J11 per the dataviz skill: clicking the ticker pill toggles a glass card with a ranked
horizontal bar list — top 8 molecule species as % of all molecules plus an "other" fold
and a total. Single-hue bars (magnitude ranking, identity in row labels — no categorical
palette to validate), values in text tokens, per-row tooltip with exact counts, rounded
data-end anchored at the baseline, chevron affordance on the ticker.

## Test plan
- [x] tsc clean; vitest 58/58 (chart is DOM-render logic over the already-tested analyzeMolecules)
- [x] Live: burn preset settled via step(3600) → real ticker click opens the card showing
      H₂O 26% ×19, H₂ 19% ×14, HO/CO₂/O₂/CH₄..., other 16% ×12, 74 total (screenshot in transcript)
- [x] Empty state ("no molecules yet") on fresh fields
