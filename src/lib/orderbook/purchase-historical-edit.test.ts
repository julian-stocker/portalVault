import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import { canBook, canRemapItem, canRemoveItem, isHistorical } from "./purchase";
import { de } from "@/lib/i18n/de";

/**
 * Ein importierter Einkauf wird bearbeitet — und was ihn schützt, sind die
 * Regeln an der ZEILE, nicht ein fehlender Knopf (ADR-0126).
 *
 * WAS VORHER WAR. Der Dialog zeigte für `excel_order_2026` keinen
 * Bearbeiten-Knopf, und die Detailseite kein „Artikel hinzufügen". Die
 * Datenbank hat das nie verlangt: `seller_update_purchase` (0121),
 * `seller_add_purchase_item` (0053) und `seller_set_purchase_item_sky` (0054)
 * prüfen die Herkunft des Einkaufs nicht — 0054 existiert ausdrücklich dafür,
 * eine falsch zugeordnete Arbeitsmappenzeile zu berichtigen. In der
 * Arbeitsmappe fehlen aber Figuren, Absender und Inserate, und ohne
 * Bearbeitungsweg blieb die Historie lückenhaft statt genauer.
 *
 * Diese Datei hält beides fest: dass der Weg offen ist, und dass die vier
 * Grenzen stehen.
 */

const LIB = (n: string) => readFileSync(`src/lib/orderbook/${n}`, "utf8");
const UI = (n: string) => readFileSync(`src/components/business/${n}`, "utf8");
const DIALOG = UI("purchase-details.tsx");
const PAGE = readFileSync(
  "src/app/(business)/business/orderbuch/[id]/page.tsx", "utf8");
const MIG = readFileSync(
  "supabase/migrations/0132_purchase_item_remove_by_line.sql", "utf8");

/** Eine Zeile, wie der Dialog sie sieht. */
const zeile = (over: Partial<Parameters<typeof canRemoveItem>[0]> = {}) => ({
  state: "ordered" as const,
  movementId: null,
  legacyConditionFlag: null,
  legacyBookedFlag: null,
  sourceRow: null as number | null,
  ...over,
});

/* ==========================================================================
 * 1. Der Weg ist offen
 * ======================================================================== */
describe("ein historischer Einkauf lässt sich bearbeiten", () => {
  it("der Dialog hat kein Tor mehr auf die Herkunft", () => {
    expect(DIALOG).not.toContain('purchase.source === "excel_order_2026" ? null');
    expect(DIALOG).toContain("{editing ? (");
    /* Der Knopf, der in den Bearbeitungsmodus führt, bleibt genau einer. */
    expect(DIALOG).toContain("onClick={startEditing}");
  });

  it("und die Detailseite bietet das Hinzufügen für jeden Einkauf an", () => {
    expect(PAGE).not.toContain('purchase.source === "manual" ? (');
    expect(PAGE).toContain("<AddPurchaseItem purchaseId={purchase.id}");
  });

  it("die Positionsliste entscheidet über die ZEILE, nicht über den Einkauf", () => {
    const liste = UI("purchase-items.tsx");
    expect(liste).toContain("canRemoveItem(item)");
    expect(liste).not.toContain("canRemoveItem(source, item)");
    /* Die Prop `source` ist damit weg — die Seite reicht sie nicht mehr durch. */
    expect(liste).not.toContain("source: string;");
    expect(PAGE).not.toContain("source={purchase.source}");
  });

  it("`isHistorical` bleibt — als ANZEIGE, nicht als Sperre", () => {
    /* Die Detailseite schreibt „historisch" statt einer Fortschrittszahl.
       Das ist eine Aussage über den Einkauf, kein Verbot. */
    expect(isHistorical("excel_order_2026")).toBe(true);
    expect(isHistorical("manual")).toBe(false);
    expect(PAGE).toContain("isHistorical(purchase.source)");
    expect(LIB("purchase.ts")).not.toContain("isHistorical(purchaseSource)");
  });

  it("gespeichert wird in EINEM Zug, über eine Funktion", () => {
    expect(DIALOG).toContain("savePurchaseEdit");
    const actions = LIB("actions.ts");
    expect(actions).toContain("seller_save_purchase_edit");
    /* Felder, Hinzufügen, Entfernen und Tauschen in einem Aufruf — 0126/0127. */
    for (const p of ["p_fields", "p_add", "p_remove", "p_swap"]) {
      expect(actions, p).toContain(p);
    }
  });
});

/* ==========================================================================
 * 2. Die vier Grenzen
 * ======================================================================== */
describe("was an einer importierten Zeile weiterhin nicht geht", () => {
  it("eine Arbeitsmappenzeile wird nicht entfernt", () => {
    expect(canRemoveItem(zeile({ state: "reconciled_legacy" }))).toBe(false);
    expect(canRemoveItem(zeile({ legacyBookedFlag: "x" }))).toBe(false);
    expect(canRemoveItem(zeile({ legacyConditionFlag: "lose" }))).toBe(false);
  });

  it("ihre FIGUR aber schon — das ist der Zweck von 0054", () => {
    expect(canRemapItem(zeile({ state: "reconciled_legacy" }))).toBe(true);
  });

  it("und eingebucht wird sie nie erneut", () => {
    /* `reconciled_legacy` heisst: steckt schon im Altbestand. Ein zweites
       Einbuchen zählte die Figur doppelt. 0053 lehnt es auch serverseitig ab. */
    expect(canBook({ state: "reconciled_legacy", skyId: "SKY-0008" })).toBe(false);
  });

  it("eine eingebuchte Zeile ist in beidem gesperrt", () => {
    const gebucht = zeile({ state: "booked", movementId: 7 });
    expect(canRemoveItem(gebucht)).toBe(false);
    expect(canRemapItem(gebucht)).toBe(false);
  });

  it("eine Zeile mit Bewegung auch, selbst wenn ihr Zustand anders klingt", () => {
    const seltsam = zeile({ state: "arrived", movementId: 7 });
    expect(canRemoveItem(seltsam)).toBe(false);
    expect(canRemapItem(seltsam)).toBe(false);
  });

  it("jede Ablehnung hat einen deutschen Satz, der sagt, was zu tun ist", () => {
    const modal = de.business.orderbook.detailsModal;
    const fehler = de.business.orderbook.errors;
    /* Im Dialog als Hinweis an der Zeile … */
    expect(modal.removeBlockedLegacy).toContain("nicht entfernbar");
    expect(modal.removeBlockedBooked).toContain("zurückbuchen");
    /* … und als Antwort des Servers, falls jemand es dennoch versucht. */
    expect(fehler.historicalItem).toContain("Excel-Historie");
    expect(fehler.historicalItem).toContain("Zuordnung ändern");
    expect(fehler.historical).toContain("bereits im Bestand");
  });
});

/* ==========================================================================
 * 3. Was NEU möglich ist — und warum es sicher ist
 * ======================================================================== */
