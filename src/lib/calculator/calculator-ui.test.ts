import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Der Kalkulator als Bauteil: wer ihn sieht, woher er seine Zahlen nimmt,
 * und was er nicht anfasst.
 *
 * Dieses Projekt rendert in Tests nicht — `vitest.config.mts` sammelt
 * `*.test.ts`, es gibt kein DOM. Die Rechnung selbst ist deshalb eine reine
 * Funktion mit eigenen Tests (`calculation.test.ts`); hier steht, was nur
 * die Quelle beantworten kann.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** Ohne Kommentare: die Prosa nennt genau die Wörter, die hier gesucht werden. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NAV = "src/components/layout/site-nav.tsx";
const LAUNCHER = "src/components/calculator/calculator-launcher.tsx";
const MODAL = "src/components/calculator/calculator-modal.tsx";
const ACTIONS = "src/lib/calculator/actions.ts";
const QUERIES = "src/lib/orderbook/queries.ts";

describe("nur ein Betrieb sieht den Kalkulator", () => {
  const nav = code(NAV);

  it("hängt das Symbol an dieselbe Fähigkeit wie den Betriebsbereich", () => {
    // Keine zweite Rollenlogik: `business` ist das Flag, das auch /business
    // freischaltet (ADR-0077).
    expect(nav).toContain("{business ? <CalculatorLauncher /> : null}");
  });

  it("zeigt es der Kundschaft nicht", () => {
    /*
     * Die Bedingung ist `business`, nicht `signedIn` und nicht `admin`. Ein
     * angemeldeter Sammler und ein Plattformadmin ohne Betriebsrolle
     * bekommen denselben Kopf wie vorher.
     */
    const at = nav.indexOf("CalculatorLauncher />");
    const condition = nav.slice(nav.lastIndexOf("{", at), at);
    expect(condition).toContain("business");
    expect(condition).not.toContain("signedIn");
    expect(condition).not.toContain("admin");
  });

  it("steht in der Aktionsreihe des Kopfes, nicht in der Navigation", () => {
    // Die untere Leiste sagt, wo man ist; der Kopf, was man tun kann.
    const actions = nav.indexOf('className="ml-auto flex min-w-0 items-center');
    expect(nav.indexOf("CalculatorLauncher />")).toBeGreaterThan(actions);
  });

  it("die Sichtbarkeit ist Bequemlichkeit, die Grenze steht auf dem Server", () => {
    // `fetchOrderbookCatalog` fragt `canOperateSeller()`, bevor es liest —
    // ein Kunde, der das Bauteil erzwänge, bekäme eine leere Liste.
    expect(code(QUERIES)).toContain("if (!(await canOperateSeller())) return [];");
    expect(code(ACTIONS)).toContain("fetchOrderbookCatalog()");
  });
});

describe("öffnen und schließen", () => {
  const launcher = code(LAUNCHER);
  const modal = code(MODAL);

  it("der Knopf sagt einem Screenreader, dass er einen Dialog öffnet", () => {
    expect(launcher).toContain('aria-haspopup="dialog"');
    expect(launcher).toContain("aria-expanded={open}");
    expect(launcher).toContain("aria-label={de.calculator.openLabel}");
  });

  it("baut das Fenster erst beim ersten Druck", () => {
    // Wer nie rechnet, lädt weder Modal noch Katalog.
    expect(launcher).toContain("lazy(");
    expect(launcher).toContain("setMounted(true)");
  });

  it("benutzt den Dialog des Projekts, nicht einen eigenen", () => {
    // Escape, Fokus, Portal und Hintergrund liegen dort schon richtig.
    expect(modal).toContain('from "@/components/ui/modal"');
    expect(modal).toContain("<Modal open={open}");
    expect(modal).toContain("labelledBy={headingId}");
  });

  it("nimmt die breite Fläche, weil vier Bereiche gleichzeitig sichtbar sein müssen", () => {
    expect(modal).toContain('size="xl"');
    expect(code("src/components/ui/modal.tsx")).toContain("xl:");
  });

  it("hält die Kalkulation über ein Schließen hinweg", () => {
    // Das Modal bleibt montiert; nur `open` wechselt.
    expect(launcher).toContain("{mounted ? (");
    expect(launcher).toContain("open={open}");
  });
});

