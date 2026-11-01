import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { verweisListe } from "./delete-errors";
import { de } from "@/lib/i18n/de";

/* Die echte Meldung, Wort fuer Wort aus dem Format in 0162. */
const EINE = "0162: auf SKY-0012 zeigen noch Daten: public.inventory_import_rows.sky_id=3.  "
  + "Die Figur wird nicht geloescht, und es wird nichts mitgeloescht.";
const ZWEI = "0162: auf SKY-9230 zeigen noch Daten: public.cart_items.sky_id=1, "
  + "public.collection_items.sky_id=2. Darunter mit ON DELETE CASCADE: public.cart_items "
  + "— die waeren stillschweigend mitgegangen.";

describe("die Loeschsperre nennt die echten Verweise (CAT-12)", () => {
  it("nicht mehr „public“, sondern Tabelle und Anzahl", () => {
    expect(verweisListe(EINE)).toBe("inventory_import_rows (3)");
    expect(de.admin.deleteBlocked(verweisListe(EINE))).toContain("inventory_import_rows (3)");
    expect(de.admin.deleteBlocked(verweisListe(EINE))).not.toMatch(/Daten: public\b/);
  });

  it("mehrere Verweise, und der CASCADE-Nachsatz wird nicht mitgelesen", () => {
    expect(verweisListe(ZWEI)).toBe("cart_items (1), collection_items (2)");
  });

  it("eine fremde Meldung ergibt eine leere Liste — die Sperre bleibt trotzdem", () => {
    expect(verweisListe("irgendetwas anderes")).toBe("");
  });

  it("die Aktion benutzt sie, und der alte Ausdruck ist fort", () => {
    const a = readFileSync("src/lib/admin/actions.ts", "utf8");
    expect(a).toContain("de.admin.deleteBlocked(verweisListe(text))");
    expect(a).not.toContain("/zeigen noch Daten: ([^.]*)/");
  });
});
