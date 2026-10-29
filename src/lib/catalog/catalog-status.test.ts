import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CATALOG_STATUSES,
  DEFAULT_CATALOG_STATUS,
  asCatalogStatus,
  isCatalogStatus,
  statusFromVisibility,
  statusOf,
  visibleFor,
} from "@/lib/catalog/catalog-status";
import { changedFields, draftFrom } from "@/lib/admin/figure-draft";
import { de } from "@/lib/i18n/de";

/**
 * Der Katalogstatus (CAT-02B, ADR-0151, Migration `0152`).
 *
 * WAS DIESE DATEI HÄLT. Der Status ist ein Feld mit drei Werten, und das
 * Risiko liegt nicht in den drei Werten, sondern in vier Zusagen:
 *
 *   1. kein bestehender Schreibpfad zerbricht
 *   2. Status und Sichtbarkeit laufen nie auseinander
 *   3. die Sichtbarkeitsregeln bleiben, was sie waren
 *   4. ein Entwurf bleibt ein Entwurf, auch wenn der alte Weg ihn versteckt
 *
 * Jede hat einen Abschnitt.
 */

const lies = (p: string) => readFileSync(p, "utf8");
const MIG = lies("supabase/migrations/0152_catalog_status.sql");
const QUELLE = (p: string) =>
  lies(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(--|\/\/).*$/gm, "");
const MIG_CODE = QUELLE("supabase/migrations/0152_catalog_status.sql");

const FIGUR = {
  displayNameOverride: null as string | null,
  cardType: "standard",
  imageOverridePath: null as string | null,
  catalogVisible: true,
};

/* ========================================================================
 * 1. DAS MODELL
 * ===================================================================== */

describe("drei Werte, zwei Verhalten", () => {
  it("die drei, in Anzeigereihenfolge, und nichts daneben", () => {
    expect([...CATALOG_STATUSES]).toEqual(["public", "hidden", "draft"]);
    for (const s of CATALOG_STATUSES) expect(isCatalogStatus(s)).toBe(true);
    for (const kein of ["Public", "veröffentlicht", "", null, undefined, 1, true]) {
      expect(isCatalogStatus(kein), String(kein)).toBe(false);
      expect(asCatalogStatus(kein)).toBeNull();
    }
  });

  it("nur „oeffentlich“ ist oeffentlich — versteckt und Entwurf verhalten sich gleich", () => {
    /*
     * DER GRUND, WARUM DER DRITTE WERT KEINE NEUE SICHTBARKEITSREGEL KOSTET.
     * Beide sind nicht öffentlich; sie unterscheiden sich in der Absicht.
     */
    expect(visibleFor("public")).toBe(true);
    expect(visibleFor("hidden")).toBe(false);
    expect(visibleFor("draft")).toBe(false);
  });

  it("ein neuer Eintrag ist ein Entwurf, kein verstecktes Objekt", () => {
    expect(DEFAULT_CATALOG_STATUS).toBe("draft");
  });

  it("die Ableitung aus der Sichtbarkeit ist exakt, nicht geschätzt", () => {
    /*
     * `0152` füllt die Spalte mit genau dieser Rechnung, und der CHECK hält
     * sie danach. Vor der Migration kann es keine Entwürfe geben — also ist
     * „abgeleitet“ dort dasselbe wie „gelesen“.
     */
    expect(statusFromVisibility(true)).toBe("public");
    expect(statusFromVisibility(false)).toBe("hidden");
    expect(MIG).toContain("case when catalog_visible then 'public' else 'hidden' end");
    /* Und `statusOf` nimmt den gelesenen Wert, wo es einen gibt. */
    expect(statusOf({ catalogVisible: false, catalogStatus: "draft" })).toBe("draft");
    expect(statusOf({ catalogVisible: false })).toBe("hidden");
    expect(statusOf({ catalogVisible: true })).toBe("public");
  });

  it("jeder Übergang ist frei — es ist ein Feld, kein Arbeitsablauf", () => {
    /*
     * Die vier Fälle, die der Betreiber genannt hat, plus die beiden
     * übrigen. Es gibt keine Vorbedingung, keinen Zustandsgraphen und keine
     * Bestätigung, also kann der Test nur eines prüfen: dass nirgends eine
     * Bedingung steht.
     */
    const uebergaenge: [string, string][] = [
      ["public", "hidden"], ["hidden", "draft"], ["draft", "public"],
      ["public", "draft"], ["hidden", "public"], ["draft", "hidden"],
    ];
    for (const [von, nach] of uebergaenge) {
      expect(isCatalogStatus(von) && isCatalogStatus(nach), `${von} → ${nach}`).toBe(true);
    }
    /* Kein Zweig in der RPC, der einen Übergang verweigert — nur der
       Wächter gegen unbekannte Werte. */
    const rpc = MIG_CODE.slice(
      MIG_CODE.indexOf("function public.admin_set_catalog_status"),
      MIG_CODE.indexOf("comment on function public.admin_set_catalog_status"),
    );
    expect(rpc).toContain("not in ('public', 'hidden', 'draft')");
    expect(rpc).not.toMatch(/old_status|from_status|allowed|transition/i);
  });

  it("und wiederholtes Speichern ohne Änderung schreibt nichts", () => {
    const initial = draftFrom(FIGUR, null);
    expect(changedFields(initial, { ...initial })).toEqual([]);
    const gleich = { ...initial, catalogStatus: initial.catalogStatus };
    expect(changedFields(initial, gleich)).toEqual([]);
  });
});

