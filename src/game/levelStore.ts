// Persistence for player-authored levels. Custom levels live in localStorage (playable via
// ?game=1&custom=<id>); the editor's in-progress draft and the "test this level" hand-off
// use sessionStorage so they survive the reload that swaps between editor and game.

import type { LevelDef } from './types';

const STORE_KEY = 'pulse.customLevels';
export const DRAFT_KEY = 'pulse.editorDraft';
export const TEST_KEY = 'pulse.testLevel';

export interface StoredLevel { id: string; name: string; def: LevelDef; savedAt: number; }

export function loadAll(): StoredLevel[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function getOne(id: string): StoredLevel | undefined {
  return loadAll().find(s => s.id === id);
}

// Upsert by def.id, newest first. Returns the persisted record.
export function saveOne(def: LevelDef): StoredLevel {
  const all = loadAll();
  const rec: StoredLevel = { id: def.id, name: def.name, def, savedAt: Date.now() };
  const i = all.findIndex(s => s.id === def.id);
  if (i >= 0) all[i] = rec; else all.unshift(rec);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
  return rec;
}

export function deleteOne(id: string): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(loadAll().filter(s => s.id !== id)));
}

export function newId(): string {
  return 'custom-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
}

// A minimal but complete, immediately-playable starting point.
export function makeEmptyLevel(): LevelDef {
  return {
    id: newId(),
    name: 'Untitled Level',
    blurb: 'Route the atoms into the tank and collect the target molecule.',
    board: { w: 960, h: 600 },
    cap: 150,
    temperature: 30,
    collisions: false,
    emitters: [
      { element: 'H', x: 0.08, y: 0.44, angle: 0, mols: 30, rate: 16, speed: 2, spread: 0.2, aimable: true },
      { element: 'H', x: 0.08, y: 0.56, angle: 0, mols: 30, rate: 16, speed: 2, spread: 0.2, aimable: true },
    ],
    zones: [{ id: 'tank', x: 0.70, y: 0.30, w: 0.22, h: 0.40, label: 'H₂' }],
    preplaced: [],
    palette: [{ type: 'fan', limit: 3 }, { type: 'deflector', limit: 2 }],
    objective: { kind: 'collect', formula: 'H2', count: 6 },
    settleSeconds: 6,
    par: { tools: 3, seconds: 60 },
  };
}

// Structural validation of an imported LevelDef — enough to avoid a hard crash in the game
// engine. Returns an error string, or null if usable.
export function validateLevel(def: unknown): string | null {
  if (!def || typeof def !== 'object') return 'Not a level object.';
  const l = def as Partial<LevelDef>;
  if (!l.id || !l.name) return 'Missing id or name.';
  if (!Array.isArray(l.emitters) || l.emitters.length === 0) return 'Needs at least one emitter.';
  if (!Array.isArray(l.zones) || l.zones.length === 0) return 'Needs at least one collector zone.';
  if (!l.objective?.formula) return 'Missing objective formula.';
  return null;
}
