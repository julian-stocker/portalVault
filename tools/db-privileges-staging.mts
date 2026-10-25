/**
 * WAS DER PRUEFZUGANG WIRKLICH DARF — gemessen, nicht behauptet.
 *
 *   npm run db:privileges:staging
 *
 * WARUM ES DAS GIBT. Dreimal hintereinander ist die Nachkontrolle von `0146`
 * an einem fehlenden Recht gescheitert. Die ersten beiden Male war die
 * Umsetzung zu eng; das dritte Mal war schlimmer: die Pruefungen leiteten
 * die Rechte aus `staging-agent-setup.sql` ab — aus der ABSICHT. Am
 * 2026-10-20 hat `0139` `shop_offers()` mit `drop function` neu angelegt, und
 * `DROP`+`CREATE` verwirft die ACL. Die Erteilung war fort, die Datei sagte
 * weiter „erteilt", und jeder Probelauf bildete eine Welt nach, die es nicht
 * mehr gab.
 *
 * Dieses Werkzeug macht die Datenbank zur Quelle: es misst, vergleicht mit
 * der Erwartung und schreibt die Messung als Momentaufnahme fort. Die
 * Probelaeufe bauen ihre Welt daraus.
 *
 * REIN LESEND. Es erteilt nichts, es entzieht nichts — es fragt
 * `has_table_privilege`, `has_function_privilege` und den Katalog. Die Rolle
 * ist ohnehin an `default_transaction_read_only` gebunden.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  AUFNAHME, abdruck, erwartung, type Aufnahme,
} from "./lib/privileges.mts";
import {
  LESE_ROLLE, STAGING_REF, ladeUmgebung, redigiere, verbindeStaging,
} from "./lib/staging-db.mts";

/** Die Objekte, die eine Pruefdatei des Runners anfasst — plus die erwarteten. */
function gesuchteObjekte(): { tabellen: string[]; funktionen: string[] } {
  const e = erwartung();
  /*
   * Gemessen wird, was ERWARTET ist, und zusaetzlich alles, was `0146`
   * braucht — auch das, was ihm bewusst NICHT erteilt ist. Gerade die
   * Negativfaelle sind die interessanten: sie muessen in der Aufnahme als
   * `false` stehen, damit ein Probelauf sie richtig nachbildet.
   */
  return {
    tabellen: [...new Set([...e.tabellen, "offer_state", "offer_state_live",
                           "favorites"])].sort(),
    funktionen: [...new Set([...e.funktionen,
      "public.offer_state_window()", "public.refresh_offer_state()",
      "public.v1_sale_condition()", "public.reservation_ttl()",
      "public.is_position_sellable(bigint)",
      "public.shop_price(numeric,numeric,numeric)"])].sort(),
  };
}

const ab = (text: string): never => {
  console.error(`\n  ${text}\n`);
  process.exit(1);
};

