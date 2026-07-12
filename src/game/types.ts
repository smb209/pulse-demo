// Data model for the "Reaction Foundry" game mode. Everything here is designed to be
// edited/extended by data: add a tool → add a ToolType; add a level → add a LevelDef;
// add an objective kind → extend ObjectiveDef + the evaluator; elements/reactions come
// straight from elements.ts / chemistry.ts.

import type { Atom } from '../sim';

// A placed tool on the board (canvas px coordinates).
export interface ToolInstance {
  type: string;      // key into TOOL_TYPES
  x: number;
  y: number;
  radius: number;
  strength: number;
  angle: number;     // radians, for directional tools
  color: string;
  fixed: boolean;    // preplaced by the level, not movable/removable
}

// A tool *behaviour*. Register one to add a new tool to every level that lists it.
export interface ToolType {
  id: string;
  name: string;
  color: string;
  blurb: string;
  defaults: { radius: number; strength: number; angle?: number };
  // extra per-atom force (mutate a.vx/a.vy). Optional.
  force?(t: ToolInstance, a: Atom, dt: number): void;
  // multiplier on bond-formation probability for a given element pair (catalysts, selective
  // catalysts). Optional; default 1.
  formBoost?(t: ToolInstance, x: number, y: number, symA: string, symB: string): number;
  // multiplier on bond-break probability at a point (shredders, hot zones). Optional; default 1.
  breakBoost?(t: ToolInstance, x: number, y: number): number;
  // per-frame chance (0..1) to adsorb/remove an atom inside the tool (contaminant getters).
  adsorb?(t: ToolInstance, x: number, y: number): number;
  // set params from a press-drag vector (dx,dy = pointer − tool centre): direction and/or
  // intensity. Optional — tools without it just place on tap.
  aim?(t: ToolInstance, dx: number, dy: number): void;
  // draw the tool at its canvas position.
  draw(ctx: CanvasRenderingContext2D, t: ToolInstance, selected: boolean): void;
}

// --- level data (board coords are fractions 0..1 → resolution independent) ---

export interface EmitterDef {
  element: string;   // symbol, resolved via BY_SYMBOL
  x: number; y: number;
  angle: number;     // emission direction (radians)
  mols: number;      // total atoms this emitter will release (the reactant budget)
  rate: number;      // atoms per second
  speed: number;     // initial speed
  spread?: number;   // angular jitter (radians)
  aimable?: boolean; // player may rotate it during the setup phase
}

export interface ZoneDef {
  id: string;
  x: number; y: number; w: number; h: number;
  label?: string;
}

export interface PlacedToolDef { type: string; x: number; y: number; angle?: number; fixed?: boolean; }

export interface ObjectiveDef {
  kind: 'collect';
  formula: string;   // ascii Hill formula, e.g. 'H2O' (subscripts normalised on compare)
  count: number;
}

export interface PaletteEntry { type: string; limit: number; }

export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  featured?: string;   // element this level introduces (periodic-table progression)
  reaction?: string;   // the balanced equation this level realises, e.g. '2 H₂ + O₂ → 2 H₂O'
  fact?: string;       // a real scientific fact tied to the reaction/method
  board?: { w: number; h: number };  // fixed logical size (default 960×600), letterboxed
  cap: number;
  temperature: number;
  collisions?: boolean;
  emitters: EmitterDef[];
  zones: ZoneDef[];              // collectors
  preplaced?: PlacedToolDef[];
  palette: PaletteEntry[];       // tools the player may place + how many
  objective: ObjectiveDef;
  settleSeconds?: number;  // grace time after the last atom is emitted, before scoring (default 6)
  par: { tools: number; seconds: number };  // legacy time/tools par (kept for reference)
}
