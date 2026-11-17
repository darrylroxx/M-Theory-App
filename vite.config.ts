import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps asset paths relative so the built app works from any
// sub-path (GitHub Pages, a USB stick, a phone's local file server...).
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // the full-sweep tests take a few seconds; slower machines (the Windows builder) need room
    testTimeout: 60_000,
  },
});