describe("die Figuren kommen aus dem Katalog des Projekts", () => {
  const modal = code(MODAL);

  it("benutzt die vorhandene Figurensuche mit ihrer Tastaturführung", () => {
    expect(modal).toContain("<FigureSearch");
    expect(modal).toContain('from "@/components/business/figure-search"');
  });

  it("baut keine zweite Suchlogik", () => {
    for (const own of ["searchFigures", "rankFigure", "toLowerCase().includes"]) {
      expect(modal).not.toContain(own);
    }
  });

  it("zeigt in den Treffern ein Bild — dafür gibt es die Zusatzangabe", () => {
    expect(modal).toContain("showImage");
    const search = code("src/components/business/figure-search.tsx");
    // Aus für alle bestehenden Aufrufer, an nur für den Kalkulator.
    expect(search).toContain("showImage = false");
  });

  it("holt den Katalog erst beim Öffnen und genau einmal", () => {
    expect(modal).toContain("loadCalculatorContext()");
    expect(modal).toContain("if (!open || catalog !== null) return;");
  });

  it("das Suchfeld trägt den Ablauf: Enter wählt, dann ist es wieder leer", () => {
    // Das kann die gemeinsame Suche seit 0064, und genau deshalb wird sie
    // benutzt statt einer eigenen. Der Fokus beim Öffnen hat einen eigenen
    // Test weiter unten — er braucht mehr als `autoFocus`.
    const search = code("src/components/business/figure-search.tsx");
    expect(search).toContain('event.key === "Enter"');
    expect(search).toContain("input.current?.focus();");
    expect(search).toContain('event.key === "ArrowDown"');
  });
});

describe("die Preisquelle ist der Marktwert, und nur der", () => {
  const modal = code(MODAL);
  const calculation = code("src/lib/calculator/calculation.ts");

  it("rechnet mit `marketPrice` aus dem Katalog", () => {
    expect(calculation).toContain("euroToCents(choice.marketPrice)");
  });

  it("fasst den Shoppreis nicht an", () => {
    /*
     * `shop_price()` ist die Verkaufsseite des Betriebs und für ein Paket,
     * das er gerade erst kaufen will, ohnehin meist gar nicht definiert:
     * die Figuren liegen noch nicht im Lager.
     */
    for (const file of [modal, calculation]) {
      expect(file).not.toContain("shop_price");
      expect(file).not.toContain("sale_price");
      expect(file).not.toContain("salePrice");
    }
  });

  it("wendet den Katalog-Aufschlag aus 0094 nicht an", () => {
    // Der ist ausdrücklich eine Anzeigeeinstellung; dieselbe Migration nennt
    // den Buy-in-Faktor als unberührt.
    for (const file of [modal, calculation]) {
      expect(file).not.toContain("marketBoost");
      expect(file).not.toContain("market_boost");
    }
  });
});

describe("die Zahlen auf dem Schirm", () => {
  const modal = code(MODAL);

  it("zeigt Positionen, Stück und Gesamtwert dauerhaft", () => {
    for (const key of ["positionsLabel", "unitsLabel", "totalLabel"]) {
      expect(modal).toContain(`copy.${key}`);
    }
  });

  it("hebt den maximalen Einkaufspreis als einzige Zahl hervor", () => {
    expect(modal).toContain("copy.maxPurchase");
    expect(modal).toContain("COMMERCE_INK");
    expect(modal).toContain("text-2xl");
  });

  it("macht den Kalkulationsfaktor mit einem Druck veränderbar", () => {
    expect(modal).toContain("FACTOR_PRESETS");
    expect(modal).toContain("parseFactor");
  });

  it("stellt den historischen Faktor als Referenz neben das Feld", () => {
    expect(modal).toContain("copy.historicFactor(historicFactor)");
    // Das editierbare Feld bleibt ein Feld und behält seine Beschriftung.
    expect(modal).toContain('htmlFor="calc-factor"');
    expect(modal).toContain("copy.factorLabel");
  });

  it("gibt den Rückfallwert nicht als historischen Wert aus", () => {
    expect(modal).toContain("historicFactor === null");
    expect(modal).toContain("copy.historicFactorNone");
    expect(de.calculator.historicFactorNone).not.toContain("50");
    expect(de.calculator.historicFactor(43)).toContain("43");
  });

  it("nennt den maximalen Einkaufspreis eine Rechnung, kein Angebot", () => {
    expect(de.calculator.maxPurchaseHint).toContain("Rechnerischer Wert");
  });

  it("sagt, dass nichts gespeichert wird", () => {
    expect(de.calculator.hint).toContain("nichts gespeichert");
  });

  it("meldet den Stand, weil der Ablauf reine Tastatur ist", () => {
    // Ohne das wächst die Liste für einen Screenreader lautlos.
    expect(modal).toContain('role="status"');
    expect(modal).toContain('aria-live="polite"');
  });

  it("fokussiert das Suchfeld nach dem Dialog, nicht per autoFocus", () => {
    /*
     * `Modal` holt den Fokus in seinem eigenen Effekt auf das Panel, und
     * Kindeffekte laufen zuerst — ein `autoFocus` wäre danach überschrieben,
     * und genau das Feld, in das man sofort tippen will, hätte den Fokus
     * nicht.
     */
    expect(modal).toContain("inputRef={searchInput}");
    expect(modal).toContain("searchInput.current?.focus();");
    expect(modal).not.toContain("autoFocus");
  });
});

