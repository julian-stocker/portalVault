import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

import {
  bewerteFamilienbild, planwert, pruefeNachher, pruefeVorher, type Familienbild,
} from "./publish-cas";
import {
  familienWidersprueche, ordneFamilienschritte, ordneVariantenschritte,
} from "./publish-variants";

/* ==========================================================================
 * CAT-19 — ein ganzer Publish gegen echtes PostgreSQL, MIT und OHNE `0168`.
 *
 * Das Ziel ist eine PGlite-Datenbank mit den WÖRTLICHEN Funktionen aus
 * `0158` und `0159` — so wie Production heute — und optional `0168`
 * darüber. Der Lauf unten ist der Klasse-B-Zweig aus
 * `tools/catalog-sync-apply.mts`, Schritt für Schritt nachgebaut, und er
 * benutzt dieselben Entscheidungsfunktionen: `pruefeVorher`, `pruefeNachher`,
 * `bewerteFamilienbild`, `ordneVariantenschritte`, `ordneFamilienschritte`.
 * Der letzte Block hält fest, dass der Executor genau diese Folge ruft.
 * ========================================================================== */

const MIG = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");
function rumpf(datei: string, name: string): string {
  const sql = MIG(datei);
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}
const FELDER = ["catalog_visible", "display_name_override", "admin_note", "catalog_group",
  "image_override_path", "card_type", "created", "catalog_status", "merged_from",
  "discarded", "character_id", "base_sky_id", "deleted", "types", "visible_type"];

const SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.is_platform_admin() returns boolean language sql stable as $$ select true $$;
create table public.characters (
  id bigint generated always as identity primary key, canonical_name text not null,
  element text, species text, role_type text, short_description text,
  source_url text, source_label text, verified_at date);
create unique index on public.characters (lower(canonical_name));
create table public.skylanders (
  sky_id text primary key, name text not null, series_code text not null,
  character_id bigint references public.characters (id) on delete restrict,
  base_sky_id text, display_name_override text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint skylanders_id_series_uniq unique (sky_id, series_code),
  constraint skylanders_base_not_self check (base_sky_id is distinct from sky_id),
  constraint skylanders_base_same_series foreign key (base_sky_id, series_code)
    references public.skylanders (sky_id, series_code) on update restrict on delete restrict);
/* Wie 0001: jede Änderung verschiebt die Marke. Gelesen wird sie als TEXT —
   so liefert PostgREST sie dem Executor, mit Mikrosekunden. */
create function public.t_marke() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger skylanders_set_updated_at before update on public.skylanders
  for each row execute function public.t_marke();
create table public.catalog_admin_changes (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, field text not null,
  old_value text, new_value text, changed_by uuid,
  constraint catalog_admin_changes_entity_known check (entity in ('skylander', 'category')),
  constraint catalog_admin_changes_field_known check (field in (${FELDER.map((f) => `'${f}'`).join(", ")})));
