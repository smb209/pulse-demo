// Simulation core: atoms, persistence + cap, energy, bond formation/breaking, spring forces.
// Headless by design (no DOM/canvas) so the invariants are unit-testable under node --test.
// Chemistry (affinity, energy gates) lives in chemistry.js; this file owns kinetics:
// which pairs meet, how much relative kinetic energy they carry, springs, cooldowns.

import { affinity, bondFormProbability, bondBreakProbability, bondEnergy, maxBondOrder, pairKey } from './chemistry.js';

// Kinetic energy (sim units) → kJ/mol scale used by chemistry.js.
// Calibrated (headless probe, 2026-07-10) so the default temperature (40) puts the mean
// free-pair energy near ~60 kJ/mol; thermal kicks scale 1/sqrt(mass) (equipartition),
// making pair energy mass-independent.
export const ENERGY_SCALE = 30;

// Thermal-bath energy (kJ/mol) as a function of the temperature setting. Bonded pairs
// have their relative velocity damped by the bond itself, so raw eRel under-reads how
// hot the bath is; break checks use max(eRel, bath). Fit: E ≈ 60 at T=40, ∝ T².
export function bathEnergy(temperature) {
  return 0.038 * temperature * temperature;
}

// High-energy capture suppression: two atoms flying past each other too fast can't be
// captured into a bond even if activation is exceeded. Kinetics, not chemistry — so it
// lives here, and chemistry.js's monotone activation gate stays intact.
export function captureFactor(eRel, eBond) {
  if (eBond <= 0) return 0;
  const x = eRel / (0.35 * eBond);
  return 1 / (1 + x * x);
}

const DAMPING = 0.985;
const POINTER_FORCE = 0.9;
const POINTER_RANGE = 190;
const FORM_RATE = 0.7;     // per-frame scale on P(form) per in-range pair
const BREAK_RATE = 0.18;   // per-frame scale on P(break) per bond
const SPRING_K = 0.045;
const BOND_DAMP = 0.92;    // damping of relative velocity along a bond axis
const REBOND_COOLDOWN = 120; // frames a broken pair cannot re-form
const BREAK_IMPULSE = 0.6;
const ATTRACT_K = 0.055;   // strength of the affinity-scaled pair attraction

// element-pair affinity cache (82×82 worst case, filled lazily)
const affinityCache = new Map();
function pairAffinity(ea, eb) {
  const k = pairKey(ea, eb);
  let v = affinityCache.get(k);
  if (v === undefined) { v = affinity(ea, eb); affinityCache.set(k, v); }
  return v;
}

// Element covalent radius (pm) → draw/physics radius (px)
export function drawRadius(el) {
  return 2.6 + el.radius / 28;
}

export function restLength(a, b) {
  return (drawRadius(a.el) + drawRadius(b.el)) * 1.15;
}

