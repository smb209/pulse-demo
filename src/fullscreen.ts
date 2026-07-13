// Fullscreen toggle helper. Lets the game/editor hide the browser chrome on demand via the
// Fullscreen API (works on iPad Safari, desktop, Android). iPhone Safari doesn't support
// element fullscreen, so wireFullscreen() hides the button there rather than showing a dead one.

type FSEl = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FSDoc = Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FSEl;
  return (!!el.requestFullscreen && (document.fullscreenEnabled ?? true)) || !!el.webkitRequestFullscreen;
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

// Wire a button element: hides itself where unsupported, toggles fullscreen on click, and
// keeps its label in sync ("enter" vs "exit") as fullscreen state changes.
export function wireFullscreen(btn: HTMLElement, enterLabel: string, exitLabel: string): void {
  if (!fullscreenSupported()) { btn.style.display = 'none'; return; }
  const sync = () => { btn.textContent = isFullscreen() ? exitLabel : enterLabel; btn.classList.toggle('is-full', isFullscreen()); };
  btn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}
