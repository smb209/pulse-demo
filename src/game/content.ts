// Game content: the tool registry and the level list. Add entries here to grow the game.

import type { ToolType, LevelDef } from './types';

// max press-drag distance (logical px) that maps to full intensity
const AIM_RANGE = 150;
const aimFrac = (dx: number, dy: number) => Math.min(Math.hypot(dx, dy), AIM_RANGE) / AIM_RANGE;

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
};

// --- levels ------------------------------------------------------------------

export const LEVELS: LevelDef[] = [
  {
    id: 'hydrogen-run',
    name: 'Hydrogen Run',
    blurb: 'Bond hydrogen into H₂ and funnel the gas into the tank.',
    board: { w: 960, h: 600 },
    cap: 150,
    temperature: 34,
    collisions: false,
    emitters: [
      { element: 'H', x: 0.05, y: 0.34, angle: 0.16, rate: 14, speed: 2.0, spread: 0.12 },
      { element: 'H', x: 0.05, y: 0.50, angle: 0, rate: 14, speed: 2.0, spread: 0.12 },
      { element: 'H', x: 0.05, y: 0.66, angle: -0.16, rate: 14, speed: 2.0, spread: 0.12 },
    ],
    zones: [{ id: 'tank', x: 0.80, y: 0.30, w: 0.16, h: 0.40, label: 'H₂' }],
    preplaced: [],
    palette: [{ type: 'fan', limit: 4 }, { type: 'catalyst', limit: 2 }, { type: 'deflector', limit: 2 }],
    objective: { kind: 'collect', formula: 'H2', count: 10 },
    par: { tools: 4, seconds: 75 },
  },
];
