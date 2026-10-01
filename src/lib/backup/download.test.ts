import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import { BACKUP_METADATA_SOURCE } from "./manifest";
import {
  backupFileName, projectRefFromUrl, sectionCounts, withRouteMetadata,
} from "./document";

/**
 * Die Benutzerfunktion „Datensicherung" (V1, Schritt 4).
 *
 * Die reine Logik — Zählung, Projektreferenz, Dateiname — wird hier
 * ausgeführt. Route und Oberfläche rendert dieses Projekt in Tests nicht
 * (`vitest.config.mts` sammelt `*.test.ts`, es gibt kein DOM), also wird an
 * ihnen geprüft, was nur die Quelle beantwortet: die Berechtigungskette,
 * die Kopfzeilen, das Fehlerverhalten und dass es keine zweite Exportlogik
 * gibt.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTE = "src/app/(business)/business/datensicherung/download/route.ts";
const PAGE = "src/app/(business)/business/datensicherung/page.tsx";
const BUTTON = "src/components/business/backup-download.tsx";
const DOCUMENT = "src/lib/backup/document.ts";

/* ------------------------------------------------------------------ Zählung */

describe("counts kommt aus dem Export selbst", () => {
  it("zählt je Bereich die Datensätze des fertigen Dokuments", () => {
    const doc = { data: { shop_inventory: [1, 2, 3], invoices: [], sales: [{}, {}] } };
    expect(sectionCounts(doc)).toEqual({ shop_inventory: 3, invoices: 0, sales: 2 });
  });

  it("fragt dafür keine Tabelle erneut", () => {
    /*
     * Eine zweite Abfrage wäre eine zweite MVCC-Momentaufnahme — die
     * Prüfgröße zählte dann einen anderen Augenblick als die Daten, die sie
     * prüfen soll.
     */
    const doc = code(DOCUMENT);
    for (const verboten of ["supabase", "createClient", ".rpc(", "fetch(", "from("]) {
      expect(doc.includes(verboten), `document.ts darf ${verboten} nicht enthalten`).toBe(false);
    }
  });

  it("verträgt ein Dokument ohne Datenteil", () => {
    expect(sectionCounts({})).toEqual({});
    expect(sectionCounts({ data: null } as never)).toEqual({});
  });
});

/* ------------------------------------------------------- Projektreferenz */

describe("source_project kommt aus der kanonischen Serverkonfiguration", () => {
  it("wird aus NEXT_PUBLIC_SUPABASE_URL abgeleitet", () => {
    // Dieselbe Variable, aus der die drei Supabase-Clients ihre Verbindung
    // bauen — also buchstäblich das Projekt, das gerade geantwortet hat.
    expect(code(ROUTE)).toContain("projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)");
    expect(projectRefFromUrl("https://zmiwxswrpkmizvqsgype.supabase.co"))
      .toBe("zmiwxswrpkmizvqsgype");
    expect(projectRefFromUrl("https://qqxcpesbwfxzgytkdsac.supabase.co"))
      .toBe("qqxcpesbwfxzgytkdsac");
  });

  it("erfindet nichts, wenn die Adresse keine Referenz trägt", () => {
    // Ein erfundener Wert wäre schlimmer als ein fehlender: bei drei Dateien
    // entscheidet genau dieses Feld, welche aus Production stammt.
    for (const url of [undefined, "", "keine-url", "http://localhost:54321",
                       "https://example.com"]) {
      expect(projectRefFromUrl(url), `${url} darf keine Referenz ergeben`).toBeNull();
    }
  });

  it("liest nicht den Hostnamen der eingehenden Anfrage", () => {
    // Den bestimmt der Aufrufer; die Projektreferenz darf nicht von ihm
    // abhängen.
    const route = code(ROUTE);
    expect(route).not.toContain("request.headers");
    expect(route).not.toContain("nextUrl");
    expect(route).not.toContain('headers()');
  });

  it("ergänzt genau die zwei Metadaten, die das Manifest der Route zuweist", () => {
    const ausRoute = Object.entries(BACKUP_METADATA_SOURCE)
      .filter(([, quelle]) => quelle === "route").map(([k]) => k);
    expect(ausRoute.sort()).toEqual(["counts", "source_project"]);

    const fertig = withRouteMetadata({ data: { sales: [{}] } }, "zmiwxswrpkmizvqsgype");
    expect(fertig.source_project).toBe("zmiwxswrpkmizvqsgype");
    expect(fertig.counts).toEqual({ sales: 1 });
  });

  it("lässt die Felder der Datenbank unangetastet", () => {
    const aus_db = {
      format: "skyisles-business-backup", format_version: 1, restore_supported: false,
      contains_personal_data: true, snapshot_txid: "39485:39485:", buy_in_factor: "0.376338",
      data: { sales: [] },
    };
    const fertig = withRouteMetadata(aus_db, "x");
    for (const [k, v] of Object.entries(aus_db)) {
      if (k !== "data") expect(fertig[k], `${k} wurde verändert`).toEqual(v);
    }
    expect(fertig.data).toBe(aus_db.data);
  });
});

