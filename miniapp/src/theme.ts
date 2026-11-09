import { onThemeChanged, paintChrome, webApp } from "./telegram.ts";
import { mock } from "./api.ts";

const dark = matchMedia("(prefers-color-scheme: dark)");

// Telegram's own light or dark choice wins; a plain browser follows the system. The palette itself is ours.
function scheme() {
  const forced = mock ? new URLSearchParams(location.search).get("theme") : null;
  if (forced === "light" || forced === "dark") return forced;
  return webApp?.colorScheme ?? (dark.matches ? "dark" : "light");
}

function apply() {
  const root = document.documentElement;
  root.dataset.theme = scheme();
  const style = getComputedStyle(root);
  paintChrome(style.getPropertyValue("--ground").trim(), style.getPropertyValue("--bar").trim());
}

export function watchTheme() {
  apply();
  onThemeChanged(apply);
  dark.addEventListener("change", apply);
}
