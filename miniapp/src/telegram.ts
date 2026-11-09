type WebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
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