/* ---------------------------------------------------------------- Dateiname */

describe("der Dateiname ist eindeutig und sortierbar", () => {
  it("trägt einen ISO-Zeitstempel ohne Doppelpunkte", () => {
    // Windows erlaubt keine Doppelpunkte im Dateinamen.
    expect(backupFileName(new Date("2026-09-30T14:30:12.456Z")))
      .toBe("skyisles-business-backup-2026-09-30T143012Z.json");
    expect(backupFileName(new Date("2026-01-02T03:04:05.000Z")))
      .toBe("skyisles-business-backup-2026-01-02T030405Z.json");
  });

  it("enthält keine Zeichen, die einen Header zerlegen könnten", () => {
    const name = backupFileName(new Date());
    expect(name).toMatch(/^skyisles-business-backup-[0-9T-]+Z\.json$/);
    for (const zeichen of ['"', ";", "\\", "\n", "\r", " ", ","]) {
      expect(name.includes(zeichen), `${zeichen} im Dateinamen`).toBe(false);
    }
  });

  it("nennt weder Projekt noch Verkäufer", () => {
    // Ein Dateiname wandert durch Downloadordner und Chatfenster.
    const name = backupFileName(new Date());
    expect(name).not.toContain("zmiw");
    expect(name).not.toMatch(/yulez|stocker/i);
  });
});

/* -------------------------------------------------------------------- Route */

