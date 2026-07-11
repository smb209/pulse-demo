// Rendering + UI wiring. All chemistry lives in chemistry.ts, all kinetics in sim.ts;
// this file owns the canvas, sprites, controls, and the window.__pulse validation probe.

import { BY_SYMBOL, type ChemElement } from './elements';
import { PRESET_BY_ID, samplePreset, analyzeMolecules, type MoleculeReport } from './chemistry';
import { createSim, drawRadius } from './sim';

declare global {
  interface Window { __pulse: { stats: () => object; step: (frames?: number) => number } }
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let W = window.innerWidth, H = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

let currentPreset = 'atmosphere';
let injectSymbol: string | null = null; // null = preset-weighted mix (J9)
const sampleElement = () => samplePreset(currentPreset);
const injectElement = () => (injectSymbol ? BY_SYMBOL[injectSymbol] : undefined);

const sim = createSim({
  width: W, height: H,
  sampleElement: () => sampleElement(),
  cap: 250,
  temperature: 40,
});

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sim.resize(W, H);
}
window.addEventListener('resize', resize);
resize();
sim.respawn();

// --- element sprites (pre-rendered: glow + CPK disc + symbol label) ------

interface Sprite { canvas: HTMLCanvasElement; half: number }
const spriteCache = new Map<string, Sprite>();

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

