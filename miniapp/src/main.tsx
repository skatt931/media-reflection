import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startTelegram } from "./telegram.ts";
import { watchTheme } from "./theme.ts";
import "./styles.css";

startTelegram();
watchTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
