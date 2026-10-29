import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * CAT-05D — die drei Handlungen an der Katalogzeile.
 *
 * Geprüft wird, was die Oberfläche ZUSAGT, und das steht in ihrem Quelltext:
 * welches Icon wann erscheint, dass nur das Löschen fragt, dass die
 * Berührungsflächen 44 px halten, und dass keine der drei Handlungen mehr
 * darf als die Datenbank.
 */
const lies = (p: string) => readFileSync(p, "utf8");
const ROW = lies("src/components/admin/row-actions.tsx");
const DIALOG = lies("src/components/admin/draft-dialog.tsx");
const LISTE = lies("src/app/(admin)/admin/catalog/page.tsx");
const AKTIONEN = lies("src/lib/admin/actions.ts");
const M0155 = lies("supabase/migrations/0155_discard_draft.sql");

describe("die drei Icons", () => {
  it("stehen in der Reihenfolge zusammenführen, bearbeiten, löschen", () => {
    const merge = ROW.indexOf("lucide git-merge");
    const stift = ROW.indexOf("lucide pencil");
    const tonne = ROW.indexOf("lucide trash-2");
    expect(merge).toBeGreaterThan(-1);
    expect(stift).toBeGreaterThan(merge);
    expect(tonne).toBeGreaterThan(stift);
  });

  it("zusammenführen und löschen nur bei Entwürfen, bearbeiten immer", () => {
    /*
     * Ein Icon, das nur zum Scheitern da ist, ist eine schlechte
     * Oberfläche: `0154` und `0155` weisen beides bei einer öffentlichen
     * Figur ohnehin ab.
     */
    const bedingte = [...ROW.matchAll(/\{istEntwurf \? \(/g)];
    expect(bedingte).toHaveLength(2);
    /* Der Stift steht außerhalb jeder Bedingung. */
    const stift = ROW.indexOf("lucide pencil");
    const zweite = ROW.indexOf("{istEntwurf ? (", ROW.indexOf("{istEntwurf ? (") + 1);
    expect(stift).toBeLessThan(zweite);
  });

  it("tragen Tooltip und aria-label, und das Icon selbst ist versteckt", () => {
    for (const wort of ["rowMerge", "rowEdit", "rowDiscard"]) {
      expect(ROW, wort).toContain(`de.admin.${wort}`);
    }
    expect(ROW).toContain('title={de.admin.rowMerge}');
    expect(ROW).toContain('aria-label={`${de.admin.rowMerge}');
    expect(ROW).toContain('"aria-hidden": "true"');
  });

  it("sind 44 px groß und dauerhaft sichtbar", () => {
    expect(ROW).toContain("size-11");
    /* Keine Sichtbarkeit erst beim Hover — nur die FARBE ändert sich. */
    expect(ROW).not.toMatch(/opacity-0|invisible|group-hover:opacity/);
    expect(ROW).toContain("hover:text-foreground");
  });

  it("der Papierkorb wird erst bei Hover oder Fokus rot", () => {
    expect(ROW).toContain("hover:text-danger");
    expect(ROW).toContain("focus-visible:text-danger");
  });

  it("jede Fläche ist mit der Tastatur erreichbar und zeigt den Fokus", () => {
    /* `focus-ring` ist die Projektklasse für den sichtbaren Fokus. */
    const flaechen = ROW.match(/focus-ring/g) ?? [];
    expect(flaechen.length).toBeGreaterThanOrEqual(3);
    /* Der Stift ist ein Link, die beiden anderen sind Knöpfe — kein `div`
       mit `onClick`, das keine Tastatur kennt. */
    expect(ROW).toContain("<Link");
    expect((ROW.match(/type="button"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("die Aktionsspalte bleibt schmal", () => {
    /* Die Tabelle ist schon breit; die Spalte bekommt kein zusätzliches
       Polster und die Icons stehen eng. */
    expect(ROW).toContain("gap-0.5");
    expect(LISTE).toContain('className="py-2 pl-1 text-right"');
    /* Und das bestehende waagerechte Scrollen bleibt. */
    expect(LISTE).toContain("overflow-x-auto");
  });
});

describe("nur das Löschen fragt nach", () => {
  it("mit Name und SKY-ID", () => {
    expect(ROW).toContain('role="alertdialog"');
    expect(ROW).toContain("discardConfirmTitle");
    expect(ROW).toContain("{figur.name}");
    expect(ROW).toContain("{figur.skyId}");
  });

  it("und sagt, was unwiderruflich ist", () => {
    const texte = lies("src/lib/i18n/de.ts");
    expect(texte).toContain("SKY-ID nie wieder vergeben");
    expect(texte).toContain("bleibt im Speicher liegen");
  });

  it("zusammenführen und bearbeiten fragen NICHT", () => {
    /* Genau ein `alertdialog` in der Zeile — der des Löschens. */
    expect((ROW.match(/alertdialog/g) ?? []).length).toBe(1);
    expect(DIALOG).not.toContain("alertdialog");
  });
});

describe("die Löschung ist serverseitig abgesichert", () => {
  it("vier Riegel in 0155, nicht in der Oberfläche", () => {
    expect(M0155).toContain("v_row.catalog_status <> 'draft'");
    expect(M0155).toContain("v_row.source <> 'admin'");
    /* Der dritte fragt nicht, was die Zeile IST, sondern was sie WAR: eine
       Figur, die einmal öffentlich stand, wird versteckt und nicht
       vernichtet. Das Journal aus `0152` weiß es. */
    expect(M0155).toContain("c.field = 'catalog_status' and c.old_value = 'public'");
    expect(M0155).toContain("admin_merge_references(p_draft)");
    expect(M0155).toContain("is_platform_admin()");
  });

  it("sie schreibt die Journalzeile VOR dem Löschen", () => {
    expect(M0155.indexOf("insert into public.catalog_admin_changes"))
      .toBeLessThan(M0155.indexOf("delete from public.skylanders"));
  });

  it("und rührt den Speicher nicht an — sie nennt den verwaisten Pfad", () => {
    /*
     * AUF DEN ZUGRIFF PRÜFEN, NICHT AUF DAS WORT. Die Datei SPRICHT über
     * Storage und Bucket — im `comment on function` und in einer `notice` —,
     * um zu erklären, warum sie beides nicht anfasst. Ein Test auf das blosse
     * Wort hielte genau diese Erklärung für den Verstoß.
     *
     * Was ein Zugriff WÄRE: das Schema `storage`, oder eine HTTP-Erweiterung.
     */
    expect(M0155).not.toMatch(/\bstorage\.\w/);
    expect(M0155).not.toMatch(/net\.http|extensions\.http|pg_net/);
    expect(M0155).toContain("'orphaned_image'");
  });

  it("die Aktion macht aus jeder Abweisung einen Satz", () => {
    for (const fall of ["discardBlocked", "discardNotDraft", "discardNotAdmin",
                        "mergeNotEnabled"]) {
      expect(AKTIONEN, fall).toContain(`de.admin.${fall}`);
    }
  });

  it("und ohne Adminrecht passiert nichts", () => {
    /* `call()` fragt die Fähigkeit, bevor es die Datenbank fragt — und die
       Datenbank fragt noch einmal selbst. */
    expect(AKTIONEN).toContain('"platform"');
    expect(M0155).toContain("errcode = '42501'");
  });
});

describe("die Oberfläche täuscht keine Funktion vor", () => {
  it("fehlt 0154, sagt der Dialog das und sperrt", () => {
    expect(DIALOG).toContain('setZustand("ausgeschaltet")');
    expect(DIALOG).toContain("mergeNotEnabled");
    /* Bedienbar ist nur der eine Zustand. */
    expect(DIALOG).toContain('const bedienbar = zustand === "ok"');
  });

  it("und der Knopf hängt daran", () => {
    expect(DIALOG).toContain("disabled={!bedienbar || pending");
  });
});
