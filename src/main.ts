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
  if (sim.burst(e.clientX, e.clientY, 30, injectElement()) === 0) flashAtCap();
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
capIn.addEventListener('input', () => {
  const cap = +capIn.value;
  document.getElementById('capOut')!.textContent = String(cap);
  sim.setCap(cap);
  sim.spawnTo(cap);
});
tempIn.addEventListener('input', () => {
  const t = +tempIn.value;
  document.getElementById('tempOut')!.textContent = String(t);
  sim.setTemperature(t);
});
document.getElementById('burstBtn')!.addEventListener('click', () => {
  if (sim.burst(W / 2, H / 2, 30, injectElement()) === 0) flashAtCap();
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

  frames++;
  if (now - fpsTimer >= 500) {
    fps = Math.round(frames * 1000 / (now - fpsTimer));
    fpsEl.textContent = String(fps);
    statAtomsEl.textContent = String(sim.atoms.length);
    bondsEl.textContent = String(sim.bonds.length);
    renderTicker(analyzeMolecules(sim.bonds));
    frames = 0;
    fpsTimer = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- molecule ticker -----------------------------------------------------------

const tickerEl = document.getElementById('ticker')!;

function renderTicker({ molecules }: MoleculeReport): void {
  const top = Object.entries(molecules).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!top.length) {
    tickerEl.textContent = 'no molecules yet';
    tickerEl.classList.add('empty');
    return;
  }
  tickerEl.classList.remove('empty');
  tickerEl.innerHTML = top
    .map(([name, n]) => `<b>${name}</b><span>×${n}</span>`)
    .join('<em>·</em>');
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