describe("die nachgetragene Zeile", () => {
  it("darf wieder entfernt werden, auch an einem importierten Einkauf", () => {
    /*
     * Der Kern von ADR-0126. Sie trägt keines der Arbeitsmappen-Merkmale:
     * kein `reconciled_legacy`, keine Flagge — und in der Datenbank
     * zusätzlich keine `source_row`.
     */
    expect(canRemoveItem(zeile())).toBe(true);
    expect(canRemoveItem(zeile({ state: "arrived" }))).toBe(true);
  });

  it("und die Datenbank sagt genau dasselbe — seit 0134 in beiden Richtungen", () => {
    /*
     * BIS ZUM STAGING-LAUF VON 0132 stand hier, die Oberfläche kenne
     * `source_row` nicht und die Abweichung gehe „in die sichere Richtung".
     * Das war nur halb richtig. Sicher war sie, weil die Datenbank nichts
     * durchließ; brauchbar war sie nicht: für die 109 Zeilen, die `0067`
     * wiedereröffnet hat, bot der Dialog ein Entfernen an, das immer
     * scheiterte. `0134` gibt `source_row` mit aus, und damit prüfen beide
     * Seiten dieselben vier Bedingungen.
     */
    expect(MIG).toContain("v_item.source_row is not null");
    expect(LIB("purchase.ts")).toContain("if (item.sourceRow !== null) return false;");
  });

  it("sie ist unbebucht und ändert daher keinen Bestand", () => {
    /* `seller_add_purchase_item` legt an, bucht nicht. Bestand entsteht
       ausschliesslich beim Einbuchen, und dieser Weg ist unverändert. */
    const add = readFileSync("supabase/migrations/0053_orderbook_purchases.sql", "utf8");
    const i = add.indexOf("create or replace function public.seller_add_purchase_item");
    const rumpf = add.slice(i, add.indexOf("\n$$;", i));
    expect(rumpf).not.toContain("inventory_movements");
    expect(rumpf).not.toContain("shop_inventory");
  });
});

/* ==========================================================================
 * 4. Kein Weg der Bearbeitung fasst den Bestand an
 * ======================================================================== */
describe("Bestand, Bewegungen und Verkaufsverknüpfungen bleiben unberührt", () => {
  /** Der Rumpf der jüngsten Fassung einer Funktion über alle Migrationen. */
  function rumpfVon(name: string): string {
    const dateien = readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql")).sort();
    let gefunden = "";
    for (const datei of dateien) {
      const s = readFileSync(`supabase/migrations/${datei}`, "utf8");
      const marke = `create or replace function public.${name}(`;
      const i = s.lastIndexOf(marke);
      if (i === -1) continue;
      const a = s.indexOf("\nas $$", i);
      if (a === -1) continue;
      gefunden = s.slice(a, s.indexOf("\n$$;", a));
    }
    expect(gefunden, `${name} nicht gefunden`).not.toBe("");
    return gefunden;
  }

  const WEGE = ["seller_update_purchase", "seller_add_purchase_item",
                "seller_set_purchase_item_sky", "seller_remove_purchase_item"];

  it("keiner der vier Wege schreibt in inventory_movements oder shop_inventory", () => {
    for (const name of WEGE) {
      const rumpf = rumpfVon(name);
      const schreibt = /(insert\s+into|update|delete\s+from)\s+public\.(inventory_movements|shop_inventory)/i;
      expect(schreibt.test(rumpf), `${name} schreibt Bestand`).toBe(false);
    }
  });

  it("und keiner fasst sale_items oder purchase_receipts an", () => {
    for (const name of WEGE) {
      const rumpf = rumpfVon(name);
      const schreibt = /(insert\s+into|update|delete\s+from)\s+public\.(sale_items|sales|purchase_receipts)/i;
      expect(schreibt.test(rumpf), `${name} schreibt daran`).toBe(false);
    }
  });

  it("das Sammelspeichern selbst schreibt nichts direkt — es delegiert", () => {
    const rumpf = rumpfVon("seller_save_purchase_edit");
    expect(rumpf).not.toMatch(/insert\s+into\s+public\./i);
    expect(rumpf).not.toMatch(/delete\s+from\s+public\./i);
    for (const d of ["seller_update_purchase", "seller_add_purchase_item",
                     "seller_remove_purchase_item", "seller_set_purchase_item_sky"]) {
      expect(rumpf, d).toContain(d);
    }
  });
});

/* ==========================================================================
 * 5. Die Migration 0132
 * ======================================================================== */