describe("die Berechtigungskette", () => {
  const route = code(ROUTE);

  it("benutzt die bestehende Business-Prüfung, keine neue Rollenlogik", () => {
    expect(route).toContain("if (!(await canOperateSeller())) return notFound();");
    expect(route).toContain('from "@/lib/auth/capabilities"');
    expect(route).not.toContain("seller_operators");
    expect(route).not.toContain("is_shop_admin");
  });

  it("ruft mit der Sitzung des Benutzers, nicht mit Service Role", () => {
    expect(route).toContain('from "@/lib/supabase/server"');
    expect(route).toContain("await createClient()");
    for (const verboten of ["SERVICE_ROLE", "service_role", "createServiceClient"]) {
      expect(route.includes(verboten), `${verboten} in der Route`).toBe(false);
    }
  });

  it("holt alles aus genau einem RPC", () => {
    expect(route).toContain('supabase.rpc("seller_business_backup")');
    const rpcs = route.match(/\.rpc\("([a-z_]+)"/g) ?? [];
    expect(rpcs).toEqual(['.rpc("seller_business_backup"']);
  });

  it("baut keine zweite Exportlogik", () => {
    // Keine Einzelabfrage der 25 Tabellen, keine Transformation der Bereiche.
    expect(route).not.toContain(".from(");
    expect(route).not.toContain("select(");
    for (const t of ["shop_inventory", "purchase_items", "sale_items", "invoices"]) {
      expect(route.includes(t), `${t} darf die Route nicht kennen`).toBe(false);
    }
  });

  it("schreibt nichts", () => {
    for (const w of ["insert", "update", "upsert", "delete", "writeFile", "createWriteStream",
                     "localStorage", "sessionStorage", "indexedDB"]) {
      expect(route.includes(w), `${w} in der Route`).toBe(false);
    }
  });

  it("wird nicht zwischengespeichert", () => {
    expect(route).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("null ist kein leeres Backup", () => {
  const route = code(ROUTE);

  it("wird zu 404, nicht zu einer Datei", () => {
    /*
     * Genau so antwortet `seller_business_backup()` einem Konto ohne
     * Betriebsrolle. Eine Datei mit leerem Datenteil wäre die schlimmste
     * Antwort: sie sähe aus wie eine Sicherung, in der nichts drinsteht.
     */
    expect(route).toContain("if (data === null || typeof data !== \"object\"");
    expect(route).toContain("return notFound();");
    const at = route.indexOf("data === null");
    expect(at).toBeLessThan(route.indexOf("new Response(body"));
  });

  it("antwortet Unberechtigten wie auf etwas Unbekanntes", () => {
    // Ein 403 verriete, dass es hier etwas zu holen gibt (ADR-0039).
    expect(route).toContain('status: 404');
    expect(route).not.toContain("403");
  });

  it("ein Datenbankfehler wird zu 500 ohne Inhalt", () => {
    expect(route).toContain("if (error) return failed();");
    expect(route).toContain('new Response("Backup failed", { status: 500 })');
    // Kein Fehlertext aus der Datenbank nach außen — er kann Tabellennamen tragen.
    expect(route).not.toContain("error.message");
    expect(route).not.toContain("String(error)");
  });

  it("protokolliert nichts", () => {
    // Der Inhalt ist Lagerbestand, Einkaufspreise und Käuferadressen.
    for (const log of ["console.log", "console.error", "console.warn", "console.debug"]) {
      expect(route.includes(log), `${log} in der Route`).toBe(false);
    }
  });
});

describe("die Kopfzeilen der Antwort", () => {
  const route = code(ROUTE);

  it("nennen Typ, Anhang und Zwischenspeicher", () => {
    expect(route).toContain('"Content-Type": "application/json; charset=utf-8"');
    expect(route).toContain('`attachment; filename="${name}"`');
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("verbieten dem Browser das Raten des Typs", () => {
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
  });

  it("folgen dem Muster der Rechnung als PDF", () => {
    // Das Projekt hat keinen Header-Helfer; das ist der vorhandene Präzedenzfall.
    const pdf = code("src/app/(public)/rechnung/[orderNumber]/pdf/route.ts");
    expect(pdf).toContain('"Cache-Control": "private, no-store"');
    expect(pdf).toContain("Content-Disposition");
  });
});

/* ------------------------------------------------------------------- Seite */

describe("die Oberfläche", () => {
  const page = code(PAGE);

  it("liegt im geschützten Bereich und baut keine zweite Prüfung", () => {
    expect(PAGE).toContain("(business)/business/datensicherung");
    // Das Layout über `(business)` fragt `capabilities()` und antwortet 404.
    expect(code("src/app/(business)/layout.tsx")).toContain("if (!sellerOperator) notFound();");
  });

  it("ist vom Betriebsbereich aus erreichbar", () => {
    expect(code("src/app/(business)/business/page.tsx"))
      .toContain('{ href: "/business/datensicherung", copy: de.business.areas.backup }');
  });

  it("weist auf personenbezogene Daten hin", () => {
    expect(page).toContain("copy.personalText");
    expect(de.business.backup.personalText).toContain("personenbezogene Daten");
    expect(de.business.backup.personalText).toContain("Rechnungen");
  });

  it("sagt, dass die Datei nicht nach Git gehört", () => {
    expect(de.business.backup.personalText).toMatch(/Git|GitHub/);
    expect(de.business.backup.personalText).toContain("Repository");
  });

  it("behauptet keinen Restore, sondern verneint ihn ausdrücklich", () => {
    expect(page).toContain("copy.noRestoreText");
    expect(de.business.backup.noRestoreText).toContain("nicht unterstützt");
    for (const wort of ["Wiederherstellen", "Zurückspielen", "Import starten"]) {
      expect(de.business.backup.download).not.toContain(wort);
    }
  });

  it("nennt den Zweck und grenzt ihn vom Datenbank-Backup ab", () => {
    expect(de.business.backup.purposeText).toContain("ersetzt nicht");
    expect(de.business.backup.purposeText).toContain("Datenbank");
  });

  it("sagt, was enthalten ist", () => {
    expect(de.business.backup.containsItems.length).toBeGreaterThanOrEqual(5);
    const alles = de.business.backup.containsItems.join(" ");
    for (const wort of ["Lagerbestand", "Einkäufe", "Verkäufe", "Rechnungen"]) {
      expect(alles).toContain(wort);
    }
  });
});

describe("der Herunterladen-Knopf", () => {
  const button = code(BUTTON);

  it("zeigt einen Ladezustand über die gemeinsame Komponente", () => {
    expect(button).toContain("<PendingButton");
    expect(button).toContain("pending={pending}");
    expect(button).toContain("pendingLabel={copy.downloading}");
  });

  it("verhindert einen zweiten Start während des Laufs", () => {
    // Zweiter Riegel neben dem gesperrten Knopf: zwei Klicks in einem Frame.
    expect(button).toContain("if (pending) return;");
  });

  it("zeigt Fehler verständlich an und unterscheidet abgelehnt von gescheitert", () => {
    expect(button).toContain('role="alert"');
    expect(button).toContain("response.status === 404 ? copy.denied : copy.failed");
  });

  it("holt genau die eine Route", () => {
    expect(button).toContain('fetch("/business/datensicherung/download"');
    expect(button).toContain('cache: "no-store"');
  });

  it("legt die Datei nirgends im Browser ab", () => {
    for (const store of ["localStorage", "sessionStorage", "indexedDB"]) {
      expect(button.includes(store), `${store} im Knopf`).toBe(false);
    }
    // Und gibt die Objekt-URL wieder frei.
    expect(button).toContain("URL.revokeObjectURL(url)");
  });

  it("nimmt den Dateinamen vom Server, statt einen zweiten zu bilden", () => {
    expect(button).toContain('response.headers.get("Content-Disposition")');
  });

  it("protokolliert nichts", () => {
    for (const log of ["console.log", "console.error", "console.warn"]) {
      expect(button.includes(log), `${log} im Knopf`).toBe(false);
    }
  });
});

/* --------------------------------------------------------- Repositoryschutz */

describe("eine erzeugte Sicherung kann nicht ins Repository geraten", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  it("die Regel steht in der .gitignore und darf dort nicht verschwinden", () => {
    /*
     * Eine heruntergeladene Sicherung trägt Lagerzahlen, Einkaufspreise und
     * die Käufernamen und -anschriften aus den Rechnungen — genau die drei
     * Arten von Daten, die `docs/SECURITY.md` in diesem Repository verbietet.
     * Dieser Test ist die Bremse dagegen, dass die Zeile bei einem Aufräumen
     * wieder herausfliegt.
     */
    expect(gitignore).toContain("skyisles-business-backup-*.json");
  });

  it("und passt zu dem Namen, den die Route tatsächlich vergibt", () => {
    // Beide Seiten desselben Vertrags: ändert jemand `backupFileName()`,
    // greift die Regel nicht mehr — und dieser Test fällt.
    const name = backupFileName(new Date("2099-01-01T00:00:00.000Z"));
    expect(name.startsWith("skyisles-business-backup-")).toBe(true);
    expect(name.endsWith(".json")).toBe(true);
  });

  it("ignoriert nicht pauschal alle JSON-Dateien", () => {
    // `*.json` würde package.json, tsconfig.json und die kuratierten Daten
    // unter data/ stillschweigend verschlucken.
    expect(gitignore).not.toMatch(/^\*\.json$/m);
    expect(gitignore).not.toMatch(/^\*\*\/\*\.json$/m);
  });

  it("keine Sicherung liegt im Repository", () => {
    // Weder eingecheckt noch danebenliegend.
    const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
    expect(tracked.filter((f) => f.includes("skyisles-business-backup"))).toEqual([]);
  });
});
