import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Migration `0106` — der Zugriffsweg auf die Exporthistorie.
 *
 * WAS DIESE TESTS BEWEISEN UND WAS NICHT. Sie lesen die SQL und prüfen, dass
 * sie das Richtige SAGT: Wächter, Rechte, Zustandsmaschine, Endgültigkeit.
 * Sie führen kein SQL aus — der Laufzeitbeweis kommt aus den Rollenproben auf
 * Staging, so wie bei `0104` und `0105`. Beides ist nötig: eine Migration,
 * die auf Staging grün ist, deren Absicht aber nirgends festgeschrieben steht,
 * lädt die nächste Änderung ein, sie still zu verlieren.
 */
const DIR = "supabase/migrations";
const FILE = `${DIR}/0106_platform_export_history.sql`;
const SQL = readFileSync(FILE, "utf8");

/** Ohne Zeilenkommentare: der Kopf nennt Zustände, Rollen und Fehlerfälle. */
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

/** Der Rumpf einer Funktion, zwischen ihren `$$`-Marken. */
function body(name: string): string {
  const at = CODE.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} fehlt`).toBeGreaterThan(-1);
  const open = CODE.indexOf("as $$", at);
  return CODE.slice(open + 5, CODE.indexOf("$$;", open));
}

/** Signatur und Flags: von der Anlage bis zum Rumpf. */
function head(name: string): string {
  const at = CODE.indexOf(`create or replace function public.${name}(`);
  return CODE.slice(at, CODE.indexOf("as $$", at));
}

/** Die drei Funktionen, die die Route später aufruft, mit ihrer Signatur. */
const ADMIN_FUNCTIONS = [
  { name: "admin_platform_export_runs", args: "" },
  {
    name: "admin_record_platform_export",
    args: "integer, text, bigint, text, integer, integer, integer",
  },
  { name: "admin_settle_platform_export", args: "bigint, text, text" },
] as const;

/** Die beiden Triggerfunktionen — niemand ruft sie von Hand auf. */
const TRIGGER_FUNCTIONS = ["platform_export_runs_protect", "platform_export_runs_no_delete"];

// ---------------------------------------------------------------------------
// 1. Form und Wächter
// ---------------------------------------------------------------------------

describe("alle drei Adminfunktionen haben dieselbe Form", () => {
  for (const fn of ADMIN_FUNCTIONS) {
    it(`${fn.name} ist security definer mit leerem search_path`, () => {
      expect(head(fn.name)).toContain("security definer");
      expect(head(fn.name)).toContain("set search_path = ''");
    });

    it(`${fn.name} steht hinter is_platform_admin()`, () => {
      expect(body(fn.name)).toContain("public.is_platform_admin()");
      // Kein zweiter, selbstgebauter Rollenbegriff.
      expect(body(fn.name)).not.toContain("platform_admins");
      expect(body(fn.name)).not.toContain("is_shop_admin");
      expect(body(fn.name)).not.toContain("can_operate_active_seller");
      expect(body(fn.name)).not.toContain("current_role");
      expect(body(fn.name)).not.toContain("session_user");
    });
  }

  it("die lesende Funktion ist stable und liefert anderen eine leere Menge", () => {
    /*
     * Wächter als `where`-Bedingung, nicht als `raise`: „nicht deins" und
     * „nichts vorhanden" sollen gleich aussehen — dieselbe Wahl wie bei
     * system_platform_export() und seller_business_backup().
     */
    expect(head("admin_platform_export_runs")).toContain("language sql");
    expect(head("admin_platform_export_runs")).toContain("stable");
    expect(body("admin_platform_export_runs")).toContain("where public.is_platform_admin()");
    expect(body("admin_platform_export_runs")).not.toContain("raise exception");
  });

  it("die beiden schreibenden Funktionen weisen ab, statt still zu verwerfen", () => {
    /*
     * Umgekehrte Wahl, mit Grund: ein stillschweigend verworfener
     * Schreibvorgang sieht für den Aufrufer wie Erfolg aus.
     */
    for (const fn of ["admin_record_platform_export", "admin_settle_platform_export"]) {
      expect(body(fn)).toContain("if not public.is_platform_admin() then");
      expect(body(fn)).toContain("errcode = 'insufficient_privilege'");
    }
  });

  it("die lesende Funktion schreibt nichts", () => {
    for (const write of ["insert into", "update ", "delete from", "nextval"]) {
      expect(body("admin_platform_export_runs").toLowerCase().includes(write), write).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Rechte
// ---------------------------------------------------------------------------

describe("kein PUBLIC, kein anon, keine Service Role", () => {
  for (const fn of ADMIN_FUNCTIONS) {
    const sig = `public.${fn.name}(${fn.args})`;

    it(`${fn.name} wird public und anon entzogen und nur authenticated gegeben`, () => {
      expect(CODE).toContain(`revoke all on function ${sig} from public, anon;`);
      expect(CODE).toContain(`grant execute on function ${sig} to authenticated;`);
    });

    it(`${fn.name} bekommt die Service Role ausdrücklich nicht`, () => {
      /*
       * Supabase' Default-Privileges vergeben EXECUTE auf neue Funktionen in
       * `public` an service_role — gemessen an `system_platform_export()`,
       * das dieses Recht hatte, obwohl 0105 es nie vergeben hat. Deshalb wird
       * es hier für jede neue Funktion einzeln entzogen.
       */
      expect(CODE).toContain(`revoke execute on function ${sig} from service_role;`);
    });

    it(`${fn.name} wird an keine andere Rolle vergeben`, () => {
      const grants = [...CODE.matchAll(
        new RegExp(`grant execute on function ${sig.replace(/[()]/g, "\\$&")} to ([a-z_, ]+);`, "g"),
      )].map((m) => m[1].trim());
      expect(grants).toEqual(["authenticated"]);
    });
  }

  it("vergibt nirgends ein Recht an public oder anon", () => {
    expect(CODE).not.toMatch(/grant[^;]*\bto\b[^;]*\b(public|anon)\b/);
  });

  it("die Triggerfunktionen kann niemand von außen aufrufen", () => {
    /*
     * Eine Triggerfunktion direkt aufzurufen scheitert ohnehin an Postgres
     * (`trigger functions can only be called as triggers`). Das Recht wird
     * trotzdem entzogen, damit „0106 vergibt nichts an public" ohne Ausnahme
     * gilt. Das Entziehen steht HINTER `create trigger`: EXECUTE wird beim
     * Anlegen des Triggers geprüft, nicht beim Feuern.
     */
    for (const fn of TRIGGER_FUNCTIONS) {
      // Die Datei richtet die beiden Revokes untereinander aus, daher \s+.
      expect(CODE).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(\\)\\s+from public, anon, authenticated;`));
      expect(CODE.indexOf(`create trigger ${fn}`))
        .toBeLessThan(CODE.indexOf(`revoke all on function public.${fn}()`));
    }
  });
});

