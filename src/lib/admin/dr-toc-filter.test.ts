import { describe, expect, it } from "vitest";

import { parseLine, decide, filterToc, bericht }
  from "../../../tools/dr/30-filter-toc.mts";

/**
 * Der Filter entscheidet, was in ein bereits initialisiertes Supabase-Projekt
 * zurückgeschrieben wird. Er ist das gefährlichste Stück des
 * Wiederherstellungswegs: lässt er zu viel durch, überschreibt der Restore
 * `auth.schema_migrations` oder `storage.migrations` — und das wirft keinen
 * Fehler, sondern bricht den Dienst später und still. Lässt er zu viel weg,
 * ist der Restore unvollständig und sieht trotzdem erfolgreich aus.
 *
 * Deshalb wird er hier gegen ein nachgebautes Inhaltsverzeichnis geprüft,
 * ohne Datenbank und ohne Dump.
 */

/* Nachgebaut nach dem Format von `pg_restore --list`. */
const TOC = [
  ";",
  "; Archive created at 2026-10-16 22:00:00 +0200",
  ";     dbname: postgres",
  ";",
  "; Selected TOC Entries:",
  ";",
  "5; 2615 16388 SCHEMA - public postgres",
  "6; 2615 16389 SCHEMA - auth supabase_admin",
  "7; 2615 16390 SCHEMA - storage supabase_admin",
  "8; 3079 16400 EXTENSION - pg_cron ",
  "210; 1259 16432 TABLE public purchases postgres",
  "211; 1259 16433 TABLE public purchase_receipts postgres",
  "212; 1259 16434 SEQUENCE public order_number_seq postgres",
  "300; 1255 16500 FUNCTION public seller_business_backup() postgres",
  "301; 1255 16501 FUNCTION public seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz) postgres",
  "400; 0 0 TABLE DATA public purchases postgres",
  "401; 0 0 TABLE DATA public purchase_receipts postgres",
  "402; 0 0 SEQUENCE SET public order_number_seq postgres",
  "500; 2606 16440 CONSTRAINT public purchases purchases_pkey postgres",
  "501; 2606 16441 FK CONSTRAINT public orders orders_user_fk postgres",
  "502; 1259 16442 INDEX public purchases_day_idx postgres",
  "503; 2620 16443 TRIGGER public purchase_items purchase_items_touch_purchase_trg postgres",
  "504; 3256 16444 POLICY public skylanders skylanders_read_all postgres",
  "505; 0 0 ROW SECURITY public skylanders postgres",
  "506; 0 0 ACL public TABLE skylanders postgres",
  "507; 0 0 COMMENT public FUNCTION seller_business_backup() postgres",
  "600; 1259 16600 TABLE auth users supabase_auth_admin",
  "601; 1259 16601 TABLE auth schema_migrations supabase_auth_admin",
  "602; 0 0 TABLE DATA auth users supabase_auth_admin",
  "603; 0 0 TABLE DATA auth identities supabase_auth_admin",
  "604; 0 0 TABLE DATA auth schema_migrations supabase_auth_admin",
  "605; 0 0 TABLE DATA auth sessions supabase_auth_admin",
  "606; 0 0 TABLE DATA auth refresh_tokens supabase_auth_admin",
  "607; 0 0 TABLE DATA auth audit_log_entries supabase_auth_admin",
  "608; 2620 16610 TRIGGER auth users on_auth_user_created supabase_auth_admin",
  "700; 1259 16700 TABLE storage objects supabase_storage_admin",
  "701; 0 0 TABLE DATA storage buckets supabase_storage_admin",
  "702; 0 0 TABLE DATA storage objects supabase_storage_admin",
  "703; 0 0 TABLE DATA storage migrations supabase_storage_admin",
  "704; 3256 16710 POLICY storage objects catalog_images_read postgres",
  "705; 3256 16711 POLICY storage objects catalog_images_insert postgres",
  "706; 3256 16712 POLICY storage objects catalog_images_update postgres",
  "707; 3256 16713 POLICY storage objects catalog_images_delete postgres",
  "708; 3256 16714 POLICY storage objects supabase_internal_policy supabase_storage_admin",
  "709; 1255 16720 FUNCTION storage extension(name text) supabase_storage_admin",
  "800; 1259 16800 TABLE cron job supabase_admin",
  "801; 0 0 TABLE DATA cron job supabase_admin",
].join("\n");

