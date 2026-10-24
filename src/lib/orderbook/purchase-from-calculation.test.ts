import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import {
  addPurchaseFigure, purchaseDraftFromUnits, purchaseDraftGap, purchaseDraftPayload,
  removePurchaseLine, setPurchaseQuantity, type PurchaseDraftLine,
} from "./purchase-draft";
import type { FigureChoice } from "./figure-search";
import { encodeLines, handOverUnits, toSavedCalculation, type CalculationRow } from
  "@/lib/calculator/saved";
import { addFigure, setQuantity, type CalculationLine } from "@/lib/calculator/calculation";

/**
 * Eine Kalkulation wird ein Einkauf — im BESTEHENDEN Formular
 * (Calculator V3, ADR-0132).
 *
 * DIE EINE FRAGE, DIE DIESE DATEI STELLT: ist eine vorausgefüllte Position
 * von einer getippten zu unterscheiden? Die Antwort muss nein sein, und zwar
 * nicht „sieht gleich aus", sondern **ist dasselbe Objekt**: dieselbe
 * Bauanleitung, dieselben Schlüssel, derselbe Anfangszustand.
 *
 * Alles hier ist rein oder liest Quelltext. Dass die Übernahme in der
 * Datenbank atomar ist, fährt Probelauf **P49** nach.
 */

const KATALOG: FigureChoice[] = [
  { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.9 },
  { skyId: "SKY-0002", name: "Legendary Spyro", series: "SA", marketPrice: 24.9 },
  { skyId: "SKY-0003", name: "Gill Grunt", series: "SA", marketPrice: 8 },
];

const wahl = (skyId: string) => KATALOG.find((c) => c.skyId === skyId)!;

/** Von Hand: so oft klicken, wie Stücke da sind. */
function vonHand(...stuecke: string[]): PurchaseDraftLine[] {
  return stuecke.reduce<PurchaseDraftLine[]>(
    (lines, skyId) => addPurchaseFigure(lines, wahl(skyId)), []);
}

/* ===================================================================== */
describe("1. vorausgefüllt ist dasselbe wie getippt", () => {
  it("drei Figuren mit Mengen ergeben Zeile für Zeile dasselbe", () => {
    const ausKalkulation = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0001", quantity: 2 },
      { skyId: "SKY-0003", quantity: 1 },
    ]);
    const getippt = vonHand("SKY-0001", "SKY-0001", "SKY-0003");
    /* Nicht „ähnlich": gleich, einschließlich der Schlüssel. */
    expect(ausKalkulation).toEqual(getippt);
  });

  it("die Varianten bleiben getrennt — es sind eigene Katalogzeilen (ADR-0034)", () => {
    const lines = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0001", quantity: 1 },
      { skyId: "SKY-0002", quantity: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.skyId)).toEqual(["SKY-0001", "SKY-0002"]);
    expect(lines.map((l) => l.name)).toEqual(["Spyro", "Legendary Spyro"]);
  });

  it("die Anzeigedaten kommen aus dem KATALOG, nicht aus dem Schnappschuss", () => {
    /*
     * Die Kalkulation erinnert sich an den Namen von damals (ADR-0131). Für
     * das Orderbuch gilt der Katalog von heute — sonst stünde im Einkauf ein
     * Name, den der Katalog nicht kennt.
     */
    const lines = purchaseDraftFromUnits(KATALOG, [{ skyId: "SKY-0001", quantity: 1 }]);
    expect(lines[0].name).toBe("Spyro");
    expect(lines[0].series).toBe("SA");
    expect(lines[0].marketPrice).toBe(12.9);
  });

  it("und die Zeilen lassen sich danach ganz normal bearbeiten", () => {
    let lines = purchaseDraftFromUnits(KATALOG, [{ skyId: "SKY-0001", quantity: 2 }]);
    /* Hinzufügen fasst dieselbe offene Zeile an. */
    lines = addPurchaseFigure(lines, wahl("SKY-0001"));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    /* Eine weitere Figur daneben. */
    lines = addPurchaseFigure(lines, wahl("SKY-0003"));
    expect(lines).toHaveLength(2);
    /* Menge setzen und entfernen gehen über dieselben Funktionen. */
    lines = setPurchaseQuantity(lines, lines[0].key, 5);
    expect(lines[0].quantity).toBe(5);
    lines = removePurchaseLine(lines, lines[0].key);
    expect(lines.map((l) => l.skyId)).toEqual(["SKY-0003"]);
  });

  it("die Nutzlast an die Datenbank ist eine je STÜCK — wie bei 0064 verlangt", () => {
    const lines = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0001", quantity: 3 },
      { skyId: "SKY-0003", quantity: 1 },
    ]);
    const payload = purchaseDraftPayload(lines);
    expect(payload).toHaveLength(4);
    expect(payload.filter((i) => i.sky_id === "SKY-0001")).toHaveLength(3);
    /* Und jede beginnt im Zustand, den auch eine getippte bekommt. */
    expect(new Set(payload.map((i) => i.state))).toEqual(new Set(["ordered"]));
  });
});

