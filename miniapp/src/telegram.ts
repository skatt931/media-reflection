type BackButton = { show(): void; hide(): void; onClick(callback: () => void): void };

type WebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  BackButton?: BackButton;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  openLink?(url: string): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: string, callback: () => void): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp = window.Telegram?.WebApp;

// Empty outside Telegram (a plain browser), where the API cannot be called.
export const initData = webApp?.initData ?? "";

export function startTelegram() {
  webApp?.ready();
  webApp?.expand();
  // Swipes inside lists must not close the Mini App.
  webApp?.disableVerticalSwipes?.();
}

const supports = (version: string) => webApp?.isVersionAtLeast?.(version) === true;

// Telegram's own back button (Bot API 6.1). Where it is missing the screens draw their own.
export const nativeBack = !!webApp?.BackButton && supports("6.1");

// One native button serves every screen that wants it: the most recent claim wins (a sheet over a screen).
const claims: (() => void)[] = [];
let bound = false;
export function claimBack(handler: () => void) {
  claims.push(handler);
  syncBack();
  return () => {
    const at = claims.lastIndexOf(handler);
    if (at >= 0) claims.splice(at, 1);
    syncBack();
  };
}
function syncBack() {
  const button = webApp?.BackButton;
  if (!nativeBack || !button) return;
  if (!bound) {
    bound = true;
    button.onClick(() => claims.at(-1)?.());
  }
  if (claims.length) button.show();
  else button.hide();
}

// Header and background take the app's own ground, so the Telegram header does not show a second colour.
export function paintChrome(ground: string, bar: string) {
  try {
    if (supports("6.1")) {
      webApp?.setHeaderColor?.(ground);
      webApp?.setBackgroundColor?.(ground);
    }
    if (supports("7.10")) webApp?.setBottomBarColor?.(bar);
  } catch {
    // An older client: the default colours stay.
  }
}

export function onThemeChanged(callback: () => void) {
  webApp?.onEvent?.("themeChanged", callback);
}

// Sources open in the system browser, not inside the Mini App.
export function openLink(url: string) {
  if (webApp?.openLink) webApp.openLink(url);
  else window.open(url, "_blank", "noopener");
}