describe("das Inhaltsverzeichnis wird Zeile für Zeile gelesen", () => {
  it("eine gewöhnliche Zeile", () => {
    expect(parseLine("210; 1259 16432 TABLE public purchases postgres"))
      .toEqual({ id: "210", desc: "TABLE", schema: "public", name: "purchases" });
  });

  it("eine Beschreibung aus zwei Wörtern", () => {
    expect(parseLine("400; 0 0 TABLE DATA public purchases postgres"))
      .toEqual({ id: "400", desc: "TABLE DATA", schema: "public", name: "purchases" });
  });

  it("eine Funktionssignatur mit Leerzeichen bleibt heil", () => {
    const e = parseLine("301; 1255 16501 FUNCTION public "
      + "seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz) postgres");
    expect(e?.desc).toBe("FUNCTION");
    expect(e?.schema).toBe("public");
    expect(e?.name).toBe("seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)");
  });

  it("ein Schemaeintrag trägt `-` als Schema", () => {
    expect(parseLine("6; 2615 16389 SCHEMA - auth supabase_admin"))
      .toEqual({ id: "6", desc: "SCHEMA", schema: "-", name: "auth" });
  });

  it("Kommentarzeilen und Unfug ergeben nichts", () => {
    expect(parseLine("; Archive created at …")).toBeNull();
    expect(parseLine("irgendwas")).toBeNull();
  });
});

describe("was behalten wird und was nicht", () => {
  const u = (line: string) => decide(parseLine(line)!);

  it("alles aus public", () => {
    for (const l of ["210; 1259 16432 TABLE public purchases postgres",
                     "400; 0 0 TABLE DATA public purchases postgres",
                     "402; 0 0 SEQUENCE SET public order_number_seq postgres",
                     "503; 2620 16443 TRIGGER public purchase_items t postgres",
                     "506; 0 0 ACL public TABLE skylanders postgres"]) {
      expect(u(l).keep, l).toBe(true);
    }
  });

  it("aus auth NUR die Konten und Identitäten", () => {
    expect(u("602; 0 0 TABLE DATA auth users supabase_auth_admin").keep).toBe(true);
    expect(u("603; 0 0 TABLE DATA auth identities supabase_auth_admin").keep).toBe(true);
    for (const l of ["604; 0 0 TABLE DATA auth schema_migrations supabase_auth_admin",
                     "605; 0 0 TABLE DATA auth sessions supabase_auth_admin",
                     "606; 0 0 TABLE DATA auth refresh_tokens supabase_auth_admin",
                     "607; 0 0 TABLE DATA auth audit_log_entries supabase_auth_admin",
                     "600; 1259 16600 TABLE auth users supabase_auth_admin",
                     "608; 2620 16610 TRIGGER auth users t supabase_auth_admin"]) {
      expect(u(l).keep, l).toBe(false);
    }
  });

  it("DAS Versionsregister von auth wird niemals angefasst", () => {
    const urteil = u("604; 0 0 TABLE DATA auth schema_migrations supabase_auth_admin");
    expect(urteil.keep).toBe(false);
    expect(urteil.grund).toContain("Systemobjekt");
  });

  it("aus storage nur Fracht und die eigenen vier Policies", () => {
    expect(u("701; 0 0 TABLE DATA storage buckets supabase_storage_admin").keep).toBe(true);
    expect(u("702; 0 0 TABLE DATA storage objects supabase_storage_admin").keep).toBe(true);
    expect(u("704; 3256 16710 POLICY storage objects catalog_images_read postgres").keep).toBe(true);
    expect(u("703; 0 0 TABLE DATA storage migrations supabase_storage_admin").keep).toBe(false);
    expect(u("708; 3256 16714 POLICY storage objects supabase_internal_policy x").keep).toBe(false);
    expect(u("709; 1255 16720 FUNCTION storage extension(name text) x").keep).toBe(false);
  });

  it("kein CREATE SCHEMA, keine Extension, kein fremdes Schema", () => {
    expect(u("5; 2615 16388 SCHEMA - public postgres").keep).toBe(false);
    expect(u("8; 3079 16400 EXTENSION - pg_cron ").keep).toBe(false);
    expect(u("801; 0 0 TABLE DATA cron job supabase_admin").keep).toBe(false);
  });

  it("und der Fünf-Minuten-Job bleibt draußen — mit Begründung", () => {
    expect(u("801; 0 0 TABLE DATA cron job supabase_admin").grund).toContain("cron");
  });
});

