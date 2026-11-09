import http from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Keep-alive agent: with Vite's default agent, large responses (/api/meta is ~9 MB) stall just short
    // of the end on Windows and the page hangs on "Loading building data…".
    proxy: { "/api": { target: "http://127.0.0.1:8000", agent: new http.Agent({ keepAlive: true }) } },
  },
  build: { chunkSizeWarningLimit: 2500 },
});
