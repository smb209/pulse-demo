# element-bonds — Validation

Per the structured-feature-dev skill. Companion to [specs/element-bonds-build-plan.md](../specs/element-bonds-build-plan.md).

Run order:

1. [00-baseline.md](00-baseline.md) — captured 2026-07-10, before any slice merges; pre-existing failure inventory.
2. [01-pre-check.md](01-pre-check.md) — runbook to reach known-good state before each test-plan execution.
3. [02-test-plan.md](02-test-plan.md) — concrete scenarios (S* structural, P* integration).
4. [03-criteria.md](03-criteria.md) — pass/fail gates.
5. [04-results.md](04-results.md) — verdict + evidence; the operator's read.

Capture path for artifacts: `/tmp/pulse-demo-validation/element-bonds/<scenario_id>/`.

Integration model: preview_* tools driving the real UI (clicks/fills on the served page at `http://localhost:4173`), state read via the read-only `window.__pulse.stats()` hook (build-plan D7). No external systems, no side effects beyond the browser tab.