describe("die Tabelle bleibt für Clients geschlossen", () => {
  it("bekommt keine Policy und kein Tabellenrecht", () => {
    expect(CODE).not.toContain("create policy");
    expect(CODE).not.toMatch(/grant[^;]*on table public\.platform_export_runs/);
    expect(CODE).not.toContain("disable row level security");
  });

  it("0105 hat public, anon und authenticated entzogen, 0106 die Service Role", () => {
    /*
     * Zusammen ergibt das den Zielzustand: kein direkter Datenzugriff für
     * irgendeine Clientrolle. Beide Hälften werden hier geprüft, damit ein
     * späteres Aufweichen einer der beiden auffällt.
     */
    const sql0105 = readFileSync(`${DIR}/0105_platform_export.sql`, "utf8");
    expect(sql0105).toContain(
      "revoke all on table public.platform_export_runs from public, anon, authenticated;");
    expect(CODE).toContain("revoke all on table public.platform_export_runs from service_role;");
  });

  it("nimmt der Service Role auch den Export selbst", () => {
    expect(CODE).toContain(
      "revoke execute on function public.system_platform_export() from service_role;");
  });

  it("ändert keine globalen Default-Privileges", () => {
    /*
     * Die Rechte, die hier entzogen werden, stammen aus
     * `alter default privileges` auf `public`. Diese Basis zu ändern wirkt auf
     * JEDES künftige Objekt des Schemas und gehört nicht in eine Migration
     * über eine Exporthistorie.
     */
    expect(CODE.toLowerCase()).not.toContain("alter default privileges");
    expect(CODE.toLowerCase()).not.toContain("alter role");
    expect(CODE.toLowerCase()).not.toContain("create role");
    expect(CODE.toLowerCase()).not.toContain("grant service_role");
  });
});

