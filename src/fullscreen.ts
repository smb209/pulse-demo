// Fullscreen / "hide the browser chrome" helper.
//
// Three worlds:
//  - iPad Safari / desktop / Android → the Fullscreen API works: the button toggles it.
//  - iPhone Safari → Apple blocks element fullscreen entirely; the ONLY chrome-free view is
//    "Add to Home Screen" (standalone). The button opens step-by-step instructions for that.
//  - Already launched from the Home Screen (standalone) → there's no chrome to hide; hide the button.

type FSEl = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FSDoc = Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FSEl;
  return (!!el.requestFullscreen && (document.fullscreenEnabled ?? true)) || !!el.webkitRequestFullscreen;
}

function isStandalone(): boolean {
  return (navigator as unknown as { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPod|iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isFullscreen(): boolean {
  const doc = document as FSDoc;
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

function toggleFullscreen(): void {
  const el = document.documentElement as FSEl;
  const doc = document as FSDoc;
  try {
    const r = isFullscreen()
      ? (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document)
      : (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
    // requestFullscreen returns a promise that can reject (restricted context / no gesture);
    // swallow it so it doesn't surface as an unhandled rejection.
    (r as Promise<void> | undefined)?.catch?.(() => { /* ignore */ });
  } catch { /* older sync-throwing implementations */ }
}

// Wire a button: pick the right behaviour for the platform and keep the label in sync.
// enter/exit labels are for the real fullscreen toggle; a2hsLabel is shown on iOS Safari.
export function wireFullscreen(btn: HTMLElement, enterLabel: string, exitLabel: string, a2hsLabel = enterLabel): void {
  if (isStandalone()) { btn.style.display = 'none'; return; } // already chrome-free

  if (fullscreenSupported()) {
    const sync = () => { btn.textContent = isFullscreen() ? exitLabel : enterLabel; btn.classList.toggle('is-full', isFullscreen()); };
    btn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return;
  }

  if (isIOS()) { // iPhone Safari: fullscreen is impossible, but Add to Home Screen isn't
    btn.textContent = a2hsLabel;
    btn.addEventListener('click', showAddToHome);
    return;
  }

  btn.style.display = 'none'; // no route to chrome-free here
}

// Self-contained instructions overlay (doesn't depend on the game/editor modal systems).
function showAddToHome(): void {
  if (document.getElementById('fsA2HS')) return;
  const o = document.createElement('div');
  o.id = 'fsA2HS';
  o.innerHTML = `
    <div class="fsa-card">
      <div class="fsa-title">Play full screen on iPhone</div>
      <p class="fsa-sub">Safari won’t let a web page hide its toolbar — but you can add Pulse to your Home Screen and it opens with <b>no browser bar at all</b>.</p>
      <ol class="fsa-steps">
        <li>Tap the <b>Share</b> button <span class="fsa-ico">${shareIcon()}</span> in Safari’s toolbar.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>, then open <b>Pulse</b> from your Home Screen.</li>
      </ol>
      <button class="fsa-close">Got it</button>
    </div>`;
  document.body.appendChild(o);
  const close = () => o.remove();
  o.querySelector('.fsa-close')!.addEventListener('click', close);
  o.addEventListener('click', e => { if (e.target === o) close(); });
  injectA2HSStyles();
}

function shareIcon(): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="vertical-align:-2px">
    <path d="M12 3v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M8.5 6.5L12 3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 10.5H5v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19.5v-9h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function injectA2HSStyles(): void {
  if (document.getElementById('fsA2HSStyle')) return;
  const s = document.createElement('style');
  s.id = 'fsA2HSStyle';
  s.textContent = `
    #fsA2HS { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
      background: rgba(8,10,10,0.66); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); padding: 20px;
      font-family: -apple-system, system-ui, sans-serif; }
    #fsA2HS .fsa-card { width: min(380px, 100%); background: var(--surface-2, #2B3031); border: 1px solid var(--border, #3A4041);
      border-radius: 16px; padding: 20px 22px; color: var(--text, #F1F3F3); }
    #fsA2HS .fsa-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 8px; }
    #fsA2HS .fsa-sub { font-size: 0.84rem; color: var(--text-muted, #A0AAAB); line-height: 1.5; margin-bottom: 14px; }
    #fsA2HS .fsa-steps { margin: 0 0 16px 1.1em; padding: 0; display: flex; flex-direction: column; gap: 9px;
      font-size: 0.88rem; line-height: 1.45; }
    #fsA2HS .fsa-ico { color: var(--primary, #44D4E4); }
    #fsA2HS .fsa-close { width: 100%; padding: 11px; font-size: 0.9rem; font-weight: 700; color: var(--bg, #181B1B);
      background: linear-gradient(100deg, var(--primary, #44D4E4), var(--secondary, #DA4E86)); border: none; border-radius: 999px; cursor: pointer; }
  `;
  document.head.appendChild(s);
}