export function createSim({ width, height, sampleElement, cap = 250, temperature = 40, rng = Math.random }) {
  let W = width, H = height;
  let nextId = 1;
  let frame = 0;
  const atoms = [];
  const bonds = [];
  const cooldowns = new Map(); // "idA:idB" (idA<idB) → frame when re-bonding is allowed
  const pointer = { x: null, y: null, active: false, mode: 'attract' };

  const coolKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
  const bondLoad = atom => atom.bonds.reduce((s, bd) => s + bd.order, 0);
  const capLeft = atom => atom.el.maxBonds - bondLoad(atom);

  function makeAtom(el, x, y, hot) {
    const a = Math.PI * 2 * rng();
    // thermal speed ~ temperature, scaled 1/sqrt(mass) (equipartition)
    const base = Math.max(0.2, thermalKick() * 10 / Math.sqrt(el.mass / 16));
    const s = (hot ? 3 : 0.6) * (0.5 + rng()) * base;
    return {
      id: nextId++,
      el,
      x: x ?? rng() * W,
      y: y ?? rng() * H,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      bonds: [],
    };
  }

  function thermalKick() {
    return sim.temperature * 0.0025;
  }

  function spawnTo(n) {
    const want = Math.min(n, sim.cap);
    while (atoms.length < want) atoms.push(makeAtom(sampleElement()));
    return atoms.length;
  }

  function removeBond(bd, impulse = false) {
    const idx = bonds.indexOf(bd);
    if (idx !== -1) bonds.splice(idx, 1);
    bd.a.bonds = bd.a.bonds.filter(x => x !== bd);
    bd.b.bonds = bd.b.bonds.filter(x => x !== bd);
    cooldowns.set(coolKey(bd.a, bd.b), frame + REBOND_COOLDOWN);
    if (impulse) {
      const dx = bd.b.x - bd.a.x, dy = bd.b.y - bd.a.y;
      const d = Math.hypot(dx, dy) || 1;
      bd.a.vx -= (dx / d) * BREAK_IMPULSE; bd.a.vy -= (dy / d) * BREAK_IMPULSE;
      bd.b.vx += (dx / d) * BREAK_IMPULSE; bd.b.vy += (dy / d) * BREAK_IMPULSE;
    }
  }

  function removeAtom(atom) {
    for (const bd of [...atom.bonds]) removeBond(bd);
    const idx = atoms.indexOf(atom);
    if (idx !== -1) atoms.splice(idx, 1);
  }

  // Relative kinetic energy of a pair on the chemistry (kJ/mol) scale:
  // E = ½ μ |Δv|² · ENERGY_SCALE, μ = reduced mass.
  function eRel(a, b) {
    const mu = (a.el.mass * b.el.mass) / (a.el.mass + b.el.mass);
    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
    return 0.5 * mu * (dvx * dvx + dvy * dvy) * ENERGY_SCALE;
  }

  function tryForm(a, b) {
    if (capLeft(a) <= 0 || capLeft(b) <= 0) return;
    const until = cooldowns.get(coolKey(a, b));
    if (until !== undefined && frame < until) return;
    if (a.bonds.some(bd => bd.a === b || bd.b === b)) return; // already bonded
    const e = eRel(a, b);
    const order = Math.min(maxBondOrder(a.el, b.el), capLeft(a), capLeft(b));
    const p = bondFormProbability(a.el, b.el, e, bondLoad(a), bondLoad(b))
      * captureFactor(e, bondEnergy(a.el, b.el, order)) * FORM_RATE;
    if (p > 0 && rng() < p) {
      const bd = { a, b, order, key: pairKey(a.el, b.el) };
      bonds.push(bd);
      a.bonds.push(bd);
      b.bonds.push(bd);
    }
  }

  const sim = {
    cap, temperature, atoms, bonds, pointer,
    get width() { return W; }, get height() { return H; },

    resize(w, h) { W = w; H = h; },

    setTemperature(t) { sim.temperature = Math.max(0, Math.min(100, t)); },

    setCap(n) {
      sim.cap = Math.max(1, n | 0);
      while (atoms.length > sim.cap) removeAtom(atoms[atoms.length - 1]);
    },

    setPointer(p) { Object.assign(pointer, p); },

    spawnTo,

    respawn() {
      atoms.length = 0;
      bonds.length = 0;
      cooldowns.clear();
      spawnTo(sim.cap);
    },

    // Inject up to `count` atoms near (x,y); returns how many actually spawned (cap-guarded).
    burst(x, y, count = 30) {
      let added = 0;
      while (added < count && atoms.length < sim.cap) {
        const atom = makeAtom(sampleElement(), x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 30, true);
        const ang = rng() * Math.PI * 2, sp = 2 + rng() * 4;
        atom.vx = Math.cos(ang) * sp; atom.vy = Math.sin(ang) * sp;
        atoms.push(atom);
        added++;
      }
      return added;
    },

    step(dtMs = 16.67) {
      frame++;
      const dt = Math.min(dtMs / 16.67, 3);
      const kick = thermalKick();

      // pointer field + thermal + integrate
      for (const p of atoms) {
        if (pointer.active && pointer.x !== null) {
          const dx = pointer.x - p.x, dy = pointer.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_RANGE * POINTER_RANGE && d2 > 1) {
            const d = Math.sqrt(d2);
            const f = (1 - d / POINTER_RANGE) * POINTER_FORCE * dt / Math.sqrt(p.el.mass / 16);
            if (pointer.mode === 'attract') { p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
            else if (pointer.mode === 'repel') { p.vx -= (dx / d) * f * 1.6; p.vy -= (dy / d) * f * 1.6; }
            else { p.vx += (-dy / d) * f * 1.8 + (dx / d) * f * 0.25; p.vy += (dx / d) * f * 1.8 + (dy / d) * f * 0.25; }
          }
        }
        p.vx *= DAMPING; p.vy *= DAMPING;
        const jm = kick / Math.sqrt(p.el.mass / 16); // lighter atoms jitter harder
        p.vx += (rng() - 0.5) * 2 * jm * dt;
        p.vy += (rng() - 0.5) * 2 * jm * dt;
      }

      // bond springs
      for (const bd of bonds) {
        const { a, b } = bd;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const stretch = d - restLength(a, b);
        const f = SPRING_K * stretch * dt;
        const ux = dx / d, uy = dy / d;
        a.vx += ux * f / (a.el.mass / 16); a.vy += uy * f / (a.el.mass / 16);
        b.vx -= ux * f / (b.el.mass / 16); b.vy -= uy * f / (b.el.mass / 16);
        // damp relative velocity along the bond axis so molecules settle
        const rv = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
        const dampAmt = rv * (1 - BOND_DAMP) * 0.5;
        a.vx += ux * dampAmt; a.vy += uy * dampAmt;
        b.vx -= ux * dampAmt; b.vy -= uy * dampAmt;
      }

      // integrate + walls
      for (const p of atoms) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > W) { p.x = W; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > H) { p.y = H; p.vy *= -1; }
      }

      // bond breaking (energy-gated per chemistry.js); the bath floor keeps global
      // temperature honest even though bond damping cools a pair's raw eRel
      const bath = bathEnergy(sim.temperature);
      for (let i = bonds.length - 1; i >= 0; i--) {
        const bd = bonds[i];
        const e = Math.max(eRel(bd.a, bd.b), bath);
        const p = bondBreakProbability(bd.a.el, bd.b.el, e, bd.order) * BREAK_RATE * dt;
        if (p > 0 && rng() < p) removeBond(bd, true);
      }

      // pair scan: weak affinity-scaled attraction (electrostatic flavor — this is how
      // partners find each other) + bond formation inside capture radius. O(n²), cheap rejects.
      const MAXR = 60;
      for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i];
        for (let j = i + 1; j < atoms.length; j++) {
          const b = atoms[j];
          const dx = b.x - a.x; if (dx > MAXR || dx < -MAXR) continue;
          const dy = b.y - a.y; if (dy > MAXR || dy < -MAXR) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 > MAXR * MAXR || d2 < 1) continue;
          if (capLeft(a) > 0 && capLeft(b) > 0) {
            const aff = pairAffinity(a.el, b.el);
            if (aff > 0) {
              const d = Math.sqrt(d2);
              const f = aff * ATTRACT_K * (1 - d / MAXR) * dt;
              const ux = dx / d, uy = dy / d;
              a.vx += ux * f / (a.el.mass / 16); a.vy += uy * f / (a.el.mass / 16);
              b.vx -= ux * f / (b.el.mass / 16); b.vy -= uy * f / (b.el.mass / 16);
              const capture = restLength(a, b) * 1.6;
              if (d2 < capture * capture) tryForm(a, b);
            }
          }
        }
      }

      // occasional cooldown GC
      if (frame % 600 === 0) {
        for (const [k, until] of cooldowns) if (until < frame) cooldowns.delete(k);
      }
    },

    stats() {
      const byElement = {};
      for (const p of atoms) byElement[p.el.symbol] = (byElement[p.el.symbol] ?? 0) + 1;
      const byBondPair = {};
      let maxLoadRatio = 0, overloaded = 0;
      for (const bd of bonds) byBondPair[bd.key] = (byBondPair[bd.key] ?? 0) + 1;
      for (const p of atoms) {
        if (p.el.maxBonds > 0) maxLoadRatio = Math.max(maxLoadRatio, bondLoad(p) / p.el.maxBonds);
        if (bondLoad(p) > p.el.maxBonds) overloaded++;
      }
      return {
        atoms: atoms.length, bonds: bonds.length, byElement, byBondPair,
        maxLoadRatio, overloaded, cap: sim.cap, temperature: sim.temperature,
      };
    },
  };

  return sim;
}
