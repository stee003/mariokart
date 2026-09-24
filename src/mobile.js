// Mobile display helpers shared by the game and its layout tests.
// The scene always renders into a centred 16:9 viewport; controls and menus
// can still use the full device screen around that gameplay rectangle.

export const GAMEPLAY_ASPECT = 16 / 9;

export function fitAspectViewport(width, height, aspect = GAMEPLAY_ASPECT) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : GAMEPLAY_ASPECT;
  if (!w || !h) return { x: 0, y: 0, width: w, height: h };

  let viewportWidth = w;
  let viewportHeight = h;
  if (w / h > ratio) viewportWidth = h * ratio;
  else viewportHeight = w / ratio;

  return {
    x: (w - viewportWidth) / 2,
    y: (h - viewportHeight) / 2,
    width: viewportWidth,
    height: viewportHeight,
  };
}

// Pointer capability is more useful than user-agent sniffing alone: it covers
// iPads using desktop Safari, foldables and touch-capable laptops. Keep the UA
// checks as a fallback for browsers that don't report pointer capabilities.
export function detectMobileDevice(windowRef = globalThis.window, navigatorRef = globalThis.navigator) {
  const nav = navigatorRef || {};
  const win = windowRef || {};
  if (nav.userAgentData?.mobile) return true;
  if ((Number(nav.maxTouchPoints) || Number(nav.msMaxTouchPoints) || 0) > 0) return true;

  try {
    if (win.matchMedia?.('(pointer: coarse)')?.matches) return true;
  } catch (_e) { /* older / restricted browser */ }

  const ua = String(nav.userAgent || '');
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) ||
    (ua.includes('Macintosh') && (Number(nav.maxTouchPoints) || 0) > 1);
}
