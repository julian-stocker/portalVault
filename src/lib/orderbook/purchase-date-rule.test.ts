/**
 * Das Kaufdatum: fehlend, ungültig, gültig — und dieselbe Regel in vier
 * Schichten.
 *
 * WARUM DIESE DATEI DIE SQL MITLIEST. Die Regel steht im Formular, in der
 * Server Action und in `seller_create_purchase_with_items`. Drei Kopien einer
 * Regel sind drei Regeln, sobald eine davon angefasst wird. Die Tests unten
 * vergleichen die Grenzen der TypeScript-Regel mit den Grenzen in der
 * Migration, statt beide separat zu beschreiben.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import {
  EARLIEST_PURCHASE_DATE, purchaseDateProblem,
} from "@/lib/orderbook/purchase-date-rule";
import { allMigrations, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const FORM = read("src/components/business/new-purchase.tsx");
const ACTIONS = read("src/lib/orderbook/actions.ts");
const SQL = migrationSource("0120_purchase_states_and_idempotency.sql");

/** Ein fester Tag, damit „heute" im Test nicht von der Uhr abhängt. */
const TODAY = new Date("2026-10-13T12:00:00Z");

describe("die Datumsregel selbst", () => {
  it("ein fehlendes Datum ist etwas anderes als ein falsches", () => {
    expect(purchaseDateProblem("", TODAY)).toBe("required");
    expect(purchaseDateProblem("   ", TODAY)).toBe("required");
    expect(purchaseDateProblem(null, TODAY)).toBe("required");
    expect(purchaseDateProblem(undefined, TODAY)).toBe("required");
    /*
     * Zwei Gründe und nicht einer: „vergessen" und „kann kein Datum sein"
     * werden verschieden behoben, und der Betreiber liest zwei verschiedene
     * Sätze.
     */
    expect(purchaseDateProblem("0202-03-14", TODAY)).toBe("invalid");
  });

  it("nimmt einen gültigen Tag an", () => {
    for (const ok of ["2026-10-13", "2011-01-01", "2024-02-29", "2019-12-31"]) {
      expect(purchaseDateProblem(ok, TODAY), ok).toBeNull();
    }
  });

  it("weist einen Tag ab, den der Kalender nicht hat", () => {
    /*
     * `new Date("2026-02-31")` wirft nicht — es rollt auf den 3. März weiter.
     * Genau deshalb vergleicht die Regel den zurückformatierten Tag mit dem
     * eingegebenen, statt sich auf `NaN` zu verlassen.
     */
    for (const bad of ["2026-02-31", "2026-13-01", "2023-02-29", "2026-00-10", "2026-04-00"]) {
      expect(purchaseDateProblem(bad, TODAY), bad).toBe("invalid");
    }
  });

  it("weist alles ab, was kein ISO-Tag ist", () => {
    for (const bad of ["13.10.2026", "2026-10", "26-10-13", "2026/10/13",
                       "heute", "2026-10-13T00:00", "20261013"]) {
      expect(purchaseDateProblem(bad, TODAY), bad).toBe("invalid");
    }
  });

  it("die Zukunft und die Zeit vor dem ersten Spiel sind beide draußen", () => {
    expect(purchaseDateProblem("2026-10-14", TODAY)).toBe("invalid");
    expect(purchaseDateProblem("2030-01-01", TODAY)).toBe("invalid");
    expect(purchaseDateProblem("2010-12-31", TODAY)).toBe("invalid");
    /* Die Grenzen selbst gehören dazu. */
    expect(purchaseDateProblem("2026-10-13", TODAY)).toBeNull();
    expect(purchaseDateProblem(EARLIEST_PURCHASE_DATE, TODAY)).toBeNull();
  });

  it("vergleicht Kalendertage, nicht Zeitzonen", () => {
    /*
     * Ein Betreiber am 13. um 23:30 Ortszeit darf den 13. eingeben, auch wenn
     * es in UTC schon der 14. ist. Deshalb wird „heute" aus den lokalen
     * Feldern des Datums gebaut und nicht aus `toISOString()`.
     */
    const lateEvening = new Date(2026, 9, 13, 23, 30, 0);
    expect(purchaseDateProblem("2026-10-13", lateEvening)).toBeNull();
  });
});

