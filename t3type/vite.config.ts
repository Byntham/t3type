import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Relative asset paths, so dist/ works from any static folder.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "~": `${here}src` } },
  server: {
    host: "0.0.0.0",
    port: 5179,
    // The thread content lives in ../content/research and is imported at build time.
    fs: { allow: [`${here}..`] },
  },
});
