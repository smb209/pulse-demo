// Reaction Foundry — a small, data-driven puzzle mode on top of the existing sim.
// Boot with ?game=1. Reuses the sim engine + chemistry via sim.setEnvironment().

import { createSim, drawRadius, type Atom } from '../sim';
import { BY_SYMBOL } from '../elements';
import { formulaOf, analyzeMolecules } from '../chemistry';
import { TOOL_TYPES, LEVELS } from './content';
import type { LevelDef, ToolInstance } from './types';

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const unsub = (s: string) => s.replace(/[₀-₉]/g, c => String(SUBS.indexOf(c)));

interface Emitter { element: string; px: number; py: number; angle: number; mols: number; rate: number; speed: number; spread: number; aimable: boolean; emitted: number; }
interface Zone { id: string; px: number; py: number; pw: number; ph: number; label: string; }

export function initGame(): void {
  injectStyles();
  const params = new URLSearchParams(location.search);
  const levelIdx = Math.max(0, Math.min(LEVELS.length - 1, (parseInt(params.get('level') || '1', 10) || 1) - 1));
  const level = LEVELS[levelIdx];

  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  // Fixed logical board, letterboxed to fit any viewport → identical difficulty on every
  // screen (all physics distances — damping reach, tool radii — live in these logical px).
  const BOARD = level.board ?? { w: 960, h: 600 };
  const W = BOARD.w, H = BOARD.h;
  let dpr = 1;

  const sim = createSim({
    width: W, height: H,
    sampleElement: () => BY_SYMBOL[level.emitters[0].element],
    cap: level.cap, temperature: level.temperature,
  });
  sim.setPhysics({ collisions: level.collisions ?? true });

  // --- board layout (level fractions → canvas px) ---------------------------
  let emitters: Emitter[] = [];
  let zones: Zone[] = [];
  function layout(): void {
    // preserve player-set angles + emitted counts across re-layout (resize)
    const prev = emitters;
    emitters = level.emitters.map((e, i) => ({
      element: e.element, px: e.x * W, py: e.y * H, angle: prev[i]?.angle ?? e.angle,
      mols: e.mols, rate: e.rate, speed: e.speed, spread: e.spread ?? 0,
      aimable: e.aimable ?? false, emitted: prev[i]?.emitted ?? 0,
    }));
    zones = level.zones.map(z => ({ id: z.id, px: z.x * W, py: z.y * H, pw: z.w * W, ph: z.h * H, label: z.label ?? '' }));
  }

  layout();
  function fit(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.position = 'fixed'; canvas.style.inset = 'auto';
    canvas.style.left = '50%'; canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    canvas.style.width = (W * scale) + 'px'; canvas.style.height = (H * scale) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fit);
  fit();
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };

  // --- tools + environment hook --------------------------------------------
  let tools: ToolInstance[] = [];
  function mkTool(type: string, x: number, y: number, angle = 0, fixed = false): ToolInstance {
    const tt = TOOL_TYPES[type];
    return { type, x, y, angle: angle || tt.defaults.angle || 0, radius: tt.defaults.radius, strength: tt.defaults.strength, color: tt.color, fixed };
  }
  function loadTools(): void {
    tools = (level.preplaced ?? []).map(p => mkTool(p.type, p.x * W, p.y * H, p.angle, p.fixed));
  }
  loadTools();

  sim.setEnvironment({
    force(a, dt) { for (const t of tools) TOOL_TYPES[t.type].force?.(t, a, dt); },
    formBoost(x, y, sa, sb) { let m = 1; for (const t of tools) { const b = TOOL_TYPES[t.type].formBoost?.(t, x, y, sa, sb); if (b !== undefined) m *= b; } return m; },
    breakBoost(x, y) { let m = 1; for (const t of tools) { const b = TOOL_TYPES[t.type].breakBoost?.(t, x, y); if (b !== undefined) m *= b; } return m; },
  });

  // --- game state (setup → run → done) --------------------------------------
  type Phase = 'setup' | 'run' | 'done';
  let phase: Phase = 'setup';
  let collected = 0;
  let elapsed = 0;
  let settle = 0;   // seconds since the last atom was emitted
  let result: { won: boolean; stars: number; theoretical: number } | null = null;
  const SETTLE = level.settleSeconds ?? 6;
  const emitAcc = new Array(level.emitters.length).fill(0);

  function parseFormula(f: string): Record<string, number> {
    const c: Record<string, number> = {};
    for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) if (m[1]) c[m[1]] = (c[m[1]] ?? 0) + (m[2] ? +m[2] : 1);
    return c;
  }
  // stoichiometric ceiling: how much product the reactant budget could make in theory
  function theoreticalMax(): number {
    const budget: Record<string, number> = {};
    for (const e of emitters) budget[e.element] = (budget[e.element] ?? 0) + e.mols;
    const need = parseFormula(level.objective.formula);
    let max = Infinity;
    for (const s in need) max = Math.min(max, Math.floor((budget[s] ?? 0) / need[s]));
    return Number.isFinite(max) ? max : 0;
  }

  function startRun(): void {
    if (phase !== 'setup') return;
    for (const a of [...sim.atoms]) sim.despawn(a);
    for (const e of emitters) e.emitted = 0;
    emitAcc.fill(0);
    collected = 0; elapsed = 0; settle = 0; result = null;
    selected = null; aiming = null; dragging = null; aimingEmitter = null;
    phase = 'run'; syncHUD();
  }
  function reset(): void {            // back to setup, keeping the placed tools
    for (const a of [...sim.atoms]) sim.despawn(a);
    for (const e of emitters) e.emitted = 0;
    emitAcc.fill(0);
    collected = 0; elapsed = 0; settle = 0; result = null; phase = 'setup';
    hideResult(); syncHUD();
  }
  function clearBoard(): void { tools = tools.filter(t => t.fixed); reset(); }

  // --- collector: bonded components of the target formula fully inside a tank -
  let collectTimer = 0;
  function collect(): void {
    const parent = new Map<Atom, Atom>();
    const find = (x: Atom): Atom => {
      let r = x; while (parent.get(r) !== r) r = parent.get(r)!;
      while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r;
    };
    for (const bd of sim.bonds) {
      if (!parent.has(bd.a)) parent.set(bd.a, bd.a);
      if (!parent.has(bd.b)) parent.set(bd.b, bd.b);
      const ra = find(bd.a), rb = find(bd.b); if (ra !== rb) parent.set(ra, rb);
    }
    const groups = new Map<Atom, Atom[]>();
    for (const a of parent.keys()) { const r = find(a); const g = groups.get(r); if (g) g.push(a); else groups.set(r, [a]); }
    for (const atoms of groups.values()) {
      const counts: Record<string, number> = {};
      for (const a of atoms) counts[a.el.symbol] = (counts[a.el.symbol] ?? 0) + 1;
      if (unsub(formulaOf(counts)) !== level.objective.formula) continue;
      let cx = 0, cy = 0; for (const a of atoms) { cx += a.x; cy += a.y; } cx /= atoms.length; cy /= atoms.length;
      const z = zones.find(z => cx >= z.px && cx <= z.px + z.pw && cy >= z.py && cy <= z.py + z.ph);
      if (z) { for (const a of atoms) sim.despawn(a); collected++; }
    }
  }

  // scored on yield: collected vs the stoichiometric ceiling the budget allowed
  function finish(): void {
    phase = 'done';
    collect();
    const theoretical = theoreticalMax();
    const goal = level.objective.count;
    const won = collected >= goal;
    // stars scale with how far past the minimum you push the yield (yield% is shown as flavour)
    const stars = !won ? 0 : collected >= goal * 2 ? 3 : collected >= Math.ceil(goal * 1.5) ? 2 : 1;
    result = { won, stars, theoretical };
    showResult();
  }

  // --- interaction (setup phase only) ---------------------------------------
  let selected: string | null = null;      // palette type queued for placement
  let dragging: ToolInstance | null = null; // existing tool being moved
  let aiming: ToolInstance | null = null;   // freshly placed tool being aimed by drag
  let aimingEmitter: Emitter | null = null; // aimable emitter being rotated
  let aimPt = { x: 0, y: 0 };
  const hit = (x: number, y: number) => tools.find(t => !t.fixed && Math.hypot(t.x - x, t.y - y) < 22);
  const hitEmitter = (x: number, y: number) => emitters.find(e => e.aimable && Math.hypot(e.px - x, e.py - y) < 26);

  canvas.addEventListener('pointerdown', e => {
    if (phase !== 'setup') return;
    const p = toLocal(e);
    const em = hitEmitter(p.x, p.y);
    if (em) { aimingEmitter = em; return; }
    const grabbed = hit(p.x, p.y);
    if (grabbed) { dragging = grabbed; return; }
    if (selected) {
      const placed = tools.filter(t => t.type === selected).length;
      const limit = level.palette.find(pl => pl.type === selected)!.limit;
      if (placed < limit) { const t = mkTool(selected, p.x, p.y); tools.push(t); aiming = t; aimPt = p; syncPalette(); }
    }
  });
  window.addEventListener('pointermove', e => {
    if (phase !== 'setup') return;
    const p = toLocal(e);
    if (aimingEmitter) { aimingEmitter.angle = Math.atan2(p.y - aimingEmitter.py, p.x - aimingEmitter.px); return; }
    if (aiming) {
      aimPt = p;
      const dx = p.x - aiming.x, dy = p.y - aiming.y;
      if (Math.hypot(dx, dy) > 10) TOOL_TYPES[aiming.type].aim?.(aiming, dx, dy);
      return;
    }
    if (dragging) { dragging.x = Math.max(0, Math.min(W, p.x)); dragging.y = Math.max(0, Math.min(H, p.y)); }
  });
  window.addEventListener('pointerup', () => { dragging = null; aiming = null; aimingEmitter = null; });
  canvas.addEventListener('dblclick', e => {
    if (phase !== 'setup') return;
    const p = toLocal(e);
    const t = hit(p.x, p.y);
    if (t) { tools = tools.filter(x => x !== t); syncPalette(); }
  });

  // --- HUD ------------------------------------------------------------------
  const hud = buildHUD(level, levelIdx, levelIdx < LEVELS.length - 1);
  function syncPalette(): void {
    for (const btn of hud.paletteBtns) {
      const type = btn.dataset.type!;
      const placed = tools.filter(t => t.type === type).length;
      const limit = level.palette.find(p => p.type === type)!.limit;
      btn.querySelector('.pl-count')!.textContent = `${limit - placed}`;
      btn.classList.toggle('selected', selected === type);
      btn.classList.toggle('empty', limit - placed <= 0);
    }
  }
  for (const btn of hud.paletteBtns) {
    btn.addEventListener('click', () => { if (phase !== 'setup') return; selected = selected === btn.dataset.type ? null : btn.dataset.type!; syncPalette(); });
  }
  hud.startBtn.addEventListener('click', startRun);
  hud.resetBtn.addEventListener('click', reset);
  hud.clearBtn.addEventListener('click', clearBoard);
  hud.replayBtn.addEventListener('click', reset);

  function syncHUD(): void {
    document.body.dataset.phase = phase;
    hud.progress.textContent = `${Math.min(collected, level.objective.count)} / ${level.objective.count}`;
    syncPalette();
  }
  syncHUD();

  function showResult(): void {
    const r = result!;
    const yieldPct = r.theoretical > 0 ? Math.round(collected / r.theoretical * 100) : 0;
    hud.winTitle.textContent = r.won ? 'Reaction complete' : 'Not enough product — retry';
    hud.winStars.textContent = r.won ? ('★★★'.slice(0, r.stars) + '☆☆☆'.slice(0, 3 - r.stars)) : '☆☆☆';
    hud.winMeta.textContent = `Collected ${collected} of ${r.theoretical} possible · ${yieldPct}% yield`;
    hud.fact.textContent = r.won && level.fact ? `Did you know? ${level.fact}` : (r.won ? '' : 'Route more reactants into the tank, or waste fewer — try a different setup.');
    if (hud.nextBtn) hud.nextBtn.style.display = r.won ? '' : 'none';
    hud.winWrap.style.display = 'flex';
  }
  function hideResult(): void { hud.winWrap.style.display = 'none'; }

  // --- loop -----------------------------------------------------------------
  function tick(dtMs: number): void {
    if (phase !== 'run') return;
    elapsed += dtMs / 1000;
    let emitting = false;
    emitters.forEach((e, i) => {
      if (e.emitted >= e.mols) return;
      emitting = true;
      emitAcc[i] += e.rate * dtMs / 1000;
      while (emitAcc[i] >= 1 && e.emitted < e.mols) {
        emitAcc[i] -= 1; e.emitted++;
        const ang = e.angle + (Math.random() - 0.5) * e.spread;
        sim.spawnAtom(BY_SYMBOL[e.element], e.px, e.py, Math.cos(ang) * e.speed, Math.sin(ang) * e.speed);
      }
    });
    sim.step(dtMs);
    // contaminant getters adsorb atoms drifting through them
    for (const t of tools) {
      const ad = TOOL_TYPES[t.type].adsorb;
      if (!ad) continue;
      for (const a of [...sim.atoms]) if (Math.random() < ad(t, a.x, a.y)) sim.despawn(a);
    }
    collectTimer += dtMs;
    if (collectTimer >= 200) { collectTimer = 0; collect(); }
    // once the reactants are spent, give stragglers a grace period, then score
    if (emitting) settle = 0;
    else { settle += dtMs / 1000; if (settle >= SETTLE) finish(); }
  }

  let last = performance.now();
  function frame(now: number): void {
    const dtMs = now - last; last = now;
    tick(dtMs);
    draw();
    hud.progress.textContent = `${Math.min(collected, level.objective.count)} / ${level.objective.count}`;
    const emittedTotal = emitters.reduce((s, e) => s + e.emitted, 0);
    const molsTotal = emitters.reduce((s, e) => s + e.mols, 0);
    hud.timer.textContent = phase === 'run' ? `${emittedTotal}/${molsTotal} mol` : `${molsTotal} mol`;
    hud.pres.textContent = phase === 'setup' ? '—' : (sim.stats().pressure * 1000).toFixed(1);
    requestAnimationFrame(frame);
  }

  function draw(): void {
    ctx.fillStyle = '#111414'; ctx.fillRect(0, 0, W, H);

    // collector zones
    for (const z of zones) {
      ctx.save();
      ctx.fillStyle = 'rgba(68,212,228,0.06)';
      ctx.strokeStyle = '#44D4E4'; ctx.setLineDash([7, 6]); ctx.lineWidth = 2;
      ctx.fillRect(z.px, z.py, z.pw, z.ph);
      ctx.strokeRect(z.px, z.py, z.pw, z.ph);
      ctx.setLineDash([]);
      ctx.fillStyle = '#8B9698'; ctx.font = '600 11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`collect ${z.label}`, z.px + 8, z.py + 7); // inside the zone, clear of the HUD
      ctx.restore();
    }

    // emitters — element disc, direction nozzle, and an mols label (remaining while running)
    for (const e of emitters) {
      const el = BY_SYMBOL[e.element];
      ctx.save();
      // direction nozzle
      ctx.strokeStyle = e.aimable ? '#F1F3F3' : '#6A7273';
      ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
      const nx = e.px + Math.cos(e.angle) * 24, ny = e.py + Math.sin(e.angle) * 24;
      ctx.beginPath(); ctx.moveTo(e.px, e.py); ctx.lineTo(nx, ny);
      ctx.lineTo(nx - Math.cos(e.angle - 0.5) * 7, ny - Math.sin(e.angle - 0.5) * 7);
      ctx.moveTo(nx, ny); ctx.lineTo(nx - Math.cos(e.angle + 0.5) * 7, ny - Math.sin(e.angle + 0.5) * 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (e.aimable && phase === 'setup') { // rotatable hint ring
        ctx.strokeStyle = '#F1F3F3'; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(e.px, e.py, 24, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = el.cpk;
      ctx.beginPath(); ctx.arc(e.px, e.py, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101414'; ctx.font = '700 11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(el.symbol, e.px, e.py + 0.5);
      // mols label below
      ctx.fillStyle = '#A0AAAB'; ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'top';
      const remaining = phase === 'run' ? e.mols - e.emitted : e.mols;
      ctx.fillText(`${remaining} mol`, e.px, e.py + 16);
      ctx.restore();
    }

    // tools (highlight the one being placed/moved)
    for (const t of tools) TOOL_TYPES[t.type].draw(ctx, t, t === aiming || t === dragging);
    // live aim guide while placing
    if (aiming) {
      ctx.save();
      ctx.strokeStyle = aiming.color; ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(aiming.x, aiming.y); ctx.lineTo(aimPt.x, aimPt.y); ctx.stroke();
      ctx.restore();
    }

    // bonds
    ctx.strokeStyle = 'rgba(190,210,214,0.5)'; ctx.lineWidth = 1.5;
    for (const bd of sim.bonds) {
      ctx.beginPath(); ctx.moveTo(bd.a.x, bd.a.y); ctx.lineTo(bd.b.x, bd.b.y); ctx.stroke();
    }

    // atoms
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of sim.atoms) {
      const r = drawRadius(p.el);
      ctx.fillStyle = p.el.cpk;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (r >= 4) {
        ctx.fillStyle = '#0d1414'; ctx.font = `700 ${Math.max(7, r)}px -apple-system, system-ui, sans-serif`;
        ctx.fillText(p.el.symbol, p.x, p.y + 0.5);
      }
    }
  }

  requestAnimationFrame(frame);

  // Dev handle for headless verification (backgrounded preview tabs suspend rAF).
  (window as unknown as { __game: unknown }).__game = {
    start: () => startRun(),
    reset: () => reset(),
    tick: (ms = 16.67, n = 1) => { for (let i = 0; i < n; i++) tick(ms); return { phase, collected, atoms: sim.atoms.length }; },
    aimEmitter: (i: number, deg: number) => { if (emitters[i]) emitters[i].angle = deg * Math.PI / 180; },
    place: (type: string, xf: number, yf: number, angleDeg?: number) => { const t = mkTool(type, xf * W, yf * H); if (angleDeg != null) t.angle = angleDeg * Math.PI / 180; tools.push(t); syncPalette(); },
    clear: () => { tools = tools.filter(t => t.fixed); syncPalette(); },
    report: () => analyzeMolecules(sim.bonds).molecules,
    theoretical: () => theoreticalMax(),
    state: () => ({ phase, collected, won: result?.won ?? false, stars: result?.stars ?? 0, theoretical: theoreticalMax(), atoms: sim.atoms.length, bonds: sim.bonds.length, tools: tools.length, elapsed: Math.round(elapsed) }),
  };
}

// --- HUD DOM -----------------------------------------------------------------

interface HUD {
  paletteBtns: HTMLButtonElement[];
  progress: HTMLElement; timer: HTMLElement; temp: HTMLElement; pres: HTMLElement;
  startBtn: HTMLElement; resetBtn: HTMLElement; clearBtn: HTMLElement;
  winWrap: HTMLElement; winTitle: HTMLElement; winStars: HTMLElement; winMeta: HTMLElement; fact: HTMLElement;
  replayBtn: HTMLElement; nextBtn: HTMLElement | null;
}

function buildHUD(level: LevelDef, levelIdx: number, hasNext: boolean): HUD {
  const root = document.createElement('div');
  root.id = 'gameHUD';
  const palette = level.palette.map(p => {
    const t = TOOL_TYPES[p.type];
    return `<button class="pl-btn" data-type="${p.type}" title="${t.blurb}">
      <span class="pl-dot" style="background:${t.color}"></span>${t.name}<span class="pl-count">${p.limit}</span></button>`;
  }).join('');
  const nextHref = `${location.pathname}?game=1&level=${levelIdx + 2}`;
  root.innerHTML = `
    <div id="gCond">
      <div class="cond"><span>Temp</span><b id="gTemp">${level.temperature}°</b></div>
      <div class="cond"><span>Press</span><b id="gPres">—</b></div>
    </div>
    <div id="gTop">
      <div class="g-title">${level.name}${level.featured ? ` <span class="g-el">${level.featured}</span>` : ''}</div>
      ${level.reaction ? `<div class="g-rxn">${level.reaction}</div>` : ''}
      <div class="g-obj">Collect <b>${level.objective.count}</b> ${objLabel(level)} · <span id="gProg">0 / ${level.objective.count}</span> · <span id="gTime">0s</span></div>
      <div class="g-blurb">${level.blurb}</div>
    </div>
    <div id="gBottom">
      <div class="g-hint">Setup — place &amp; aim your tools, rotate the aimable emitters (white ring), then Start.</div>
      <div class="g-row" id="gPalette">${palette}</div>
      <div class="g-row">
        <button class="pl-btn primary" id="gStart">▶ Start reaction</button>
        <button class="pl-btn ghost" id="gClear">Clear</button>
        <button class="pl-btn ghost" id="gReset">Reset run</button>
        <a class="pl-btn ghost" href="${location.pathname}">Sandbox</a>
      </div>
    </div>
    <div id="gWin">
      <div class="g-card">
        <div class="g-win-title" id="gWinTitle">Reaction complete</div>
        <div id="gStars">★★★</div>
        <div id="gWinMeta"></div>
        <div id="gFact"></div>
        <div class="g-card-row">
          <button class="pl-btn" id="gReplay">Retry</button>
          ${hasNext ? `<a class="pl-btn" id="gNext" href="${nextHref}">Next level ▸</a>` : ''}
          <a class="pl-btn ghost" href="${location.pathname}">Sandbox</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  return {
    paletteBtns: [...root.querySelectorAll<HTMLButtonElement>('.pl-btn[data-type]')],
    progress: root.querySelector('#gProg')!,
    timer: root.querySelector('#gTime')!,
    temp: root.querySelector('#gTemp')!,
    pres: root.querySelector('#gPres')!,
    startBtn: root.querySelector('#gStart')!,
    resetBtn: root.querySelector('#gReset')!,
    clearBtn: root.querySelector('#gClear')!,
    winWrap: root.querySelector('#gWin')!,
    winTitle: root.querySelector('#gWinTitle')!,
    winStars: root.querySelector('#gStars')!,
    winMeta: root.querySelector('#gWinMeta')!,
    fact: root.querySelector('#gFact')!,
    replayBtn: root.querySelector('#gReplay')!,
    nextBtn: root.querySelector('#gNext'),
  };
}

function objLabel(level: LevelDef): string {
  // pretty-print the ascii formula with subscripts
  return level.objective.formula.replace(/([A-Za-z])(\d+)/g, (_, s, n) => s + String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join(''));
}

function injectStyles(): void {
  const s = document.createElement('style');
  s.textContent = `
    body.game > header, body.game #panel, body.game #stats, body.game #ticker,
    body.game #molechart, body.game #gasHUD, body.game #viewCycle, body.game #hint { display: none !important; }
    #gameHUD { position: fixed; inset: 0; z-index: 20; pointer-events: none; font-family: -apple-system, system-ui, sans-serif; }
    #gameHUD button, #gameHUD a { pointer-events: auto; }
    #gCond { position: fixed; top: max(12px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 6px; user-select: none; }
    #gCond .cond { display: flex; align-items: baseline; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px 9px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    #gCond .cond span { font-size: 0.56rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
    #gCond .cond b { font-size: 0.82rem; color: var(--primary); font-variant-numeric: tabular-nums; font-weight: 600; }
    #gTop { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); text-align: center; user-select: none; }
    #gTop .g-title { font-size: 1.05rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
      background: linear-gradient(100deg, var(--primary), var(--secondary), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    #gTop .g-obj { font-size: 0.82rem; color: var(--text-muted); margin-top: 3px; }
    #gTop .g-obj b { color: var(--primary); }
    #gTop .g-obj #gProg { color: var(--text); font-variant-numeric: tabular-nums; }
    #gTop .g-el { font-size: 0.7rem; font-weight: 700; color: var(--bg); background: var(--accent); border-radius: 6px; padding: 1px 6px; vertical-align: middle; -webkit-background-clip: border-box; background-clip: border-box; }
    #gTop .g-rxn { font-size: 0.82rem; font-weight: 600; color: var(--primary); letter-spacing: 0.04em; margin-top: 2px; font-variant-ligatures: none; }
    #gTop .g-blurb { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; max-width: min(560px, calc(100vw - 30px)); line-height: 1.35; }
    #gBottom { position: fixed; bottom: max(12px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(560px, calc(100vw - 20px)); }
    #gBottom .g-hint { font-size: 0.64rem; color: var(--text-muted); letter-spacing: 0.04em; }
    #gBottom .g-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .pl-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; font-size: 0.78rem; font-weight: 600;
      color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; cursor: pointer;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); text-decoration: none; -webkit-tap-highlight-color: transparent; }
    .pl-btn:active { transform: scale(0.96); }
    .pl-btn.selected { border-color: var(--primary); box-shadow: 0 0 14px rgba(68,212,228,0.4); color: var(--primary); }
    .pl-btn.empty { opacity: 0.4; }
    .pl-btn.ghost { color: var(--text-muted); }
    .pl-btn.primary { color: var(--bg); background: linear-gradient(100deg, var(--primary), var(--secondary)); border-color: transparent; font-weight: 700; box-shadow: 0 0 16px rgba(68,212,228,0.4); }
    /* phase-gated bottom bar */
    body[data-phase="run"] #gPalette, body[data-phase="run"] #gStart, body[data-phase="run"] #gClear { display: none; }
    body[data-phase="setup"] #gReset { display: none; }
    body[data-phase="done"] #gBottom { display: none; }
    .pl-dot { width: 10px; height: 10px; border-radius: 50%; }
    .pl-count { font-variant-numeric: tabular-nums; color: var(--text-muted); min-width: 12px; text-align: center; }
    .pl-btn.selected .pl-count { color: var(--primary); }
    #gWin { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(10,12,12,0.6); backdrop-filter: blur(4px); }
    #gWin .g-card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 26px 30px;
      background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); width: min(420px, calc(100vw - 32px)); text-align: center; }
    .g-win-title { font-size: 1.1rem; font-weight: 700; letter-spacing: 0.06em; color: var(--text); }
    #gStars { font-size: 2rem; letter-spacing: 0.1em; color: var(--accent); }
    #gWinMeta { font-size: 0.85rem; color: var(--text-muted); }
    #gFact { font-size: 0.78rem; color: var(--text-muted); line-height: 1.45; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 2px; }
    #gWin .g-card-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 4px; }
  `;
  document.head.appendChild(s);
}