/* ========================================================================
 * 2. KEIN BESTEHENDER SCHREIBPFAD ZERBRICHT
 * ===================================================================== */

describe("die Rückwärtskompatibilität, und warum sie hält", () => {
  it("ein reiner CHECK hätte drei Schreibpfade verletzt — der Trigger verhindert es", () => {
    /*
     * DIE ZÄHLUNG, auf die es ankommt. Alle drei schreiben `catalog_visible`
     * ohne den Status zu nennen:
     *
     *   admin_set_catalog_visible    UPDATE nur der einen Spalte
     *   admin_create_figure          INSERT mit catalog_visible = false
     *   seller_create_catalog_item   dasselbe, aus dem Einkaufsbuch (0137)
     *
     * Ohne Trigger wäre jeder davon ein CHECK-Verstoß. Mit ihm leitet die
     * Datenbank ab, was der Aufrufer nicht sagt.
     */
    expect(MIG).toContain("create trigger skylanders_sync_catalog_status");
    expect(MIG).toContain("before insert or update on public.skylanders");
    expect(MIG_CODE).toContain("if new.catalog_status is null then");
    /* Und die Spalte hat KEINEN Vorgabewert: NULL ist das Signal
       „der Aufrufer hat nichts gesagt“. */
    expect(MIG_CODE).toContain("add column catalog_status text;");
    expect(MIG_CODE).not.toMatch(/add column catalog_status text[^;]*default/);
  });

  it("der CHECK bleibt trotzdem — er ist der Nachweis, nicht die Mechanik", () => {
    expect(MIG).toContain("check (catalog_status in ('public', 'hidden', 'draft'))");
    expect(MIG).toContain("check ((catalog_status = 'public') = catalog_visible)");
  });

  it("ein Entwurf bleibt ein Entwurf, wenn der alte Weg ihn versteckt", () => {
    /*
     * DIE EINE FEINHEIT. `admin_set_catalog_visible(sky_id, false)` auf einem
     * Entwurf darf ihn nicht stillschweigend zu „versteckt“ umbenennen:
     * beide sind nicht öffentlich, und die Absicht gehört dem, der sie
     * gesetzt hat. Nur der Wechsel nach sichtbar ist eindeutig.
     */
    expect(MIG_CODE).toContain("when old.catalog_status = 'draft' then 'draft'");
  });

  it("`admin_set_catalog_visible` bleibt erhalten und wird nicht umgeschrieben", () => {
    /* Zubehör- und Betriebsflächen stellen weiterhin die
       Zwei-Zustands-Frage. Eine Funktion zu entfernen, die noch aufgerufen
       wird, wäre eine Änderung mit Reichweite. */
    expect(MIG).not.toContain("drop function public.admin_set_catalog_visible");
    expect(MIG_CODE).not.toContain("function public.admin_set_catalog_visible");
    const aktionen = QUELLE("src/lib/admin/actions.ts");
    expect(aktionen).toContain('"admin_set_catalog_visible"');
    expect(aktionen).toContain('"admin_set_catalog_status"');
  });

  it("`seller_create_catalog_item` wird nicht angefasst", () => {
    /*
     * Auf den ANWEISUNGEN, nicht auf der Prosa: die Spaltenbeschreibung
     * (`comment on column`) nennt die Funktion zu Recht, weil sie erklärt,
     * warum die Spalte keinen Vorgabewert hat. Angefasst wird sie nicht —
     * und das heißt: kein `create or replace` darauf.
     */
    expect(MIG_CODE).not.toMatch(/function public\.seller_create_catalog_item/);
    expect(MIG_CODE).not.toMatch(/drop function[^;]*seller_create/);
  });

  it("der Katalogimport schreibt die Spalte nicht — und darf es nicht", () => {
    /*
     * Redaktionelle Spalten gehören dem Admin und dürfen nie in einen
     * Import-Payload geraten (CLAUDE.md, ADR-0039). Der Import nennt acht
     * Spalten, und `catalog_status` ist keine davon — eine neue Zeile
     * bekommt vom Trigger 'public', genau wie heute.
     */
    const imp = QUELLE("tools/import-catalog.mts");
    expect(imp).not.toContain("catalog_status");
    expect(imp).not.toContain("catalog_visible");
  });

  it("`admin_create_figure` behält seine Signatur — sonst wäre es eine Überladung", () => {
    const fn = MIG.slice(MIG.indexOf("create or replace function public.admin_create_figure"));
    for (const p of ["p_name", "p_series_code", "p_category_id", "p_card_type",
                     "p_catalog_visible", "p_display_name_override", "p_admin_note",
                     "p_template_sky_id"]) {
      expect(fn, p).toContain(p);
    }
    expect(fn).not.toContain("p_catalog_status");
    /* Die EINE fachliche Änderung: der INSERT nennt den Status. */
    expect(fn).toContain("case when coalesce(p_catalog_visible, false) then 'public' else 'draft' end");
  });
});

