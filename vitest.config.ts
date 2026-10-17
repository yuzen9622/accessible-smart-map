import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // tsconfig.json sets "jsx": "preserve" for Next.js's own build pipeline;
  // Vite (this version transforms via oxc, not esbuild) inherits that for
  // .tsx files, which leaves raw JSX untranspiled and breaks Vite's
  // import-analysis parser on any .tsx import. Override just for the test
  // runner (Next.js's build is untouched).
  oxc: {
    jsx: { runtime: "automatic" },
  },
  // These Node unit tests import CSS modules through client components but
  // do not test generated styles. Next's PostCSS config uses string plugin
  // entries, whereas Vite's loader expects plugin objects. Keep the app's
  // Tailwind pipeline intact and avoid loading it in the test runner.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    env: {
      TZ: "Asia/Taipei",
    },
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
  },
});
