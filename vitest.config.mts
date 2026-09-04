// .mts so Vite loads this as an ES module without adding "type": "module"
// to package.json, which would change resolution for the whole Next.js app.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "@/*" path mapping in tsconfig.json, which Vitest does
      // not read on its own.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
