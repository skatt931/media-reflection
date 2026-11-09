import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The build is committed (miniapp-dist/): the server only runs `git merge --ff-only`, it has no Vite.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: { outDir: "../miniapp-dist", emptyOutDir: true },
  // `npm run miniapp:dev` forwards /api to the bot running on this machine.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