function sprite(el: ChemElement): Sprite {
  let s = spriteCache.get(el.symbol);
  if (s) return s;
  const r = drawRadius(el);
  const glow = r * 2.2;
  const size = Math.ceil((r + glow) * 2 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const cx = size / (2 * dpr);
  const grad = g.createRadialGradient(cx, cx, r * 0.6, cx, cx, r + glow);
  grad.addColorStop(0, el.cpk + '59'); // ~35% alpha glow
  grad.addColorStop(1, el.cpk + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, cx * 2, cx * 2);
  g.fillStyle = el.cpk;
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();
  if (r >= 3.4) {
    g.fillStyle = luminance(el.cpk) > 140 ? '#101a1b' : '#F1F3F3';
    g.font = `600 ${Math.max(5.5, r * 1.05)}px -apple-system, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(el.symbol, cx, cx + 0.5);
  }
  s = { canvas: c, half: size / (2 * dpr) };
  spriteCache.set(el.symbol, s);
  return s;
}

// --- input ---------------------------------------------------------------

const statAtomsEl = document.getElementById('atoms')!;

function setPointer(e: PointerEvent | TouchEvent): void {
  const t = 'touches' in e ? e.touches[0] : e;
  if (!t) return;
  sim.setPointer({ x: t.clientX, y: t.clientY, active: true });
}
window.addEventListener('pointermove', setPointer);
window.addEventListener('pointerdown', e => {
  if ((e.target as Element).closest('#panel')) return;
  setPointer(e);
  if (sim.burst(e.clientX, e.clientY, 30, injectElement()) < 30) flashAtCap();
});
window.addEventListener('pointerleave', () => sim.setPointer({ active: false }));
window.addEventListener('touchmove', e => {
  if (!(e.target as Element).closest('#panel')) e.preventDefault();
  setPointer(e);
}, { passive: false });
window.addEventListener('touchend', () => sim.setPointer({ active: false }));

function flashAtCap(): void {
  const stat = statAtomsEl.parentElement!;
  stat.classList.remove('flash');
  void (stat as HTMLElement).offsetWidth; // restart animation
  stat.classList.add('flash');
}

// --- presets + legend --------------------------------------------------------

const legendEl = document.getElementById('legend')!;
const legendTitleEl = document.getElementById('legendTitle')!;

function renderLegend(): void {
  const preset = PRESET_BY_ID[currentPreset];
  legendTitleEl.textContent = preset.name;
  const entries = Object.entries(preset.mix).sort((a, b) => b[1] - a[1]).slice(0, 6);
  legendEl.innerHTML = entries.map(([sym, pct]) => {
    const el = BY_SYMBOL[sym];
    return `<div class="chip" title="${el.name}"><i style="background:${el.cpk}"></i>${sym} ${pct >= 1 ? Math.round(pct) + '%' : '&lt;1%'}</div>`;
  }).join('');
}

document.getElementById('presets')!.addEventListener('click', e => {
  const btn = (e.target as Element).closest('button');
  if (!btn || btn.dataset.preset === currentPreset) return;
  currentPreset = btn.dataset.preset!;
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('active', b === btn));
  renderLegend();
  sim.respawn();
});
renderLegend();

// --- controls --------------------------------------------------------------

document.getElementById('modes')!.addEventListener('click', e => {
  const btn = (e.target as Element).closest('button');
  if (!btn) return;
  sim.setPointer({ mode: btn.dataset.mode as 'attract' | 'repel' | 'vortex' });
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('active', b === btn));
});

const capIn = document.getElementById('cap') as HTMLInputElement;
const tempIn = document.getElementById('temp') as HTMLInputElement;
// Cap is a ceiling, not a set-point (D5/J14): lowering trims, raising just opens headroom.
capIn.addEventListener('input', () => {
  const cap = +capIn.value;
  document.getElementById('capOut')!.textContent = String(cap);
  sim.setCap(cap);
});
tempIn.addEventListener('input', () => {
  const t = +tempIn.value;
  document.getElementById('tempOut')!.textContent = String(t);
  sim.setTemperature(t);
});
// Burst = detonation (J16): snap every bond, eject fragments with the bond energy.
document.getElementById('burstBtn')!.addEventListener('click', () => {
  sim.detonate();
});

// --- injector chips (J9) ------------------------------------------------------

document.getElementById('inject')!.addEventListener('click', e => {
  const btn = (e.target as Element).closest('button');
  if (!btn) return;
  injectSymbol = btn.dataset.inject === 'mix' ? null : btn.dataset.inject!;
  document.querySelectorAll('#inject button').forEach(b => b.classList.toggle('active', b === btn));
});

// --- reset (J10): control baseline + respawn, preset stays -----------------------

function setActive(groupId: string, match: (b: HTMLButtonElement) => boolean): void {
  document.querySelectorAll<HTMLButtonElement>(`#${groupId} button`).forEach(b => b.classList.toggle('active', match(b)));
}

document.getElementById('resetBtn')!.addEventListener('click', () => {
  capIn.value = '250';
  document.getElementById('capOut')!.textContent = '250';
  sim.setCap(250);
  tempIn.value = '40';
  document.getElementById('tempOut')!.textContent = '40';
  sim.setTemperature(40);
  sim.setPointer({ mode: 'attract', active: false });
  setActive('modes', b => b.dataset.mode === 'attract');
  injectSymbol = null;
  setActive('inject', b => b.dataset.inject === 'mix');
  sim.respawn();
});

// --- collapsible control panel (mobile space-saver) --------------------------

const panelEl = document.getElementById('panel')!;
const panelToggle = document.getElementById('panelToggle')!;
const COLLAPSE_KEY = 'pulse.controls.collapsed';

function setPanelCollapsed(collapsed: boolean): void {
  panelEl.classList.toggle('collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.title = collapsed ? 'Expand controls' : 'Collapse controls';
}

// Default collapsed on narrow (mobile) viewports so the field is usable on first
// load; remember the operator's choice thereafter.
const storedCollapsed = localStorage.getItem(COLLAPSE_KEY);
setPanelCollapsed(storedCollapsed === null
  ? window.matchMedia('(max-width: 720px)').matches
  : storedCollapsed === '1');

panelToggle.addEventListener('click', () => {
  const collapsed = !panelEl.classList.contains('collapsed');
  setPanelCollapsed(collapsed);
  localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
});

// --- gas-physics + readout toggles -------------------------------------------
// Three flags drive the sim (collisions/thermostat/gravity); three drive read-only
// overlays (pressure HUD, speed histogram, diffusion tracer). Choices persist.

type FlagName = 'collisions' | 'thermostat' | 'gravity' | 'pressure' | 'speeds' | 'tracer';
const PHYS_KEY = 'pulse.phys';
const flagDefaults: Record<FlagName, boolean> = {
  collisions: true, thermostat: false, gravity: false, pressure: false, speeds: false, tracer: false,
};
const flags: Record<FlagName, boolean> = (() => {
  try { return { ...flagDefaults, ...JSON.parse(localStorage.getItem(PHYS_KEY) || '{}') }; }
  catch { return { ...flagDefaults }; }
})();

const gasHUD = document.getElementById('gasHUD')!;
const hudGas = document.getElementById('hudGas')!;
const hudSpeeds = document.getElementById('hudSpeeds')!;
const hudTracer = document.getElementById('hudTracer')!;
const physBtns = document.getElementById('physics')!;

const isMobile = (): boolean => window.matchMedia('(max-width: 720px)').matches;

function setText(id: string, t: string): void { const el = document.getElementById(id); if (el) el.textContent = t; }

function applyFlags(): void {
  sim.setPhysics({ collisions: flags.collisions, thermostat: flags.thermostat, gravity: flags.gravity });
  if (isMobile()) {
    // Mobile: the cycler + CSS own readout visibility, so keep the sections un-hidden
    // (the `hidden` attribute is a desktop-flag concept and would fight the view rules).
    hudGas.hidden = hudSpeeds.hidden = hudTracer.hidden = gasHUD.hidden = false;
  } else {
    hudGas.hidden = !flags.pressure;
    hudSpeeds.hidden = !flags.speeds;
    hudTracer.hidden = !flags.tracer;
    gasHUD.hidden = !(flags.pressure || flags.speeds || flags.tracer);
  }
  physBtns.querySelectorAll<HTMLButtonElement>('button').forEach(b =>
    b.classList.toggle('active', !!flags[b.dataset.flag as FlagName]));
}
applyFlags();

physBtns.addEventListener('click', e => {
  const btn = (e.target as Element).closest('button');
  if (!btn) return;
  const f = btn.dataset.flag as FlagName;
  flags[f] = !flags[f];
  localStorage.setItem(PHYS_KEY, JSON.stringify(flags));
  applyFlags();
});

// Overlay state updated on the 500ms HUD tick; the per-frame draw reads the tracer syms.
const HIST_BINS = 14;
const histBarsEl = document.getElementById('histBars')!;
const histBars: HTMLElement[] = [];
let tracerLightSym: string | null = null;
let tracerHeavySym: string | null = null;

// --- mobile readout cycler ---------------------------------------------------
// Every readout at once is too busy on a phone, so one pill cycles through them one
// at a time. Desktop keeps its roomy multi-panel layout (driven by the flags above).
const MOBILE_VIEWS = ['stats', 'molecules', 'gas', 'speeds', 'diffusion', 'off'] as const;
type ViewName = typeof MOBILE_VIEWS[number];
const VIEW_LABEL: Record<ViewName, string> = {
  stats: 'Stats', molecules: 'Molecules', gas: 'Gas', speeds: 'Speeds', diffusion: 'Diffusion', off: 'Hidden',
};
const VIEW_KEY = 'pulse.view';
let mobileView: ViewName = ((): ViewName => {
  const v = localStorage.getItem(VIEW_KEY) as ViewName;
  return (MOBILE_VIEWS as readonly string[]).includes(v) ? v : 'stats';
})();

function updateHUD(): void {
  const mob = isMobile();
  const wantGas = mob ? mobileView === 'gas' : flags.pressure;
  const wantSpeeds = mob ? mobileView === 'speeds' : flags.speeds;
  const wantDiffusion = mob ? mobileView === 'diffusion' : flags.tracer;
  const wantMolecules = mob && mobileView === 'molecules';
  if (!wantGas && !wantSpeeds && !wantDiffusion && !wantMolecules) return;
  const list = sim.atoms;

  if (wantGas) {
    const s = sim.stats();
    const kT = s.meanKE; // 2D equipartition: ⟨KE⟩ = kT
    const Z = (kT > 1e-9 && s.atoms > 0) ? (s.pressure * s.area) / (s.atoms * kT) : 0;
    setText('hudT', kT.toFixed(1));
    setText('hudP', (s.pressure * 1000).toFixed(2)); // scaled to readable arbitrary units
    setText('hudN', String(s.atoms));
    const zEl = document.getElementById('hudZ')!;
    zEl.textContent = Z ? Z.toFixed(2) : '—';
    zEl.classList.toggle('warn', Z !== 0 && Math.abs(Z - 1) > 0.3);
  }

  if (wantSpeeds) {
    if (!histBars.length) for (let i = 0; i < HIST_BINS; i++) { const el = document.createElement('i'); histBarsEl.appendChild(el); histBars.push(el); }
    let maxV = 0.001;
    for (const p of list) { const v = Math.hypot(p.vx, p.vy); if (v > maxV) maxV = v; }
    maxV *= 1.05;
    const bins = new Array(HIST_BINS).fill(0);
    for (const p of list) { const idx = Math.min(HIST_BINS - 1, Math.floor(Math.hypot(p.vx, p.vy) / maxV * HIST_BINS)); bins[idx]++; }
    let maxBin = 1; for (const c of bins) if (c > maxBin) maxBin = c;
    bins.forEach((c, i) => { histBars[i].style.height = `${Math.round(c / maxBin * 100)}%`; });
  }

  if (wantDiffusion) {
    const per = new Map<string, { n: number; v: number; m: number }>();
    for (const p of list) {
      let e = per.get(p.el.symbol);
      if (!e) { e = { n: 0, v: 0, m: p.el.mass }; per.set(p.el.symbol, e); }
      e.n++; e.v += Math.hypot(p.vx, p.vy);
    }
    // Compare only well-populated species so a lone trace atom can't skew the ratio.
    const minN = Math.max(3, list.length * 0.03);
    const eligible = [...per.entries()].filter(([, e]) => e.n >= minN).sort((a, b) => a[1].m - b[1].m);
    if (eligible.length >= 2) {
      const [lsym, le] = eligible[0];
      const [hsym, he] = eligible[eligible.length - 1];
      tracerLightSym = lsym; tracerHeavySym = hsym;
      const lv = le.v / le.n, hv = he.v / he.n;
      setText('tracerLight', `${lsym} · ${le.m}`);
      setText('tracerHeavy', `${hsym} · ${he.m}`);
      setText('tracerLightV', lv.toFixed(2));
      setText('tracerHeavyV', hv.toFixed(2));
      setText('tracerRatio', `${(hv > 1e-6 ? lv / hv : 0).toFixed(2)} / ${Math.sqrt(he.m / le.m).toFixed(2)}`);
    } else {
      tracerLightSym = tracerHeavySym = null;
      setText('tracerLight', 'light'); setText('tracerHeavy', 'heavy');
      setText('tracerLightV', '—'); setText('tracerHeavyV', '—');
      setText('tracerRatio', 'inject 2+ species');
    }
  }

  if (wantMolecules) renderChart(analyzeMolecules(sim.bonds));
}

const viewCycle = document.getElementById('viewCycle')!;
const viewCycleLabel = document.getElementById('viewCycleLabel')!;

function setView(v: ViewName): void {
  mobileView = v;
  document.body.dataset.view = v;
  viewCycleLabel.textContent = VIEW_LABEL[v];
  viewCycle.classList.toggle('off', v === 'off');
  // drive the molecule chart's render gate from the view on mobile
  (document.getElementById('molechart') as HTMLElement).hidden = !(v === 'molecules');
  localStorage.setItem(VIEW_KEY, v);
  updateHUD();
}

viewCycle.addEventListener('click', () => {
  const i = MOBILE_VIEWS.indexOf(mobileView);
  setView(MOBILE_VIEWS[(i + 1) % MOBILE_VIEWS.length]);
});

// tracer rings follow the tracer flag on desktop, the Diffusion view on mobile
const tracerRingsActive = (): boolean => (isMobile() ? mobileView === 'diffusion' : flags.tracer);

// --- render loop -------------------------------------------------------------

const fpsEl = document.getElementById('fps')!;
const bondsEl = document.getElementById('bonds')!;
let last = performance.now(), frames = 0, fpsTimer = last, fps = 0;

const BOND_STYLES = ['rgba(190,210,214,0.55)', 'rgba(190,210,214,0.5)', 'rgba(190,210,214,0.45)'];

function frame(now: number): void {
  const dtMs = now - last;
  last = now;
  sim.step(dtMs);

  ctx.fillStyle = 'rgba(24, 27, 27, 0.30)';
  ctx.fillRect(0, 0, W, H);

  // bonds: order → parallel strokes
  ctx.lineWidth = 1.4;
  for (const bd of sim.bonds) {
    const { a, b, order } = bd;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const px = -dy / d, py = dx / d; // perpendicular
    ctx.strokeStyle = BOND_STYLES[order - 1] ?? BOND_STYLES[0];
    for (let k = 0; k < order; k++) {
      const off = (k - (order - 1) / 2) * 2.6;
      ctx.beginPath();
      ctx.moveTo(a.x + px * off, a.y + py * off);
      ctx.lineTo(b.x + px * off, b.y + py * off);
      ctx.stroke();
    }
  }

  // atoms via sprite cache
  for (const p of sim.atoms) {
    const s = sprite(p.el);
    ctx.drawImage(s.canvas, p.x - s.half, p.y - s.half, s.half * 2, s.half * 2);
  }

  // ion badges: ring + sign, drawn per frame (ions are few)
  ctx.lineWidth = 1.3;
  ctx.font = '700 8px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of sim.atoms) {
    if (p.charge === 0) continue;
    const r = drawRadius(p.el);
    const color = p.charge > 0 ? '#EEA02B' : '#44D4E4';
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    const sign = p.charge > 0 ? '+' : '−';
    ctx.fillText(Math.abs(p.charge) > 1 ? sign + Math.abs(p.charge) : sign, p.x + r + 4.5, p.y - r - 2);
  }

  // diffusion tracer: ring the lightest (cyan) and heaviest (amber) species so their
  // different diffusion rates (Graham's law) are visible.
  if (tracerRingsActive() && (tracerLightSym || tracerHeavySym)) {
    ctx.lineWidth = 1.7;
    for (const p of sim.atoms) {
      const color = p.el.symbol === tracerLightSym ? '#44D4E4'
        : p.el.symbol === tracerHeavySym ? '#EEA02B' : null;
      if (!color) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, drawRadius(p.el) + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  frames++;
  if (now - fpsTimer >= 500) {
    fps = Math.round(frames * 1000 / (now - fpsTimer));
    fpsEl.textContent = String(fps);
    statAtomsEl.textContent = String(sim.atoms.length);
    bondsEl.textContent = String(sim.bonds.length);
    renderTicker(analyzeMolecules(sim.bonds));
    updateHUD();
    frames = 0;
    fpsTimer = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- molecule ticker + bar chart (J11) -------------------------------------------

const tickerEl = document.getElementById('ticker')!;
const chartEl = document.getElementById('molechart')!;
const chartRowsEl = document.getElementById('mcRows')!;
const chartTotalEl = document.getElementById('mcTotal')!;

tickerEl.addEventListener('click', () => {
  const open = chartEl.hidden === true;
  chartEl.hidden = !open;
  tickerEl.classList.toggle('open', open);
  // on mobile the gas HUD yields to the molecule chart (see .chart-open CSS)
  document.body.classList.toggle('chart-open', open);
});

function renderTicker(report: MoleculeReport): void {
  const { molecules } = report;
  const top = Object.entries(molecules).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!top.length) {
    tickerEl.textContent = 'no molecules yet';
    tickerEl.classList.add('empty');
  } else {
    tickerEl.classList.remove('empty');
    tickerEl.innerHTML = top
      .map(([name, n]) => `<b>${name}</b><span>×${n}</span>`)
      .join('<em>·</em>');
  }
  if (!chartEl.hidden) renderChart(report);
}

// Horizontal single-hue bar list: magnitude ranking of molecule species as % of all
// molecules. Identity lives in the row label (no categorical palette needed); values
// wear text tokens, the bar wears the primary hue.
function renderChart({ molecules, components }: MoleculeReport): void {
  if (!components) {
    chartTotalEl.textContent = '';
    chartRowsEl.innerHTML = '<div class="mc-empty">no molecules yet</div>';
    return;
  }
  const ranked = Object.entries(molecules).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 8);
  const otherCount = ranked.slice(8).reduce((s, [, n]) => s + n, 0);
  if (otherCount > 0) top.push(['other', otherCount]);
  const maxPct = (top[0][1] / components) * 100;
  chartTotalEl.textContent = `${components} total`;
  chartRowsEl.innerHTML = top.map(([name, n]) => {
    const pct = (n / components) * 100;
    const width = maxPct > 0 ? (pct / maxPct) * 100 : 0;
    return `<div class="mc-row" title="${name}: ${n} of ${components} molecules (${pct.toFixed(1)}%)">`
      + `<span class="mc-label">${name}</span>`
      + `<span class="mc-track"><span class="mc-fill" style="width:${width.toFixed(1)}%; display:block"></span></span>`
      + `<span class="mc-val">${pct.toFixed(0)}% ×${n}</span>`
      + `</div>`;
  }).join('');
}

// --- validation probe (read-only) — build plan D7 -----------------------------

window.__pulse = {
  stats: () => ({ ...sim.stats(), fps, preset: currentPreset, inject: injectSymbol ?? 'mix', ...analyzeMolecules(sim.bonds) }),
  // Time acceleration for validation (J13): synchronously advance N sim frames through
  // the normal step path. Hidden tabs suspend rAF entirely, so timed scenarios drive
  // the clock with this instead of waiting. Capped to keep any single call bounded.
  step: (frames = 60) => {
    const n = Math.min(Math.max(1, frames | 0), 36000);
    for (let i = 0; i < n; i++) sim.step();
    return n;
  },
};

// Initialize the mobile readout view (after renderChart + its DOM refs exist).
setView(mobileView);
