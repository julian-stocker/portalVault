/**
 * Z0 WIRD ZITIERT, NICHT NACHGEBAUT.
 *
 * ZWEIMAL DASSELBE PASSIERT, an zwei Tagen hintereinander, und beide Male
 * sah es nach einer Datenänderung aus:
 *
 *   2026-10-20  der Angebotsabdruck meldete `faabf8ef…` statt `4d1d6c30…`.
 *               Ursache: eine selbst erfundene `md5`-Formel mit vier
 *               Feldern statt der Z0-Formel mit dreien.
 *   2026-10-20  die sammelbaren Katalogzeilen meldeten 564 statt 534.
 *               Ursache: eine selbst geschriebene Zählung ohne
 *               `catalog_visible` — sie zählte die 30 ausgeblendeten
 *               Figuren mit.
 *
 * Beide Male stimmten die Daten und die Prüfung war falsch. Das ist die
 * teuerste Art Fehler, die eine Prüfdatei haben kann: sie meldet einen
 * Befund, wo keiner ist, und kostet eine Migration ihren Lauf.
 *
 * DIE URSACHE IST IMMER DIESELBE. Eine Datei, die einen Z0-Wert als
 * ERWARTUNG führt, muss ihn mit DEMSELBEN Ausdruck messen, mit dem Z0 ihn
 * gemessen hat. Die Quelle ist `supabase/checks/0135_preflight.sql`; alles
 * andere ist eine zweite Definition derselben Frage.
 *
 * Diese Datei vergleicht die Ausdrücke — nicht die Zahlen, die Ausdrücke.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const Z0_QUELLE = "supabase/checks/0135_preflight.sql";
const Z0 = readFileSync(Z0_QUELLE, "utf8");

/** Einrückung ist keine Aussage. */
const flach = (sql: string): string => sql.replace(/\s+/g, " ").trim();

/** Der Text zwischen zwei Marken in der Z0-Quelle. */
function ausZ0(von: string, bis: string): string {
  const a = Z0.indexOf(von);
  expect(a, `Marke fehlt in ${Z0_QUELLE}: ${von}`).toBeGreaterThan(-1);
  const b = Z0.indexOf(bis, a);
  expect(b, `Endmarke fehlt: ${bis}`).toBeGreaterThan(a);
  return Z0.slice(a, b);
}

/**
 * Die Bedingung, die „sammelbar" definiert — aus der CTE ganz oben.
 *
 * Sie trägt `catalog_visible`, und das ist der Punkt: der
 * Fortschritts-Nenner zählt, was der öffentliche Katalog HEUTE anbietet
 * (ADR-0040). Eine ausgeblendete Figur ist in keiner Hälfte.
 */
const SAMMELBAR = flach(ausZ0("where s.is_active and s.catalog_visible", "),"));

/** Die Abdruckformel — drei Felder, Trenner `;`, OHNE `available`. */
const ANGEBOTE_MD5 = flach(ausZ0(
  "md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'", "from public.shop_offers() o"));

/** Jede Prüfdatei, die Z0-Werte als ERWARTUNG führt. */
const PRUEFER = [
  "supabase/checks/0139_preflight.sql",
  "supabase/checks/0139_postflight.sql",
  "supabase/checks/accessory_offer_readonly.sql",
] as const;

/** Welche Z0-Konstante welchen Ausdruck verlangt. */
const VERTRAG: readonly (readonly [string, string, string])[] = [
  ["sammelbar", SAMMELBAR, "die Definition aus der CTE, mit catalog_visible"],
  ["angebote_md5", ANGEBOTE_MD5, "die Abdruckformel mit drei Feldern"],
];

describe("Z0-Werte werden mit der Z0-Formel gemessen", () => {
  it("die Quelle trägt beide Ausdrücke, und sie sehen aus wie erwartet", () => {
    /* Verschiebt sich `0135_preflight.sql`, soll das hier auffallen und
       nicht stillschweigend zu einem leeren Vergleich führen. */
    expect(SAMMELBAR).toContain("s.is_active and s.catalog_visible");
    expect(SAMMELBAR).toContain("non_collectible_categories()");
    expect(ANGEBOTE_MD5).toContain("';' order by o.sky_id, o.condition");
    expect(ANGEBOTE_MD5).not.toContain("available");
  });

  for (const datei of PRUEFER) {
    const text = readFileSync(datei, "utf8");
    const flachText = flach(text);

    for (const [schluessel, ausdruck, was] of VERTRAG) {
      /* Nur prüfen, was die Datei auch als Erwartung führt. */
      const fuehrtWert = new RegExp(`\\('${schluessel}',\\s*'`).test(text);
      it(`${datei}: ${schluessel} — ${fuehrtWert ? was : "nicht geführt"}`, () => {
        if (!fuehrtWert) { expect(true).toBe(true); return; }
        expect(flachText, `${datei} misst ${schluessel} mit einer eigenen Formel`)
          .toContain(ausdruck);
      });
    }

    it(`${datei}: die Z0-Konstanten sind die aus ${Z0_QUELLE}`, () => {
      /* Nicht nur die Formel, auch die Zahl. Ein abgeschriebener Sollwert
         läuft genauso auseinander wie eine abgeschriebene Formel. */
      for (const [schluessel] of [["angebote"], ["angebote_md5"], ["shopfaehig"],
        ["sammelbar"]] as const) {
        const hier = new RegExp(`\\('${schluessel}',\\s*'([^']+)'`).exec(text);
        if (hier === null) continue;
        const dort = new RegExp(`\\('${schluessel}',\\s*'([^']+)'`).exec(Z0);
        expect(dort, `${schluessel} fehlt in ${Z0_QUELLE}`).not.toBeNull();
        expect(hier[1], `${datei}: ${schluessel}`).toBe(dort![1]);
      }
    });
  }
});
