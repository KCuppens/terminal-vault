import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1024 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
