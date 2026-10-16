import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { RECEIPT_ISSUANCE_RELEASED } from "./receipt-release";
import { de } from "@/lib/i18n/de";

/**
 * Die Ausstellung von Eigenbelegen ist in der Oberfläche ausgeblendet, bis
 * Freigabe B erteilt ist.
 *
 * WAS HIER GEPRÜFT WIRD — UND WAS NICHT
 *
 * Diese Konstante ist **nicht** die Sperre. Die Sperre ist ein `revoke
 * execute` in der Datenbank (`supabase/operations/lock-receipt-issuance.sql`)
 * und nimmt jeder API-Rolle das Recht. Würde die Konstante versehentlich
 * umgestellt, lehnte PostgreSQL mit 42501 ab, und
 * `receipt-actions.ts` zeigt dafür „Dafür fehlt die Berechtigung."
 *
 * Geprüft wird deshalb zweierlei: dass die Oberfläche keinen Ausstellweg mehr
 * anbietet, und dass sie den **Abruf bestehender Belege** nicht mitnimmt —
 * ein ausgestelltes Dokument muss abrufbar bleiben.
 */
const DIALOG = readFileSync(
  "src/components/business/purchase-details.tsx", "utf8");

describe("bis Freigabe B ist die Ausstellung ausgeblendet", () => {
  it("die Freigabe steht auf false", () => {
    expect(RECEIPT_ISSUANCE_RELEASED).toBe(false);
  });

  it("und sie liegt in einem eigenen Modul, nicht bei den PDF-Renderern", () => {
    /*
     * `purchase-receipt.ts` zieht beide PDF-Formate herein. Ein Import von
     * dort in eine Client-Komponente trüge den ganzen PDF-Code in das
     * Browser-Bundle — für einen Boolean.
     */
    const modul = readFileSync("src/lib/business/receipt-release.ts", "utf8");
    expect(modul).not.toContain("receipt-format-v1");
    expect(modul).not.toContain("receipt-format-v2");
    expect(modul.split("\n").filter((z) => z.startsWith("import")))
      .toEqual([]);
    expect(DIALOG).toContain(
      'import { RECEIPT_ISSUANCE_RELEASED } from "@/lib/business/receipt-release"');
  });

  it("der Dialog hängt den Ausstellknopf an die Freigabe", () => {
    /* Derselbe Knopf stellt aus (ohne Beleg) oder lädt herunter (mit Beleg).
       Ohne Freigabe darf nur der zweite Fall übrig bleiben. */
    expect(DIALOG).toContain(
      "{!RECEIPT_ISSUANCE_RELEASED && receipt === null ? (");
    expect(DIALOG).toContain("{receiptCopy.issuanceLocked}");
  });

  it("und den Korrekturknopf ebenso", () => {
    expect(DIALOG).toContain(
      "{RECEIPT_ISSUANCE_RELEASED\n                 && receipt !== null && correctable");
  });

  it("der Satz steht in de.ts und nennt beides: gesperrt und abrufbar", () => {
    const text = de.business.orderbook.receipt.issuanceLocked;
    expect(text).toContain("noch nicht freigegeben");
    expect(text).toContain("herunterladen");
  });

  /* ------------------------------------------------- was NICHT gesperrt ist */

  it("ein bestehender Beleg bleibt herunterladbar", () => {
    /*
     * Mit `receipt !== null` greift der `else`-Zweig, und der Knopf trägt die
     * Herunterladen-Beschriftung. Der Ausstellaufruf steckt in
     * `fetchReceipt()` hinter `receipt === null` — er ist dann unerreichbar.
     */
    const zweig = DIALOG.slice(DIALOG.indexOf("{!RECEIPT_ISSUANCE_RELEASED && receipt === null"));
    expect(zweig.slice(0, 700)).toContain("receiptCopy.download");
    expect(zweig.slice(0, 700)).toContain("void fetchReceipt()");
  });

  it("die Abrufknöpfe der älteren Fassungen bleiben unberührt", () => {
    /* Die Historie lädt eine bestimmte Fassung — immer ein Abruf, nie eine
       Ausstellung. Sie darf nicht an der Freigabe hängen. */
    const historie = DIALOG.slice(DIALOG.indexOf("downloadVersion"));
    expect(historie).toContain("void fetchReceipt({");
    expect(historie.slice(0, 600)).not.toContain("RECEIPT_ISSUANCE_RELEASED");
  });

  it("sonst ist am Dialog nichts gesperrt", () => {
    /*
     * Einkaufsbearbeitung, Figurenwechsel, Positionen, Sicherung bleiben
     * unberührt: im ausführbaren Code (ohne Kommentare) kommt die Freigabe
     * genau dreimal vor — der Import und die zwei Tore am Belegblock.
     */
    const ohneProsa = DIALOG.replace(/\/\*[\s\S]*?\*\//g, "")
                            .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(ohneProsa.split("RECEIPT_ISSUANCE_RELEASED").length - 1).toBe(3);
  });

  /* --------------------------------------------- die Datenbank bleibt Chef */

  it("die Datenbanksperre nennt beide Funktionen und jede API-Rolle", () => {
    const sperre = readFileSync(
      "supabase/operations/lock-receipt-issuance.sql", "utf8");
    expect(sperre).toContain(
      "from public, anon, authenticated, service_role");
    expect(sperre).toContain("public.seller_issue_purchase_receipt(bigint)");
    expect(sperre).toContain(
      "public.seller_issue_purchase_receipt_correction(bigint)");
  });

  it("und 42501 wird dem Betreiber als Satz gezeigt", () => {
    const aktionen = readFileSync("src/lib/business/receipt-actions.ts", "utf8");
    expect(aktionen).toContain('error?.code === "42501"');
    expect(de.admin.notAllowed).toBe("Dafür fehlt die Berechtigung.");
  });

  it("das Modul sagt, dass es NICHT die Sperre ist", () => {
    const modul = readFileSync("src/lib/business/receipt-release.ts", "utf8");
    expect(modul).toContain("lock-receipt-issuance.sql");
    expect(modul).toContain("the protection is a");
    expect(modul).toContain("database grant");
    expect(modul).toContain("42501");
  });
});
