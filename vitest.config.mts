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
    /*
     * ZWEI ENDUNGEN, UND DIE ZWEITE IST NEU (V3.1).
     *
     * Bis hierher sammelte Vitest nur `*.test.ts`, weil in diesem Projekt
     * nichts gerendert wurde: Oberflächen wurden als QUELLTEXT geprüft (ein
     * `readFileSync` plus `toContain`). Genau daran ist der Fehler
     * vorbeigelaufen, dass ein Verweis im Kalkulator zwar die richtige
     * Adresse trug, der Dialog darüber aber geöffnet blieb und die Zielseite
     * verdeckte — die Adresse stand im Quelltext, der Klick wurde nie
     * ausgeführt.
     *
     * `*.test.tsx` erlaubt jetzt das eine, was ein Quelltextvergleich nicht
     * kann: tatsächlich rendern und tatsächlich klicken. Solche Dateien
     * nennen ihre Umgebung selbst (`// @vitest-environment jsdom`), damit die
     * übrigen 286 Testdateien weiterhin ohne DOM und ohne deren Kosten
     * laufen.
     */
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
