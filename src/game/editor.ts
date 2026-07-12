// Reaction Foundry — level editor. Boot with ?game=1&editor=1.
// Produces LevelDef objects (the exact contract the game consumes) and reuses the real
// TOOL_TYPES draw calls, so what you build is what you play. Placement is tap-to-drop +
// a slider/number inspector: precise positioning never needs a pixel-perfect tap, and while
// dragging on a touch screen the object rides above your fingertip so you can see it.

import { TOOL_TYPES } from './content';
import { ELEMENTS, BY_SYMBOL } from '../elements';
import {
  makeEmptyLevel, saveOne, loadAll, deleteOne, getOne, validateLevel,
  DRAFT_KEY, TEST_KEY,
} from './levelStore';
import type { LevelDef, PlacedToolDef, ToolInstance } from './types';

type Sel = { kind: 'tool' | 'emitter' | 'zone'; i: number } | null;

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function initEditor(): void {
  injectStyles();

  let draft = loadDraft();
  let W = draft.board?.w ?? 960, H = draft.board?.h ?? 600;
  let dpr = 1;

  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  let selection: Sel = null;
  let settingsOpen = false;
  let placeMode: string | null = null;   // 'tool:fan' | 'emitter' | 'zone'
  let drag: { grabX: number; grabY: number; lift: number; fx: number; fy: number } | null = null;

  // --- DOM scaffold ---------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'edUI';
  root.innerHTML = uiHTML();
  document.body.appendChild(root);
  const panel = root.querySelector('#edPanel') as HTMLElement;
  const nameEl = root.querySelector('#edName') as HTMLElement;
  const modeBanner = root.querySelector('#edMode') as HTMLElement;
  const bar = root.querySelector('#edBar') as HTMLElement;
  const toastEl = root.querySelector('#edToast') as HTMLElement;

  // --- model <-> pixel helpers ---------------------------------------------
  function toolInst(p: PlacedToolDef): ToolInstance {
    const tt = TOOL_TYPES[p.type];
    return {
      type: p.type, x: p.x * W, y: p.y * H, angle: p.angle ?? tt.defaults.angle ?? 0,
      radius: p.radius ?? tt.defaults.radius, strength: p.strength ?? tt.defaults.strength,
      color: tt.color, fixed: !!p.fixed,
    };
  }
  const toLocal = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };

  // --- layout / fit ---------------------------------------------------------
  function panelVisible(): boolean {
    return window.innerWidth >= 820 || settingsOpen || selection !== null;
  }
  function fit(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    const wide = vw >= 820;
    const topH = bar.offsetHeight + 8;
    const rightW = wide && panelVisible() ? 324 : 0;
    const bottomH = !wide && panelVisible() ? Math.round(vh * 0.44) : 0;
    const availW = vw - rightW - 16;
    const availH = vh - topH - bottomH - 12;
    const scale = Math.max(0.05, Math.min(availW / W, availH / H));
    canvas.width = W * dpr; canvas.height = H * dpr;
    const cx = 8 + availW / 2, cy = topH + availH / 2;
    canvas.style.position = 'fixed';
    canvas.style.transform = 'none';
    canvas.style.left = (cx - W * scale / 2) + 'px';
    canvas.style.top = (cy - H * scale / 2) + 'px';
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    root.dataset.wide = wide ? '1' : '0';
    root.dataset.panel = panelVisible() ? '1' : '0';
  }
  window.addEventListener('resize', fit);

  // --- persistence ----------------------------------------------------------
  const autosave = () => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  const updateName = () => { nameEl.textContent = draft.name || 'Untitled'; };

  // --- selection / placement ------------------------------------------------
  function hitTest(px: number, py: number): Sel {
    const tools = draft.preplaced ?? [];
    for (let i = tools.length - 1; i >= 0; i--) {
      const t = toolInst(tools[i]);
      if (Math.hypot(t.x - px, t.y - py) < 26) return { kind: 'tool', i };
    }
    for (let i = draft.emitters.length - 1; i >= 0; i--) {
      const e = draft.emitters[i];
      if (Math.hypot(e.x * W - px, e.y * H - py) < 28) return { kind: 'emitter', i };
    }
    for (let i = draft.zones.length - 1; i >= 0; i--) {
      const z = draft.zones[i];
      if (px >= z.x * W && px <= (z.x + z.w) * W && py >= z.y * H && py <= (z.y + z.h) * H) return { kind: 'zone', i };
    }
    return null;
  }
  function anchorPx(sel: NonNullable<Sel>): { x: number; y: number } {
    if (sel.kind === 'tool') { const t = (draft.preplaced ?? [])[sel.i]; return { x: t.x * W, y: t.y * H }; }
    if (sel.kind === 'emitter') { const e = draft.emitters[sel.i]; return { x: e.x * W, y: e.y * H }; }
    const z = draft.zones[sel.i]; return { x: z.x * W, y: z.y * H };
  }
  function moveAnchor(sel: NonNullable<Sel>, px: number, py: number): void {
    const xf = clamp01(px / W), yf = clamp01(py / H);
    if (sel.kind === 'tool') { const t = (draft.preplaced ?? [])[sel.i]; t.x = xf; t.y = yf; }
    else if (sel.kind === 'emitter') { const e = draft.emitters[sel.i]; e.x = xf; e.y = yf; }
    else { const z = draft.zones[sel.i]; z.x = clamp01(px / W); z.y = clamp01(py / H); }
    syncPositionInputs();
  }
  function placeAt(mode: string, px: number, py: number): void {
    const xf = clamp01(px / W), yf = clamp01(py / H);
    if (mode.startsWith('tool:')) {
      const type = mode.slice(5);
      (draft.preplaced ??= []).push({ type, x: xf, y: yf, angle: 0, fixed: false });
      selection = { kind: 'tool', i: draft.preplaced.length - 1 };
    } else if (mode === 'emitter') {
      draft.emitters.push({ element: 'H', x: xf, y: yf, angle: 0, mols: 30, rate: 16, speed: 2, spread: 0.2, aimable: true });
      selection = { kind: 'emitter', i: draft.emitters.length - 1 };
    } else {
      const w = 0.22, h = 0.26;
      draft.zones.push({ id: 'zone' + (draft.zones.length + 1), x: clamp01(xf - w / 2), y: clamp01(yf - h / 2), w, h, label: 'X' });
      selection = { kind: 'zone', i: draft.zones.length - 1 };
    }
    settingsOpen = false;
    autosave(); renderPanel(); fit();
  }
  function deleteSelection(): void {
    if (!selection) return;
    if (selection.kind === 'tool') draft.preplaced!.splice(selection.i, 1);
    else if (selection.kind === 'emitter') draft.emitters.splice(selection.i, 1);
    else draft.zones.splice(selection.i, 1);
    selection = null; autosave(); renderPanel(); fit();
  }

  // --- canvas interaction ---------------------------------------------------
  canvas.addEventListener('pointerdown', e => {
    const p = toLocal(e);
    if (placeMode) { placeAt(placeMode, p.x, p.y); setPlaceMode(null); return; }
    const hit = hitTest(p.x, p.y);
    selection = hit;
    settingsOpen = false;
    renderPanel(); fit();
    if (hit) {
      const a = anchorPx(hit);
      const lift = e.pointerType === 'touch' ? 44 : 0;
      drag = { grabX: a.x - p.x, grabY: a.y - p.y, lift, fx: p.x, fy: p.y };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !selection) return;
    const p = toLocal(e);
    drag.fx = p.x; drag.fy = p.y;
    moveAnchor(selection, p.x + drag.grabX, p.y - drag.lift + drag.grabY);
  });
  const endDrag = () => { if (drag) { drag = null; autosave(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // --- top bar --------------------------------------------------------------
  function setPlaceMode(m: string | null): void {
    placeMode = m;
    root.querySelectorAll<HTMLElement>('[data-add]').forEach(b => b.classList.toggle('on', b.dataset.add === m));
    modeBanner.style.display = m ? 'block' : 'none';
    if (m) modeBanner.textContent = 'Tap the board to place · tap again on the item to fine-tune it';
  }
  root.querySelectorAll<HTMLElement>('[data-add]').forEach(b =>
    b.addEventListener('click', () => setPlaceMode(placeMode === b.dataset.add ? null : b.dataset.add!)));

  (root.querySelector('#edSettings') as HTMLElement).addEventListener('click', () => {
    settingsOpen = !settingsOpen; if (settingsOpen) setPlaceMode(null);
    renderPanel(); fit();
  });
  (root.querySelector('#edTest') as HTMLElement).addEventListener('click', () => {
    const err = validateLevel(draft);
    if (err) { toast('Can’t test: ' + err); return; }
    sessionStorage.setItem(TEST_KEY, JSON.stringify(draft));
    autosave();
    location.href = `${location.pathname}?game=1&test=1`;
  });
  (root.querySelector('#edSave') as HTMLElement).addEventListener('click', () => {
    saveOne(draft); toast(`Saved “${draft.name}”`);
  });
  (root.querySelector('#edNew') as HTMLElement).addEventListener('click', () => confirmModal(
    'Start a new level?', 'Your current draft is autosaved only until you overwrite it. Save it first if you want to keep it.',
    () => { draft = makeEmptyLevel(); W = draft.board!.w; H = draft.board!.h; selection = null; settingsOpen = false; autosave(); updateName(); renderPanel(); fit(); }));
  (root.querySelector('#edLoad') as HTMLElement).addEventListener('click', openLoad);
  (root.querySelector('#edExport') as HTMLElement).addEventListener('click', openExport);
  (root.querySelector('#edImport') as HTMLElement).addEventListener('click', openImport);

  // --- inspector / settings panel ------------------------------------------
  panel.addEventListener('input', onPanelChange);
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-act]'); if (!b) return;
    if (b.getAttribute('data-act') === 'del') deleteSelection();
  });

  function onPanelChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    const field = el.dataset.field; if (!field) return;
    let v: string | number | boolean;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range' || el.type === 'number') v = Number(el.value);
    else v = el.value;
    applyField(field, v);
    // keep the paired range/number in the same control synced without a full re-render
    const ctl = el.closest('.f-ctl');
    if (ctl) ctl.querySelectorAll<HTMLInputElement>(`[data-field="${field}"]`).forEach(o => { if (o !== el) o.value = String(v); });
    autosave();
  }

  function applyField(field: string, v: string | number | boolean): void {
    if (field.startsWith('s:')) return applySetting(field.slice(2), v);
    if (field.startsWith('pal:')) {
      const type = field.slice(4), limit = Number(v);
      draft.palette = draft.palette.filter(p => p.type !== type);
      if (limit > 0) draft.palette.push({ type, limit });
      return;
    }
    if (!selection) return;
    if (selection.kind === 'tool') {
      const t = draft.preplaced![selection.i];
      if (field === 'x') t.x = clamp01(+v); else if (field === 'y') t.y = clamp01(+v);
      else if (field === 'radius') t.radius = +v; else if (field === 'strength') t.strength = +v;
      else if (field === 'angle') t.angle = (+v) * RAD; else if (field === 'fixed') t.fixed = !!v;
    } else if (selection.kind === 'emitter') {
      const em = draft.emitters[selection.i];
      if (field === 'element') em.element = BY_SYMBOL[v as string] ? (v as string) : em.element;
      else if (field === 'x') em.x = clamp01(+v); else if (field === 'y') em.y = clamp01(+v);
      else if (field === 'angle') em.angle = (+v) * RAD; else if (field === 'mols') em.mols = Math.max(1, +v);
      else if (field === 'rate') em.rate = Math.max(1, +v); else if (field === 'speed') em.speed = +v;
      else if (field === 'spread') em.spread = +v; else if (field === 'aimable') em.aimable = !!v;
    } else {
      const z = draft.zones[selection.i];
      if (field === 'label') z.label = v as string; else if (field === 'x') z.x = clamp01(+v); else if (field === 'y') z.y = clamp01(+v);
      else if (field === 'w') z.w = clamp(+v, 0.03, 1); else if (field === 'h') z.h = clamp(+v, 0.03, 1);
    }
  }

  function applySetting(key: string, v: string | number | boolean): void {
    switch (key) {
      case 'name': draft.name = v as string; updateName(); break;
      case 'blurb': draft.blurb = v as string; break;
      case 'featured': draft.featured = (v as string) || undefined; break;
      case 'reaction': draft.reaction = (v as string) || undefined; break;
      case 'fact': draft.fact = (v as string) || undefined; break;
      case 'temperature': draft.temperature = clamp(+v, 0, 100); break;
      case 'cap': draft.cap = Math.max(10, +v); break;
      case 'settle': draft.settleSeconds = Math.max(0, +v); break;
      case 'collisions': draft.collisions = !!v; break;
      case 'objFormula': draft.objective.formula = (v as string).replace(/\s/g, ''); break;
      case 'objCount': draft.objective.count = Math.max(1, +v); break;
      case 'boardW': draft.board = { w: clamp(+v, 320, 1920), h: H }; W = draft.board.w; fit(); break;
      case 'boardH': draft.board = { w: W, h: clamp(+v, 240, 1200) }; H = draft.board.h; fit(); break;
    }
  }

  function syncPositionInputs(): void {
    if (!selection || settingsOpen) return;
    const set = (f: string, val: number) => panel.querySelectorAll<HTMLInputElement>(`[data-field="${f}"]`).forEach(o => o.value = String(val));
    if (selection.kind === 'tool') { const t = draft.preplaced![selection.i]; set('x', round(t.x)); set('y', round(t.y)); }
    else if (selection.kind === 'emitter') { const e = draft.emitters[selection.i]; set('x', round(e.x)); set('y', round(e.y)); }
    else { const z = draft.zones[selection.i]; set('x', round(z.x)); set('y', round(z.y)); }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;

  function renderPanel(): void {
    panel.innerHTML = settingsOpen ? settingsHTML(draft) : selection ? selectionHTML() : hintHTML();
  }

  function selectionHTML(): string {
    if (!selection) return hintHTML();
    if (selection.kind === 'tool') {
      const t = draft.preplaced![selection.i], tt = TOOL_TYPES[t.type];
      return section(`${tt.name}`, 'tool', `
        <p class="ed-blurb">${esc(tt.blurb)}</p>
        ${chk('Fixed (player can’t move it — a hazard/given)', 'fixed', !!t.fixed)}
        ${range('Position X', 'x', t.x, 0, 1, 0.005)}
        ${range('Position Y', 'y', t.y, 0, 1, 0.005)}
        ${range('Radius', 'radius', t.radius ?? tt.defaults.radius, 20, 240, 1)}
        ${range('Strength', 'strength', t.strength ?? tt.defaults.strength, 0, 4, 0.01)}
        ${range('Angle°', 'angle', Math.round((t.angle ?? 0) / RAD), -180, 180, 1)}`);
    }
    if (selection.kind === 'emitter') {
      const e = draft.emitters[selection.i];
      return section('Emitter', 'emitter', `
        ${elementSelect(e.element)}
        ${range('Position X', 'x', e.x, 0, 1, 0.005)}
        ${range('Position Y', 'y', e.y, 0, 1, 0.005)}
        ${range('Aim angle°', 'angle', Math.round(e.angle / RAD), -180, 180, 1)}
        ${range('Amount (mol)', 'mols', e.mols, 1, 300, 1)}
        ${range('Rate (mol/s)', 'rate', e.rate, 1, 80, 1)}
        ${range('Speed', 'speed', e.speed, 0.2, 8, 0.1)}
        ${range('Spread', 'spread', e.spread ?? 0, 0, 2, 0.02)}
        ${chk('Player may rotate it in setup', 'aimable', !!e.aimable)}`);
    }
    const z = draft.zones[selection.i];
    return section('Collector zone', 'zone', `
      ${text('Label (target shown to player)', 'label', z.label ?? '')}
      ${range('Position X', 'x', z.x, 0, 1, 0.005)}
      ${range('Position Y', 'y', z.y, 0, 1, 0.005)}
      ${range('Width', 'w', z.w, 0.03, 1, 0.005)}
      ${range('Height', 'h', z.h, 0.03, 1, 0.005)}`);
  }

  updateName();
  renderPanel();
  fit();

  // --- render loop ----------------------------------------------------------
  function draw(): void {
    ctx.fillStyle = '#0f1212'; ctx.fillRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = 'rgba(120,140,145,0.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo(W * i / 10, 0); ctx.lineTo(W * i / 10, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H * i / 10); ctx.lineTo(W, H * i / 10); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,140,145,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);

    // zones
    draft.zones.forEach((z, i) => {
      const x = z.x * W, y = z.y * H, w = z.w * W, h = z.h * H;
      const on = selection?.kind === 'zone' && selection.i === i;
      ctx.save();
      ctx.fillStyle = 'rgba(68,212,228,0.06)';
      ctx.strokeStyle = on ? '#7BEAF6' : '#44D4E4'; ctx.setLineDash([7, 6]); ctx.lineWidth = on ? 3 : 2;
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      ctx.fillStyle = '#8B9698'; ctx.font = '600 12px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`collect ${z.label ?? ''}`, x + 8, y + 7);
      if (on) cornerTicks(x, y, w, h);
      ctx.restore();
    });

    // emitters
    draft.emitters.forEach((e, i) => {
      const el = BY_SYMBOL[e.element] ?? BY_SYMBOL.H;
      const x = e.x * W, y = e.y * H;
      const on = selection?.kind === 'emitter' && selection.i === i;
      ctx.save();
      ctx.strokeStyle = e.aimable ? '#F1F3F3' : '#6A7273'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
      const nx = x + Math.cos(e.angle) * 24, ny = y + Math.sin(e.angle) * 24;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny);
      ctx.lineTo(nx - Math.cos(e.angle - 0.5) * 7, ny - Math.sin(e.angle - 0.5) * 7);
      ctx.moveTo(nx, ny); ctx.lineTo(nx - Math.cos(e.angle + 0.5) * 7, ny - Math.sin(e.angle + 0.5) * 7);
      ctx.stroke(); ctx.globalAlpha = 1;
      if (on) { ctx.strokeStyle = '#7BEAF6'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = el.cpk; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101414'; ctx.font = '700 11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(el.symbol, x, y + 0.5);
      ctx.fillStyle = '#A0AAAB'; ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText(`${e.mols} mol`, x, y + 16);
      ctx.restore();
    });

    // tools
    (draft.preplaced ?? []).forEach((p, i) => {
      const on = selection?.kind === 'tool' && selection.i === i;
      const inst = toolInst(p);
      TOOL_TYPES[p.type].draw(ctx, inst, on);
      ctx.save();
      ctx.fillStyle = p.fixed ? '#FF9A6B' : '#F1F3F3';
      ctx.beginPath(); ctx.arc(inst.x, inst.y, on ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
      if (on) { ctx.strokeStyle = '#7BEAF6'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(inst.x, inst.y, 20, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
    });

    // fingertip-lift connector while dragging on touch
    if (drag && drag.lift > 0 && selection) {
      const a = anchorPx(selection);
      ctx.save();
      ctx.strokeStyle = 'rgba(123,234,246,0.6)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(drag.fx, drag.fy); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(123,234,246,0.35)';
      ctx.beginPath(); ctx.arc(drag.fx, drag.fy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  function cornerTicks(x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = '#7BEAF6'; const s = 5;
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { ctx.fillRect(cx - s, cy - s, s * 2, s * 2); }
  }
  requestAnimationFrame(draw);

  // --- dialogs --------------------------------------------------------------
  function openLoad(): void {
    const list = loadAll();
    const rows = list.length ? list.map(s => `
      <div class="ed-lrow">
        <div class="ed-lname">${esc(s.name)}<small>${new Date(s.savedAt).toLocaleString()}</small></div>
        <div class="ed-lacts">
          <button class="pl-btn sm" data-load="${s.id}">Edit</button>
          <a class="pl-btn sm ghost" href="${location.pathname}?game=1&custom=${s.id}">Play</a>
          <button class="pl-btn sm ghost" data-del="${s.id}">Delete</button>
        </div>
      </div>`).join('') : '<p class="ed-blurb">No saved levels yet. Build one and hit Save.</p>';
    const m = modal('Load level', `<div class="ed-list">${rows}</div>`);
    m.body.querySelectorAll<HTMLElement>('[data-load]').forEach(b => b.addEventListener('click', () => {
      const rec = getOne(b.dataset.load!); if (!rec) return;
      draft = JSON.parse(JSON.stringify(rec.def)); normalize(draft);
      W = draft.board?.w ?? 960; H = draft.board?.h ?? 600;
      selection = null; settingsOpen = false; autosave(); updateName(); renderPanel(); fit(); m.close();
    }));
    m.body.querySelectorAll<HTMLElement>('[data-del]').forEach(b => b.addEventListener('click', () => {
      deleteOne(b.dataset.del!); m.close(); openLoad();
    }));
  }
  function openExport(): void {
    const json = JSON.stringify(draft, null, 2);
    const m = modal('Export JSON', `<textarea class="ed-code" readonly>${esc(json)}</textarea>
      <div class="ed-mrow"><button class="pl-btn sm" id="edCopy">Copy</button></div>`);
    (m.body.querySelector('#edCopy') as HTMLElement).addEventListener('click', () => {
      navigator.clipboard?.writeText(json).then(() => toast('Copied to clipboard'), () => toast('Copy failed — select & copy manually'));
    });
  }
  function openImport(): void {
    const m = modal('Import JSON', `<textarea class="ed-code" id="edPaste" placeholder="Paste a level’s JSON here…"></textarea>
      <div class="ed-mrow"><button class="pl-btn sm" id="edDoImport">Import</button></div>`);
    (m.body.querySelector('#edDoImport') as HTMLElement).addEventListener('click', () => {
      let parsed: unknown;
      try { parsed = JSON.parse((m.body.querySelector('#edPaste') as HTMLTextAreaElement).value); }
      catch { toast('Not valid JSON'); return; }
      const err = validateLevel(parsed); if (err) { toast('Invalid level: ' + err); return; }
      draft = parsed as LevelDef; normalize(draft);
      W = draft.board?.w ?? 960; H = draft.board?.h ?? 600;
      selection = null; settingsOpen = false; autosave(); updateName(); renderPanel(); fit(); m.close();
      toast('Imported');
    });
  }

  function toast(msg: string): void {
    toastEl.textContent = msg; toastEl.classList.add('show');
    window.clearTimeout((toastEl as unknown as { _t: number })._t);
    (toastEl as unknown as { _t: number })._t = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
}

// --- pure view helpers -------------------------------------------------------

function loadDraft(): LevelDef {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) { const d = JSON.parse(raw) as LevelDef; normalize(d); return d; }
  } catch { /* fall through */ }
  return makeEmptyLevel();
}

// Guarantee the arrays/objects the editor and engine rely on exist.
function normalize(d: LevelDef): void {
  d.board ??= { w: 960, h: 600 };
  d.preplaced ??= [];
  d.emitters ??= [];
  d.zones ??= [];
  d.palette ??= [];
  d.objective ??= { kind: 'collect', formula: 'H2', count: 5 };
  d.par ??= { tools: 3, seconds: 60 };
  if (d.cap == null) d.cap = 150;
  if (d.temperature == null) d.temperature = 30;
}

function section(title: string, kind: string, body: string): string {
  return `<div class="ed-head"><span>${esc(title)} · ${kind}</span><button class="pl-btn sm ghost" data-act="del">Delete</button></div>${body}`;
}
function hintHTML(): string {
  return `<div class="ed-hint">Tap <b>＋</b> a tool, <b>Emitter</b>, or <b>Zone</b> above, then tap the board to drop it.
    Tap any item to select it and fine-tune every value here — no pixel-perfect tapping needed.</div>`;
}
function range(label: string, field: string, val: number, min: number, max: number, step: number): string {
  return `<div class="f-row"><label>${esc(label)}</label><div class="f-ctl">
    <input type="range" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${val}">
    <input type="number" class="f-num" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${val}"></div></div>`;
}
function chk(label: string, field: string, val: boolean): string {
  return `<label class="f-chk"><input type="checkbox" data-field="${field}" ${val ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}
function text(label: string, field: string, val: string): string {
  return `<div class="f-row"><label>${esc(label)}</label><input type="text" class="f-text" data-field="${field}" value="${esc(val)}"></div>`;
}
function area(label: string, field: string, val: string): string {
  return `<div class="f-row"><label>${esc(label)}</label><textarea class="f-text" data-field="${field}" rows="2">${esc(val)}</textarea></div>`;
}
function elementSelect(sym: string): string {
  const opts = ELEMENTS.filter(e => e.maxBonds > 0).map(e => `<option value="${e.symbol}" ${e.symbol === sym ? 'selected' : ''}>${e.symbol} — ${e.name}</option>`).join('');
  return `<div class="f-row"><label>Element</label><select class="f-text" data-field="element">${opts}</select></div>`;
}
function settingsHTML(d: LevelDef): string {
  const pal = Object.values(TOOL_TYPES).map(tt => {
    const cur = d.palette.find(p => p.type === tt.id)?.limit ?? 0;
    return `<div class="pal-row"><span class="pl-dot" style="background:${tt.color}"></span><span class="pal-name">${tt.name}</span>
      <input type="number" class="f-num" data-field="pal:${tt.id}" min="0" max="12" step="1" value="${cur}"></div>`;
  }).join('');
  return `<div class="ed-head"><span>Level settings</span></div>
    ${text('Name', 's:name', d.name)}
    ${area('Blurb (instructions)', 's:blurb', d.blurb ?? '')}
    ${text('Featured element (badge, optional)', 's:featured', d.featured ?? '')}
    ${text('Reaction equation (optional)', 's:reaction', d.reaction ?? '')}
    ${area('Fact (shown on win, optional)', 's:fact', d.fact ?? '')}
    <div class="ed-sub">Conditions</div>
    ${range('Ambient temperature', 's:temperature', d.temperature, 0, 100, 1)}
    ${range('Atom cap', 's:cap', d.cap, 20, 500, 5)}
    ${chk('Collisions (atoms bounce off each other)', 's:collisions', !!d.collisions)}
    ${range('Settle seconds (grace before scoring)', 's:settle', d.settleSeconds ?? 6, 0, 30, 1)}
    ${range('Board width', 's:boardW', d.board?.w ?? 960, 480, 1600, 20)}
    ${range('Board height', 's:boardH', d.board?.h ?? 600, 320, 1080, 20)}
    <div class="ed-sub">Objective</div>
    ${text('Target formula (e.g. H2O)', 's:objFormula', d.objective.formula)}
    ${range('Count to collect', 's:objCount', d.objective.count, 1, 99, 1)}
    <div class="ed-sub">Player’s palette (0 = not available)</div>
    <div class="pal-list">${pal}</div>`;
}

function uiHTML(): string {
  const tools = Object.values(TOOL_TYPES).map(tt =>
    `<button class="ed-add" data-add="tool:${tt.id}" title="${esc(tt.blurb)}"><span class="pl-dot" style="background:${tt.color}"></span>${tt.name}</button>`).join('');
  return `
    <div id="edBar">
      <div class="ed-barrow ed-brand">
        <span id="edTitle">Level editor</span><span id="edName">Untitled</span>
      </div>
      <div class="ed-barrow ed-adds">
        <span class="ed-lbl">Add</span>${tools}
        <button class="ed-add em" data-add="emitter">＋ Emitter</button>
        <button class="ed-add zn" data-add="zone">＋ Zone</button>
      </div>
      <div class="ed-barrow ed-files">
        <button class="pl-btn sm" id="edTest">▶ Test</button>
        <button class="pl-btn sm" id="edSettings">⚙ Settings</button>
        <button class="pl-btn sm" id="edSave">Save</button>
        <button class="pl-btn sm ghost" id="edLoad">Load</button>
        <button class="pl-btn sm ghost" id="edExport">Export</button>
        <button class="pl-btn sm ghost" id="edImport">Import</button>
        <button class="pl-btn sm ghost" id="edNew">New</button>
        <a class="pl-btn sm ghost" href="${location.pathname}?game=1&level=1">Play campaign</a>
      </div>
    </div>
    <div id="edMode"></div>
    <div id="edPanel"></div>
    <div id="edToast"></div>`;
}

// --- generic modal / confirm -------------------------------------------------

function modal(title: string, bodyHTML: string): { root: HTMLElement; body: HTMLElement; close: () => void } {
  const root = document.createElement('div');
  root.className = 'ed-modal';
  root.innerHTML = `<div class="ed-mcard"><div class="ed-mhead"><span>${esc(title)}</span><button class="ed-x">✕</button></div><div class="ed-mbody">${bodyHTML}</div></div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.querySelector('.ed-x')!.addEventListener('click', close);
  root.addEventListener('click', e => { if (e.target === root) close(); });
  return { root, body: root.querySelector('.ed-mbody') as HTMLElement, close };
}
function confirmModal(title: string, msg: string, onYes: () => void): void {
  const m = modal(title, `<p class="ed-blurb">${esc(msg)}</p><div class="ed-mrow"><button class="pl-btn sm" id="edYes">Continue</button><button class="pl-btn sm ghost" id="edNo">Cancel</button></div>`);
  (m.body.querySelector('#edYes') as HTMLElement).addEventListener('click', () => { onYes(); m.close(); });
  (m.body.querySelector('#edNo') as HTMLElement).addEventListener('click', m.close);
}

// --- styles ------------------------------------------------------------------

function injectStyles(): void {
  const s = document.createElement('style');
  s.textContent = `
    body.game > header, body.game #panel, body.game #stats, body.game #ticker,
    body.game #molechart, body.game #gasHUD, body.game #viewCycle, body.game #hint { display: none !important; }
    body.game { overflow: hidden; }
    #stage { background: #0f1212; border-radius: 6px; box-shadow: 0 0 0 1px var(--border); touch-action: none; }
    #edUI { position: fixed; inset: 0; z-index: 20; pointer-events: none; font-family: -apple-system, system-ui, sans-serif; }
    #edUI button, #edUI a, #edUI input, #edUI select, #edUI textarea { pointer-events: auto; }
    #edBar { position: fixed; top: 0; left: 0; right: 0; display: flex; flex-direction: column; gap: 5px; padding: 7px 10px;
      background: rgba(16,19,19,0.82); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
    .ed-barrow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ed-brand { gap: 10px; }
    #edTitle { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }
    #edName { font-size: 0.9rem; font-weight: 700; color: var(--primary); }
    .ed-lbl { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
    .ed-add { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; font-size: 0.72rem; font-weight: 600;
      color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .ed-add.on { border-color: var(--primary); color: var(--primary); box-shadow: 0 0 12px rgba(68,212,228,0.4); }
    .ed-add.em { color: #7BEAF6; } .ed-add.zn { color: #9ad; }
    .pl-btn.sm { padding: 5px 11px; font-size: 0.72rem; }
    #edMode { position: fixed; top: 118px; left: 50%; transform: translateX(-50%); z-index: 22; display: none;
      background: var(--primary); color: var(--bg); font-size: 0.72rem; font-weight: 600; padding: 5px 12px; border-radius: 999px; pointer-events: none; }
    #edPanel { position: fixed; z-index: 21; background: rgba(16,19,19,0.94); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      border: 1px solid var(--border); overflow-y: auto; -webkit-overflow-scrolling: touch; }
    #edUI[data-wide="1"] #edPanel { top: 96px; right: 8px; width: 308px; bottom: 8px; border-radius: 12px; padding: 12px; }
    #edUI[data-wide="0"] #edPanel { left: 0; right: 0; bottom: 0; height: 44vh; border-radius: 14px 14px 0 0; padding: 12px 14px; }
    #edUI[data-wide="0"][data-panel="0"] #edPanel { display: none; }
    .ed-hint, .ed-blurb { font-size: 0.76rem; color: var(--text-muted); line-height: 1.5; }
    .ed-blurb { margin: 0 0 8px; }
    .ed-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .ed-head span { font-size: 0.82rem; font-weight: 700; color: var(--text); letter-spacing: 0.02em; }
    .ed-sub { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin: 14px 0 6px; border-top: 1px solid var(--border); padding-top: 10px; }
    .f-row { margin-bottom: 9px; }
    .f-row > label { display: block; font-size: 0.68rem; color: var(--text-muted); margin-bottom: 3px; }
    .f-ctl { display: flex; align-items: center; gap: 8px; }
    .f-ctl input[type=range] { flex: 1; accent-color: var(--primary); }
    .f-num { width: 62px; }
    #edPanel input, #edPanel select, #edPanel textarea { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 7px; padding: 5px 7px; font-size: 0.76rem; font-family: inherit; }
    #edPanel input[type=range] { padding: 0; }
    .f-text { width: 100%; box-sizing: border-box; }
    .f-chk { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; color: var(--text); margin: 8px 0; }
    .f-chk input { width: 16px; height: 16px; accent-color: var(--primary); }
    .pal-list { display: flex; flex-direction: column; gap: 5px; }
    .pal-row { display: flex; align-items: center; gap: 8px; }
    .pal-name { flex: 1; font-size: 0.74rem; color: var(--text); }
    .pl-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    #edToast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%) translateY(20px); z-index: 40;
      background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 8px 16px;
      font-size: 0.78rem; opacity: 0; transition: opacity 0.2s, transform 0.2s; pointer-events: none; }
    #edToast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .ed-modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
      background: rgba(8,10,10,0.62); backdrop-filter: blur(4px); pointer-events: auto; }
    .ed-mcard { width: min(560px, calc(100vw - 28px)); max-height: 84vh; overflow: auto; background: var(--surface-2);
      border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    .ed-mhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .ed-mhead span { font-weight: 700; color: var(--text); }
    .ed-x { background: none; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; }
    .ed-mrow { display: flex; gap: 8px; margin-top: 10px; }
    .ed-code { width: 100%; box-sizing: border-box; height: 220px; font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem;
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px; resize: vertical; }
    .ed-list { display: flex; flex-direction: column; gap: 8px; }
    .ed-lrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
    .ed-lname { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text); font-weight: 600; }
    .ed-lname small { font-size: 0.64rem; color: var(--text-muted); font-weight: 400; }
    .ed-lacts { display: flex; gap: 6px; flex: none; }
    .pl-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); border-radius: 999px; cursor: pointer; text-decoration: none; font-weight: 600; -webkit-tap-highlight-color: transparent; }
    .pl-btn.ghost { color: var(--text-muted); }
    .pl-btn:active { transform: scale(0.96); }
  `;
  document.head.appendChild(s);
}