describe("dieselbe Regel in allen Schichten", () => {
  it("das Formular prüft vor allem anderen und setzt den Fokus", () => {
    const submit = FORM.slice(FORM.indexOf("function submit"));
    const check = submit.indexOf("purchaseDateProblem(date)");
    const costs = submit.indexOf("parseMoney");
    expect(check).toBeGreaterThan(-1);
    /* Vor der Betragsprüfung: sonst wird ein Betrag beanstandet und das
       fehlende Datum erst danach. */
    expect(check).toBeLessThan(costs);
    expect(submit).toContain("dateRef.current?.focus()");
  });

  it("das Feld ist rot, benannt und angekündigt", () => {
    const field = FORM.slice(FORM.indexOf("copy.columns.date"));
    const inside = field.slice(0, field.indexOf("</Field>"));
    expect(inside).toContain("required");
    expect(inside).toContain("aria-invalid");
    expect(inside).toContain('aria-describedby={dateProblem === null ? undefined : "new-purchase-date-error"}');
    expect(inside).toContain('id="new-purchase-date-error"');
    expect(inside).toContain('role="alert"');
    expect(inside).toContain("DATE_BAD");
    /*
     * Und die rote Fassung ersetzt die normale, statt sie zu überschreiben:
     * zwei Ring-Utilities an einem Element entscheidet die Reihenfolge im
     * Stylesheet, nicht die im Attribut.
     */
    expect(FORM).toContain("const DATE_OK = `${DATE_BASE} ring-1 ring-border/70`");
    expect(FORM).toContain("const DATE_BAD = `${DATE_BASE} ring-2 ring-danger`");
    expect(FORM).not.toContain("${INPUT} ring-danger");
  });

  it("die Server Action prüft noch einmal, mit derselben Funktion", () => {
    expect(ACTIONS).toContain('from "@/lib/orderbook/purchase-date-rule"');
    expect(ACTIONS).toContain("const dateProblem = purchaseDateProblem(purchasedAt);");
    /*
     * Und der Typ lässt `null` nicht mehr durch — beim ANLEGEN. Die
     * Korrekturfunktion `setPurchaseDate` behält `string | null` ausdrücklich:
     * dort heisst null „Datum entfernen", und das bleibt erlaubt.
     */
    expect(ACTIONS).toContain("createPurchaseWithItems(\n  purchasedAt: string,");
    const create = ACTIONS.slice(ACTIONS.indexOf("export async function createPurchaseWithItems"));
    expect(create.slice(0, create.indexOf(") {"))).not.toContain("| null");
    expect(ACTIONS).toContain("setPurchaseDate(id: number, purchasedAt: string | null)");
  });

  it("die Grenzen in der SQL sind dieselben wie in TypeScript", () => {
    expect(SQL).toContain(`date '${EARLIEST_PURCHASE_DATE}'`);
    expect(SQL).toContain("p_purchased_at > current_date");
    expect(SQL).toContain("p_purchased_at is null");
    expect(SQL).toContain("a purchase needs its date");
  });

  it("und beide Meldungen sind Sätze, keine Codes", () => {
    const errors = de.business.orderbook.errors;
    expect(errors.dateRequired).toContain("Kaufdatum");
    expect(errors.dateImplausible).toContain("2011");
    expect(errors.dateRequired).not.toBe(errors.dateImplausible);
    for (const text of [errors.dateRequired, errors.dateImplausible]) {
      expect(text).not.toMatch(/constraint|invalid_parameter|23[0-9]{3}/);
    }
  });
});

describe("der Bestand bleibt unangetastet", () => {
  it("die Spalte bleibt nullable — keine Migration macht sie zur Pflicht", () => {
    expect(allMigrations).not.toMatch(/alter column purchased_at set not null/);
    /* Und 0120 prüft es nach dem Lauf selbst. */
    expect(SQL).toContain("purchases.purchased_at ist NOT NULL geworden");
  });

  it("genau eine Migration kennt den Riegel, und es ist nicht der Importpfad", () => {
    expect(migrationFiles.filter((f) => migrationSource(f).includes("a purchase needs its date")))
      .toEqual(["0120_purchase_states_and_idempotency.sql"]);
    const base = latestFunction("seller_create_purchase").body;
    expect(base).not.toContain("a purchase needs its date");
    expect(migrationSource("0053_orderbook_purchases.sql"))
      .not.toContain("a purchase needs its date");
  });

  it("der Korrekturpfad behält seine Datumsfreiheit", () => {
    /*
     * `seller_update_purchase` schreibt `coalesce(p_purchased_at,
     * p.purchased_at)`: NULL heisst „nicht anfassen". Der eine echte
     * undatierte Einkauf bleibt damit erhalten UND korrigierbar — er bekommt
     * ein Datum, sobald eines bekannt ist.
     */
    const update = latestFunction("seller_update_purchase").body;
    expect(update).toContain("coalesce(p_purchased_at, p.purchased_at)");
    expect(update).not.toContain("a purchase needs its date");
  });

  it("der Filter für undatierte Einkäufe bleibt", () => {
    const ledger = latestFunction("seller_orderbook_ledger").body;
    expect(ledger).toContain("p_undated");
    expect(ledger).toContain("p.purchased_at is null");
  });
});

