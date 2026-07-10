# 01 — Pre-check runbook

Reach known-good state before each test-plan execution. All steps are non-destructive (no persistent state exists in this project).

1. **Working tree** — `git -C /Users/snappytwo/dontwork/pulse-demo status --porcelain` is empty; `git log --oneline -1` records the commit under test (stack tip during validation).
2. **Unit substrate** — `npm test` from `pulse-demo/` exits 0 (from slice 1 onward). Any failure → **BLOCKED**, fix before scenarios.
3. **Server** — `preview_start` name `pulse-demo`; confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` → 200.
4. **Fresh page** — `preview_eval: window.location.reload()`; then `preview_console_logs level=warn` must be empty. Any error at idle → **BLOCKED**.
5. **Probe present** — `preview_eval: typeof window.__pulse?.stats` → `"function"` (slice 2+).
6. **Capture dirs** — `mkdir -p /tmp/pulse-demo-validation/element-bonds/<scenario_id>` per scenario about to run.

Halt rule: any BLOCKED above stops the run; record in 04-results and surface — do not work around.