/* ===================================================================== */
describe("2. was der Katalog nicht kennt, wird weggelassen und gezählt", () => {
  it("eine unbekannte SKY-ID erzeugt keine Zeile und keinen Fehler", () => {
    const lines = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0001", quantity: 1 },
      { skyId: "SKY-9999", quantity: 2 },
    ]);
    expect(lines.map((l) => l.skyId)).toEqual(["SKY-0001"]);
  });

  it("und die Zahl der weggelassenen Stücke ist abfragbar", () => {
    expect(purchaseDraftGap(KATALOG, [
      { skyId: "SKY-0001", quantity: 1 },
      { skyId: "SKY-9999", quantity: 2 },
    ])).toBe(2);
    expect(purchaseDraftGap(KATALOG, [{ skyId: "SKY-0001", quantity: 1 }])).toBe(0);
  });

  it("die Oberfläche sagt es in einem Satz, nicht in einem Dialog", () => {
    expect(de.business.orderbook.calculationMissing(1)).toContain("1 Stück");
    expect(de.business.orderbook.calculationMissing(3)).toContain("3 Stück");
    const form = readFileSync("src/components/business/new-purchase.tsx", "utf8");
    expect(form).toContain("copy.calculationMissing(missingUnits)");
    /* Kein Dialog, keine Bestätigung. */
    expect(form).not.toContain("confirmImport");
  });
});

/* ===================================================================== */
describe("3. der Weg von der Kalkulation zu den Stücken", () => {
  const kalkulation = (lines: CalculationLine[]) => toSavedCalculation({
    id: "0b6c0f3e-3a4a-4f0e-9a2a-9f5f5f5f5f5f", name: "Willhaben", status: "negotiating",
    lines: encodeLines(lines), factor_percent: 55,
    total_cents: 0, positions: 0, units: 0, purchase_id: null,
    created_at: "", updated_at: "",
  } as unknown as CalculationRow);

  it("liefert SKY-ID und Menge — und sonst nichts", () => {
    let lines = addFigure([], { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.9 });
    lines = setQuantity(lines, "SKY-0001", 3);
    const units = handOverUnits(kalkulation(lines));
    expect(units).toEqual([{ skyId: "SKY-0001", quantity: 3 }]);
    /* Kein Preis, kein Faktor, kein Gesamtwert in der Übergabe. */
    expect(JSON.stringify(units)).not.toContain("Cents");
    expect(JSON.stringify(units)).not.toContain("factor");
  });

  it("und behält die Reihenfolge der Kalkulation", () => {
    let lines = addFigure([], { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 1 });
    lines = addFigure(lines, { skyId: "SKY-0003", name: "Gill", series: "SA", marketPrice: 1 });
    /* Zuletzt hinzugefügt steht oben (ADR-0131, Punkt 4). */
    expect(handOverUnits(kalkulation(lines)).map((u) => u.skyId))
      .toEqual(["SKY-0003", "SKY-0001"]);
  });
});