describe("0132 streicht eine Bedingung und nur diese", () => {
  it("die Herkunftsbedingung des Einkaufs ist aus dem Rumpf verschwunden", () => {
    const i = MIG.indexOf("create or replace function public.seller_remove_purchase_item");
    const rumpf = MIG.slice(i, MIG.indexOf("\n$$;", i));
    expect(rumpf).not.toContain("v_source");
    expect(rumpf).not.toContain("p.source");
  });

  it("die vier Zeilenbedingungen stehen alle noch drin", () => {
    const i = MIG.indexOf("create or replace function public.seller_remove_purchase_item");
    const rumpf = MIG.slice(i, MIG.indexOf("\n$$;", i));
    for (const b of ["v_item.movement_id is not null",
                     "v_item.state = 'reconciled_legacy'",
                     "v_item.source_row is not null",
                     "v_item.legacy_booked_flag is not null",
                     "v_item.legacy_condition_flag is not null"]) {
      expect(rumpf, b).toContain(b);
    }
  });

  it("die Meldung bleibt wörtlich — sonst bricht die Abbildung in der Oberfläche", () => {
    expect(MIG).toContain("this item came from the legacy workbook");
    expect(LIB("actions.ts")).toContain('text.includes("legacy workbook")');
  });

  it("die Vorbedingung prüft die Annahme, auf der die Lockerung ruht", () => {
    /* Faende sich eine Zeile an einem importierten Einkauf OHNE jedes
       Merkmal, waere sie nach 0132 entfernbar. Dann bricht die Migration ab,
       statt es zu erlauben. */
    expect(MIG).toContain("ohne jedes Arbeitsmappen-Merkmal");
    expect(MIG).toContain("i.state <> 'reconciled_legacy'");
    expect(MIG).toContain("i.source_row is null");
  });

  it("sie führt selbst keine Datenanweisung aus", () => {
    /*
     * DER UNTERSCHIED, DER HIER ZÄHLT: was die MIGRATION tut, und was eine
     * FUNKTION tut, wenn sie später aufgerufen wird.
     *
     * `seller_update_purchase` enthält ein `update public.purchases` — das
     * ist ihr Zweck und läuft nur auf Aufruf. Die Migration selbst darf
     * keine Zeile anfassen. Also werden die Funktionsrümpfe
     * herausgeschnitten, bevor geprüft wird; alles andere ist das, was beim
     * Anwenden wirklich ausgeführt wird.
     */
    const ohneRumpf = MIG.replace(/\nas \$\$[\s\S]*?\n\$\$;/g, "\n-- (Rumpf)");
    const ohneProsa = ohneRumpf.replace(/\/\*[\s\S]*?\*\//g, "")
                               .replace(/^\s*--.*$/gm, "");
    expect(ohneProsa).not.toMatch(/\balter table\b/i);
    expect(ohneProsa).not.toMatch(/\bdrop table\b/i);
    expect(ohneProsa).not.toMatch(/insert\s+into\s+public\./i);
    expect(ohneProsa).not.toMatch(/\bupdate\s+public\./i);
    expect(ohneProsa).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(ohneProsa).not.toMatch(/\btruncate\b/i);
    /* Was sie ausführt: zwei Funktionen ersetzen, zwei Kommentare, Rechte. */
    expect((MIG.match(/create or replace function/g) ?? []).length).toBe(2);
  });

  it("und die beiden Funktionen schreiben nur, was sie schreiben sollen", () => {
    /* `seller_update_purchase` → `purchases`.
       `seller_remove_purchase_item` → `purchase_items`. Sonst nichts. */
    const rumpfVon = (fn: string) => {
      const i = MIG.lastIndexOf(`create or replace function public.${fn}`);
      return MIG.slice(i, MIG.indexOf("\n$$;", i));
    };
    const up = rumpfVon("seller_update_purchase");
    expect(up).toMatch(/update public\.purchases/);
    expect(up).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.(inventory_movements|shop_inventory|sale_items|sales|purchase_receipts)/i);
    const rm = rumpfVon("seller_remove_purchase_item");
    expect(rm).toMatch(/delete from public\.purchase_items/);
    expect(rm).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.(inventory_movements|shop_inventory|sale_items|sales|purchase_receipts)/i);
  });

  it("und der Funktionsrumpf kennt die Belegtabellen nicht", () => {
    /*
     * Im Rumpf darf `purchase_receipt` nicht vorkommen. In der
     * NACHBEDINGUNG steht der Name sehr wohl — dort prüft die Migration,
     * dass der Rumpf ihn nicht enthält. Ein Wächter, der ein Wort nennt, ist
     * nicht dasselbe wie eine Funktion, die es benutzt.
     */
    const i = MIG.indexOf("create or replace function public.seller_remove_purchase_item");
    const rumpf = MIG.slice(i, MIG.indexOf("\n$$;", i));
    expect(rumpf).not.toContain("purchase_receipt");
    expect(rumpf).not.toContain("inventory_movements");
    expect(MIG).toContain("0132 Abbruch: die Funktion nennt die Belegtabelle");
  });

  it("die Rechte werden wiederhergestellt, wie 0064 sie setzte", () => {
    expect(MIG).toContain("revoke all on function public.seller_remove_purchase_item(bigint)"
      + " from public, anon;");
    expect(MIG).toContain("grant execute on function public.seller_remove_purchase_item(bigint)"
      + " to authenticated;");
  });

  it("PUBLIC wird über den ACL geprüft, nicht über has_function_privilege", () => {
    /* Die Lehre aus 0124/0125: `public` steht nicht in `pg_roles`, und ein
       NULL-ACL heisst „Standardrechte", also EXECUTE für PUBLIC. */
    const ohneProsa = MIG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(ohneProsa).not.toContain("has_function_privilege('public'");
    expect(ohneProsa).toContain("a.grantee = 0");
    expect(ohneProsa).toContain("aclexplode(p.proacl)");
    expect(ohneProsa).toContain("v_oid) is null");
  });

  it("Pre- und Postflight liegen daneben und prüfen die Annahme mit", () => {
    for (const f of ["0132_preflight.sql", "0132_postflight.sql"]) {
      const s = readFileSync(`supabase/checks/${f}`, "utf8");
      expect(s, f).toContain("importierte Zeilen OHNE jedes Merkmal");
      expect(s, f).toContain("importierte Zeilen ohne source_row");
      expect(s, f).toContain("Lagerbilanz");
      expect(s, f).toContain("9999");
    }
  });
});

/* ==========================================================================
 * 6. Die Belegausstellung bleibt gesperrt
 * ======================================================================== */
