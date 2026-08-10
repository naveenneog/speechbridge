import { defineConfig } from "vite";

// The client is a static SPA; the Express server owns /api and is proxied in dev.
export default defineConfig({
  root: "src/client",
  publicDir: false,
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8790",
        changeOrigin: true,
      },
    },
  },
});