/* ===================================================================== */
describe("4. keine Kalkulationspreise im Einkauf", () => {
  const seite = readFileSync("src/app/(business)/business/orderbuch/neu/page.tsx", "utf8");
  const form = readFileSync("src/components/business/new-purchase.tsx", "utf8");
  const migration = readFileSync("supabase/migrations/0143_purchase_from_calculation.sql", "utf8");

  it("die Seite übergibt Zeilen und eine Kennung — keine Beträge", () => {
    expect(seite).toContain("initialLines={initialLines}");
    expect(seite).toContain("calculationId={calculation?.id ?? null}");
    for (const verboten of ["totalCents", "total_cents", "factorPercent", "maxPurchase",
      "setItemsCost", "itemsCost="]) {
      expect(seite.includes(verboten), verboten).toBe(false);
    }
  });

  it("das Formular belegt keinen Kostenbetrag vor", () => {
    /* Die vier Geldfelder starten leer — unverändert gegenüber „+ Neu". */
    for (const leer of ['useState("")']) {
      expect(form).toContain(leer);
    }
    expect(form).toContain('const [itemsCost, setItemsCost] = useState("")');
    expect(form).toContain('const [shipping, setShipping] = useState("")');
    expect(form).toContain('const [buyerProtection, setBuyerProtection] = useState("")');
  });

  it("und die Datenbankfunktion liest keine Zahl aus der Kalkulation", () => {
    /* Sie liest genau eine Spalte: `purchase_id`. Die Migration prüft das
       selbst nach — hier steht dieselbe Zusicherung noch einmal. */
    expect(migration).toContain("select c.purchase_id into v_vorher");
    expect(migration).toContain("sie liest einen Wert aus der Kalkulation, der eine Zahl ist");
  });
});

