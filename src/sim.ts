// Simulation core: atoms, persistence + cap, energy, bond formation/breaking, spring forces.
// Headless by design (no DOM/canvas) so the invariants are unit-testable under vitest.
// Chemistry (affinity, energy gates) lives in chemistry.ts; this file owns kinetics:
// which pairs meet, how much relative kinetic energy they carry, springs, cooldowns.

import { affinity, bondFormProbability, bondBreakProbability, bondEnergy, maxBondOrder, pairKey, cleaveCharges, neutralizeOnBond, type Rng } from './chemistry';
import type { ChemElement } from './elements';

export interface Atom {
  id: number;
  el: ChemElement;
  x: number; y: number;
  vx: number; vy: number;
  charge: number;
  bonds: Bond[];
}

export interface Bond {
  a: Atom;
  b: Atom;
  order: number;
  key: string;
}

export interface PointerState {
  x: number | null;
  y: number | null;
  active: boolean;
  mode: 'attract' | 'repel' | 'vortex';
}

export interface SimStats {
  atoms: number;
  bonds: number;
  byElement: Record<string, number>;
  byBondPair: Record<string, number>;
  maxLoadRatio: number;
  overloaded: number;
  cap: number;
  temperature: number;
  ions: { positive: number; negative: number; net: number };
  meanSpeed: number;
  meanKE: number;    // mean kinetic energy per atom (sim units) — 2D equipartition: ⟨KE⟩ = kT
  pressure: number;  // smoothed wall force-per-length (0 until the sim has run)
  area: number;      // container area (px²) — the "volume" in PV = N·kT
}

export interface SimOptions {
  width: number;
  height: number;
  sampleElement: () => ChemElement;
  cap?: number;
  temperature?: number;
  rng?: Rng;
}

// Kinetic energy (sim units) → kJ/mol scale used by chemistry.ts.
// Calibrated (headless probe, 2026-07-10) so the default temperature (40) puts the mean
// free-pair energy near ~60 kJ/mol; thermal kicks scale 1/sqrt(mass) (equipartition),
// making pair energy mass-independent.
export const ENERGY_SCALE = 30;

// Thermal-bath energy (kJ/mol) as a function of the temperature setting. Bonded pairs
// have their relative velocity damped by the bond itself, so raw eRel under-reads how
// hot the bath is; break checks use max(eRel, bath). Fit: E ≈ 60 at T=40, ∝ T².
export function bathEnergy(temperature: number): number {
  return 0.038 * temperature * temperature;
}

