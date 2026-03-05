import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // All /api requests forwarded to Express during dev
      "/api": {
        target: "http://localhost:3006",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Output to server/public so Express can serve it in production
    outDir: "../server/public",
    emptyOutDir: true,
  },
});
