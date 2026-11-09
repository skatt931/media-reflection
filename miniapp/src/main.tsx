import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startTelegram } from "./telegram.ts";
import { watchTheme } from "./theme.ts";
import "./styles.css";

// A button in the bot opens the app at a screen: `?go=media/album/2026-11` becomes the address inside it.
// (Telegram keeps the query of the button's address; its own launch data goes in the fragment.)
const go = new URLSearchParams(location.search).get("go");
if (go && /^[\w/-]{1,100}$/.test(go)) history.replaceState(null, "", `${location.pathname}#/${go}`);

startTelegram();
watchTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
