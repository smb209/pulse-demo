// Game content: the tool registry and the level list. Add entries here to grow the game.

import type { ToolType, LevelDef } from './types';

// max press-drag distance (logical px) that maps to full intensity
const AIM_RANGE = 150;
const aimFrac = (dx: number, dy: number) => Math.min(Math.hypot(dx, dy), AIM_RANGE) / AIM_RANGE;

// shared: a soft radial glow + ring, used by field-style tools
function glowRing(ctx: CanvasRenderingContext2D, t: { x: number; y: number; radius: number }, rgb: string, selected: boolean): void {
  ctx.save();
  const g = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, t.radius);
  g.addColorStop(0, `rgba(${rgb},0.20)`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgb(${rgb})`; ctx.globalAlpha = selected ? 0.95 : 0.55; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// --- tools -------------------------------------------------------------------
// Each tool is pure behaviour + a draw call. `force` pushes atoms; `formBoost`
// multiplies bond-formation probability. Add a key here and it's instantly placeable
// by any level whose palette lists it.

export const TOOL_TYPES: Record<string, ToolType> = {
  fan: {
    id: 'fan',
    name: 'Fan',
    color: '#DA4E86',
    blurb: 'Blows atoms along its arrow — conveyor gas toward the tank.',
    defaults: { radius: 95, strength: 0.32, angle: 0 },
    force(t, a, dt) {
      const dx = a.x - t.x, dy = a.y - t.y;
      if (dx * dx + dy * dy > t.radius * t.radius) return;
      const f = t.strength * dt / Math.sqrt(a.el.mass / 16);
      a.vx += Math.cos(t.angle) * f; a.vy += Math.sin(t.angle) * f;
    },
    aim(t, dx, dy) { t.angle = Math.atan2(dy, dx); t.strength = 0.12 + aimFrac(dx, dy) * 0.5; },
    draw(ctx, t, selected) {
      ctx.save();
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = selected ? 0.9 : 0.5;
      ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.95; ctx.lineWidth = 3;
      const a = t.angle, L = 14 + t.strength * 52, hx = t.x + Math.cos(a) * L, hy = t.y + Math.sin(a) * L;
      ctx.beginPath();
      ctx.moveTo(t.x - Math.cos(a) * L, t.y - Math.sin(a) * L); ctx.lineTo(hx, hy);
      ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(a - 0.5) * 9, hy - Math.sin(a - 0.5) * 9);
      ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(a + 0.5) * 9, hy - Math.sin(a + 0.5) * 9);
      ctx.stroke();
      ctx.restore();
    },
  },

  deflector: {
    id: 'deflector',
    name: 'Deflector',
    color: '#44D4E4',
    blurb: 'Repels atoms — redirect streams around it.',
    defaults: { radius: 74, strength: 0.9 },
    force(t, a, dt) {
      const dx = a.x - t.x, dy = a.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > t.radius * t.radius || d2 < 1) return;
      const d = Math.sqrt(d2);
      const f = (1 - d / t.radius) * t.strength * dt / Math.sqrt(a.el.mass / 16);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
    },
    aim(t, dx, dy) { t.strength = 0.5 + aimFrac(dx, dy) * 1.7; }, // drag = repulsion intensity
    draw(ctx, t, selected) {
      ctx.save();
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = selected ? 0.95 : 0.65;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(t.x, t.y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },
  },

  catalyst: {
    id: 'catalyst',
    name: 'Catalyst',
    color: '#EEA02B',
    blurb: 'Speeds up bonding inside its field.',
    defaults: { radius: 64, strength: 3.2 },
    formBoost(t, x, y) {
      const dx = x - t.x, dy = y - t.y;
      return (dx * dx + dy * dy <= t.radius * t.radius) ? t.strength : 1;
    },
    aim(t, dx, dy) { t.radius = 44 + aimFrac(dx, dy) * 106; }, // drag = field size
    draw(ctx, t, selected) {
      ctx.save();
      const g = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, t.radius);
      g.addColorStop(0, 'rgba(238,160,43,0.22)');
      g.addColorStop(1, 'rgba(238,160,43,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = selected ? 0.95 : 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.color;
      ctx.font = '700 15px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', t.x, t.y + 0.5);
      ctx.restore();
    },
  },

  heater: {
    id: 'heater', name: 'Heater', color: '#EE5A2B',
    blurb: 'Adds heat — energises collisions and cracks weak bonds.',
    defaults: { radius: 82, strength: 0.85 },
    force(t, a, dt) {
      const dx = a.x - t.x, dy = a.y - t.y;
      if (dx * dx + dy * dy > t.radius * t.radius) return;
      const j = t.strength * dt / Math.sqrt(a.el.mass / 16);
      a.vx += (Math.random() - 0.5) * 2 * j; a.vy += (Math.random() - 0.5) * 2 * j;
    },
    aim(t, dx, dy) { t.strength = 0.3 + aimFrac(dx, dy) * 1.5; },
    draw(ctx, t, selected) { glowRing(ctx, t, '238,90,43', selected); },
  },

  cooler: {
    id: 'cooler', name: 'Cooler', color: '#5AA9FF',
    blurb: 'Removes heat — slows atoms so bonds settle.',
    defaults: { radius: 82, strength: 0.05 },
    force(t, a, dt) {
      const dx = a.x - t.x, dy = a.y - t.y;
      if (dx * dx + dy * dy > t.radius * t.radius) return;
      const k = Math.max(0, 1 - t.strength * dt);
      a.vx *= k; a.vy *= k;
    },
    aim(t, dx, dy) { t.strength = 0.02 + aimFrac(dx, dy) * 0.12; },
    draw(ctx, t, selected) { glowRing(ctx, t, '90,169,255', selected); },
  },

  shredder: {
    id: 'shredder', name: 'Shredder', color: '#FF5470',
    blurb: 'Snaps every bond passing through — a photodissociation field.',
    defaults: { radius: 66, strength: 1 },
    breakBoost(t, x, y) { const dx = x - t.x, dy = y - t.y; return (dx * dx + dy * dy <= t.radius * t.radius) ? 160 : 1; },
    draw(ctx, t, selected) {
      ctx.save();
      ctx.strokeStyle = t.color; ctx.globalAlpha = selected ? 0.95 : 0.7;
      ctx.setLineDash([2, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 2.4; ctx.globalAlpha = 0.9;
      const s = 9;
      ctx.beginPath();
      ctx.moveTo(t.x - s, t.y - s); ctx.lineTo(t.x + s, t.y + s);
      ctx.moveTo(t.x + s, t.y - s); ctx.lineTo(t.x - s, t.y + s);
      ctx.stroke();
      ctx.restore();
    },
  },

  ohcat: {
    id: 'ohcat', name: 'O–H Catalyst', color: '#EEC02B',
    blurb: 'Promotes O–H bonds and suppresses H–H — the trick to making water.',
    defaults: { radius: 120, strength: 1 },
    formBoost(t, x, y, sa, sb) {
      const dx = x - t.x, dy = y - t.y;
      if (dx * dx + dy * dy > t.radius * t.radius) return 1;
      const oh = (sa === 'H' && sb === 'O') || (sa === 'O' && sb === 'H');
      if (oh) return 28;
      if (sa === 'H' && sb === 'H') return 0.02;
      return 0.3;
    },
    breakBoost(t, x, y) { const dx = x - t.x, dy = y - t.y; return (dx * dx + dy * dy <= t.radius * t.radius) ? 0.04 : 1; }, // strongly stabilises the water it makes
    aim(t, dx, dy) { t.radius = 70 + aimFrac(dx, dy) * 90; },
    draw(ctx, t, selected) {
      glowRing(ctx, t, '238,192,43', selected);
      ctx.save(); ctx.fillStyle = t.color; ctx.globalAlpha = 0.95;
      ctx.font = '700 12px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('OH', t.x, t.y + 0.5); ctx.restore();
    },
  },

  getter: {
    id: 'getter', name: 'Contaminant', color: '#9C7B4E',
    blurb: 'A poisoned surface — adsorbs atoms that drift through.',
    defaults: { radius: 70, strength: 1 },
    adsorb(t, x, y) { const dx = x - t.x, dy = y - t.y; return (dx * dx + dy * dy <= t.radius * t.radius) ? 0.04 : 0; },
    draw(ctx, t, selected) {
      ctx.save();
      const g = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, t.radius);
      g.addColorStop(0, 'rgba(156,123,78,0.30)'); g.addColorStop(1, 'rgba(156,123,78,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = t.color; ctx.globalAlpha = selected ? 0.9 : 0.55;
      ctx.setLineDash([2, 4]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },
  },
};

// --- levels ------------------------------------------------------------------

export const LEVELS: LevelDef[] = [
  {
    id: 'hydrogen-run',
    name: 'Hydrogen Run',
    blurb: 'Fan the hydrogen up and over into the corner tank before it disperses — H₂ that drifts is recycled.',
    featured: 'H',
    reaction: 'H + H → H₂',
    fact: 'Hydrogen is the lightest and most abundant element in the universe — ~90% of all atoms. Two H atoms share electrons in the simplest possible covalent bond: H₂.',
    board: { w: 960, h: 600 },
    cap: 80,
    temperature: 34,
    collisions: false,
    // emitters spray along the bottom; the tank is up in the top-right corner, so the gas
    // never drifts there on its own — you must fan it up and over.
    emitters: [
      { element: 'H', x: 0.05, y: 0.64, angle: 0, mols: 20, rate: 16, speed: 2.2, spread: 0.1 },
      { element: 'H', x: 0.05, y: 0.76, angle: 0, mols: 20, rate: 16, speed: 2.2, spread: 0.1 },
      { element: 'H', x: 0.05, y: 0.88, angle: 0, mols: 20, rate: 16, speed: 2.2, spread: 0.1 },
    ],
    zones: [{ id: 'tank', x: 0.77, y: 0.08, w: 0.19, h: 0.32, label: 'H₂' }],
    // a shredder squats in the bottom flow path — lift the gas over it or it gets cracked
    preplaced: [{ type: 'shredder', x: 0.56, y: 0.78, fixed: true }],
    palette: [{ type: 'fan', limit: 4 }, { type: 'catalyst', limit: 2 }, { type: 'deflector', limit: 2 }],
    objective: { kind: 'collect', formula: 'H2', count: 8 },
    settleSeconds: 6,
    par: { tools: 3, seconds: 50 },
  },
  {
    id: 'first-water',
    name: 'First Water',
    blurb: 'Cover the mixing zone with the O–H catalyst (a heater sparks it) so oxygen grabs the hydrogen — water is a low-yield reaction, so make what you can.',
    featured: 'O',
    reaction: '2 H₂ + O₂ → 2 H₂O',
    fact: 'Burning hydrogen in oxygen releases huge energy and makes only water — the cleanest fuel there is. Rocket engines run on exactly this: liquid H₂ + liquid O₂ → H₂O and enormous thrust.',
    board: { w: 960, h: 600 },
    cap: 260,
    temperature: 22,
    collisions: false,
    emitters: [
      { element: 'H', x: 0.05, y: 0.34, angle: 0.30, mols: 54, rate: 20, speed: 1.9, spread: 0.1, aimable: true },
      { element: 'H', x: 0.05, y: 0.66, angle: -0.30, mols: 54, rate: 20, speed: 1.9, spread: 0.1, aimable: true },
      { element: 'O', x: 0.05, y: 0.50, angle: 0, mols: 54, rate: 20, speed: 1.7, spread: 0.1, aimable: true },
    ],
    // the whole chamber is the collector — any water made in it counts
    zones: [{ id: 'tank', x: 0.24, y: 0.10, w: 0.72, h: 0.80, label: 'H₂O — whole chamber' }],
    // a contaminant patch in the corner — atoms it adsorbs are lost from your budget
    preplaced: [{ type: 'getter', x: 0.84, y: 0.84, fixed: true }],
    palette: [{ type: 'ohcat', limit: 3 }, { type: 'heater', limit: 2 }, { type: 'fan', limit: 3 }, { type: 'cooler', limit: 1 }],
    objective: { kind: 'collect', formula: 'H2O', count: 3 },
    settleSeconds: 10,
    par: { tools: 4, seconds: 90 },
  },
];
