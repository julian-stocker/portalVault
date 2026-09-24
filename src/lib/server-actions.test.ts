/**
 * Was in einer `"use server"`-Datei stehen darf.
 *
 * DER FEHLER, DER DIESEN TEST ERZWUNGEN HAT. Der erste Sendeversuch im
 * Nachrichtenkanal endete mit einem 500er:
 *
 *   A "use server" file can only export async functions, found number
 *
 * In `lib/messages/actions.ts` stand am Ende ein `export { MESSAGE_MAX }` —
 * eine Bequemlichkeit, damit ein Aufrufer die Grenze nicht aus zwei Modulen
 * holen muss. Next macht aus JEDEM Export einer solchen Datei einen
 * aufrufbaren Endpunkt und bricht deshalb ab, sobald etwas anderes als eine
 * async-Funktion dabei ist. Getroffen hat es niemanden beim Übersetzen: der
 * Fehler erscheint erst, wenn der Action-Loader die Datei zur Laufzeit lädt —
 * also beim ersten Klick.
 *
 * Genau das fängt dieser Test ab, für ALLE Action-Dateien und nicht nur für
 * die eine: er sucht sie selbst, statt eine Liste zu pflegen, die beim
 * nächsten Modul veraltet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

/** Jede Datei, die Next als Server-Action-Modul behandelt. */
const ACTION_FILES = walk("src")
  .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
  .filter((path) => /^\s*"use server";/m.test(readFileSync(path, "utf8")))
  .sort();

describe("use-server-Dateien exportieren nur async Funktionen", () => {
  it("findet die Action-Dateien überhaupt", () => {
    // Eine leere Menge wäre ein stiller Test, kein bestandener.
    expect(ACTION_FILES.length).toBeGreaterThan(15);
    expect(ACTION_FILES).toContain("src/lib/messages/actions.ts");
  });

  /**
   * Erlaubt ist `export async function` und `export type` / `export interface`
   * — Typen werden beim Übersetzen entfernt und erreichen den Loader nie.
   * Alles andere wäre ein Wert oder eine synchrone Funktion.
   */
  it("exportiert nirgends einen Wert, eine Klasse oder eine synchrone Funktion", () => {
    const offenders: string[] = [];
    for (const path of ACTION_FILES) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/^export\b/.test(line)) return;
        const ok = /^export async function /.test(line)
          || /^export (type|interface) /.test(line);
        if (!ok) offenders.push(`${path}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("nennt den Fall, der es ausgelöst hat, beim Namen", () => {
    const actions = readFileSync("src/lib/messages/actions.ts", "utf8");
    expect(actions).not.toContain("export { MESSAGE_MAX }");
    // Die Grenze steht dort, wo sie hingehört: im reinen Modul.
    expect(readFileSync("src/lib/messages/conversation.ts", "utf8"))
      .toContain("export const MESSAGE_MAX = 2000;");
  });

  it("und die Aufrufer holen sie auch von dort", () => {
    const thread = readFileSync("src/components/messages/conversation-thread.tsx", "utf8");
    expect(thread).toContain('from "@/lib/messages/conversation"');
    // Aus der Action kommen nur die beiden Aktionen.
    const fromActions = thread.slice(thread.indexOf('from "@/lib/messages/actions"') - 200,
                                     thread.indexOf('from "@/lib/messages/actions"'));
    expect(fromActions).toContain("markConversationRead");
    expect(fromActions).toContain("sendOrderMessage");
    expect(fromActions).not.toContain("MESSAGE_MAX");
  });
});