// ---------------------------------------------------------------------------
// 3. Die Zustandsmaschine
// ---------------------------------------------------------------------------

describe("ein Lauf entsteht ausschließlich als generated", () => {
  const record = body("admin_record_platform_export");

  it("schreibt den Status als Literal und nimmt ihn nicht als Parameter", () => {
    /*
     * Eine Funktion, die den Status annähme, könnte einen Lauf als bestätigt
     * anlegen, ohne dass ihn jemand bestätigt hat.
     */
    expect(record).toContain("'generated'");
    expect(head("admin_record_platform_export")).not.toContain("p_status");
    expect(record).not.toContain("'received'");
    expect(record).not.toContain("'failed'");
  });

  it("setzt weder received_at noch failure_stage", () => {
    expect(record).not.toContain("received_at");
    expect(record).not.toContain("failure_stage");
  });

  it("gibt die Kennung des neuen Laufs zurück", () => {
    expect(head("admin_record_platform_export")).toContain("returns bigint");
    expect(record).toContain("returning id into v_id");
    expect(record).toContain("return v_id;");
  });

  it("ist der einzige INSERT in 0106", () => {
    const inserts = [...CODE.matchAll(/insert into public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(inserts).toEqual(["platform_export_runs"]);
  });
});

describe("abgeschlossen heißt endgültig", () => {
  const settle = body("admin_settle_platform_export");

  it("verlangt genau eine Absicht pro Aufruf", () => {
    // Prüfsumme (→ received) ODER Fehlerstufe (→ failed). Beides oder keines
    // von beidem ist keine Absicht, sondern ein Fehler im Aufrufer.
    expect(settle).toContain("if (p_sha256 is null) = (p_failure_stage is null) then");
    expect(settle).toContain("errcode = 'invalid_parameter_value'");
  });

  it("lässt nur generated abschließen", () => {
    expect(settle).toContain("if v_status <> 'generated' then");
    expect(settle).toContain("errcode = 'check_violation'");
  });

  it("weist eine unbekannte Kennung ab, statt sie still hinzunehmen", () => {
    expect(settle).toContain("if not found then");
    expect(settle).toContain("errcode = 'no_data_found'");
  });

  it("sperrt die Zeile, damit zwei Abschlüsse nicht beide gewinnen", () => {
    expect(settle).toContain("for update");
  });

  it("vergleicht die Prüfsumme und übernimmt sie nicht", () => {
    /*
     * `received` heißt: die Datei, die ankam, ist die Datei, die ging. Eine
     * Funktion, die den Hash überschriebe, beantwortete genau die Frage
     * nicht, für die sie existiert.
     */
    expect(settle).toContain("if v_sha256 is distinct from p_sha256 then");
    expect(settle).not.toMatch(/set[^;]*sha256\s*=/);
  });

  it("nennt den gespeicherten Hash in keiner Fehlermeldung", () => {
    // Eine Meldung, die den erwarteten Hash mitschickt, macht den Vergleich
    // sinnlos.
    const meldungen = [...settle.matchAll(/raise exception '([^']*)'(?:, ([^;]*?))? *\n? *using/g)];
    expect(meldungen.length).toBeGreaterThan(0);
    for (const m of meldungen) {
      expect(`${m[1]} ${m[2] ?? ""}`).not.toContain("v_sha256");
      expect(`${m[1]} ${m[2] ?? ""}`).not.toContain("p_sha256");
    }
  });

  it("führt genau zwei Übergänge aus und gibt den erreichten Status zurück", () => {
    const stati = [...settle.matchAll(/set\s+status = '([a-z]+)'/g)].map((m) => m[1]);
    expect(stati.sort()).toEqual(["failed", "received"]);
    expect(settle).toContain("return 'failed';");
    expect(settle).toContain("return 'received';");
    expect(head("admin_settle_platform_export")).toContain("returns text");
  });

  it("setzt received_at nur beim Bestätigen", () => {
    const empfangen = settle.slice(settle.indexOf("if v_sha256 is distinct from p_sha256"));
    expect(empfangen).toContain("status = 'received'");
    expect(empfangen).toContain("received_at = now()");
    const gescheitert = settle.slice(
      settle.indexOf("if p_failure_stage is not null then"),
      settle.indexOf("if v_sha256 is distinct from p_sha256"),
    );
    expect(gescheitert).toContain("status = 'failed'");
    expect(gescheitert).not.toContain("received_at");
  });

  it("kennt keinen Weg zurück nach generated", () => {
    expect(settle).not.toMatch(/set\s+status = 'generated'/);
    expect(CODE).not.toMatch(/set\s+received_at = null/);
    expect(CODE).not.toMatch(/set\s+failure_stage = null/);
  });
});

describe("der Trigger hält dieselben Regeln ein zweites Mal", () => {
  const protect = body("platform_export_runs_protect");

  it("hängt vor jedem UPDATE", () => {
    expect(CODE).toContain("drop trigger if exists platform_export_runs_protect on public.platform_export_runs;");
    expect(CODE).toContain("before update on public.platform_export_runs");
    expect(CODE).toContain("for each row execute function public.platform_export_runs_protect();");
  });

  it("lässt nur einen erzeugten Lauf verändern", () => {
    expect(protect).toContain("if old.status <> 'generated' then");
    expect(protect).toContain("errcode = 'restrict_violation'");
  });

  it("lässt ihn nur nach received oder failed", () => {
    expect(protect).toContain("if new.status not in ('received', 'failed') then");
  });

  it("friert die gemessenen Tatsachen ein", () => {
    /*
     * Ein Backup, dessen Größe oder Prüfsumme sich nachträglich ändern lässt,
     * belegt nichts. Genau die neun unveränderlichen Spalten, und genau die
     * drei, die der Abschluss setzen darf, bleiben draußen.
     */
    for (const spalte of ["id", "created_at", "format_version", "source_project",
                          "size_bytes", "sha256", "section_count",
                          "storage_file_count", "storage_missing_count"]) {
      expect(protect, `${spalte} ist nicht eingefroren`)
        .toContain(`new.${spalte}`);
    }
    for (const veraenderlich of ["status", "received_at", "failure_stage"]) {
      const eingefroren = new RegExp(
        `new\\.${veraenderlich}\\s+is distinct from old\\.${veraenderlich}`);
      expect(eingefroren.test(protect), `${veraenderlich} darf der Abschluss setzen`).toBe(false);
    }
  });

  it("verbietet das Löschen der Historie vollständig", () => {
    expect(body("platform_export_runs_no_delete")).toContain("raise exception");
    expect(body("platform_export_runs_no_delete")).toContain("errcode = 'restrict_violation'");
    expect(CODE).toContain("before delete on public.platform_export_runs");
  });

  it("beide Triggerfunktionen haben den leeren search_path", () => {
    for (const fn of TRIGGER_FUNCTIONS) {
      expect(head(fn)).toContain("set search_path = ''");
      expect(head(fn)).toContain("returns trigger");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Die Historie ist eine Historie, kein zweiter Weg zu den Daten
// ---------------------------------------------------------------------------

describe("über die Historie kommt niemand an Exportinhalte", () => {
  it("gibt genau die zwölf Spalten der Tabelle zurück", () => {
    const signatur = head("admin_platform_export_runs");
    const spalten = [...signatur.matchAll(/^\s{2}([a-z_0-9]+)\s+(bigint|text|timestamptz|integer)/gm)]
      .map((m) => m[1]);
    expect(spalten).toEqual([
      "id", "status", "created_at", "received_at", "format_version", "source_project",
      "size_bytes", "sha256", "section_count", "storage_file_count",
      "storage_missing_count", "failure_stage",
    ]);
  });

  it("liest keine andere Tabelle als die Historie", () => {
    const gelesen = new Set(
      [...CODE.matchAll(/(?:from|join|into)\s+public\.([a-z_0-9]+)/g)].map((m) => m[1]),
    );
    expect([...gelesen]).toEqual(["platform_export_runs"]);
  });

  it("ruft den Export nicht auf und erzeugt kein Dokument", () => {
    for (const fremd of ["seller_business_backup", "jsonb_build_object", "jsonb_agg",
                         "pg_current_snapshot", "coalesce((select"]) {
      expect(CODE, `${fremd} gehört nicht in 0106`).not.toContain(fremd);
    }
  });

  it("nennt system_platform_export() ausschließlich, um ein Recht zu entziehen", () => {
    /*
     * Die Ausnahme zur Regel darüber: Teil 2 nimmt der Service Role das
     * EXECUTE. Das ist der EINZIGE Grund, aus dem der Name hier vorkommen
     * darf — aufgerufen wird die Funktion nicht, und neu definiert schon
     * gar nicht.
     */
    const stellen = [...CODE.matchAll(/^.*system_platform_export.*$/gm)].map((m) => m[0].trim());
    expect(stellen).toEqual([
      "revoke execute on function public.system_platform_export() from service_role;",
    ]);
    for (const fn of [...ADMIN_FUNCTIONS.map((f) => f.name), ...TRIGGER_FUNCTIONS]) {
      expect(body(fn), `${fn} ruft den Export auf`).not.toContain("system_platform_export");
    }
  });

  it("sortiert deterministisch neueste zuerst", () => {
    /*
     * Nach `id`, nicht nach `created_at`: die Identität ist monoton und
     * eindeutig, zwei Läufe in derselben Sekunde hätten sonst keine feste
     * Reihenfolge. Eine Liste, die sich zwischen zwei Aufrufen umsortiert,
     * ist kein Nachweis.
     */
    expect(body("admin_platform_export_runs")).toContain("order by r.id desc");
    expect(body("admin_platform_export_runs")).not.toContain("order by r.created_at");
    expect(body("admin_platform_export_runs")).not.toContain("limit");
  });
});

// ---------------------------------------------------------------------------
// 5. Umfang und Drift
// ---------------------------------------------------------------------------

describe("0106 bleibt in seinem Umfang", () => {
  it("legt keine Tabelle an und ändert keine", () => {
    expect(CODE.toLowerCase()).not.toContain("create table");
    expect(CODE.toLowerCase()).not.toContain("alter table");
    expect(CODE.toLowerCase()).not.toContain("add column");
    expect(CODE.toLowerCase()).not.toContain("drop column");
  });

  it("löscht keine Daten und kein bestehendes Objekt außer den eigenen Triggern", () => {
    const drops = [...CODE.matchAll(/drop\s+(\w+)\s+if exists\s+([a-z_0-9.]+)/gi)]
      .map((m) => `${m[1].toLowerCase()} ${m[2]}`);
    expect(drops).toEqual([
      "trigger platform_export_runs_protect",
      "trigger platform_export_runs_no_delete",
    ]);
    expect(CODE.toLowerCase()).not.toContain("delete from");
    expect(CODE.toLowerCase()).not.toContain("truncate");
    expect(CODE.toLowerCase()).not.toContain("drop function");
  });

  it("enthält keine Route, keine UI, kein ZIP, kein Auth, kein Storage", () => {
    for (const spaeter of ["auth.", "storage.", "pg_cron", "cron.", "http", "zip",
                           "bucket", "restore"]) {
      expect(CODE.toLowerCase().includes(spaeter), `${spaeter} gehört nicht in 0106`).toBe(false);
    }
  });

  it("fasst 0104 und 0105 nicht an", () => {
    expect(CODE).not.toContain("seller_business_backup");
    expect(CODE).not.toContain("create or replace function public.system_platform_export");
  });

  it("0104 und 0105 sind byte-identisch geblieben", () => {
    const hash = (file: string) =>
      createHash("sha256").update(readFileSync(`${DIR}/${file}`)).digest("hex");
    expect(hash("0104_business_backup_export.sql"))
      .toBe("2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf");
    expect(hash("0105_platform_export.sql"))
      .toBe("e1fbd1e35253c1900d3aa166a8026644f6bcf7dea4ba4c2b9af37fcd746c9e68");
  });
});
