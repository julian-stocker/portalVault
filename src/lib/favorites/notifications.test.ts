import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Der Aufrufpunkt für S3 (Migration 0148).
 *
 * ARBEITSTEILUNG MIT P56. Probelauf **P56** in
 * `tools/validate-check-sql.mts` fährt `0146`–`0148` an echtem PostgreSQL
 * und durchläuft jeden fachlichen Fall: zwei Nutzer vor der Phase und einer
 * danach, wiederholte Aufrufe, Preisänderung, Reservierung, zweiter Zyklus,
 * Varianten, RLS. Das ist der stärkere Nachweis.
 *
 * Hier stehen die Aussagen über den **Aufruf**: dass er die
 * Datenbankfunktion nimmt und nicht nachrechnet, und dass ein Fehler die
 * Seite nicht aufhält.
 */

const MOCK = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: MOCK.rpc }),
}));

const { claimAvailabilityNotifications } = await import("@/lib/favorites/notifications");

describe("claimAvailabilityNotifications", () => {
  it("ruft die Datenbankfunktion und gibt ihre Zahl zurück", async () => {
    MOCK.rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await claimAvailabilityNotifications()).toBe(2);
    expect(MOCK.rpc).toHaveBeenCalledWith("claim_availability_notifications");
  });

  it("und übergibt KEINE Argumente — die Funktion entscheidet alles selbst", () => {
    /*
     * Keine SKY-ID, kein Nutzer, keine Karenzzeit. Jede Angabe von hier wäre
     * eine zweite Wahrheit über „fällig", und die Erkennung gehört `0147`.
     */
    expect(MOCK.rpc.mock.calls.every((c) => c.length === 1)).toBe(true);
  });

  it("ein Fehler hält die Seite nicht auf", async () => {
    MOCK.rpc.mockResolvedValueOnce({ data: null, error: { message: "weg" } });
    expect(await claimAvailabilityNotifications()).toBe(0);
  });

  it("und eine unsinnige Antwort auch nicht", async () => {
    for (const data of [null, undefined, "7", Number.NaN, {}]) {
      MOCK.rpc.mockResolvedValueOnce({ data, error: null });
      expect(await claimAvailabilityNotifications(), JSON.stringify(data)).toBe(0);
    }
  });

  it("die Datei rechnet nichts selbst — kein Schwellwert, keine Karenzzeit", () => {
    const quelle = readFileSync("src/lib/favorites/notifications.ts", "utf8");
    const code = quelle
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");
    for (const wort of ["buyable_since", "30", "interval", "favorites",
                        "offer_state", "announced"]) {
      expect(code, wort).not.toContain(wort);
    }
  });

  it("und sie liest die Meldungen nicht — das ist S4", () => {
    const quelle = readFileSync("src/lib/favorites/notifications.ts", "utf8");
    expect(quelle).not.toContain('.from("availability_notifications")');
    expect(quelle).toContain("sind S4");
  });
});
