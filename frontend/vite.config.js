import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/lsp": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { sourcemap: true },
});