/* ========================================================================
 * 3. DIE SICHTBARKEIT BLEIBT, WAS SIE WAR
 * ===================================================================== */

describe("keine Sichtbarkeitsregel wird angefasst", () => {
  it("die Migration nennt keine Politik, keinen Index, keine Sicht", () => {
    /*
     * DER ZUSCHNITT, und er ist der eigentliche Grund für diesen Entwurf:
     * `catalog_visible` behält genau seine Bedeutung, also bleibt die
     * auditierte Sicherheitsgrenze unberührt.
     */
    /*
     * ANWEISUNGEN, NICHT WÖRTER. Die Spaltenbeschreibung nennt `shop_offers()`
     * und die Lesepolitik, weil sie erklärt, was unberührt bleibt — das ist
     * der Punkt, nicht ein Verstoß. Geprüft wird deshalb, dass keine
     * ANWEISUNG sie anfasst.
     */
    const ohneBeschreibung = MIG_CODE.replace(/comment on [\s\S]*?;/g, "");
    for (const verboten of ["create policy", "drop policy", "alter policy",
                            "create index", "drop index",
                            "create or replace view", "drop view",
                            "create or replace function public.shop_offers",
                            "alter table public.collection_items",
                            "alter table public.favorites"]) {
      expect(ohneBeschreibung.toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("und sie löscht nichts und vergibt beim Lauf keine SKY-ID", () => {
    /*
     * `nextval('sky_id_seq')` STEHT in der Migration — im wortgleich
     * übernommenen Rumpf von `admin_create_figure`, und dort gehört es hin.
     * Was nicht vorkommen darf, ist eine Vergabe durch die Migration selbst,
     * also eine Anweisung auf oberster Ebene.
     */
    const anweisungen = MIG_CODE.slice(0, MIG_CODE.indexOf("create or replace function public.admin_create_figure"));
    expect(anweisungen).not.toContain("nextval");
    expect(anweisungen).not.toContain("insert into public.skylanders");
    for (const verboten of ["delete from", "truncate", "drop table", "drop column"]) {
      expect(MIG_CODE.toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("kein bestehender Eintrag wird zum Entwurf", () => {
    const backfill = MIG_CODE.slice(MIG_CODE.indexOf("update public.skylanders"));
    expect(backfill).toContain("then 'public' else 'hidden' end");
    expect(backfill.slice(0, 200)).not.toContain("'draft'");
  });

  it("nur der Plattformadmin darf den Status setzen", () => {
    expect(MIG).toContain("if not public.is_platform_admin() then");
    expect(MIG).toContain("revoke all on function public.admin_set_catalog_status(text, text) from public, anon;");
    expect(MIG).toContain("grant execute on function public.admin_set_catalog_status(text, text) to authenticated;");
    /* `is_shop_admin()` wäre die falsche Rolle: seit ADR-0077 sind
       Plattform und Verkäuferbetrieb getrennt, und der Katalog gehört der
       Plattform. */
    expect(MIG_CODE).not.toContain("is_shop_admin");
  });

  it("der Status wird journalisiert, ohne neues Journal", () => {
    /* `log_skylander_editorial_change` führt vier Felder (0004/0007/0033);
       `0152` macht fünf daraus. `catalog_visible` bleibt dabei — der alte
       Schreibweg nennt weiterhin nur die eine Spalte. */
    expect(MIG_CODE).toContain("if new.catalog_status is distinct from old.catalog_status then");
    expect(MIG_CODE).toContain("if new.catalog_visible is distinct from old.catalog_visible then");
    for (const feld of ["display_name_override", "image_override_path", "card_type"]) {
      expect(MIG_CODE, feld).toContain(`'${feld}'`);
    }
    expect(MIG_CODE).not.toContain("create table public.catalog_status_changes");
  });
});

/* ========================================================================
 * 4. DIE OBERFLÄCHE — EIN FELD, KEIN VORGANG
 * ===================================================================== */

describe("die Adminoberfläche bleibt die bestehende", () => {
  it("drei Wörter, an einer Stelle, auf Deutsch", () => {
    expect(de.catalog.statusPublic).toBe("Öffentlich");
    expect(de.catalog.statusHidden).toBe("Versteckt");
    expect(de.catalog.statusDraft).toBe("Entwurf");
    expect(de.catalog.statusAll).toBe("Alle");
  });

  it("ein `select` im bestehenden Formular, in der bestehenden WRITERS-Tabelle", () => {
    const modal = QUELLE("src/components/admin/figure-modal.tsx");
    expect(modal).toContain("catalogStatus: (skyId, draft) => setCatalogStatus(skyId, draft.catalogStatus)");
    expect(modal).toContain("<select");
    /*
     * DAS SICHTBARKEITS-HÄKCHEN IST WEG, und mit ihm der
     * Zwei-Zustands-Schreibweg. Geprüft wird jetzt genau das und nicht mehr
     * „kein Kästchen im Dialog": seit CAT-10 steht dort eine
     * MEHRFACHAUSWAHL aus Kästchen für die Typmenge (`0163`), und die hat
     * mit der Sichtbarkeit nichts zu tun — sie schreibt
     * `admin_set_figure_types` und niemals `catalog_visible`.
     *
     * Die Zusage, um die es hier geht, bleibt damit vollständig: der Status
     * hat EINEN Schreibweg, und das ist das `select`.
     */
    expect(modal).not.toContain("setCatalogVisible");
    expect(modal).not.toContain('checked={draft.catalogStatus');
    /* Und kein Kästchen, das die Sichtbarkeit oder den Status schreibt. */
    for (const zeile of modal.split("\n")) {
      if (!zeile.includes('type="checkbox"')) continue;
      expect(zeile, zeile.trim()).not.toContain("catalogStatus");
      expect(zeile, zeile.trim()).not.toContain("catalogVisible");
    }
  });

  it("und kein Bestätigungsdialog, keine Warnung, keine Freigabeseite", () => {
    for (const datei of ["src/components/admin/figure-modal.tsx",
                         "src/components/admin/status-select.tsx",
                         "src/app/(admin)/admin/catalog/page.tsx"]) {
      const q = QUELLE(datei);
      /* Wortgrenzen: „review" steckt in „preview", und eine Vorschau ist
         kein Freigabeschritt. */
      for (const verboten of [/\bconfirm\(/, /window\.confirm/, /Bist du sicher/,
                              /\bfreigeben\b/i, /\breview\b/i, /\bapprove\b/i]) {
        expect(q, `${datei}: ${verboten}`).not.toMatch(verboten);
      }
    }
  });

  it("der Statusfilter wirkt serverseitig, nicht auf einem Ausschnitt", () => {
    /*
     * DIE LEKTION AUS CAT-01B, hier als Zusage: die Adminliste lädt
     * seitenweise, und ein Filter nach dem Blättern filtert einen Ausschnitt
     * statt den Bestand.
     */
    const q = QUELLE("src/lib/admin/queries.ts");
    expect(q).toContain('if (options.status === "public")');
    expect(q).toContain('query = query.eq("catalog_visible", false).eq("catalog_status", options.status)');
    const seite = QUELLE("src/app/(admin)/admin/catalog/page.tsx");
    expect(seite).toContain("fetchAdminCatalog({ page, series: params.series, query: params.q, status })");
    /* Und der Filterzustand steht in der Adresszeile, wie die anderen. */
    expect(seite).toContain('name="status"');
  });

  it("die Statusanzeige steht in Liste UND Detailseite", () => {
    for (const datei of ["src/app/(admin)/admin/catalog/page.tsx",
                         "src/app/(admin)/admin/catalog/[skyId]/page.tsx"]) {
      expect(QUELLE(datei), datei).toContain("<StatusSelect");
      expect(QUELLE(datei), datei).not.toContain("VisibilityToggle");
    }
  });

  it("die Farbe ist nie das einzige Signal", () => {
    const q = QUELLE("src/components/admin/status-select.tsx");
    /* Jede Option trägt ihr Wort, und das `select` seinen Namen. */
    expect(q).toContain("{LABELS[option]}");
    expect(q).toContain("de.catalog.statusLabel");
  });
});

/* ==========================================================================
 * 5. Akte, Hülle, Prüfdateien und Laufzettel (CAT-02C, Teil C und D)
 *
 * Eine Migration ist erst vorbereitet, wenn jemand sie fahren KANN: mit
 * einem Preflight, der den Ausgangszustand benennt, einer Hülle, die genau
 * diese Datei trägt, einer Nachkontrolle, die den Erfolg beweist, und einer
 * Rücknahme, die sagt, was sie kostet. Dieser Abschnitt prüft, dass alle
 * vier existieren und zueinander passen — nicht, dass sie gelaufen sind.
 * ======================================================================== */
describe("0152 — Akte, Hülle, Prüfdateien und Laufzettel", () => {
  const PRE = lies("supabase/checks/0152_preflight.sql");
  const POST = lies("supabase/checks/0152_postflight.sql");
  const HUELLE = lies("supabase/operations/staging-0152.sql");
  const ZETTEL = lies("supabase/checks/0152_staging_run.md");
  const R = lies("supabase/rollback/R0152_drop_catalog_status.sql");

  it("die Prüfdateien teilen den Vertrag zeichengleich mit 0151", () => {
    /*
     * DERSELBE BODEN WIE BEI `0150`/`0151`. Der Basis-Vertrag ist nicht
     * abgeschrieben, sondern kopiert: der Kopf mit den Messungen und der
     * Schwanz ab der Marke müssen Zeichen für Zeichen stimmen, bis auf die
     * Migrationsnummer. Eine abgewandelte Messung wäre eine zweite
     * Wahrheit darüber, was „unverändert" heißt.
     */
    for (const [alt, neu, marke] of [
      ["supabase/checks/0151_preflight.sql", "supabase/checks/0152_preflight.sql",
       "  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)\n"],
      ["supabase/checks/0151_postflight.sql", "supabase/checks/0152_postflight.sql",
       "  -- ------------------------------------------------------- Nichts verrueckt\n"],
    ] as const) {
      const a = lies(alt);
      const b = lies(neu);
      const kopf = (t: string) =>
        t.slice(t.indexOf("\nwith sammelbar as ("), t.indexOf("pruef (nr, bereich"));
      expect(kopf(b), neu).toBe(kopf(a));
      expect(b.slice(b.indexOf(marke)), neu)
        .toBe(a.slice(a.indexOf(marke)).split("0151").join("0152"));
    }
  });

  it("der Preflight verlangt GENAU EINE Fassung von admin_create_figure", () => {
    /*
     * DER FEHLER, DEN P60 ZUERST FAND. `0033` legte sieben Parameter an,
     * `0034` acht und löscht die alte. Stünden beide, wäre ein Aufruf mit
     * drei Argumenten mehrdeutig (`42725`). Auf der Stub-Datenbank war das
     * ein Befund über das Werkzeug; auf einer echten Datenbank ist es eine
     * Prüfung, und sie gehört vor den Lauf.
     */
    expect(PRE).toContain("und zwar genau EINE Fassung von admin_create_figure");
    expect(PRE).toContain("'admin_create_figure'), '1'),");
    /* Und dieselbe Bedingung steht als Wächter in der Hülle. */
    expect(HUELLE).toContain("ABBRUCH A5");
  });

  it("der Preflight prüft die vier Abwesenheiten einzeln", () => {
    for (const was of ["skylanders.catalog_status fehlt",
                       "kein CHECK mit catalog_status im Namen",
                       "kein Trigger skylanders_sync_catalog_status",
                       "admin_set_catalog_status(text,text) gibt es nicht"]) {
      expect(PRE, was).toContain(was);
    }
  });

  it("die Nachkontrolle beweist den Backfill OHNE übergebene Zahl", () => {
    /*
     * DIE STÄRKSTE ZEILE DIESER DATEI, und sie braucht keinen Handgriff:
     * eine übergebene Zahl sagt „so viele waren es vorher", diese Zeile
     * sagt „genau diese Zeilen sind es, Zeile für Zeile". Handgriffe waren
     * bei `0145` und `0146` die Fehlerquelle (ADR-0137).
     */
    expect(POST).toContain("where catalog_visible <> (catalog_status = 'public')), '0')");
    expect(POST).toContain("KEINE Zeile ist zum Entwurf geworden");
    expect(POST).toContain("where catalog_status = 'draft'), '0')");
  });

  it("die Nachkontrolle prüft den Trigger nach Zeitpunkt, nicht nur nach Namen", () => {
    /* `tgtype` 23 = BEFORE + ROW + INSERT + UPDATE. Ein AFTER-Trigger wäre
       fachlich falsch: danach lässt sich `NEW` nicht mehr ändern. */
    expect(POST).toContain("BEFORE INSERT OR UPDATE, FOR EACH ROW");
    expect(POST).toContain("'23')");
  });

  it("die Nachkontrolle prüft, dass die Lesepolitiken UNBERÜHRT sind", () => {
    /*
     * DIE SICHERHEITSGRENZE. Beide Politiken lesen weiter `catalog_visible`
     * und NICHT den Status — ein Entwurf ist deshalb genau so unsichtbar
     * wie eine versteckte Zeile, und aus demselben Grund wie vorher. Hätte
     * `0152` sie angefasst, wäre das eine Sichtbarkeitsänderung.
     */
    for (const politik of ["skylanders_select_anon", "skylanders_select_authenticated"]) {
      expect(POST, politik).toContain(`policyname = '${politik}'`);
    }
    expect(POST).toContain("qual not like '%catalog_status%'");
  });

  it("die Hülle klammert, die Migration nicht", () => {
    /*
     * DIE KORREKTUR AUS TEIL D. `0152` klammerte sich selbst; zwei
     * Klammern hintereinander hätten mit dem inneren `commit` die äußere
     * Transaktion vorzeitig abgeschlossen und die Wächter wirkungslos
     * gemacht. `0150` und `0151` machen es richtig, und jetzt auch `0152`.
     */
    const zeilen = (t: string) => t.split("\n").map((l) => l.trim());
    expect(zeilen(MIG).filter((l) => l === "begin;")).toHaveLength(0);
    expect(zeilen(MIG).filter((l) => l === "commit;")).toHaveLength(0);
    expect(zeilen(HUELLE).filter((l) => l === "begin;")).toHaveLength(1);
    expect(zeilen(HUELLE).filter((l) => l === "commit;")).toHaveLength(1);
    /* Und die Datei sagt, warum sie es so macht. */
    expect(MIG).toContain("KEINE EIGENE TRANSAKTIONSKLAMMER");
  });

  it("der Plan steht in migration-plans.json und fragt das Ereignis", () => {
    const plan = JSON.parse(lies("supabase/checks/migration-plans.json"));
    const e = plan.migrationen["0152"];
    expect(e.preflight).toBe("0152_preflight.sql");
    expect(e.lauf).toBe("staging-0152.sql");
    expect(e.postflight).toBe("0152_postflight.sql");
    expect(e.braucht).toEqual(["skyisles.base", "skyisles.coll"]);
    /* Die Probe fragt die Spalte — ein Ereignis, kein wiederholbarer
       Zustand. `0152` ist nicht wiederholbar, und die Probe sagt das. */
    expect(e.angewendet.sql).toContain("attname = 'catalog_status'");
    expect(e.angewendet.beschreibung).toContain("nicht wiederholbar");
  });

  it("der Laufzettel nennt Abbruchbedingungen, Rücknahme und die Werkzeuggrenzen", () => {
    for (const was of ["Abbruchbedingungen", "R0152_drop_catalog_status.sql",
                       "Erwartete Ausgangszustände", "9999", "P60",
                       "drei nachgewiesene Grenzen"]) {
      expect(ZETTEL, was).toContain(was);
    }
    /* Und er behauptet nicht, der Probelauf sei ein Lauf gegen Production. */
    expect(ZETTEL).toContain("Was dieser Lauf NICHT beweist");
  });

  it("die Rücknahme nennt, was sie kostet — vor dem ersten Eingriff", () => {
    /*
     * KEIN DATENVERLUST, ABER EIN VERLUST VON ABSICHT. Jede Zeile, die als
     * Entwurf geführt wurde, ist danach nur noch „versteckt". Deshalb zählt
     * und NENNT sie die betroffenen SKY-IDs, bevor sie etwas anfasst.
     */
    expect(R).toContain("string_agg(sky_id");
    expect(R.indexOf("string_agg(sky_id")).toBeLessThan(R.indexOf("drop trigger"));
    expect(R).toContain("VERLUST VON ABSICHT");
  });

  it("die Rücknahme verweigert, solange 0153 angewendet ist", () => {
    /*
     * SONST BRICHT DIE SICHERUNG STILL. `0153` nennt `t.catalog_status` im
     * Rumpf von `system_platform_export()`. Ein `drop column` darunter
     * lässt die Funktion stehen und bricht sie erst beim Aufruf — also erst
     * dann, wenn jemand eine Sicherung braucht.
     */
    expect(R).toContain("system_platform_export");
    expect(R).toContain("Zuerst R0153 fahren");
    expect(R.indexOf("Zuerst R0153 fahren")).toBeLessThan(R.indexOf("drop trigger"));
  });

  it("die Rücknahme stellt die zwei Rümpfe zeichengleich her", () => {
    /*
     * AUS DEN MIGRATIONEN, NICHT VON HAND. Ein nachgebauter Rumpf wäre
     * eine dritte Fassung. `log_skylander_editorial_change` kommt aus
     * `0033`, `admin_create_figure` aus `0041` — das sind die jeweils
     * letzten Definitionen vor `0152`.
     */
    const rumpf = (datei: string, name: string) => {
      const s = lies(`supabase/migrations/${datei}`);
      const i = s.lastIndexOf(`create or replace function public.${name}(`);
      expect(i, `${datei}: ${name} fehlt`).toBeGreaterThan(-1);
      return s.slice(i, s.indexOf("\n$$;", i) + "\n$$;".length);
    };
    expect(R).toContain(rumpf("0033_admin_created_figures.sql",
                              "log_skylander_editorial_change"));
    expect(R).toContain(rumpf("0041_three_account_authorization.sql",
                              "admin_create_figure"));
    /* Und sie fasst die Spalte an, nicht die Zeilen. */
    expect(R).not.toMatch(/^\s*update\s+public\.skylanders/im);
    expect(R).not.toMatch(/delete\s+from/i);
  });

  it("die Akte nennt die neuen Artefakte und die Korrektur", () => {
    const akte = lies("supabase/migrations/APPLIED.md");
    for (const was of ["0152_preflight.sql", "0152_postflight.sql",
                       "staging-0152.sql", "0152_staging_run.md",
                       "R0152_drop_catalog_status.sql",
                       "KORREKTUR AN DIESER DATEI SELBST"]) {
      expect(akte, was).toContain(was);
    }
  });
});
