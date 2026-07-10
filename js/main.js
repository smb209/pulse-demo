// Rendering + UI wiring. All chemistry lives in chemistry.js, all kinetics in sim.js;
// this file owns the canvas, sprites, controls, and the window.__pulse validation probe.

import { BY_SYMBOL } from './elements.js';
import { PRESET_BY_ID, samplePreset, analyzeMolecules } from './chemistry.js';
import { createSim, drawRadius } from './sim.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let W = window.innerWidth, H = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

let currentPreset = 'atmosphere';
const sampleElement = () => samplePreset(currentPreset);

const sim = createSim({
  width: W, height: H,
  sampleElement: () => sampleElement(),
  cap: 250,
  temperature: 40,
});

function resize() {
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

const spriteCache = new Map();
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}
function sprite(el) {
  let s = spriteCache.get(el.symbol);
  if (s) return s;
  const r = drawRadius(el);
  const glow = r * 2.2;
  const size = Math.ceil((r + glow) * 2 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
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

const statAtomsEl = document.getElementById('atoms');
function setPointer(e) {
  const t = e.touches ? e.touches[0] : e;
  sim.setPointer({ x: t.clientX, y: t.clientY, active: true });
}
window.addEventListener('pointermove', setPointer);
window.addEventListener('pointerdown', e => {
  if (e.target.closest('#panel')) return;
  setPointer(e);
  const t = e.touches ? e.touches[0] : e;
  if (sim.burst(t.clientX, t.clientY, 30) === 0) flashAtCap();
});
window.addEventListener('pointerleave', () => sim.setPointer({ active: false }));
window.addEventListener('touchmove', e => {
  if (!e.target.closest('#panel')) e.preventDefault();
  setPointer(e);
}, { passive: false });
window.addEventListener('touchend', () => sim.setPointer({ active: false }));

function flashAtCap() {
  statAtomsEl.parentElement.classList.remove('flash');
  void statAtomsEl.parentElement.offsetWidth; // restart animation
  statAtomsEl.parentElement.classList.add('flash');
}

// --- presets + legend --------------------------------------------------------

const legendEl = document.getElementById('legend');
const legendTitleEl = document.getElementById('legendTitle');

function renderLegend() {
  const preset = PRESET_BY_ID[currentPreset];
  legendTitleEl.textContent = preset.name;
  const entries = Object.entries(preset.mix).sort((a, b) => b[1] - a[1]).slice(0, 6);
  legendEl.innerHTML = entries.map(([sym, pct]) => {
    const el = BY_SYMBOL[sym];
    return `<div class="chip" title="${el.name}"><i style="background:${el.cpk}"></i>${sym} ${pct >= 1 ? Math.round(pct) + '%' : '<1%'}</div>`;
  }).join('');
}

document.getElementById('presets').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.preset === currentPreset) return;
  currentPreset = btn.dataset.preset;
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('active', b === btn));
  renderLegend();
  sim.respawn();
});
renderLegend();

// --- controls --------------------------------------------------------------

document.getElementById('modes').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  sim.setPointer({ mode: btn.dataset.mode });
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('active', b === btn));
});

const capIn = document.getElementById('cap');
const tempIn = document.getElementById('temp');
capIn.addEventListener('input', () => {
  const cap = +capIn.value;
  document.getElementById('capOut').textContent = cap;
  sim.setCap(cap);
  sim.spawnTo(cap);
});
tempIn.addEventListener('input', () => {
  const t = +tempIn.value;
  document.getElementById('tempOut').textContent = t;
  sim.setTemperature(t);
});
document.getElementById('burstBtn').addEventListener('click', () => {
  if (sim.burst(W / 2, H / 2, 30) === 0) flashAtCap();
});

// --- render loop -------------------------------------------------------------

const fpsEl = document.getElementById('fps');
const bondsEl = document.getElementById('bonds');
let last = performance.now(), frames = 0, fpsTimer = last, fps = 0;

const BOND_STYLES = ['rgba(190,210,214,0.55)', 'rgba(190,210,214,0.5)', 'rgba(190,210,214,0.45)'];

function frame(now) {
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

  frames++;
  if (now - fpsTimer >= 500) {
    fps = Math.round(frames * 1000 / (now - fpsTimer));
    fpsEl.textContent = fps;
    statAtomsEl.textContent = sim.atoms.length;
    bondsEl.textContent = sim.bonds.length;
    lastMolecules = analyzeMolecules(sim.bonds);
    renderTicker(lastMolecules);
    frames = 0;
    fpsTimer = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- molecule ticker -----------------------------------------------------------

const tickerEl = document.getElementById('ticker');
let lastMolecules = { molecules: {}, components: 0, named: 0 };

function renderTicker({ molecules }) {
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
  stats: () => ({ ...sim.stats(), fps, preset: currentPreset, ...analyzeMolecules(sim.bonds) }),
};