/* ===================================================================== */
describe("5. ein Weg, einen Einkauf anzulegen", () => {
  const actions = readFileSync("src/lib/orderbook/actions.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");
  const migration = readFileSync("supabase/migrations/0143_purchase_from_calculation.sql", "utf8");

  it("dieselbe Serveraktion, einmal im Formular gerufen", () => {
    const form = readFileSync("src/components/business/new-purchase.tsx", "utf8");
    expect(form.match(/createPurchaseWithItems\(/g)).toHaveLength(1);
    /* Keine zweite Aktion für den Kalkulationsfall. */
    expect(form).not.toContain("createPurchaseFromCalculation");
  });

  it("die Argumente werden EINMAL gebaut und beiden Funktionen gegeben", () => {
    expect(actions).toContain("const args = {");
    expect(actions).toContain('rpc("seller_create_purchase_from_calculation",');
    expect(actions).toContain("{ p_calculation_id: head.calculationId, ...args }");
    expect(actions).toContain('rpc("seller_create_purchase_with_items", args)');
    /*
     * Und zwar in GENAU EINER Argumentliste: `createPurchaseWithItems` baut
     * `args` einmal und gibt sie beiden Funktionen. Zwei Listen wären zwei
     * Gelegenheiten, dass eine ein Feld vergisst — und dann hätte ein
     * Einkauf aus einer Kalkulation andere Daten als einer von Hand.
     *
     * Gezählt wird im Rumpf dieser einen Aktion, nicht in der ganzen Datei:
     * `setPurchaseDate` und `updatePurchase` nennen denselben Parameter
     * zurecht an ihren eigenen Stellen.
     */
    const rumpf = actions.slice(
      actions.indexOf("export async function createPurchaseWithItems"),
      actions.indexOf("export async function updatePurchase"));
    expect(rumpf.match(/p_purchased_at:/g)).toHaveLength(1);
    expect(rumpf.match(/rpc\(/g)).toHaveLength(2);
  });

  it("und die neue Funktion legt den Einkauf nicht selbst an, sondern ruft die bestehende", () => {
    expect(migration).toContain("v_id := public.seller_create_purchase_with_items(");
    /* Kein eigenes Einfügen in `purchases` oder `purchase_items`. */
    const rumpf = migration.slice(migration.indexOf("as $$"), migration.lastIndexOf("$$;"));
    expect(rumpf).not.toMatch(/insert\s+into\s+public\.purchases/i);
    expect(rumpf).not.toMatch(/insert\s+into\s+public\.purchase_items/i);
    /* Und die Migration prüft das selbst nach. */
    expect(migration).toContain("sie ruft seller_create_purchase_with_items nicht auf");
  });

  it("drei Riegel, und jeder steht im Rumpf", () => {
    expect(migration).toContain("can_operate_active_seller()");
    expect(migration).toContain("c.user_id = (select auth.uid())");
    expect(migration).toContain("for update");
    expect(migration).toContain("already handed over");
    /* Dieselbe Antwort für „gibt es nicht" und „gehört jemand anderem". */
    expect(migration).toContain("calculation not found");
  });
});

/* ===================================================================== */
describe("6. der Weg dorthin trägt nur eine Kennung", () => {
  const panel = readFileSync("src/components/calculator/saved-panel.tsx", "utf8");
  const seite = readFileSync("src/app/(business)/business/orderbuch/neu/page.tsx", "utf8");

  it("die Liste verweist auf das bestehende Formular, mit der ID als Parameter", () => {
    /*
     * DIESE ZEILE WAR RICHTIG UND HAT NICHT GEREICHT (V3.1).
     *
     * Die Adresse stand im Quelltext, der Klick kam im Browser trotzdem
     * nicht an: der Dialog blieb offen und verdeckte die Zielseite. Ein
     * Quelltextvergleich kann das nicht sehen. Was es sieht, steht seit V3.1
     * in `components/calculator/calculator-navigation.test.tsx` — dort wird
     * wirklich gerendert und wirklich geklickt.
     */
    expect(panel).toContain("/business/orderbuch/neu?kalkulation=${calculation.id}");
    /* Keine Artikelliste in der Adresse. */
    expect(panel).not.toContain("lines=");
    expect(panel).not.toContain("items=");
  });

  it("und die Artikel liest der Server, unter den Richtlinien aus 0142", () => {
    expect(seite).toContain("await fetchOwnCalculation(kalkulation)");
    const query = readFileSync("src/lib/calculator/saved-queries.ts", "utf8");
    expect(query).toContain('from("purchase_calculations")');
    /* Kein Dienstschlüssel, keine Umgehung der Richtlinie. */
    expect(query).not.toContain("SERVICE_ROLE");
    expect(query).not.toContain("service_role");
  });

  it("eine fremde, unbekannte oder krumme Kennung führt zu einem LEEREN Formular", () => {
    const query = readFileSync("src/lib/calculator/saved-queries.ts", "utf8");
    expect(query).toContain("if (!UUID.test(id)) return null");
    expect(query).toContain("if (error || data === null) return null");
    /* Und die Seite behandelt `null` wie einen Aufruf ohne Parameter. */
    expect(seite).toContain("const units = calculation === null ? [] : handOverUnits(calculation)");
  });

  it("ein Aufruf der Seite legt nichts an", () => {
    /* Kein `createPurchase`, kein `update`, keine Serveraktion beim Rendern. */
    for (const verboten of ["createPurchaseWithItems", "updateCalculation", '"use server"']) {
      expect(seite.includes(verboten), verboten).toBe(false);
    }
  });

  it("die Liste zeigt genau einen der beiden Wege", () => {
    expect(panel).toContain("calculation.purchaseId === null ? (");
    expect(panel).toContain("{copy.createPurchase}");
    expect(panel).toContain("{copy.viewPurchase}");
    expect(de.calculator.createPurchase).toBe("Einkauf erstellen");
    expect(de.calculator.viewPurchase).toBe("Einkauf ansehen");
  });

  it("und beide Wege schließen das Fenster, wenn sie navigieren", () => {
    /*
     * Zwei `onNavigate`, eines je Verweis. `onNavigate` und NICHT `onClick`:
     * bei Cmd- oder Strg-Klick öffnet der Browser einen neuen Tab, und der
     * Rückruf läuft dann laut `next/link`s Dokumentation nicht — die
     * Kalkulation bleibt stehen. Der Ablauf selbst ist in
     * `calculator-navigation.test.tsx` geklickt; hier steht, dass die
     * Verdrahtung nicht wieder verschwindet.
     */
    expect(panel.match(/onNavigate=\{onLeave\}/g)).toHaveLength(2);
    expect(panel).not.toContain("onClick={onLeave}");
    const modal = readFileSync("src/components/calculator/calculator-modal.tsx", "utf8");
    expect(modal).toContain("onLeave={close}");
  });

  it("und im Orderbuch entsteht kein neues Bedienelement für die Übernahme", () => {
    const form = readFileSync("src/components/business/new-purchase.tsx", "utf8");
    /* Ein Speichern-Knopf, der des Orderbuchs. */
    expect(form.match(/type="submit"/g)).toHaveLength(1);
    for (const verboten of ["Übernehmen", "übernehmen", "Importieren", "importieren"]) {
      expect(form.includes(verboten), verboten).toBe(false);
    }
  });
});

/* ===================================================================== */
describe("7. die funktionale Prüfung auf Staging", () => {
  const tool = readFileSync("tools/verify-purchase-from-calculation.mts", "utf8");

  it("fährt nur gegen Staging, und der Riegel steht vor jedem Client", () => {
    expect(tool).toContain('requireStaging("verify:purchase-from-calculation")');
    const riegel = tool.indexOf("requireStaging(");
    expect(riegel).toBeLessThan(tool.indexOf("serviceClient()"));
  });

  it("behauptet Rechte nur mit echten Benutzer-JWT", () => {
    /* Die Dienstrolle legt Konten an, liest Gegenwerte und räumt auf. Jede
       Aussage über „darf nicht" fällt mit einer angemeldeten Sitzung. */
    expect(tool).toContain("signInWithPassword");
    expect(tool).toContain("ruf(fremd.client");
    expect(tool).toContain("ruf(betrieb.client");
  });

  it("räumt alles wieder weg und zählt es nach", () => {
    expect(tool).toContain("} finally {");
    expect(tool).toContain('from("purchases").delete().eq("id", id)');
    expect(tool).toContain('from("purchase_calculations").delete().eq("id", id)');
    expect(tool).toContain("deleteUser");
    expect(tool).toContain("die Bestaende sind wieder die von vorher");
  });

  it("löscht ausschließlich eigene Kennungen", () => {
    /* Kein `delete` ohne `eq`, kein `ilike`, kein Löschen nach Datum: was
       dieser Lauf nicht angelegt hat, fasst er nicht an. */
    const loeschen = [...tool.matchAll(/\.delete\(\)([^;]*);/g)].map((m) => m[1]);
    expect(loeschen.length).toBeGreaterThan(0);
    for (const l of loeschen) expect(l, l).toContain(".eq(");
  });

  it("ein Abfragefehler kann nicht als „0 Zeilen“ durchgehen", () => {
    /*
     * DER FEHLER AUS DEM ERSTEN LAUF. Die Datei fragte nach `booked_at` —
     * eine Spalte, die es nicht gibt. PostgREST antwortete `42703`, `data`
     * war `undefined`, zwei Prüfungen lasen das als „0 Positionen", und
     * eine dritte meldete „Zeile für Zeile dieselben", weil beide Abfragen
     * gleich leer waren. Ein grüner Haken, der nichts geprüft hat.
     */
    expect(tool).toContain("const wirftNicht =");
    expect(tool).toContain("die Abfrage selbst");
    /* Im CODE nicht mehr — im Kommentar steht der Hergang, und der soll
       dort stehen bleiben. */
    const code = tool.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");
    expect(code).not.toContain("booked_at");
    expect(code).toContain("movement_id");
    /* Und die Gleichheit zählt nur mit Inhalt. */
    expect(tool).toContain("positionen.length === 3 && handPositionen.length === 3");
  });

  it("vergleicht den Einkauf aus der Kalkulation mit einem von Hand", () => {
    expect(tool).toContain('rpc("seller_create_purchase_with_items"');
    expect(tool).toContain("DIE POSITIONEN SIND ZEILE FUER ZEILE DIESELBEN");
    /* Und prüft, dass der von Hand angelegte mit keiner Kalkulation
       verknüpft ist — die Verknüpfung entsteht nur auf dem einen Weg. */
    expect(tool).toContain("ist mit keiner Kalkulation verknuepft");
  });

  it("prüft die Belegsperre und dass nichts eingebucht wird", () => {
    expect(tool).toContain('rpc("issue_platform_receipt"');
    expect(tool).toContain("Kaufen ist nicht Einlagern");
  });
});