describe("der Kalkulator schreibt nirgends hin", () => {
  const files = [MODAL, LAUNCHER, ACTIONS, "src/lib/calculator/calculation.ts"];

  it("fasst weder Lager noch Bewegungen, Bestellungen oder den Warenkorb an", () => {
    for (const file of files) {
      const text = code(file);
      for (const forbidden of [
        "shop_inventory", "inventory_movements", "set_shop_listing", "adjust_stock",
        "order_lines", "create_order", "useCart", "addToCart", "start_payment",
        "stripe", "issue_invoice", "market_price\" ,", "update(",
      ]) {
        expect(text.includes(forbidden), `${file} darf ${forbidden} nicht enthalten`).toBe(false);
      }
    }
  });

  it("die einzige Serverfunktion liest und gibt Katalog und Faktor zurück", () => {
    const actions = code(ACTIONS);
    expect(actions).toContain('"use server"');
    // Genau ein Endpunkt. Eine `"use server"`-Datei macht aus jedem Export
    // einen, deshalb ist die Anzahl hier eine Aussage über die Angriffsfläche.
    expect(actions.match(/^export async function/gm)).toHaveLength(1);
    expect(actions).toContain("loadCalculatorContext");
    for (const write of ["insert", "update", "delete", "upsert"]) {
      expect(actions.includes(write), `actions.ts darf ${write} nicht enthalten`).toBe(false);
    }
    /*
     * Genau ein RPC, und es ist `stable` — ein SELECT über `purchases`.
     * `orderbook_global_factor` ist die einzige Funktion, die dieser Weg
     * ruft; alles andere geht über `fetchOrderbookCatalog`.
     */
    const rpcs = actions.match(/\.rpc\("([a-z_]+)"/g) ?? [];
    expect(rpcs).toEqual(['.rpc("seller_buy_in_factor"']);
  });

  it("legt keine Tabelle an — V1 lebt im Browser", () => {
    // Keine Migration gehört zu diesem Feature.
    const migrations = readFileSync("docs/DATABASE.md", "utf8");
    expect(migrations).not.toContain("calculator");
  });
});

describe("der historische Faktor wird gelesen und nicht berührt", () => {
  const actions = code(ACTIONS);
  const modal = code(MODAL);

  it("kommt aus der bestehenden Orderbuch-Rechnung, nicht aus einer Kopie", () => {
    /*
     * Seit 0103 über `seller_buy_in_factor()` — den Wächter davor. Der
     * ruft `orderbook_global_factor()` auf; die Formel bleibt die eine, die
     * seit 0059 in der Datenbank steht.
     */
    expect(actions).toContain('supabase.rpc("seller_buy_in_factor")');
    // Die Formel selbst — Ausgaben ÷ bekannter Marktwert — wird nirgends
    // in TypeScript nachgebaut.
    for (const file of [actions, modal, code("src/lib/calculator/calculation.ts")]) {
      expect(file).not.toContain("total_cost");
      expect(file).not.toContain("purchase_market_value");
      expect(file).not.toContain("known_value");
    }
  });

  it("wird nur einem Betrieb verraten", () => {
    /*
     * `orderbook_global_factor()` trägt seit 0059 `grant execute … to
     * authenticated` und keinen Rollenwächter im Rumpf. Zu welchem Anteil
     * am Marktwert ein Betrieb einkauft, ist ein Geschäftsgeheimnis, also
     * prüft dieser Weg selbst, bevor er fragt.
     */
    expect(actions).toContain("if (!(await canOperateSeller())) return null;");
    const at = actions.indexOf("canOperateSeller()");
    expect(at).toBeLessThan(actions.indexOf('supabase.rpc("seller_buy_in_factor")'));
  });

  it("setzt den Startwert genau einmal, beim Laden", () => {
    expect(modal).toContain("setFactor(initialFactor(context.historicFactor))");
    // Danach gehört das Feld dem Menschen: kein Effekt schreibt es zurück.
    expect(modal.match(/setFactor\(initialFactor/g)).toHaveLength(1);
  });

  it("schreibt beim Laden oder Verstellen nichts", () => {
    for (const write of ["insert", "update", "upsert", "delete", "seller_create_sale",
                         "seller_update_sale", "buy_in_factor_snapshot"]) {
      expect(actions.includes(write), `actions.ts darf ${write} nicht enthalten`).toBe(false);
    }
    // Der Faktor ist reiner Browserzustand.
    expect(modal).toContain("useState<number>(FALLBACK_FACTOR)");
  });
});

describe("eine Kalkulation überlebt das Schließen", () => {
  const launcher = code(LAUNCHER);
  const modal = code(MODAL);

  it("das Fenster bleibt eingehängt, nur `open` wechselt", () => {
    /*
     * Dreißig getippte Figuren dürfen nicht an einem versehentlichen Escape
     * hängen. `mounted` wird beim ersten Öffnen wahr und nie wieder falsch,
     * also behält `CalculatorModal` seinen Zustand.
     */
    expect(launcher).toContain("setMounted(true)");
    expect(launcher).not.toContain("setMounted(false)");
    expect(launcher).toContain("onClose={() => setOpen(false)}");
  });

  it("die Positionen liegen im Fenster, nicht im Knopf", () => {
    expect(modal).toContain("useState<CalculationLine[]>([])");
    expect(launcher).not.toContain("CalculationLine");
  });

  it("nur das bewusste Leeren entfernt sie, und erst nach Rückfrage", () => {
    expect(modal).toContain("onClearConfirm={() => { setLines([]); setConfirmClear(false); }}");
    expect(modal).toContain("copy.clearConfirm(positions)");
    // Das Schließen selbst räumt nur die begonnene Rückfrage weg.
    expect(modal).toContain("setConfirmClear(false);\n    onClose();");
  });

  it("ein Neuladen darf sie verlieren — V1 speichert bewusst nicht", () => {
    for (const file of [modal, launcher, code("src/lib/calculator/calculation.ts"),
                        code("src/lib/calculator/actions.ts")]) {
      expect(file).not.toContain("localStorage");
      expect(file).not.toContain("sessionStorage");
      expect(file).not.toContain("indexedDB");
    }
  });
});

/**
 * Das Fenster bei fünfzehn bis dreißig Figuren.
 *
 * Alles hier sind echte Layoutfehler, keine Geschmacksfragen: sie treten
 * erst bei einer langen Liste auf, und genau dafür ist das Werkzeug gebaut.
 */
describe("die Geometrie hält eine lange Liste aus", () => {
  const modal = code(MODAL);

  it("schließt die Höhenkette, sonst rollt die Liste nicht, sondern wird abgeschnitten", () => {
    // Das Panel deckelt und versteckt Überlauf; ohne `flex-1` bliebe dieser
    // Kasten inhaltsgroß und der Fuß mit der wichtigsten Zahl ausser Sicht.
    expect(modal).toContain('className="flex min-h-0 flex-1 flex-col"');
    expect(modal).toContain('className="min-h-0 flex-1 overflow-y-auto');
  });

  it("hält Suche und Zusammenfassung stehen, während nur die Liste rollt", () => {
    const search = modal.indexOf("<FigureSearch");
    const list = modal.indexOf("min-h-0 flex-1 overflow-y-auto");
    const summary = modal.indexOf("<Summary");
    expect(search).toBeLessThan(list);
    expect(list).toBeLessThan(summary);
    // Beide Ränder sind `shrink-0`, also drückt die Liste sie nicht weg.
    expect(modal).toContain("shrink-0 overflow-y-auto border-b");
    expect(modal).toContain('<footer className="shrink-0 border-t');
  });

  it("lässt die Treffer den Dialog nicht auffressen", () => {
    expect(modal).toContain("max-h-[45dvh]");
    expect(modal).toContain("limit={CALC_RESULTS}");
    expect(modal).toContain("const CALC_RESULTS = 6;");
  });

  it("lässt die Menge tippen, ohne beim Leeren auf 1 zu springen", () => {
    // Ein gebundenes `type="number"` macht aus `Number("")` NaN und damit
    // sofort wieder 1 — man könnte keine zweistellige Menge eintippen.
    expect(modal).not.toContain('type="number"');
    expect(modal).toContain("qtyDraft");
    expect(modal).toContain('if (raw.trim() !== "") onQuantitySet(Number(raw));');
  });

  it("nimmt deutsche Beträge im Wertfeld an", () => {
    expect(modal).toContain('inputMode="decimal"');
    expect(modal).toContain("parseAmountToCents");
  });
});