describe("der ganze Durchlauf", () => {
  const r = filterToc(TOC);

  it("keine Verstöße gegen die Zusicherungen", () => {
    expect(r.verstoesse).toEqual([]);
  });

  it("behält genau das Erwartete", () => {
    const namen = r.behalten.map((e) => `${e.schema}/${e.desc}/${e.name}`);
    expect(namen).toContain("auth/TABLE DATA/users");
    expect(namen).toContain("auth/TABLE DATA/identities");
    expect(namen).toContain("storage/TABLE DATA/buckets");
    expect(namen).toContain("storage/POLICY/objects catalog_images_read");
    expect(namen).not.toContain("auth/TABLE DATA/schema_migrations");
    expect(namen).not.toContain("storage/TABLE DATA/migrations");
    expect(r.behalten.filter((e) => e.schema === "auth")).toHaveLength(2);
    expect(r.behalten.filter((e) => e.schema === "storage")).toHaveLength(6);
    expect(r.behalten.filter((e) => e.schema === "public").length)
      .toBeGreaterThanOrEqual(13);
  });

  it("verworfene Zeilen sind auskommentiert, nicht gelöscht", () => {
    const text = r.zeilen.join("\n");
    /* `--use-list` überliest Kommentare — und der Mensch kann nachlesen,
       was nicht angewendet wird. Beides zählt. */
    expect(text).toContain("; Supabase-Systemobjekt in auth: 604;");
    expect(text.split("\n").length).toBe(TOC.split("\n").length);
    for (const zeile of TOC.split("\n")) {
      expect(text).toContain(zeile.startsWith(";") ? zeile : zeile.slice(0, 20));
    }
  });

  it("eine unbekannte Zeilenform BRICHT AB — sie wird nicht stillschweigend übergangen", () => {
    /*
     * Ausschließen allein wäre auch eine Entscheidung, nur eine unbemerkte.
     * Eine Zeile, die der Filter nicht liest, ist ein Objekttyp, über den
     * niemand entschieden hat — also Abbruch, nicht Weitermachen.
     */
    const r2 = filterToc(TOC + "\n999; 1 2 VOELLIG NEUE ART public dings postgres");
    expect(r2.behalten.some((e) => e.name === "dings")).toBe(false);
    expect(r2.zeilen.join("\n")).toContain("UNGEPARST");
    expect(r2.ungeparst).toHaveLength(1);
    expect(r2.verstoesse.join(" ")).toContain("unbekannte Form");
    /* Und der Bericht nennt sie, damit man sie nachsehen kann. */
    expect(bericht(r2)).toContain("VOELLIG NEUE ART");
  });

  it("ohne unbekannte Zeilen ist der Bericht an dieser Stelle leer", () => {
    expect(r.ungeparst).toEqual([]);
    expect(bericht(r)).toContain("UNGEPARSTE ZEILEN");
    expect(bericht(r)).toContain("keine");
  });

  it("der Bericht nennt Zahlen und die verworfenen Systemobjekte", () => {
    const b = bericht(r);
    expect(b).toContain("BEHALTEN");
    expect(b).toContain("Summe behalten:");
    expect(b).toContain("auth TABLE DATA schema_migrations");
  });
});

describe("POSITIVKONTROLLEN: der Filter schlägt an, wenn er zu viel durchlässt", () => {
  it("kein behaltener Eintrag ist ein Strukturobjekt aus auth oder storage", () => {
    /*
     * Die zweite, unabhängige Sicherung: selbst wenn `decide` eines Tages
     * falsch entschiede, prüft `filterToc` das Ergebnis noch einmal als
     * Ganzes. Hier wird dieselbe Eigenschaft direkt behauptet — aus auth und
     * storage darf NICHTS Strukturelles übrig sein, nur Fracht und die vier
     * eigenen Policies.
     */
    const struktur = new Set(["TABLE", "FUNCTION", "TRIGGER", "CONSTRAINT",
                              "FK CONSTRAINT", "INDEX", "ACL", "DEFAULT ACL",
                              "SEQUENCE", "VIEW", "TYPE", "SCHEMA"]);
    const uebrig = filterToc(TOC).behalten
      .filter((e) => e.schema === "auth" || e.schema === "storage")
      .filter((e) => struktur.has(e.desc));
    expect(uebrig).toEqual([]);
  });

  it("ohne Sequenzstände ist der Plan unzulässig", () => {
    const ohne = filterToc(TOC.split("\n")
      .filter((z) => !z.includes("SEQUENCE SET")).join("\n"));
    expect(ohne.verstoesse.join(" ")).toContain("Sequenzstaende");
  });

  it("ohne Daten aus public ist der Plan unzulässig", () => {
    const ohne = filterToc(TOC.split("\n")
      .filter((z) => !z.includes("TABLE DATA public")).join("\n"));
    expect(ohne.verstoesse.join(" ")).toContain("Datenzeile aus public");
  });

  it("ohne Tabellenstruktur aus public ist der Plan unzulässig", () => {
    const ohne = filterToc(TOC.split("\n")
      .filter((z) => !/ TABLE public /.test(z)).join("\n"));
    expect(ohne.verstoesse.join(" ")).toContain("Tabellenstruktur");
  });

  it("ein behaltener Eintrag aus einem vierten Schema wäre ein Verstoß", () => {
    /*
     * `cron`, `realtime`, `vault`, `extensions`, `supabase_functions` gehören
     * der Plattform. `decide` verwirft sie; diese Zusicherung ist das zweite
     * Netz, falls jemand die Regel einmal lockert.
     */
    const r3 = filterToc(TOC);
    expect(r3.behalten.every((e) => ["public", "auth", "storage"].includes(e.schema)))
      .toBe(true);
    expect(r3.verstoesse.join(" ")).not.toContain("fremden Schemata");
  });
});