describe("die Prüfwerkzeuge kennen die neue Pflicht", () => {
  const VERIFY_ITEMS = read("tools/verify-purchase-items.mts");
  const VERIFY_SETTLED = read("tools/verify-settled.mts");
  const TRANSFER = read("tools/transfer-to-production.mts");

  it("kein Werkzeug übergibt mehr ein leeres Kaufdatum", () => {
    /*
     * Fünf Aufrufstellen trugen `p_purchased_at: null` und wären nach 0120
     * alle abgebrochen. Das fiel in `npm run check` nicht auf, weil diese
     * Werkzeuge gegen Staging schreiben und dort nicht mitlaufen — genau
     * deshalb steht die Prüfung hier.
     */
    for (const [name, tool] of [["verify-purchase-items", VERIFY_ITEMS],
                                ["verify-settled", VERIFY_SETTLED],
                                ["transfer-to-production", TRANSFER]] as const) {
      expect(tool, name).not.toContain("p_purchased_at: null");
    }
  });

  it("beide Prüfwerkzeuge benutzen einen gültigen, reproduzierbaren Tag", () => {
    for (const [name, tool] of [["verify-purchase-items", VERIFY_ITEMS],
                                ["verify-settled", VERIFY_SETTLED]] as const) {
      expect(tool, name).toContain(
        "const PURCHASE_DATE = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)");
      expect(tool, name).toContain("p_purchased_at: PURCHASE_DATE");
      /* Und der Tag steht im Protokoll, damit ein Lauf nachvollziehbar ist. */
      expect(tool, name).toContain("${PURCHASE_DATE}");
    }
    /* Gestern, nicht heute: die Obergrenze ist `current_date` der DATENBANK,
       und ein Zeitzonenversatz würde sonst einen gültigen Tag ungültig
       machen. */
    expect(purchaseDateProblem(
      new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))).toBeNull();
  });

  it("die Rollback-Prüfung prüft den Fremdschlüssel, nicht das Datum", () => {
    /*
     * DER EIGENTLICHE PUNKT. Mit `p_purchased_at: null` hätte der
     * Datumsriegel zugeschlagen, bevor die ungültige Figur je erreicht wird —
     * „an invalid figure is refused" wäre grün gewesen, und die Atomarität
     * nie geprüft.
     */
    expect(VERIFY_ITEMS).toContain('const FK_VIOLATION = "23503"');
    expect(VERIFY_ITEMS).toContain("bad.error?.code === FK_VIOLATION");
    expect(VERIFY_ITEMS).toContain("AND FOR THE RIGHT REASON — the foreign key, not the date");
    expect(VERIFY_ITEMS).toContain('!(bad.error?.message ?? "").includes("needs its date")');
    /* Und der Datumsriegel wird namentlich ausgeschlossen, nicht nur
       implizit durch den Fremdschlüsselcode. */
    expect(VERIFY_ITEMS).toContain("bad.error?.code !== BAD_PARAMETER");
  });

  it("die Berechtigungsprüfungen prüfen den Berechtigungscode", () => {
    expect(VERIFY_ITEMS).toContain('const DENIED = "42501"');
    expect(VERIFY_ITEMS).toContain('const MISSING_FUNCTION = "PGRST202"');
    expect(VERIFY_ITEMS).toContain('const BAD_PARAMETER = "22023"');
    /* anon hat kein EXECUTE: 42501 oder — je Rolle gefilterter Schema-Cache —
       PGRST202. Beides eine Ablehnung, 22023 wäre keine. */
    expect(VERIFY_ITEMS).toContain(
      '[DENIED, MISSING_FUNCTION].includes(anonCreate.error?.code ?? "")');
    /* Das angemeldete Nicht-Betreiber-Konto erreicht den Rumpf und wird vom
       Gate abgelehnt: genau 42501. */
    expect(VERIFY_ITEMS).toContain("outCreate.error?.code === DENIED");
  });

  it("und jeder dieser Codes ist genau einmal definiert", () => {
    /* Die Lehre aus 0117: ein Name, eine Bedeutung. */
    for (const name of ["DENIED", "MISSING_FUNCTION", "BAD_PARAMETER", "FK_VIOLATION"]) {
      expect(VERIFY_ITEMS.split(`const ${name} =`), name).toHaveLength(2);
    }
  });

  it("transfer-to-production prüft die Existenz jetzt LESEND", () => {
    /*
     * Vorher: ein Aufruf von `seller_create_purchase_with_items` gegen
     * Production, nur um `PGRST202` auszuschliessen — und damit ein
     * Schreibzugriff als Existenzsonde. Die anderen sechs Sonden rufen
     * lesende Funktionen mit `p_id: -1`.
     */
    expect(TRANSFER).not.toContain('"seller_create_purchase_with_items", { p_purchased_at');
    expect(TRANSFER).toContain("async function exposedFunctions");
    expect(TRANSFER).toContain("/rest/v1/");
    expect(TRANSFER).toContain('rpcs.has(fn)');
    /* Und die Sonde steht nicht mehr in der aufrufenden Liste. */
    const probes = TRANSFER.slice(TRANSFER.indexOf("const SCHEMA_PROBES"));
    expect(probes.slice(0, probes.indexOf("];"))).not.toContain("seller_create_purchase_with_items\"");
  });

  it("der Importpfad bleibt datumsfrei — er muss es sein", () => {
    /*
     * `tools/import-orderbook.mts` ruft `seller_import_purchase_group`, nicht
     * die geänderte Funktion. Die dreizehn undatierten `#REF!`-Gruppen der
     * Arbeitsmappe bleiben damit importierbar.
     */
    const importer = read("tools/import-orderbook.mts");
    expect(importer).toContain('rpc("seller_import_purchase_group"');
    expect(importer).not.toContain("seller_create_purchase_with_items");
    expect(importer).toContain("p_purchased_at: plan.date");
  });
});
