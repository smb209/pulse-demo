// Reaction Foundry — a small, data-driven puzzle mode on top of the existing sim.
// Boot with ?game=1. Reuses the sim engine + chemistry via sim.setEnvironment().

import { createSim, drawRadius, type Atom } from '../sim';
import { BY_SYMBOL } from '../elements';
import { formulaOf, analyzeMolecules } from '../chemistry';
import { TOOL_TYPES, LEVELS } from './content';
import type { LevelDef, ToolInstance } from './types';

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const unsub = (s: string) => s.replace(/[₀-₉]/g, c => String(SUBS.indexOf(c)));

interface Emitter { element: string; px: number; py: number; angle: number; rate: number; speed: number; spread: number; }
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
    emitters = level.emitters.map(e => ({
      element: e.element, px: e.x * W, py: e.y * H, angle: e.angle,
      rate: e.rate, speed: e.speed, spread: e.spread ?? 0,
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

  // --- game state -----------------------------------------------------------
  let collected = 0;
  let elapsed = 0;
  let won = false;
  const emitAcc = new Array(level.emitters.length).fill(0);

  function reset(): void {
    for (const a of [...sim.atoms]) sim.despawn(a);
    loadTools();
    collected = 0; elapsed = 0; won = false;
    emitAcc.fill(0);
    selected = null;
    hideWin();
    syncPalette();
  }

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
      const z = zones.find(z => atoms.every(a => a.x >= z.px && a.x <= z.px + z.pw && a.y >= z.py && a.y <= z.py + z.ph));
      if (z) { for (const a of atoms) sim.despawn(a); collected++; }
    }
    if (!won && collected >= level.objective.count) win();
  }

  function win(): void {
    won = true;
    const usedTools = tools.filter(t => !t.fixed).length;
    let stars = 1;
    if (elapsed <= level.par.seconds && usedTools <= level.par.tools) stars = 3;
    else if (elapsed <= level.par.seconds || usedTools <= level.par.tools) stars = 2;
    showWin(stars, usedTools);
  }

  // --- interaction: place / drag / remove tools -----------------------------
  let selected: string | null = null;      // palette type queued for placement
  let dragging: ToolInstance | null = null; // existing tool being moved
  let aiming: ToolInstance | null = null;   // freshly placed tool being aimed by drag
  let aimPt = { x: 0, y: 0 };
  const hit = (x: number, y: number) => tools.find(t => !t.fixed && Math.hypot(t.x - x, t.y - y) < 22);

  canvas.addEventListener('pointerdown', e => {
    if (won) return;
    const p = toLocal(e);
    const grabbed = hit(p.x, p.y);
    if (grabbed) { dragging = grabbed; return; }
    if (selected) {
      const placed = tools.filter(t => t.type === selected).length;
      const limit = level.palette.find(pl => pl.type === selected)!.limit;
      if (placed < limit) { const t = mkTool(selected, p.x, p.y); tools.push(t); aiming = t; aimPt = p; syncPalette(); }
    }
  });
  window.addEventListener('pointermove', e => {
    const p = toLocal(e);
    if (aiming) {
      aimPt = p;
      const dx = p.x - aiming.x, dy = p.y - aiming.y;
      if (Math.hypot(dx, dy) > 10) TOOL_TYPES[aiming.type].aim?.(aiming, dx, dy); // drag past deadzone = aim
      return;
    }
    if (dragging) {
      dragging.x = Math.max(0, Math.min(W, p.x));
      dragging.y = Math.max(0, Math.min(H, p.y));
    }
  });
  window.addEventListener('pointerup', () => { dragging = null; aiming = null; });
  canvas.addEventListener('dblclick', e => {
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
    btn.addEventListener('click', () => { selected = selected === btn.dataset.type ? null : btn.dataset.type!; syncPalette(); });
  }
  hud.resetBtn.addEventListener('click', reset);
  hud.replayBtn.addEventListener('click', reset);
  syncPalette();

  function showWin(stars: number, usedTools: number): void {
    hud.winStars.textContent = '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars);
    hud.winMeta.textContent = `${Math.round(elapsed)}s · ${usedTools} tool${usedTools === 1 ? '' : 's'}`;
    hud.fact.textContent = level.fact ? `Did you know? ${level.fact}` : '';
    hud.winWrap.style.display = 'flex';
  }
  function hideWin(): void { hud.winWrap.style.display = 'none'; }

  // --- loop -----------------------------------------------------------------
  function tick(dtMs: number): void {
    if (won) return;
    elapsed += dtMs / 1000;
    emitters.forEach((e, i) => {
      emitAcc[i] += e.rate * dtMs / 1000;
      while (emitAcc[i] >= 1) {
        emitAcc[i] -= 1;
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
  }

  let last = performance.now();
  function frame(now: number): void {
    const dtMs = now - last; last = now;
    tick(dtMs);
    draw();
    hud.progress.textContent = `${Math.min(collected, level.objective.count)} / ${level.objective.count}`;
    hud.timer.textContent = `${Math.round(elapsed)}s`;
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
      ctx.fillStyle = '#A0AAAB'; ctx.font = '600 12px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`collect ${z.label}`, z.px + z.pw / 2, z.py - 8);
      ctx.restore();
    }

    // emitters
    for (const e of emitters) {
      const el = BY_SYMBOL[e.element];
      ctx.save();
      ctx.fillStyle = el.cpk;
      ctx.beginPath(); ctx.arc(e.px, e.py, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101414'; ctx.font = '700 11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(el.symbol, e.px, e.py + 0.5);
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
    tick: (ms = 16.67, n = 1) => { for (let i = 0; i < n; i++) tick(ms); return { collected, atoms: sim.atoms.length }; },
    place: (type: string, xf: number, yf: number) => { tools.push(mkTool(type, xf * W, yf * H)); syncPalette(); },
    clear: () => { tools = tools.filter(t => t.fixed); syncPalette(); },
    report: () => analyzeMolecules(sim.bonds).molecules,
    tools: () => tools.map(t => ({ type: t.type, angle: +t.angle.toFixed(2), strength: +t.strength.toFixed(2), radius: Math.round(t.radius) })),
    inTank: () => sim.atoms.filter(a => zones.some(z => a.x >= z.px && a.x <= z.px + z.pw && a.y >= z.py && a.y <= z.py + z.ph)).length,
    hist: () => { const b = new Array(10).fill(0); for (const a of sim.atoms) b[Math.min(9, Math.max(0, Math.floor(a.x / W * 10)))]++; return b; },
    state: () => ({ collected, won, atoms: sim.atoms.length, bonds: sim.bonds.length, tools: tools.length, ke: +sim.stats().meanKE.toFixed(2), elapsed: Math.round(elapsed) }),
  };
}

// --- HUD DOM -----------------------------------------------------------------

interface HUD {
  paletteBtns: HTMLButtonElement[];
  progress: HTMLElement; timer: HTMLElement; resetBtn: HTMLElement;
  winWrap: HTMLElement; winStars: HTMLElement; winMeta: HTMLElement; fact: HTMLElement; replayBtn: HTMLElement;
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
    <div id="gTop">
      <div class="g-title">${level.name}${level.featured ? ` <span class="g-el">${level.featured}</span>` : ''}</div>
      <div class="g-obj">Collect <b>${level.objective.count}</b> ${objLabel(level)} · <span id="gProg">0 / ${level.objective.count}</span> · <span id="gTime">0s</span></div>
      <div class="g-blurb">${level.blurb}</div>
    </div>
    <div id="gBottom">
      <div class="g-hint">tap a tool · press &amp; drag to place + aim · drag to move · double-tap to remove</div>
      <div class="g-row">
        ${palette}
        <button class="pl-btn ghost" id="gReset">Reset</button>
        <a class="pl-btn ghost" href="${location.pathname}">Sandbox</a>
      </div>
    </div>
    <div id="gWin">
      <div class="g-card">
        <div class="g-win-title">Level complete</div>
        <div id="gStars">★★★</div>
        <div id="gWinMeta"></div>
        <div id="gFact"></div>
        <div class="g-card-row">
          <button class="pl-btn" id="gReplay">Replay</button>
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
    resetBtn: root.querySelector('#gReset')!,
    winWrap: root.querySelector('#gWin')!,
    winStars: root.querySelector('#gStars')!,
    winMeta: root.querySelector('#gWinMeta')!,
    fact: root.querySelector('#gFact')!,
    replayBtn: root.querySelector('#gReplay')!,
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
    #gTop { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); text-align: center; user-select: none; }
    #gTop .g-title { font-size: 1.05rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
      background: linear-gradient(100deg, var(--primary), var(--secondary), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    #gTop .g-obj { font-size: 0.82rem; color: var(--text-muted); margin-top: 3px; }
    #gTop .g-obj b { color: var(--primary); }
    #gTop .g-obj #gProg { color: var(--text); font-variant-numeric: tabular-nums; }
    #gTop .g-el { font-size: 0.7rem; font-weight: 700; color: var(--bg); background: var(--accent); border-radius: 6px; padding: 1px 6px; vertical-align: middle; -webkit-background-clip: border-box; background-clip: border-box; }
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