async function main(): Promise<void> {
  console.log("");
  console.log("  RECHTE DES STAGING-PRUEFZUGANGS");
  console.log("  -------------------------------");

  ladeUmgebung(`${process.env.HOME ?? ""}/.skyisles/staging-db.env`);
  const db = await verbindeStaging();
  console.log(`  Ziel:   ${STAGING_REF}`);
  console.log(`  TLS:    ${db.tls}`);
  console.log("");

  const gesucht = gesuchteObjekte();
  const erwartet = erwartung();
  const liste = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");

  try {
    /* ---------------------------------------------------- Schema und Rolle */
    const kopf = (await db.fuehre(`
      select has_schema_privilege('${LESE_ROLLE}', 'public', 'usage')::text  as usage,
             has_schema_privilege('${LESE_ROLLE}', 'public', 'create')::text as erzeugen`
    ))[0][0];

    /* --------------------------------------------- Tabellen und Sichten */
    const tabZeilen = (await db.fuehre(`
      select c.relname::text as name,
             has_table_privilege('${LESE_ROLLE}', c.oid, 'select')::text as darf
        from pg_class c
       where c.relnamespace = 'public'::regnamespace
         and c.relkind in ('r', 'v', 'm')
         and c.relname in (${liste(gesucht.tabellen)})
       order by c.relname`))[0];

    /*
     * ------------------------------------------------------- Funktionen
     *
     * DIE SIGNATUR WIRD SELBST GEBAUT, nicht aus `regprocedure::text`
     * genommen: dessen Ausgabe laesst das Schema weg, wenn `public` im
     * `search_path` steht (`shop_offers()` statt `public.shop_offers()`).
     * Die erste Fassung verglich deshalb gegen eine Liste mit `public.`-
     * Praefix und fand NICHTS — der Abschnitt blieb leer, und das sah aus
     * wie „keine Funktion gefunden" statt wie ein Fehler im Vergleich.
     *
     * Gesucht wird ueber den NAMEN; die Signatur entsteht aus
     * `proargtypes`, also NUR AUS TYPEN.
     * `pg_get_function_identity_arguments` nimmt die Parameternamen mit
     * (`is_shop_eligible(p_sky_id text)`), und dann passt nichts mehr zu der
     * Erteilung in der Einrichtungsdatei (`is_shop_eligible(text)`) — die
     * zweite Fassung meldete deshalb „Funktion gibt es nicht". Fuer die
     * Rechte zaehlen ohnehin nur die Typen.
     */
    const fnNamen = [...new Set(gesucht.funktionen.map(
      (f) => f.replace(/^public\./, "").replace(/\(.*$/, "")))];
    const fnZeilen = (await db.fuehre(`
      select 'public.' || p.proname || '('
             || coalesce((select string_agg(format_type(t, null), ',' order by ord)
                            from unnest(p.proargtypes) with ordinality u(t, ord)), '')
             || ')' as sig,
             has_function_privilege('${LESE_ROLLE}', p.oid, 'execute')::text as darf,
             p.prosecdef::text as definer
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in (${liste(fnNamen)})
       order by 1`))[0];

    /* --------------------------------------------- Mitgliedschaften, beide Richtungen */
    const mitZeilen = (await db.fuehre(`
      select 'ist_mitglied_von' as richtung, g.rolname::text as andere
        from pg_auth_members m
        join pg_roles r on r.oid = m.member
        join pg_roles g on g.oid = m.roleid
       where r.rolname = '${LESE_ROLLE}'
      union all
      select 'hat_als_mitglied', r.rolname::text
        from pg_auth_members m
        join pg_roles r on r.oid = m.member
        join pg_roles g on g.oid = m.roleid
       where g.rolname = '${LESE_ROLLE}'
       order by 1, 2`))[0];

    const tabellen: Record<string, boolean> = {};
    for (const z of tabZeilen) tabellen[String(z.name)] = z.darf === "true";
    const funktionen: Record<string, { execute: boolean; definer: boolean }> = {};
    for (const z of fnZeilen) {
      funktionen[String(z.sig)] = {
        execute: z.darf === "true", definer: z.definer === "true",
      };
    }

    /* ------------------------------------------ Erwartung gegen Messung */
    const abweichungen: string[] = [];
    for (const t of erwartet.tabellen) {
      if (tabellen[t] === undefined) abweichungen.push(`Tabelle public.${t} gibt es nicht`);
      else if (!tabellen[t]) {
        abweichungen.push(`public.${t}: select ERTEILT laut ${"Einrichtungsdatei"}, `
          + "aber die Rolle darf NICHT lesen");
      }
    }
    /* Signaturen werden OHNE Leerraum verglichen: die Einrichtungsdatei
       schreibt `(numeric, numeric, numeric)`, der Katalog liefert dasselbe
       mit anderem Abstand. */
    const ohneRaum = (x: string) => x.replace(/\s+/g, "");
    for (const f of erwartet.funktionen) {
      const m = Object.entries(funktionen).find(([sig]) => ohneRaum(sig) === ohneRaum(f));
      if (m === undefined) abweichungen.push(`Funktion ${f} gibt es nicht`);
      else if (!m[1].execute) {
        abweichungen.push(`${m[0]}: execute ERTEILT laut Einrichtungsdatei, aber die `
          + "Rolle darf NICHT ausfuehren — wurde die Funktion mit `drop function` "
          + "neu angelegt? `DROP`+`CREATE` verwirft die ACL.");
      }
    }

    const { abdruck: stand, erheblich } = abdruck();
    const aufnahme: Aufnahme = {
      projekt: STAGING_REF,
      erhoben: new Date().toISOString(),
      abdruck: stand,
      rolle: LESE_ROLLE,
      schema: { usage: kopf.usage === "true", create: kopf.erzeugen === "true" },
      mitgliedschaften: {
        istMitgliedVon: mitZeilen.filter((z) => z.richtung === "ist_mitglied_von")
          .map((z) => String(z.andere)),
        hatAlsMitglied: mitZeilen.filter((z) => z.richtung === "hat_als_mitglied")
          .map((z) => String(z.andere)),
      },
      tabellen, funktionen, abweichungen,
    };

    /* ------------------------------------------------------- Ausgabe */
    console.log(`  Schema public:  usage=${aufnahme.schema.usage} `
      + `create=${aufnahme.schema.create}`);
    console.log(`  Mitgliedschaften: ist Mitglied von `
      + `[${aufnahme.mitgliedschaften.istMitgliedVon.join(", ") || "—"}], `
      + `hat als Mitglied [${aufnahme.mitgliedschaften.hatAlsMitglied.join(", ") || "—"}]`);
    console.log("");
    console.log("  Tabellen und Sichten");
    for (const [name, darf] of Object.entries(tabellen)) {
      console.log(`    ${darf ? "select" : "  —   "}  public.${name}`);
    }
    console.log("");
    console.log("  Funktionen");
    for (const [sig, w] of Object.entries(funktionen)) {
      console.log(`    ${w.execute ? "execute" : "   —   "}  ${sig}`
        + `${w.definer ? "  [definer]" : ""}`);
    }
    console.log("");
    console.log(`  Abdruck: ${stand.slice(0, 16)}…  (${erheblich.length} rechtserhebliche `
      + `Migration(en): ${erheblich.join(", ") || "keine"})`);

    mkdirSync(dirname(AUFNAHME), { recursive: true });
    writeFileSync(AUFNAHME, `${JSON.stringify(aufnahme, null, 2)}\n`, "utf8");
    console.log(`  Aufnahme: ${AUFNAHME} geschrieben.`);
    console.log("");

    if (abweichungen.length > 0) {
      ab(`${abweichungen.length} ABWEICHUNG(EN) zwischen Einrichtungsdatei und Datenbank:\n`
        + abweichungen.map((x) => `    · ${x}`).join("\n")
        + "\n\n  Die Aufnahme ist geschrieben und gibt den TATSAECHLICHEN Stand wieder —\n"
        + "  die Probelaeufe bilden also die echte Lage nach. Behoben ist damit\n"
        + "  nichts: solange die Abweichung steht, bleiben die betroffenen\n"
        + "  Pruefzeilen OFFEN (Zeile 9998), und das ist richtig so.");
    }
    console.log("  Einrichtungsdatei und Datenbank stimmen ueberein.");
    console.log("");
  } finally {
    await db.schliesse();
  }
}

if (process.argv[1]?.endsWith("db-privileges-staging.mts")) {
  main().catch((e) => {
    console.error(`\n  ABBRUCH: ${redigiere(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  });
}