describe("an den Belegen ändert diese Arbeit nichts", () => {
  it("die Ausstellung ist in der Oberfläche weiterhin zu", () => {
    const flag = readFileSync("src/lib/business/receipt-release.ts", "utf8");
    expect(flag).toContain("RECEIPT_ISSUANCE_RELEASED = false");
    expect(DIALOG).toContain("{!RECEIPT_ISSUANCE_RELEASED && receipt === null ? (");
  });

  it("und 0132 berührt keine Belegtabelle", () => {
    /* Der Rumpf nennt sie nicht; die Nachbedingung prüft genau das. */
    const i = MIG.indexOf("create or replace function public.seller_remove_purchase_item");
    expect(MIG.slice(i, MIG.indexOf("\n$$;", i))).not.toContain("purchase_receipt");
  });

  it("ein bestehender Beleg bleibt abrufbar und unverändert", () => {
    /* Weicht der Einkauf nach einer Bearbeitung vom Beleg ab, sagt der
       Dialog das über den Fingerabdruck — geändert wird der Beleg nicht. */
    expect(DIALOG).toContain("receiptCopy.stale");
    expect(de.business.orderbook.receipt.stale.length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 7. Die abgeschlossene Zahlung
 * ======================================================================== */

/**
 * WELCHES FELD IST DIE ZAHLUNG? Die Frage ist nicht rhetorisch, und sie
 * pauschal mit „alle Kostenfelder" zu beantworten hätte genau das verboten,
 * was nachgetragen werden soll.
 *
 *   `total_cost`   der bezahlte Betrag. DAS ist die Zahlung.
 *   `items_cost`, `shipping_cost`, `buyer_protection_cost`
 *                  seine AUFTEILUNG. `purchases_cost_split_adds_up` (0115)
 *                  nagelt sie auf `total_cost` fest — sie kann die Summe
 *                  nicht verschieben und darf deshalb nachgetragen werden.
 *   `currency`     gehört zum Betrag; `seller_update_purchase` nimmt sie
 *                  nicht an, sie ist auf diesem Weg längst unveränderlich.
 *   `market_price_snapshot`, `knownValue`, `factor`
 *                  Bewertung, keine Zahlung.
 */
describe("die bezahlte Summe eines importierten Einkaufs", () => {
  const SPLIT_CHECK = readFileSync(
    "supabase/migrations/0115_purchase_costs_platform_and_day.sql", "utf8");

  it("ist in der Datenbank gegen Änderung verriegelt (0132)", () => {
    expect(MIG).toContain("the paid total of an imported purchase is final");
    expect(MIG).toContain("p.source <> 'manual'");
    expect(MIG).toContain("round(p.total_cost, 2) <> round(p_total_cost, 2)");
  });

  it("und der Riegel greift NUR bei einem importierten Einkauf", () => {
    const i = MIG.indexOf("DIE BEZAHLTE SUMME EINES HISTORISCHEN EINKAUFS");
    const block = MIG.slice(i, i + 2200);
    expect(block).toContain("p_total_cost is not null");
    /* Ein manueller Einkauf bleibt vollständig änderbar. */
    expect(block).toContain("p.source <> 'manual'");
  });

  it("die AUFTEILUNG bleibt nachtragbar — alle vier Parameter überleben", () => {
    const i = MIG.lastIndexOf("create or replace function public.seller_update_purchase");
    const rumpf = MIG.slice(i, MIG.indexOf("\n$$;", i));
    for (const p of ["p_items_cost", "p_shipping_cost",
                     "p_buyer_protection_cost", "p_clear_cost_split"]) {
      expect(rumpf, p).toContain(p);
    }
  });

  it("und alles Beschreibende auch", () => {
    const i = MIG.lastIndexOf("create or replace function public.seller_update_purchase");
    const rumpf = MIG.slice(i, MIG.indexOf("\n$$;", i));
    for (const p of ["p_purchased_at", "p_platform", "p_seller_name",
                     "p_payment_method", "p_external_ref", "p_note",
                     "p_sender_name", "p_sender_street", "p_sender_postal_code",
                     "p_sender_city", "p_sender_country",
                     "p_listing_title", "p_listing_url", "p_listing_details",
                     "p_agreement_note"]) {
      expect(rumpf, p).toContain(p);
    }
  });

  it("die Aufteilung kann die Summe gar nicht verschieben — der CHECK aus 0115", () => {
    expect(SPLIT_CHECK).toContain("purchases_cost_split_adds_up");
    expect(SPLIT_CHECK).toContain("= round(total_cost, 2)");
  });

  it("die Oberfläche schickt die Summe bei einem importierten Einkauf NICHT mit", () => {
    /*
     * Der indirekte Weg, und der gefährlichere: `typed.total` ist die Summe
     * der getippten Teile. Würde sie mitgeschickt, zöge jede Änderung der
     * Aufteilung die bezahlte Summe mit.
     */
    expect(DIALOG).toContain("hasSplit && !zahlungAbgeschlossen ? typed.total : undefined");
    expect(DIALOG).toContain("const zahlungAbgeschlossen = isHistorical(purchase.source)");
  });

  it("und prüft vorher, dass die Aufteilung die bezahlte Summe ergibt", () => {
    expect(DIALOG).toContain("modal.splitMustMatchPaid(");
    expect(DIALOG).toContain("Math.abs(typed.total - purchase.totalCost) > 0.004");
  });

  it("die bezahlte Summe ist sichtbar, aber ohne Eingabefeld", () => {
    expect(DIALOG).toContain("modal.paidFixedLabel");
    expect(DIALOG).toContain("value={formatPrice(purchase.totalCost)} strong");
    /* Es gab noch nie ein Eingabefeld für `total_cost` — und es kommt keines. */
    expect(DIALOG).not.toMatch(/value=\{draft\.total/);
  });

  it("die Sätze dazu stehen in de.ts", () => {
    const modal = de.business.orderbook.detailsModal;
    expect(modal.paidFixedLabel).toContain("unveränderlich");
    expect(modal.paidFixedHint).toContain("steht fest");
    expect(modal.splitMustMatchPaid("1,00 €", "2,00 €")).toContain("1,00 €");
    expect(modal.splitMustMatchPaid("1,00 €", "2,00 €")).toContain("2,00 €");
    expect(de.business.orderbook.errors.paidTotalFinal).toContain("abgeschlossen");
  });

  it("und die Ablehnung des Servers wird zu diesem Satz", () => {
    expect(LIB("actions.ts"))
      .toContain('text.includes("the paid total of an imported purchase is final")');
  });

  it("der Monatsbericht rechnet mit Bestellungen, nicht mit Einkäufen", () => {
    /*
     * Damit kann ein nachgetragenes Kaufdatum keinen abgeschlossenen Bericht
     * verfälschen — die Sorge gilt hier nicht.
     */
    const archiv = readFileSync(
      "supabase/migrations/0045_seller_order_archive.sql", "utf8");
    expect(archiv).not.toContain("public.purchases");
  });
});

/* ==========================================================================
 * 8. Einbuchen: genau einmal, und nicht für die Arbeitsmappe
 * ======================================================================== */
describe("die nachgetragene Figur wird regulär eingebucht", () => {
  const BOOK = (() => {
    const s = readFileSync(
      "supabase/migrations/0116_purchase_factor_showcase_and_ledger.sql", "utf8");
    const i = s.lastIndexOf("create or replace function public.seller_book_purchase_item");
    return s.slice(i, s.indexOf("\n$$;", i));
  })();

  it("der Einbuchungsweg kennt die Herkunft des Einkaufs nicht", () => {
    expect(BOOK).not.toContain("p.source");
    expect(BOOK).not.toContain("excel_order_2026");
  });

  it("er entscheidet über den ZUSTAND der Zeile", () => {
    expect(BOOK).toContain("reconciled_legacy");
    expect(BOOK).toContain("already reflected in stock and is never booked again");
  });

  it("und der Bestand steigt genau einmal — zweimal buchen ist kein Fehler, aber auch keine zweite Bewegung", () => {
    /* `if v_item.state = 'booked' then return v_item.movement_id;` */
    expect(BOOK).toMatch(/state = 'booked'[\s\S]{0,120}return v_item\.movement_id/);
  });

  it("eine neue Zeile ist buchbar, eine importierte nicht", () => {
    expect(canBook({ state: "ordered", skyId: "SKY-0008" })).toBe(true);
    expect(canBook({ state: "arrived", skyId: "SKY-0008" })).toBe(true);
    expect(canBook({ state: "reconciled_legacy", skyId: "SKY-0008" })).toBe(false);
    /* Ohne Katalogfigur gar nicht. */
    expect(canBook({ state: "ordered", skyId: null })).toBe(false);
  });
});

/* ==========================================================================
 * 9. Verkaufte Figuren — die Grenze des Datenmodells
 * ======================================================================== */
describe("eine bereits verkaufte Figur", () => {
  it("hat keine Verbindung zum Einkauf — es gibt keine im Datenmodell", () => {
    /*
     * `sale_items` verweist auf `sales`, `skylanders` und zwei
     * Lagerbewegungen. Auf `purchase_items` verweist nichts. Der Gewinn wird
     * über den Ankaufsfaktor gerechnet, nicht je Stück.
     *
     * Folge: eine nachträgliche Einkaufszeile zu einer längst verkauften
     * Figur ist Herkunftsnachweis am Einkauf — eine Verknüpfung mit dem
     * Verkauf entsteht dabei nicht und kann es nicht. Sie stillschweigend zu
     * erfinden wäre schlimmer als sie nicht zu haben.
     */
    const sales = readFileSync("supabase/migrations/0059_orderbook_sales.sql", "utf8");
    const i = sales.indexOf("create table if not exists public.sale_items");
    const tabelle = sales.slice(i, sales.indexOf(");", i));
    expect(tabelle).not.toContain("purchase_item");
    expect(tabelle).toContain("movement_id");
  });

  it("und kein Bearbeitungsweg fasst einen Verkauf an", () => {
    const aktionen = LIB("actions.ts");
    /* Die vier Wege des Sammelspeicherns stehen in Abschnitt 4; hier nur,
       dass die Oberfläche keinen Verkauf anrührt. */
    expect(DIALOG).not.toContain("sale_items");
    expect(aktionen).not.toContain("seller_remove_sale_item");
  });
});

/* ==========================================================================
 * 10. `0133` — die Zahlung auch gegen ein direktes UPDATE
 * ======================================================================== */

/**
 * DIE LÜCKE, DIE BEIM SCHREIBEN DES TESTPLANS AUFFIEL.
 *
 * `0132` setzt den Riegel in `seller_update_purchase`. Das deckt jeden Weg
 * der Anwendung ab — die Oberfläche ruft nur diese Funktion. Es deckt **nicht**
 * den SQL-Editor ab: ein `update public.purchases set total_cost = …` als
 * `postgres` geht an der Funktion vorbei, und der einzige Tabellenzwang
 * (`purchases_cost_split_adds_up`) prüft nur, dass die Aufteilung zur Summe
 * passt — nicht, dass die Summe bleibt.
 *
 * Die Anforderung lautet „weder direkt noch indirekt". Dafür ist eine Funktion
 * der falsche Ort: unveränderlich wird in diesem Projekt mit einem TRIGGER
 * gemacht — `purchase_receipts_immutable_trg` (0122) und
 * `inventory_movements_append_only` (0003) tun es genauso.
 *
 * `0133` ist deshalb eine EIGENE Migration und **nicht freigegeben**: sie
 * macht die Zahlung hart und nimmt dafür Spielraum. `0132` bleibt in der
 * Fassung, die freigegeben wurde.
 */
describe("0133 hält die bezahlte Summe als Trigger", () => {
  const M33 = readFileSync(
    "supabase/migrations/0133_paid_total_immutable.sql", "utf8");
  const rumpf = (() => {
    const i = M33.indexOf("create or replace function public.purchases_paid_total_is_final");
    return M33.slice(i, M33.indexOf("\n$$;", i));
  })();

  it("sie liegt getrennt von 0132 — die bleibt, wie sie freigegeben wurde", () => {
    expect(M33).toContain("NICHT FREIGEGEBEN");
    expect(M33).toContain("`0132` bleibt");
    /* 0132 kennt keinen Trigger. */
    expect(MIG).not.toContain("create trigger");
  });

  it("der Trigger ist BEFORE UPDATE FOR EACH ROW auf purchases", () => {
    expect(M33).toContain("create trigger purchases_paid_total_immutable_trg");
    expect(M33).toContain("before update on public.purchases");
    expect(M33).toContain("for each row execute function public.purchases_paid_total_is_final()");
    /* Nicht bei insert, nicht bei delete: ein Einkauf entsteht und bleibt. */
    expect(M33).not.toMatch(/before (insert|delete)[^;]*on public\.purchases/);
  });

  it("er hält genau drei Dinge fest: Summe, Währung, Herkunft", () => {
    expect(rumpf).toContain("round(new.total_cost, 2) is distinct from round(old.total_cost, 2)");
    expect(rumpf).toContain("new.currency is distinct from old.currency");
    /* Die Herkunft mit: liesse man sie auf `manual` drehen, wäre die Sperre
       mit einem `update` umgangen. */
    expect(rumpf).toContain("new.source is distinct from old.source");
  });

  it("und NICHTS von der Aufteilung oder den Metadaten", () => {
    for (const feld of ["items_cost", "shipping_cost", "buyer_protection_cost",
                        "purchased_at", "sender_name", "sender_street",
                        "listing_url", "listing_title", "agreement_note",
                        "note", "platform", "seller_name", "payment_method"]) {
      expect(rumpf, feld).not.toContain(feld);
    }
  });

  it("ein manueller Einkauf ist ausgenommen", () => {
    expect(rumpf).toContain("if old.source = 'manual' then");
    expect(rumpf).toContain("return new;");
  });

  it("die Ablehnung trägt denselben Text wie der Riegel aus 0132", () => {
    /* Damit die Abbildung in `actions.ts` beide Wege abdeckt. */
    expect(rumpf).toContain("the paid total of an imported purchase is final");
    expect(LIB("actions.ts"))
      .toContain('text.includes("the paid total of an imported purchase is final")');
  });

  it("sie setzt 0115 und 0132 voraus und prüft das selbst", () => {
    expect(M33).toContain("0133 setzt 0115 voraus");
    expect(M33).toContain("0133 setzt 0132 voraus");
    expect(M33).toContain("0133 Abbruch: der Trigger steht schon");
  });

  it("sie führt selbst keine Datenanweisung aus", () => {
    const ohneRumpf = M33.replace(/\nas \$\$[\s\S]*?\n\$\$;/g, "\n-- (Rumpf)");
    const ohneProsa = ohneRumpf.replace(/\/\*[\s\S]*?\*\//g, "")
                               .replace(/^\s*--.*$/gm, "");
    expect(ohneProsa).not.toMatch(/insert\s+into\s+public\./i);
    expect(ohneProsa).not.toMatch(/\bupdate\s+public\./i);
    expect(ohneProsa).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(ohneProsa).not.toMatch(/\balter table\b/i);
    expect(ohneProsa).not.toContain("purchase_receipts");
  });

  it("Pre-, Postflight und Rücknahme liegen daneben", () => {
    const pre = readFileSync("supabase/checks/0133_preflight.sql", "utf8");
    const post = readFileSync("supabase/checks/0133_postflight.sql", "utf8");
    const back = readFileSync(
      "supabase/rollback/R0133_drop_paid_total_trigger.sql", "utf8");
    expect(pre).toContain("der Trigger fehlt noch");
    expect(post).toContain("BEFORE UPDATE FOR EACH ROW");
    expect(post).toContain("und NICHTS von der Aufteilung oder den Metadaten");
    /* Die Rücknahme nennt den milderen Weg zuerst. */
    expect(back).toContain("disable trigger purchases_paid_total_immutable_trg");
    expect(back).toContain("R0133 Abbruch: auch der Riegel aus 0132 ist weg");
  });

  it("und die Akte sagt, dass sie nicht angewendet ist", () => {
    const akte = readFileSync("supabase/migrations/APPLIED.md", "utf8");
    expect(akte).toContain("0133_paid_total_immutable.sql");
    expect(akte).toContain("nicht freigegeben");
  });
});

/* ==========================================================================
 * 11. Der Testplan deckt die Vorgänge ab, die kein SELECT zeigt
 * ======================================================================== */
describe("0132_test_plan.md", () => {
  const PLAN = readFileSync("supabase/checks/0132_test_plan.md", "utf8");

  it("er nennt alle zwölf Fälle", () => {
    for (let i = 1; i <= 12; i++) {
      expect(PLAN, `H${i}`).toContain(`## H${i} `);
    }
  });

  it("und er sagt, warum er nicht im SQL-Editor läuft", () => {
    expect(PLAN).toContain("can_operate_active_seller()");
    expect(PLAN).toContain("`auth.uid()` NULL");
    expect(PLAN).toContain("npm run dev:staging");
  });

  it("er deckt die sechs Punkte der Freigabe ab", () => {
    expect(PLAN).toContain("bleibt geschützt");          // Excel-Positionen
    expect(PLAN).toContain("wieder entfernen");          // nachgetragene Zeile
    expect(PLAN).toContain("genau einmal");              // Einbuchen
    expect(PLAN).toContain("unveränderlich");            // Zahlungssumme
    expect(PLAN).toContain("ohne die Summe zu ändern");  // Aufteilung
    expect(PLAN).toContain("Belegausstellung bleibt zu");
  });

  it("und er nennt die Zahlen, die vorher und nachher gleich sein müssen", () => {
    expect(PLAN).toContain("Nach dem Durchlauf");
    expect(PLAN).toContain("Lagerbilanz stimmt");
    expect(PLAN).toContain("kein Beleg entstanden");
    expect(PLAN).toContain("keine bezahlte Summe hat sich bewegt");
  });
});

/* ==========================================================================
 * 12. Die beiden Abweichungen aus dem PRODUCTION-Lauf von 0132
 *
 * Der Lauf meldete zwei blockierende Zeilen, vor und nach der Migration
 * identisch: 109 importierte Positionen ohne `reconciled_legacy` und die
 * Mehrzahl der Lagerpositionen mit `quantity <> sum(delta)`. Beide Zahlen
 * sind richtig — falsch waren meine beiden Prüfungen.
 *
 * Er fand auf Production statt. Freigegeben war Staging; der Betreiber hat
 * die Verwechslung am 2026-10-18 festgestellt und gemeldet. An den beiden
 * Ursachen ändert das nichts — `0067` und der Cutover liefen in beiden
 * Umgebungen. Diese Gruppe hält fest, woher jede Zahl kommt, dass die
 * Korrektur die Schutzwirkung nicht anfasst, und dass die Akte den Vorfall
 * führt statt ihn zu glätten.
 * ======================================================================== */
describe("Abweichung 1 — 109 importierte Zeilen ohne reconciled_legacy", () => {
  const M0067 = readFileSync(
    "supabase/migrations/0067_reopen_undelivered_legacy_items.sql", "utf8");

  it("0067 hat genau diese 109 Zeilen bewusst wiedereröffnet", () => {
    expect(M0067).toMatch(/v_expected_items\s+constant integer := 109;/);
    expect(M0067).toContain("set state = 'ordered'");
  });

  it("und es sind die fünf nie gelieferten Pakete", () => {
    expect(M0067).toContain("reconciled_legacy");
    expect(M0067.toLowerCase()).toContain("five parcels");
  });

  it("0067 fasst die source_row nicht an — die Herkunft bleibt stehen", () => {
    expect(M0067).not.toMatch(/source_row\s*=\s*null/i);
    expect(M0067).not.toMatch(/set[^;]*\bsource_row\b\s*=/i);
  });

  it("die Datenbank lehnt sie deshalb weiter ab: source_row ist eine der vier Bedingungen", () => {
    expect(MIG).toContain("v_item.source_row is not null");
  });

  it("und der Dialog lehnt sie jetzt auch ab (0134)", () => {
    // Genau der Fall der 109: offen, keine Flaggen, aber eine Zeilennummer.
    expect(canRemoveItem(zeile({ state: "ordered", sourceRow: 418 }))).toBe(false);
  });

  it("eine selbst nachgetragene Zeile bleibt entfernbar", () => {
    expect(canRemoveItem(zeile({ state: "ordered", sourceRow: null }))).toBe(true);
  });

  it("der Dialog prüft jetzt alle vier Bedingungen der Datenbank", () => {
    const code = LIB("purchase.ts");
    expect(code).toContain('if (item.state === "reconciled_legacy") return false;');
    expect(code).toContain("if (item.sourceRow !== null) return false;");
    expect(code).toContain("item.legacyConditionFlag === null && item.legacyBookedFlag === null");
    expect(code).toContain("Four refusals");
  });

  it("und source_row erreicht den Bildschirm überhaupt erst über 0134", () => {
    const m = readFileSync(
      "supabase/migrations/0134_purchase_item_source_row_visible.sql", "utf8");
    expect(m).toContain("'source_row', i.source_row,");
    expect(m).toContain("create or replace function public.seller_purchase(p_id bigint)");
    expect(m).toContain("grant execute on function public.seller_purchase(bigint) to authenticated;");
    expect(LIB("queries.ts")).toContain("sourceRow:");
    expect(LIB("queries.ts")).toContain("i.source_row");
  });

  it("0134 ändert am Körper aus 0119 nichts weiter als diesen einen Schlüssel", () => {
    const koerper = (quelle: string) => {
      const a = quelle.indexOf("create or replace function public.seller_purchase(p_id bigint)");
      const b = quelle.indexOf("\n$$;", a);
      return quelle.slice(a, b);
    };
    const neu = koerper(readFileSync(
      "supabase/migrations/0134_purchase_item_source_row_visible.sql", "utf8"));
    const alt = koerper(readFileSync(
      "supabase/migrations/0119_orderbook_display_names.sql", "utf8"));
    const ohneZusatz = neu
      .split("\n")
      .filter((z) => !z.includes("'source_row', i.source_row,") && !z.includes("NEU IN 0134")
        && !z.includes("`0064` prueft und der Bildschirm"))
      .join("\n");
    expect(ohneZusatz).toBe(alt);
  });

  it("die Rücknahme ist der Körper aus 0119, Zeichen für Zeichen", () => {
    const r = readFileSync(
      "supabase/rollback/R0134_purchase_item_source_row_visible.sql", "utf8");
    const a = r.indexOf("create or replace function public.seller_purchase(p_id bigint)");
    const alt = readFileSync("supabase/migrations/0119_orderbook_display_names.sql", "utf8");
    const b = alt.indexOf("create or replace function public.seller_purchase(p_id bigint)");
    expect(r.slice(a, r.indexOf("\n$$;", a))).toBe(alt.slice(b, alt.indexOf("\n$$;", b)));
  });

  it("und 0134 steht als nicht angewendet in der Akte", () => {
    const akte = readFileSync("supabase/migrations/APPLIED.md", "utf8");
    expect(akte).toContain("0134_purchase_item_source_row_visible.sql");
  });
});

/* ==========================================================================
 * 13. Der Vorfall vom 2026-10-18 — die falsche Umgebung
 * ======================================================================== */
describe("0132 und 0133 stehen auf Production, nicht auf Staging", () => {
  const AKTE = readFileSync("supabase/migrations/APPLIED.md", "utf8");
  const PROTOKOLL = readFileSync(
    "docs/history/2026-10-18-production-0132-0133.md", "utf8");

  it("die Akte führt beide in der Production-Tabelle", () => {
    const prod = AKTE.slice(AKTE.indexOf("## Production"),
                            AKTE.indexOf("## Nicht angewendet"));
    expect(prod).toContain("0132_purchase_item_remove_by_line.sql");
    expect(prod).toContain("0133_paid_total_immutable.sql");
  });

  it("und in KEINER Staging-Zeile", () => {
    const stag = AKTE.slice(AKTE.indexOf("## Staging"), AKTE.indexOf("## Production"));
    expect(stag).not.toContain("0132_purchase_item_remove_by_line.sql");
    expect(stag).not.toContain("0133_paid_total_immutable.sql");
  });

  it("der Vorfall ist protokolliert und nicht geglättet", () => {
    expect(PROTOKOLL).toContain("zmiwxswrpkmizvqsgype");
    expect(PROTOKOLL).toContain("qqxcpesbwfxzgytkdsac");
    expect(PROTOKOLL).toContain("nicht erfolgt und nicht empfohlen");
  });

  it("er beantwortet die Verträglichkeit mit der veröffentlichten Oberfläche", () => {
    expect(PROTOKOLL).toContain("PGRST202");
    expect(PROTOKOLL).toContain("seller_update_purchase(21 Parameter)");
    /* Welcher Stand ausgeliefert ist, hält das Repository nicht fest. Das
       Protokoll nennt beide Kandidaten und sagt, dass es für die Antwort
       nicht darauf ankommt — beide lehnen dieselbe Zeile ab. */
    expect(PROTOKOLL).toContain("c24926e");
    expect(PROTOKOLL).toContain("81386e6");
    expect(PROTOKOLL).toContain("isHistorical(purchaseSource)");
  });

  it("und die Frage, ob der Trigger einen regulären Ablauf blockiert", () => {
    /* Sieben Funktionen schreiben purchases; genau eine fasst die Summe an. */
    for (const fn of [
      "purchase_items_touch_purchase", "seller_create_purchase_with_items",
      "seller_set_purchase_date", "seller_set_purchase_test",
      "seller_swap_purchase_daily_index", "system_set_legacy_purchase_fingerprint",
      "seller_update_purchase",
    ]) {
      expect(PROTOKOLL, fn).toContain(fn);
    }
    expect(PROTOKOLL).toContain("weder bei INSERT noch bei DELETE");
  });

  it("und genau diese sieben sind es auch wirklich", () => {
    /*
     * Nicht aus dem Gedächtnis: die jeweils JÜNGSTE Fassung jeder Funktion in
     * `supabase/migrations/` wird gelesen, und nur sie zählt. Käme eine achte
     * hinzu, die `purchases` schreibt, fällt es hier auf — und erst dann ist
     * die Aussage des Protokolls zu prüfen.
     */
    const juengste = new Map<string, string>();
    for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()) {
      const quelle = readFileSync(`supabase/migrations/${f}`, "utf8");
      const re = /create (?:or replace )?function public\.(\w+)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(quelle)) !== null) {
        const ende = quelle.indexOf("\n$$;", m.index);
        if (ende > m.index) juengste.set(m[1], quelle.slice(m.index, ende));
      }
    }
    const schreiber = [...juengste.entries()]
      .filter(([, body]) => body.includes("update public.purchases"))
      .map(([name]) => name).sort();
    expect(schreiber).toEqual([
      "purchase_items_touch_purchase",
      "seller_create_purchase_with_items",
      "seller_set_purchase_date",
      "seller_set_purchase_test",
      "seller_swap_purchase_daily_index",
      "seller_update_purchase",
      "system_set_legacy_purchase_fingerprint",
    ]);
    /* Und nur eine davon weist eines der drei gehaltenen Felder zu. */
    const heikel = schreiber.filter((n) => {
      const body = juengste.get(n)!;
      return /total_cost\s*=/.test(body) || /currency\s*=/.test(body)
        || /\bsource\s*=/.test(body);
    });
    expect(heikel).toEqual(["seller_update_purchase"]);
  });

  it("die lesende Nachprüfung zu 0133 liegt vor und schreibt nichts", () => {
    const L = readFileSync("supabase/checks/0133_production_readonly.sql", "utf8");
    expect(L).toContain("REIN LESEND");
    expect(L).toContain("tgenabled");
    /*
     * Die Zeichenkette `update public.purchases` STEHT in dieser Datei — als
     * LIKE-Muster, mit dem sie die Funktionen findet, die `purchases`
     * schreiben. Ein Verbot über den ganzen Text wäre deshalb falsch. Geprüft
     * wird, was eine Anweisung ausmacht: kein Befehl beginnt eine Zeile, und
     * die Datei ist ein einziges SELECT.
     */
    const anweisungen = L.split("\n")
      .map((z) => z.trim())
      .filter((z) => z.length > 0 && !z.startsWith("--"));
    expect(anweisungen[0]).toBe("with");
    for (const z of anweisungen) {
      expect(z.toLowerCase(), z).not.toMatch(
        /^(insert|update|delete|alter|drop|create|truncate|grant|revoke|begin|commit|rollback|do)\b/);
    }
    expect(L.trim().endsWith("order by nr;")).toBe(true);
  });

  it("der Umgebungsstempel nennt die Figuren, statt eine Umgebung zu behaupten", () => {
    /*
     * BERICHTIGT AM 2026-10-19. Der Stempel verglich die Anzahl von
     * `SKY-9101`/`SKY-9998` und leitete daraus die Umgebung ab — „2 = Staging,
     * 0 = Production". Der Production-Lauf hat das widerlegt: dort steht eine
     * davon, weil `verify:rls` sie als DAUERHAFTE Fixture anlegt und ihr
     * Teardown sie wegen ON DELETE RESTRICT nie entfernen konnte.
     *
     * Jetzt zählt der Stempel den ganzen Fixture-Bereich auf und behauptet
     * nichts. Entscheidbar ist dafür etwas anderes, und das ist jetzt die
     * blockierende Prüfung: im öffentlichen Angebot hat kein Testartikel
     * etwas zu suchen.
     */
    for (const f of ["0132_preflight.sql", "0132_postflight.sql",
                     "0132_diagnose_production.sql", "0133_production_readonly.sql",
                     "state_audit_readonly.sql"]) {
      const q = readFileSync(`supabase/checks/${f}`, "utf8");
      expect(q, f).toContain("sky_id >= 'SKY-9000'");
      /* Ohne Kommentarzeilen: die widerlegte Formel darf als ZITAT in der
         Berichtigung stehen bleiben — nur nicht mehr als Prüfungstext. */
      const ohneKommentar = q.split("\n")
        .filter((z) => !z.trim().startsWith("--")).join("\n");
      expect(ohneKommentar, f).not.toContain("Staging 2, Production 0");
    }
    const d = readFileSync("supabase/checks/0132_diagnose_production.sql", "utf8");
    expect(d).toContain("Testfiguren im oeffentlichen Angebot (muss 0 sein)");
    expect(d).toContain("public.shop_offers()");
  });

  it("die eingefrorenen Kopfzeilen werden festgehalten, nicht korrigiert", () => {
    /*
     * Beide Dateien behaupten in ihrem Kopf, nirgends angewendet zu sein. Das
     * ist falsch — und bleibt stehen: eine angewendete Migration wird nicht
     * geändert, sonst passt die Prüfsumme der ausgeführten Fassung nicht mehr.
     */
    const m0132 = readFileSync(
      "supabase/migrations/0132_purchase_item_remove_by_line.sql", "utf8");
    const m0133 = readFileSync(
      "supabase/migrations/0133_paid_total_immutable.sql", "utf8");
    expect(m0132).toContain("NUR LOKAL VORBEREITET");
    expect(m0133).toContain("NICHT FREIGEGEBEN");
    expect(AKTE).toContain("Zwei eingefrorene Kopfzeilen, die nicht mehr stimmen");
    expect(AKTE).toContain("nicht in der Datei");
  });

  it("der Staging-Plan steht und führt nichts aus", () => {
    const PLAN = readFileSync("supabase/checks/0132_staging_plan.md", "utf8");
    expect(PLAN).toContain("Nichts in dieser Datei ist ausgeführt");
    expect(PLAN).toContain("qqxcpesbwfxzgytkdsac");
    expect(PLAN).toContain("Bleibt gesperrt");              // 0134
    expect(PLAN).toContain("Keine Rücknahme von `0132` oder `0133`");
  });
});

describe("Abweichung 2 — 245 Lagerpositionen ohne Journaldeckung", () => {
  const RESET = readFileSync(
    "docs/history/2026-09-21-pre-go-live-reset.md", "utf8");

  it("der Pre-Go-Live-Reset hat das Journal geleert und quantity stehen lassen", () => {
    expect(RESET).toContain("delete from public.inventory_movements;");
    expect(RESET).toContain("shop_inventory.quantity — unangetastet");
    expect(RESET).toContain("die losen Stück sind ab jetzt");
    expect(RESET).toContain("die operative Ausgangsbasis");
  });

  it("er lief am 2026-09-21 auf beiden Umgebungen", () => {
    expect(RESET).toContain("Staging     2026-09-21");
    expect(RESET).toContain("Production  2026-09-21");
  });

  it("die Differenz je Position IST damit der Eröffnungsbestand", () => {
    // Nach dem Reset bewegt sich `quantity` ausschließlich über
    // `apply_inventory_movement`, und das schreibt beide Seiten zusammen.
    const m0093 = readFileSync(
      "supabase/migrations/0093_movement_refusal_names_its_cause.sql", "utf8");
    expect(m0093).toContain("set quantity = quantity + p_delta");
    expect(m0093).toContain("insert into public.inventory_movements");
  });
});

describe("die korrigierten Prüfungen", () => {
  const PRE = readFileSync("supabase/checks/0132_preflight.sql", "utf8");
  const POST = readFileSync("supabase/checks/0132_postflight.sql", "utf8");
  const BASE = readFileSync("supabase/checks/dr/baseline-business.sql", "utf8");

  it("202 behauptet nicht mehr, jede Importzeile trage reconciled_legacy", () => {
    for (const [name, datei] of [["preflight", PRE], ["postflight", POST]] as const) {
      expect(datei, name).not.toContain(
        "'importierte Zeilen ohne reconciled_legacy (muss 0 sein)'");
      expect(datei, name).toContain("(202, 'Arbeitsmappe', 'Info: Zustaende importierter Zeilen'");
      expect(datei, name).toContain("0067");
    }
  });

  it("201 und 203 bleiben blockierend — sie tragen den Nachweis", () => {
    for (const [name, datei] of [["preflight", PRE], ["postflight", POST]] as const) {
      expect(datei, name).toContain("importierte Zeilen OHNE jedes Merkmal (muss 0 sein)");
      expect(datei, name).toContain("importierte Zeilen ohne source_row (muss 0 sein)");
    }
  });

  it("303 prüft die Richtung statt der Gleichheit und nennt den Grund", () => {
    for (const [name, datei] of [["preflight", PRE], ["postflight", POST]] as const) {
      expect(datei, name).not.toContain("'Lagerbilanz: quantity <> sum(delta) (muss 0 sein)'");
      expect(datei, name).toContain(
        "Lagerbilanz: Positionen mit negativem Eroeffnungsbestand (muss 0 sein)");
      expect(datei, name).toContain("2026-09-21");
      expect(datei, name).toContain("i.quantity < coalesce((select sum(m.delta)");
    }
  });

  it("und der Eröffnungsbestand selbst wird als Zahl mitgeführt", () => {
    for (const [name, datei] of [["preflight", PRE], ["postflight", POST]] as const) {
      expect(datei, name).toContain(
        "(307, 'Bestand', 'Info: Eroeffnungsbestand aus dem Cutover (Positionen / Summe)'");
    }
  });

  it("die DR-Baseline trägt dieselbe Korrektur", () => {
    expect(BASE).not.toContain("'Lagerbilanz: quantity <> sum(delta) (muss 0 sein)'");
    expect(BASE).toContain(
      "select 11, 'Lagerbilanz: Positionen mit negativem Eroeffnungsbestand (muss 0 sein)'");
    expect(BASE).toContain("select 22, 'Eroeffnungsbestand aus dem Cutover (Positionen / Summe)'");
    expect(BASE).toContain("2026-09-21");
  });

  it("keine Prüfung wurde entfernt — beide Dateien zählen weiterhin ihre Abweichungen", () => {
    for (const [name, datei] of [["preflight", PRE], ["postflight", POST]] as const) {
      expect(datei, name).toContain("blockierende Abweichungen (muss 0 sein)");
    }
  });
});

describe("die Diagnoseabfrage für Production", () => {
  const D = readFileSync("supabase/checks/0132_diagnose_production.sql", "utf8");

  it("sie liest nur", () => {
    expect(D).toContain("REIN LESEND");
    for (const verboten of [
      "insert into", "update public.", "delete from", "alter table", "drop ",
      "create or replace function", "truncate", "disable trigger",
    ]) {
      expect(D.toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("sie belegt beide Ursachen mit einem Sollwert", () => {
    expect(D).toContain("'109'");                       // 0067
    expect(D).toContain("initial_import-Bewegungen");    // geleerter Ledger
    expect(D).toContain("Bewegungen vor dem 2026-09-21");
    expect(D).toContain("seller_remove_purchase_item NICHT ablehnen wuerde");
    expect(D).toContain("Positionen mit diff < 0");
  });

  it("und sie fasst keine personenbezogene Spalte an", () => {
    for (const spalte of ["buyer", "email", "address", "auth.users"]) {
      expect(D.toLowerCase(), spalte).not.toContain(spalte);
    }
  });
});