// High-energy capture suppression: two atoms flying past each other too fast can't be
// captured into a bond even if activation is exceeded. Kinetics, not chemistry — so it
// lives here, and chemistry.ts's monotone activation gate stays intact.
export function captureFactor(eRel: number, eBond: number): number {
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
const ATTRACT_K = 0.055;   // strength of the affinity-scaled pair attraction

// --- energy-conserving reactions (J6) --------------------------------------
// Formation is exothermic: EXO_FRACTION of the bond energy becomes fragment kinetic
// energy; breaking is endothermic: the bond energy is consumed from the pair's relative
// kinetic energy. Both exchanges conserve momentum (impulse J on one atom, −J on the
// other → Δv ∝ 1/mass). REACTION_VCAP bounds any single event's Δv for integrator
// stability; values calibrated headless 2026-07-10 (burn-mix ignites at T=40, seawater
// at T=40 stays in the v1 regime).
export const EXO_FRACTION = 0.25;
const REACTION_VCAP = 2.5;

const COULOMB_K = 220;      // ion-ion force constant (softened inverse-square)
const COULOMB_RANGE = 240;  // px — ions feel each other much further than neutrals

// --- toggleable gas-physics extensions -------------------------------------
// Off by default in the headless core (keeps existing invariants/tests intact);
// the app opts individual features in via setPhysics().
const GRAVITY = 0.03;       // downward acceleration (equal for all masses) when enabled
const COLLIDE_K = 1.1;      // soft-sphere repulsion stiffness (excluded volume / collisions)
const COLLIDE_VCAP = 3;     // clamp a single collision's Δv for integrator stability
const TH_TARGET = 0.011;    // thermostat: target mean KE per atom ≈ TH_TARGET · T²
const TH_LAMBDA = 0.4;      // thermostat coupling — strong enough to overcome damping so the
                            // measured temperature actually reaches the setpoint (a uniform
                            // velocity rescale preserves the Maxwell–Boltzmann shape).

export interface PhysicsFlags {
  collisions: boolean;  // excluded-volume repulsion so atoms bounce instead of overlapping
  thermostat: boolean;  // rescale velocities so measured temperature tracks the setpoint
  gravity: boolean;     // downward pull → barometric density gradient
}

type Kinetic = { el: ChemElement; vx: number; vy: number };

function reducedMass(a: Kinetic, b: Kinetic): number {
  return (a.el.mass * b.el.mass) / (a.el.mass + b.el.mass);
}

// Exothermic release: give the pair extra relative speed Δv (random direction),
// split so that momentum is conserved: Δva·ma = −Δvb·mb.
export function applyFormationEnergetics(a: Kinetic, b: Kinetic, eBondKj: number, rng: Rng): void {
  const mu = reducedMass(a, b);
  const eSim = (eBondKj / ENERGY_SCALE) * EXO_FRACTION;
  const dv = Math.min(Math.sqrt(2 * eSim / mu), REACTION_VCAP);
  const ang = rng() * Math.PI * 2;
  const jx = Math.cos(ang) * dv * mu, jy = Math.sin(ang) * dv * mu; // impulse vector
  a.vx += jx / a.el.mass; a.vy += jy / a.el.mass;
  b.vx -= jx / b.el.mass; b.vy -= jy / b.el.mass;
}

// Endothermic break: remove up to the bond energy from the pair's relative kinetic
// energy by scaling relative velocity down (never below zero), momentum-conserving.
export function applyBreakEnergetics(a: Kinetic, b: Kinetic, eBondKj: number): void {
  const mu = reducedMass(a, b);
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
  const eRelSim = 0.5 * mu * (dvx * dvx + dvy * dvy);
  const eCost = eBondKj / ENERGY_SCALE;
  if (eRelSim <= 1e-9) return;
  const scale = Math.sqrt(Math.max(0, eRelSim - eCost) / eRelSim);
  // change in relative velocity: Δ(dv) = (scale−1)·dv, applied as ±J/m
  const ddvx = (scale - 1) * dvx, ddvy = (scale - 1) * dvy;
  const jx = ddvx * mu, jy = ddvy * mu;
  b.vx += jx / b.el.mass; b.vy += jy / b.el.mass;
  a.vx -= jx / a.el.mass; a.vy -= jy / a.el.mass;
}

// element-pair affinity cache (82×82 worst case, filled lazily)
const affinityCache = new Map<string, number>();
function pairAffinity(ea: ChemElement, eb: ChemElement): number {
  const k = pairKey(ea, eb);
  let v = affinityCache.get(k);
  if (v === undefined) { v = affinity(ea, eb); affinityCache.set(k, v); }
  return v;
}

// Element covalent radius (pm) → draw/physics radius (px)
export function drawRadius(el: ChemElement): number {
  return 2.6 + el.radius / 28;
}

export function restLength(a: { el: ChemElement }, b: { el: ChemElement }): number {
  return (drawRadius(a.el) + drawRadius(b.el)) * 1.15;
}

// A pluggable environment lets an outer layer (the game mode) inject extra per-atom forces
// (placed tools/fields) and locally boost bond formation (catalysts) without the core sim
// knowing anything about tools. Both hooks are optional; default behaviour is unchanged.
export interface SimEnvironment {
  force?(a: Atom, dt: number): void;
  // multiplier on P(form) at a midpoint for a specific element pair (selective catalysts)
  formBoost?(x: number, y: number, symA: string, symB: string): number;
  // multiplier on P(break) at a bond's midpoint (shredders / hot zones)
  breakBoost?(x: number, y: number): number;
}

export type Sim = ReturnType<typeof createSim>;

export function createSim({ width, height, sampleElement, cap = 250, temperature = 40, rng = Math.random }: SimOptions) {
  let W = width, H = height;
  let nextId = 1;
  let frame = 0;
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const cooldowns = new Map<string, number>(); // "idA:idB" (idA<idB) → frame when re-bonding is allowed
  const pointer: PointerState = { x: null, y: null, active: false, mode: 'attract' };

  const phys: PhysicsFlags = { collisions: false, thermostat: false, gravity: false };
  let wallImpulse = 0;   // momentum delivered to walls during the current frame
  let pressureEMA = 0;   // smoothed wall force-per-length
  let environment: SimEnvironment | null = null;

  const coolKey = (a: Atom, b: Atom) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
  const bonded = (a: Atom, b: Atom) => a.bonds.some(bd => bd.a === b || bd.b === b);
  const bondLoad = (atom: Atom) => atom.bonds.reduce((s, bd) => s + bd.order, 0);
  const capLeft = (atom: Atom) => atom.el.maxBonds - bondLoad(atom);

  function thermalKick(): number {
    return sim.temperature * 0.0025;
  }

  function makeAtom(el: ChemElement, x?: number, y?: number, hot?: boolean): Atom {
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
      charge: 0,
      bonds: [],
    };
  }

  function spawnTo(n: number): number {
    const want = Math.min(n, sim.cap);
    while (atoms.length < want) atoms.push(makeAtom(sampleElement()));
    return atoms.length;
  }

  // `reaction: true` = a real dissociation event (endothermic energetics + possible
  // heterolytic ionization). `false` = bookkeeping removal (cap trim) — no physics.
  function removeBond(bd: Bond, reaction = false): void {
    const idx = bonds.indexOf(bd);
    if (idx !== -1) bonds.splice(idx, 1);
    bd.a.bonds = bd.a.bonds.filter(x => x !== bd);
    bd.b.bonds = bd.b.bonds.filter(x => x !== bd);
    cooldowns.set(coolKey(bd.a, bd.b), frame + REBOND_COOLDOWN);
    if (reaction) {
      applyBreakEnergetics(bd.a, bd.b, bondEnergy(bd.a.el, bd.b.el, bd.order));
      const [qa, qb] = cleaveCharges(bd.a.el, bd.b.el, bd.a.charge, bd.b.charge);
      bd.a.charge = qa;
      bd.b.charge = qb;
    }
  }

  function removeAtom(atom: Atom): void {
    for (const bd of [...atom.bonds]) removeBond(bd);
    const idx = atoms.indexOf(atom);
    if (idx !== -1) atoms.splice(idx, 1);
  }

  // Relative kinetic energy of a pair on the chemistry (kJ/mol) scale:
  // E = ½ μ |Δv|² · ENERGY_SCALE, μ = reduced mass.
  function eRel(a: Atom, b: Atom): number {
    const mu = (a.el.mass * b.el.mass) / (a.el.mass + b.el.mass);
    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
    return 0.5 * mu * (dvx * dvx + dvy * dvy) * ENERGY_SCALE;
  }

  function tryForm(a: Atom, b: Atom): void {
    if (capLeft(a) <= 0 || capLeft(b) <= 0) return;
    const until = cooldowns.get(coolKey(a, b));
    if (until !== undefined && frame < until) return;
    if (a.bonds.some(bd => bd.a === b || bd.b === b)) return; // already bonded
    const e = eRel(a, b);
    const order = Math.min(maxBondOrder(a.el, b.el), capLeft(a), capLeft(b));
    const eBond = bondEnergy(a.el, b.el, order);
    let p = bondFormProbability(a.el, b.el, e, bondLoad(a), bondLoad(b), a.charge, b.charge)
      * captureFactor(e, eBond) * FORM_RATE;
    if (environment?.formBoost) p *= environment.formBoost((a.x + b.x) / 2, (a.y + b.y) / 2, a.el.symbol, b.el.symbol); // catalysts
    if (p > 0 && rng() < p) {
      const bd: Bond = { a, b, order, key: pairKey(a.el, b.el) };
      bonds.push(bd);
      a.bonds.push(bd);
      b.bonds.push(bd);
      [a.charge, b.charge] = neutralizeOnBond(a.charge, b.charge);
      applyFormationEnergetics(a, b, eBond, rng); // exothermic — this is what ignites chains
    }
  }

  const sim = {
    cap, temperature, atoms, bonds, pointer,
    get width() { return W; }, get height() { return H; },

    resize(w: number, h: number) { W = w; H = h; },

    setTemperature(t: number) { sim.temperature = Math.max(0, Math.min(100, t)); },

    setCap(n: number) {
      sim.cap = Math.max(1, n | 0);
      while (atoms.length > sim.cap) removeAtom(atoms[atoms.length - 1]);
    },

    setPointer(p: Partial<PointerState>) { Object.assign(pointer, p); },

    phys,
    setPhysics(p: Partial<PhysicsFlags>) { Object.assign(phys, p); },

    // Game-mode extension surface: an environment hook + spawn/despawn primitives.
    setEnvironment(e: SimEnvironment | null) { environment = e; },
    spawnAtom(el: ChemElement, x: number, y: number, vx = 0, vy = 0): Atom | null {
      if (atoms.length >= Math.ceil(sim.cap * 1.5)) return null;
      const a: Atom = { id: nextId++, el, x, y, vx, vy, charge: 0, bonds: [] };
      atoms.push(a);
      return a;
    },
    despawn(atom: Atom) { removeAtom(atom); },

    spawnTo,

    // Fill to half of cap (J15) — the other half is the player's injection budget.
    respawn() {
      atoms.length = 0;
      bonds.length = 0;
      cooldowns.clear();
      spawnTo(Math.max(1, Math.floor(sim.cap * 0.5)));
    },

    // Inject `count` atoms near (x,y); returns how many actually spawned.
    // `element` overrides the sampler — the injector feature (J9) drops a pure element.
    // Soft cap (J15): injection may overshoot the cap (step() decays the oldest atoms back
    // down); the 1.5×cap hard bound evicts the oldest immediately so spam stays bounded.
    burst(x: number, y: number, count = 30, element?: ChemElement): number {
      const hardMax = Math.ceil(sim.cap * 1.5);
      let added = 0;
      while (added < count) {
        if (atoms.length >= hardMax) {
          if (atoms.length > 0 && added < count) removeAtom(atoms[0]);
          else break;
        }
        const atom = makeAtom(element ?? sampleElement(), x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 30, true);
        const ang = rng() * Math.PI * 2, sp = 2 + rng() * 4;
        atom.vx = Math.cos(ang) * sp; atom.vy = Math.sin(ang) * sp;
        atoms.push(atom);
        added++;
      }
      return added;
    },

    // Detonation (J16/J17): break every bond at once — a flash depositing several times
    // each bond's energy: the dissociation cost is paid (endothermic step inside
    // removeBond) and DETONATION_BOOST× the bond energy ejects the pair along its bond
    // axis (momentum-conserving), so fragments visibly fly apart before damping settles
    // them. Ionic pairs cleave heterolytically. Returns the number of bonds broken.
    detonate(): number {
      const DETONATION_BOOST = 4;
      const DETONATION_VCAP = 8;
      const broken = bonds.length;
      for (const bd of [...bonds]) {
        const eBond = bondEnergy(bd.a.el, bd.b.el, bd.order);
        removeBond(bd, true); // endothermic bookkeeping + heterolytic charges + cooldown
        const dx = bd.b.x - bd.a.x, dy = bd.b.y - bd.a.y;
        const d = Math.hypot(dx, dy) || 1;
        const mu = (bd.a.el.mass * bd.b.el.mass) / (bd.a.el.mass + bd.b.el.mass);
        const dv = Math.min(Math.sqrt(2 * (eBond * DETONATION_BOOST / ENERGY_SCALE) / mu), DETONATION_VCAP);
        const jx = (dx / d) * dv * mu, jy = (dy / d) * dv * mu;
        bd.b.vx += jx / bd.b.el.mass; bd.b.vy += jy / bd.b.el.mass;
        bd.a.vx -= jx / bd.a.el.mass; bd.a.vy -= jy / bd.a.el.mass;
      }
      return broken;
    },

    step(dtMs = 16.67) {
      frame++;
      const dt = Math.min(dtMs / 16.67, 3);
      const kick = thermalKick();

      // pointer field + thermal + integrate
      for (const p of atoms) {
        if (pointer.active && pointer.x !== null && pointer.y !== null) {
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
        if (phys.gravity) p.vy += GRAVITY * dt; // equal accel — heavier gases settle lower
        if (environment?.force) environment.force(p, dt); // game-mode tools/fields
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

      // integrate + walls (wall bounces deposit momentum → pressure measurement)
      for (const p of atoms) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0) { p.x = 0; p.vx *= -1; wallImpulse += 2 * p.el.mass * Math.abs(p.vx); }
        if (p.x > W) { p.x = W; p.vx *= -1; wallImpulse += 2 * p.el.mass * Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy *= -1; wallImpulse += 2 * p.el.mass * Math.abs(p.vy); }
        if (p.y > H) { p.y = H; p.vy *= -1; wallImpulse += 2 * p.el.mass * Math.abs(p.vy); }
      }
      // Pressure = wall force per unit boundary length, smoothed. By 2D kinetic theory this
      // tracks n·⟨KE⟩, so PV/(N·kT) ≈ 1 for an ideal gas; interactions push it off 1.
      const perimeter = 2 * (W + H) || 1;
      pressureEMA += ((wallImpulse / perimeter) - pressureEMA) * 0.05;
      wallImpulse = 0;

      // bond breaking (energy-gated per chemistry.ts); the bath floor keeps global
      // temperature honest even though bond damping cools a pair's raw eRel
      const bath = bathEnergy(sim.temperature);
      for (let i = bonds.length - 1; i >= 0; i--) {
        const bd = bonds[i];
        const e = Math.max(eRel(bd.a, bd.b), bath);
        let p = bondBreakProbability(bd.a.el, bd.b.el, e, bd.order) * BREAK_RATE * dt;
        if (environment?.breakBoost) p *= environment.breakBoost((bd.a.x + bd.b.x) / 2, (bd.a.y + bd.b.y) / 2);
        if (p > 0 && rng() < p) removeBond(bd, true);
      }

      // Coulomb forces among ions (J7): few atoms carry charge, so collect then O(k²).
      // Softened inverse-square; opposite charges attract, like charges repel.
      const ions = atoms.filter(p => p.charge !== 0);
      for (let i = 0; i < ions.length; i++) {
        const a = ions[i];
        for (let j = i + 1; j < ions.length; j++) {
          const b = ions[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > COULOMB_RANGE * COULOMB_RANGE || d2 < 1) continue;
          const d = Math.sqrt(d2);
          // positive f = repulsion (like charges), negative = attraction
          const f = COULOMB_K * a.charge * b.charge / Math.max(d2, 100) * dt;
          const ux = dx / d, uy = dy / d;
          a.vx -= ux * f / (a.el.mass / 16); a.vy -= uy * f / (a.el.mass / 16);
          b.vx += ux * f / (b.el.mass / 16); b.vy += uy * f / (b.el.mass / 16);
        }
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
          // excluded volume (collisions): non-bonded atoms repel once they overlap, so they
          // bounce instead of passing through. Contact < bond rest length, so chemistry is
          // untouched. This is the keystone that makes the field behave like a real gas.
          if (phys.collisions && !bonded(a, b)) {
            const contact = drawRadius(a.el) + drawRadius(b.el);
            if (d2 < contact * contact) {
              const d = Math.sqrt(d2);
              const push = Math.min(COLLIDE_K * (contact - d) * dt, COLLIDE_VCAP);
              const ux = dx / d, uy = dy / d;
              a.vx -= ux * push / (a.el.mass / 16); a.vy -= uy * push / (a.el.mass / 16);
              b.vx += ux * push / (b.el.mass / 16); b.vy += uy * push / (b.el.mass / 16);
            }
          }
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

      // thermostat: make temperature emergent-but-controlled. Measure mean KE, then gently
      // rescale velocities toward the setpoint's target KE (Berendsen-style) so the reported
      // temperature reflects real kinetic state instead of just the raw thermal-kick knob.
      if (phys.thermostat && atoms.length) {
        let keSum = 0;
        for (const p of atoms) keSum += p.el.mass * (p.vx * p.vx + p.vy * p.vy);
        const measKE = 0.5 * keSum / atoms.length;
        const target = TH_TARGET * sim.temperature * sim.temperature;
        if (measKE > 1e-9) {
          const scale = Math.sqrt(Math.max(0, 1 + TH_LAMBDA * (target / measKE - 1)));
          for (const p of atoms) { p.vx *= scale; p.vy *= scale; }
        }
      }

      // soft-cap decay (J15): while over cap, shed the OLDEST atom every few frames
      // (~12 atoms/s) so injected overshoot drains gracefully instead of instantly
      if (atoms.length > sim.cap && frame % 5 === 0) {
        removeAtom(atoms[0]);
      }

      // occasional cooldown GC
      if (frame % 600 === 0) {
        for (const [k, until] of cooldowns) if (until < frame) cooldowns.delete(k);
      }
    },

    stats(): SimStats {
      const byElement: Record<string, number> = {};
      for (const p of atoms) byElement[p.el.symbol] = (byElement[p.el.symbol] ?? 0) + 1;
      const byBondPair: Record<string, number> = {};
      let maxLoadRatio = 0, overloaded = 0, positive = 0, negative = 0, net = 0, speedSum = 0, keSum = 0;
      for (const bd of bonds) byBondPair[bd.key] = (byBondPair[bd.key] ?? 0) + 1;
      for (const p of atoms) {
        if (p.el.maxBonds > 0) maxLoadRatio = Math.max(maxLoadRatio, bondLoad(p) / p.el.maxBonds);
        if (bondLoad(p) > p.el.maxBonds) overloaded++;
        if (p.charge > 0) positive++;
        if (p.charge < 0) negative++;
        net += p.charge;
        speedSum += Math.hypot(p.vx, p.vy);
        keSum += 0.5 * p.el.mass * (p.vx * p.vx + p.vy * p.vy);
      }
      return {
        atoms: atoms.length, bonds: bonds.length, byElement, byBondPair,
        maxLoadRatio, overloaded, cap: sim.cap, temperature: sim.temperature,
        ions: { positive, negative, net },
        meanSpeed: atoms.length ? speedSum / atoms.length : 0,
        meanKE: atoms.length ? keSum / atoms.length : 0,
        pressure: pressureEMA,
        area: W * H,
      };
    },
  };

  return sim;
}
