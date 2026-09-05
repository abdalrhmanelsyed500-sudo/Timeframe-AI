import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The app uses Tailwind v4 via PostCSS; tests never need CSS processing.
  // Tailwind v4 PostCSS config is not loadable by Vite's node API; tests never need CSS.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