create table public.collection_items (sky_id text references public.skylanders (sky_id), quantity int);
`;

type Soll = Record<string, { serie: string; basis: string | null; familie: string | null }>;

async function ziel(mit0168: boolean, start: Soll, familien: string[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  for (const [d, n] of [["0158_figure_families.sql", "admin_create_character"],
                        ["0158_figure_families.sql", "admin_set_character"],
                        ["0159_variant_base_figure.sql", "skylanders_variant_base_guard"],
                        ["0159_variant_base_figure.sql", "admin_set_variant_base"]] as const) {
    await db.exec(rumpf(d, n));
  }
  await db.exec(`create trigger skylanders_variant_base_guard_trg
    before insert or update of base_sky_id on public.skylanders
    for each row execute function public.skylanders_variant_base_guard();`);
  for (const f of familien) await db.query("insert into public.characters (canonical_name) values ($1)", [f]);
  /* Erst die Basisfiguren, dann die Varianten. */
  const reihe = Object.entries(start).sort(([, a], [, b]) => Number(a.basis !== null) - Number(b.basis !== null));
  for (const [sky, z] of reihe) {
    await db.query(`insert into public.skylanders (sky_id, name, series_code, base_sky_id, character_id)
      values ($1, $1, $2, $3, (select id from public.characters where canonical_name = $4))`,
      [sky, z.serie, z.basis, z.familie]);
  }
  await db.query("insert into public.collection_items values ('SKY-0002', 3)");
  if (mit0168) await db.exec(MIG("0168_variant_family_inheritance.sql"));
  return db;
}

type Schritt = { art: string; sky_id: string; feld?: string; von?: string; nach?: string };

/** Der Planer im Kleinen: Familien anlegen, dann je Zeile base_sky_id und familie. */
async function planen(db: PGlite, soll: Soll): Promise<Schritt[]> {
  const ist = await stand(db);
  const da = new Set((await db.query<{ n: string }>("select canonical_name as n from public.characters")).rows.map((r) => r.n));
  const plan: Schritt[] = [];
  const gebraucht = new Set(Object.values(soll).map((z) => z.familie).filter((f): f is string => f !== null));
  for (const f of [...gebraucht].sort()) if (!da.has(f)) plan.push({ art: "charakter-anlegen", sky_id: "—", nach: f });
  for (const sky of Object.keys(soll).sort()) {
    const a = ist[sky]; const z = soll[sky];
    if ((a.basis ?? "~") !== (z.basis ?? "~")) {
      plan.push({ art: "feld", sky_id: sky, feld: "base_sky_id", von: a.basis ?? "~", nach: z.basis ?? "~" });
    }
    if ((a.familie ?? "~") !== (z.familie ?? "~")) {
      plan.push({ art: "feld", sky_id: sky, feld: "familie", von: a.familie ?? "~", nach: z.familie ?? "~" });
    }
  }
  return plan;
}

async function stand(db: PGlite): Promise<Soll> {
  const r = await db.query<{ s: string; serie: string; b: string | null; f: string | null }>(
    `select s.sky_id as s, s.series_code as serie, s.base_sky_id as b, c.canonical_name as f
       from public.skylanders s left join public.characters c on c.id = s.character_id`);
  return Object.fromEntries(r.rows.map((z) => [z.s, { serie: z.serie, basis: z.b, familie: z.f }]));
}
const journal = async (db: PGlite) =>
  Number((await db.query<{ n: number }>("select count(*)::int as n from public.catalog_admin_changes")).rows[0].n);

/**
 * Der Klasse-B-Zweig des Executors. `stoerung` greift vor dem n-ten Schritt
 * ein (fremde Änderung oder Abbruch), um Drift und Wiederanlauf zu prüfen.
 */
async function ausfuehren(db: PGlite, roh: Schritt[], opt: {
  widersprueche?: number; stoerung?: { vor: number; was: (db: PGlite) => Promise<void> };
} = {}): Promise<{ geschrieben: number; erwartet: number; delta: number; vererbt: number }> {
  if ((opt.widersprueche ?? 0) > 0) throw new Error("TOR 1c — Familienwidersprueche im Plan");
  const charakterId = new Map<string, number>();
  const ladeChar = async () => {
    for (const r of (await db.query<{ id: number; n: string }>(
      "select id, canonical_name as n from public.characters")).rows) charakterId.set(r.n, Number(r.id));
  };
  await ladeChar();
  const jetzt = new Map((await db.query<{ s: string; u: unknown; b: string | null; c: number | null }>(
    "select sky_id as s, updated_at::text as u, base_sky_id as b, character_id as c from public.skylanders"))
    .rows.map((r) => [r.s, { updated_at: r.u, base_sky_id: r.b, character_id: r.c }]));

  const RANG: Record<string, number> = { "charakter-anlegen": 0, feld: 1 };
  const FELDRANG: Record<string, number> = { base_sky_id: 2, familie: 3 };
  const schritte = [...roh].sort((a, b) => (RANG[a.art] - RANG[b.art])
    || ((FELDRANG[a.feld ?? ""] ?? 5) - (FELDRANG[b.feld ?? ""] ?? 5)) || a.sky_id.localeCompare(b.sky_id));
  schritte.splice(0, schritte.length, ...ordneVariantenschritte(schritte));
  const basisZiel = new Map(schritte.filter((s) => s.feld === "base_sky_id")
    .map((s) => [s.sky_id, s.nach === "~" ? null : s.nach ?? null] as const));
  schritte.splice(0, schritte.length, ...ordneFamilienschritte(schritte, (id) =>
    basisZiel.has(id) ? basisZiel.get(id)! : jetzt.get(id)?.base_sky_id ?? null));

  const familienbild = async (sky: string): Promise<Familienbild> => new Map(
    (await db.query<{ s: string; c: number | null; b: string | null; u: unknown }>(
      `select sky_id as s, character_id as c, base_sky_id as b, updated_at::text as u from public.skylanders
        where sky_id = $1 or base_sky_id = $1`, [sky])).rows
      .map((r) => [r.s, { character_id: r.c === null ? null : Number(r.c), base_sky_id: r.b, updated_at: r.u }]));
  const lies = async (sky: string, feld: "familie" | "base_sky_id") => {
    const r = (await db.query<{ c: number | null; b: string | null; u: unknown }>(
      "select character_id as c, base_sky_id as b, updated_at::text as u from public.skylanders where sky_id = $1",
      [sky])).rows[0];
    const namen = new Map([...charakterId].map(([n, i]) => [i, n] as const));
    return { ist: feld === "familie" ? planwert("familie", r.c, namen) : (r.b ?? "~"), marke: r.u };
  };

  const vorherJournal = await journal(db);
  const familieGeerbt = new Map<string, string>();
  let erwartet = 0; let geschrieben = 0; let vererbt = 0;
  for (const [i, s] of schritte.entries()) {
    if (opt.stoerung && opt.stoerung.vor === i) await opt.stoerung.was(db);
    if (s.art === "charakter-anlegen") {
      await db.query("select public.admin_create_character($1)", [s.nach]);
      await ladeChar();
      continue;
    }
    const feld = s.feld as "familie" | "base_sky_id";
    let journalt = 1;
    erwartet += journalt;
    const bildVor = await familienbild(s.sky_id);
    const vorher = await lies(s.sky_id, feld);
    const urteil = pruefeVorher({
      wie: `${feld} ${s.sky_id}`, ist: vorher.ist, von: s.von!, nach: s.nach!,
      markeIst: vorher.marke, markeErwartet: jetzt.get(s.sky_id)?.updated_at,
      auchErlaubt: feld === "familie" && familieGeerbt.has(s.sky_id) ? [familieGeerbt.get(s.sky_id)!] : [],
    });
    if (!urteil.ok) throw new Error(`TOR 2b — ${urteil.grund}`);
    if (feld === "familie" && vorher.ist === s.nach) { erwartet -= journalt; vererbt += 1; geschrieben += 1; continue; }

    if (feld === "familie") {
      await db.query("select public.admin_set_character($1, $2)",
        [s.sky_id, s.nach === "~" ? null : charakterId.get(s.nach!)]);
    } else {
      await db.query("select public.admin_set_variant_base($1, $2, false)",
        [s.sky_id, s.nach === "~" ? null : s.nach]);
    }
    const nachher = await lies(s.sky_id, feld);
    const n = pruefeNachher({ wie: `${feld} ${s.sky_id}`, ist: nachher.ist, nach: s.nach! });
    if (!n.ok) throw new Error(`TOR 2b — ${n.grund}`);
    const eintrag = jetzt.get(s.sky_id);
    if (eintrag) eintrag.updated_at = nachher.marke;

    const befund = bewerteFamilienbild({ feld, skyId: s.sky_id, vor: bildVor, nach: await familienbild(s.sky_id) });
    if (befund.fehler !== null) throw new Error(`TOR 2c — ${befund.fehler}`);
    for (const [id, m] of befund.mitbewegt) {
      const mit = jetzt.get(id);
      if (mit) { mit.updated_at = m.updated_at; mit.character_id = m.character_id; }
    }
    if (befund.eigeneUebernommen) {
      const namen = new Map([...charakterId].map(([nm, id]) => [id, nm] as const));
      familieGeerbt.set(s.sky_id, planwert("familie", befund.eigeneNeu, namen));
    }
    erwartet += befund.nebenbei; journalt += befund.nebenbei;
    geschrieben += 1;
  }
  return { geschrieben, erwartet, delta: (await journal(db)) - vorherJournal, vererbt };
}

/* ---------------------------------------------------------------- Die Fälle */

/**
 * Production heute → Staging-Ziel. Drei Basisfiguren in zwei Serien, mehrere
 * Varianten, eine neue Familie, ein Wechsel, eine NULL-Familie, ein
 * Basiswechsel und eine serienübergreifende Familie.
 */
const START: Soll = {
  "SKY-0001": { serie: "G", basis: null, familie: null },          // Sprocket (Basis)
  "SKY-0002": { serie: "G", basis: "SKY-0001", familie: null },    // Sparkle Sprocket
  "SKY-0003": { serie: "G", basis: "SKY-0001", familie: null },
  "SKY-0010": { serie: "SF", basis: null, familie: "Heavy Duty Sprocket" },
  "SKY-0011": { serie: "SF", basis: "SKY-0010", familie: "Heavy Duty Sprocket" },
  "SKY-0020": { serie: "G", basis: null, familie: "Prism Break Light Core" },
  "SKY-0021": { serie: "G", basis: "SKY-0020", familie: "Prism Break Light Core" },
  "SKY-0030": { serie: "G", basis: null, familie: "Whirlwind" },   // wird NULL
  "SKY-0031": { serie: "G", basis: "SKY-0030", familie: "Whirlwind" },
  "SKY-0040": { serie: "G", basis: null, familie: null },          // eigenständig
};
const ZIEL: Soll = {
  "SKY-0001": { serie: "G", basis: null, familie: "Sprocket" },
  "SKY-0002": { serie: "G", basis: "SKY-0001", familie: "Sprocket" },
  "SKY-0003": { serie: "G", basis: "SKY-0001", familie: "Sprocket" },
  "SKY-0010": { serie: "SF", basis: null, familie: "Sprocket" },
  "SKY-0011": { serie: "SF", basis: "SKY-0010", familie: "Sprocket" },
  "SKY-0020": { serie: "G", basis: null, familie: "Prism Break" },
  "SKY-0021": { serie: "G", basis: "SKY-0001", familie: "Sprocket" },  // Basiswechsel
  "SKY-0030": { serie: "G", basis: null, familie: null },
  "SKY-0031": { serie: "G", basis: "SKY-0030", familie: null },
  "SKY-0040": { serie: "G", basis: null, familie: "Chompy Mage" },
};
const FAMILIEN = ["Heavy Duty Sprocket", "Prism Break Light Core", "Whirlwind", "Prism Break"];

for (const mit0168 of [false, true]) {
  describe(`ein ganzer Publish ${mit0168 ? "MIT" : "OHNE"} 0168 auf dem Ziel`, () => {
    it("erreicht genau den Staging-Stand, mit exakt erwarteten Journalzeilen", async () => {
      const db = await ziel(mit0168, START, FAMILIEN);
      const plan = await planen(db, ZIEL);
      expect(familienWidersprueche(new Map(Object.entries(ZIEL).map(([k, z]) =>
        [k, { base_sky_id: z.basis, familie: z.familie }])))).toEqual([]);
      const lauf = await ausfuehren(db, plan);
      expect(await stand(db)).toEqual(ZIEL);
      expect(lauf.delta).toBe(lauf.erwartet);
      /* Mit 0168 nimmt die Kaskade Varianten mit — deren eigene Schritte
         schreiben dann nichts. Ohne 0168 schreibt jeder Schritt selbst. */
      if (mit0168) expect(lauf.vererbt).toBeGreaterThan(0);
      else expect(lauf.vererbt).toBe(0);
      /* Kein Schritt doppelt, keiner vergessen. */
      expect(lauf.geschrieben).toBe(plan.filter((s) => s.art === "feld").length);
      /* Die Sammlung blieb, wie sie war. */
      expect((await db.query<{ q: number }>("select quantity as q from public.collection_items")).rows[0].q).toBe(3);
      /* Ein zweiter Plan ist leer — nichts bleibt offen. */
      expect(await planen(db, ZIEL)).toEqual([]);
      await db.close();
    }, 60_000);

    it("die Übertragung aus 0159 (Basis hat schon eine ALTE Familie) bricht nicht ab", async () => {
      /* Die Lücke aus dem Review: eine Variante ohne Familie bekommt eine
         Basisfigur, die auf dem Ziel noch die alte Familie trägt; beide
         sollen die neue tragen. */
      const start: Soll = {
        "SKY-0001": { serie: "G", basis: null, familie: "Alt" },
        "SKY-0002": { serie: "G", basis: null, familie: null },
        "SKY-0009": { serie: "G", basis: null, familie: null },
      };
      start["SKY-0002"].basis = "SKY-0009";
      const soll: Soll = {
        "SKY-0001": { serie: "G", basis: null, familie: "Neu" },
        "SKY-0002": { serie: "G", basis: "SKY-0001", familie: "Neu" },
        "SKY-0009": { serie: "G", basis: null, familie: null },
      };
      const db = await ziel(mit0168, start, ["Alt", "Neu"]);
      const lauf = await ausfuehren(db, await planen(db, soll));
      expect(await stand(db)).toEqual(soll);
      expect(lauf.delta).toBe(lauf.erwartet);
      await db.close();
    }, 60_000);

    it("Drift: eine fremde Änderung mitten im Lauf bricht ab, und danach wird nichts mehr geschrieben", async () => {
      const db = await ziel(mit0168, START, FAMILIEN);
      const plan = await planen(db, ZIEL);
      let fehler = "";
      const vorher = await journal(db);
      try {
        await ausfuehren(db, plan, { stoerung: { vor: 6, was: async (d) => {
          await d.exec("update public.skylanders set display_name_override = 'fremd' where sky_id like 'SKY-00%'");
        } } });
      } catch (e) { fehler = (e as Error).message; }
      expect(fehler).toMatch(/TOR 2b/);
      const geschriebenBisDahin = (await journal(db)) - vorher;
      expect(geschriebenBisDahin).toBeGreaterThan(0);
      await db.close();
    }, 60_000);

    it("Wiederanlauf: nach einem Abbruch plant der zweite Lauf nur den Rest und erreicht das Ziel", async () => {
      const db = await ziel(mit0168, START, FAMILIEN);
      try {
        await ausfuehren(db, await planen(db, ZIEL), { stoerung: { vor: 3, was: async () => {
          throw new Error("Netz weg");
        } } });
      } catch { /* erwartet */ }
      const rest = await planen(db, ZIEL);
      expect(rest.length).toBeGreaterThan(0);
      expect(rest.filter((s) => s.art === "charakter-anlegen")).toEqual([]);   // keine Familie doppelt
      const lauf = await ausfuehren(db, rest);
      expect(await stand(db)).toEqual(ZIEL);
      expect(lauf.delta).toBe(lauf.erwartet);
      expect((await db.query<{ n: number }>(
        "select count(*)::int as n from public.characters where canonical_name = 'Sprocket'")).rows[0].n).toBe(1);
      await db.close();
    }, 60_000);

    it("TOR 1c: ein Ziel mit Familienwiderspruch wird gar nicht erst angefangen", async () => {
      const db = await ziel(mit0168, START, FAMILIEN);
      const kaputt: Soll = { ...ZIEL, "SKY-0002": { serie: "G", basis: "SKY-0001", familie: null } };
      const w = familienWidersprueche(new Map(Object.entries(kaputt).map(([k, z]) =>
        [k, { base_sky_id: z.basis, familie: z.familie }])));
      expect(w.map((x) => x.sky_id)).toEqual(["SKY-0002"]);
      const j = await journal(db);
      await expect(ausfuehren(db, await planen(db, kaputt), { widersprueche: w.length }))
        .rejects.toThrow(/TOR 1c/);
      expect(await journal(db)).toBe(j);
      await db.close();
    }, 60_000);
  });
}

describe("der Executor ruft genau diese Folge", () => {
  const ex = readFileSync("tools/catalog-sync-apply.mts", "utf8");
  const zweig = ex.slice(ex.indexOf("} else if (s.feld && s.feld in RPC_B) {"),
                         ex.indexOf('} else if (s.feld === "catalog_visible" || s.feld === "catalog_status") {'));
  it("lesen, prüfen, ggf. überspringen, schreiben, nachprüfen, Familienbild bewerten", () => {
    const folge = ["await familienbild(s.sky_id)", "await liesKlasseB(s.sky_id, feldB)", "pruefeVorher(",
      'if (feldB === "familie" && vorher.ist === t(s.nach)) {', "await W.rpc(r.fn,", "pruefeNachher(",
      "eintrag.updated_at = nachher.marke", "bewerteFamilienbild(", "familieGeerbt.set("];
    let bei = -1;
    for (const f of folge) {
      const i = zweig.indexOf(f, bei + 1);
      expect(i, f).toBeGreaterThan(bei);
      bei = i;
    }
    expect(zweig).toContain('feldB === "familie" && familieGeerbt.has(s.sky_id) ? [familieGeerbt.get(s.sky_id)!]');
  });
});
