type WebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  openLink?(url: string): void;
  onEvent?(event: string, handler: () => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp = window.Telegram?.WebApp;

// Empty outside Telegram (a plain browser), where the API cannot be called.
export const initData = webApp?.initData ?? "";

const applyScheme = () => {
  if (webApp?.colorScheme) document.documentElement.dataset.scheme = webApp.colorScheme;
};

export function startTelegram() {
  webApp?.ready();
  webApp?.expand();
  // Swipes inside lists must not close the Mini App.
  webApp?.disableVerticalSwipes?.();
  applyScheme();
  webApp?.onEvent?.("themeChanged", applyScheme);
}

// Sources open in the system browser, not inside the Mini App.
export function openLink(url: string) {
  if (webApp?.openLink) webApp.openLink(url);
  else window.open(url, "_blank", "noopener");
}
