/**
 * Die gespeicherten Einkaufskalkulationen, funktional geprüft (`0142`,
 * ADR-0131).
 *
 *   npm run verify:calculations:staging
 *
 * WAS DIESE DATEI BEWEIST, UND WAS KEIN TEST IM ARBEITSBAUM BEWEISEN KANN:
 * dass die vier Richtlinien aus `0142` **wirken**. Nicht, dass sie richtig
 * geschrieben sind — das prüft `calculator-save-ui.test.ts` am Quelltext —,
 * sondern dass zwei echte angemeldete Sitzungen einander nicht sehen.
 *
 * SIE SCHREIBT, UND ZWAR AUF STAGING. Zwei Auth-Konten, ein paar
 * Kalkulationszeilen, und sie räumt beides wieder weg. Deshalb steht der
 * Staging-Riegel als Erstes: `SKYISLES_REQUIRE_STAGING=1` und ein Abgleich
 * gegen `.env.staging`, bevor eine Verbindung entsteht.
 *
 * DIE ROLLEN, GETRENNT GEHALTEN — dieselbe Trennung wie in `verify-rls.mts`:
 *
 *   * Dienstrolle NUR zum Anlegen und Aufräumen der zwei Konten. Niemals für
 *     eine Behauptung: sie umgeht RLS und würde nichts beweisen.
 *   * Anon-Schlüssel + echtes Benutzer-JWT für JEDE Behauptung.
 *
 * SIE GIBT KEINE GEHEIMNISSE AUS. Keine Schlüssel, keine Passwörter, keine
 * Kontokennungen — nur Befunde.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStagingIfRequested } from "./lib/staging-guard.mts";

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, passed: boolean, detail = ""): void => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const heading = (text: string) => console.log(`\n${text}\n${"-".repeat(text.length)}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run through npm, which loads the env file.`);
    process.exit(1);
  }
  return value;
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });

/** Eine Kalkulation, wie die Oberfläche sie schreibt. */
const PROBE = (name: string) => ({
  name,
  factor_percent: 55,
  lines: {
    version: 1,
    lines: [
      { sky_id: "SKY-0001", name: "Spyro", series: "SA", image: null,
        suggested_cents: 1290, unit_cents: 1290, quantity: 2, manual: false },
      { sky_id: "SKY-0003", name: "Gill Grunt", series: "SA", image: null,
        suggested_cents: 800, unit_cents: 1000, quantity: 1, manual: true },
    ],
  },
  total_cents: 2 * 1290 + 1000,
  positions: 2,
  units: 3,
});

async function createSignedInUser(
  admin: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<{ client: SupabaseClient; user: User }> {
  const client = anonClient();
  const signUp = await client.auth.signUp(credentials);
  if (signUp.error || !signUp.data.session) {
    const created = await admin.auth.admin.createUser({
      email: credentials.email, password: credentials.password, email_confirm: true,
    });
    if (created.error) throw new Error(`admin.createUser: ${created.error.message}`);
    const signIn = await client.auth.signInWithPassword(credentials);
    if (signIn.error) throw new Error(`signInWithPassword: ${signIn.error.message}`);
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error(`getUser: ${error?.message ?? "no user"}`);
  return { client, user: data.user };
}

async function main(): Promise<void> {
  /*
   * DER RIEGEL ZUERST — vor jeder Verbindung.
   *
   * `requireStaging` vergleicht Ziel und Dienstschlüssel exakt mit dem, was
   * `.env.staging` nennt, und bricht ab, bevor ein Client entsteht. Das
   * npm-Skript setzt `SKYISLES_REQUIRE_STAGING=1`; wer diese Datei von Hand
   * ohne das Flag startet, bekommt keinen Riegel — deshalb gibt es den
   * umgebungsneutralen Alias nicht (CLAUDE.md).
   */
  requireStagingIfRequested("verify:calculations");

  console.log(`purchase_calculations auf ${new URL(URL_).host}\n`);

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  /* ------------------------------------------------- 0. Steht die Tabelle? */
  heading("0. Ist 0142 hier angewendet?");
  const da = await admin.from("purchase_calculations").select("id").limit(1);
  if (da.error) {
    console.log(`  Die Tabelle antwortet nicht: ${da.error.code} ${da.error.message}`);
    console.log("\n  0142 ist hier NICHT angewendet. Zuerst");
    console.log("  supabase/operations/staging-0142.sql im SQL-Editor fahren.");
    process.exit(2);
  }
  check("public.purchase_calculations ist da", true);

  const stempel = await admin.from("skylanders").select("sky_id")
    .in("sky_id", ["SKY-0821", "SKY-0822"]);
  check("und es ist Staging (Markerpaar SKY-0821 + SKY-0822)",
        (stempel.data ?? []).length === 2, `${(stempel.data ?? []).length}/2`);

  /* --------------------------------------------- 1. Zwei getrennte Konten */
  heading("1. Zwei echte, getrennte Sitzungen");
  const stamp = Date.now();
  const kontoA = { email: `calc-a-${stamp}@skyisles.test`, password: `pw-a-${stamp}-x!` };
  const kontoB = { email: `calc-b-${stamp}@skyisles.test`, password: `pw-b-${stamp}-x!` };

  const A = await createSignedInUser(admin, kontoA);
  const B = await createSignedInUser(admin, kontoB);
  check("zwei angemeldete Benutzer mit eigenen JWT", A.user.id !== B.user.id);

  let idA = "";
  try {
    /* ------------------------------------------- 2. Jeder legt für sich an */
    heading("2. Anlegen — und die Zuordnung kommt aus der Sitzung");
    const insA = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("A: Willhaben 35 Figuren"), user_id: A.user.id })
      .select("id, user_id, positions, units, total_cents").single();
    check("A kann eine eigene Kalkulation anlegen", insA.error === null,
          insA.error?.code ?? "");
    idA = insA.data?.id ?? "";
    check("die Zeile gehört A", insA.data?.user_id === A.user.id);
    check("und die drei abgeleiteten Zahlen stehen",
          insA.data?.positions === 2 && insA.data?.units === 3
          && insA.data?.total_cents === 3580,
          `${insA.data?.positions} Positionen, ${insA.data?.units} Stück, `
          + `${insA.data?.total_cents} Cent`);

    /*
     * DER VERSUCH, DER SCHEITERN MUSS: eine Zeile mit der Kennung eines
     * anderen Kontos. Ohne `with check` in der INSERT-Policy wäre das der
     * Weg, jemandem etwas unterzuschieben.
     */
    const fremd = await B.client.from("purchase_calculations")
      .insert({ ...PROBE("B: untergeschoben"), user_id: A.user.id }).select("id");
    check("B kann KEINE Zeile für A anlegen", fremd.error !== null,
          fremd.error?.code ?? "DURCHGELAUFEN — Befund");

    /* ----------------------------------------------------- 3. Nur die eigenen */
    heading("3. Lesen — jeder sieht ausschließlich seine eigenen");
    const leseA = await A.client.from("purchase_calculations").select("id, name");
    check("A sieht seine eigene", (leseA.data ?? []).some((r) => r.id === idA),
          `${(leseA.data ?? []).length} Zeile(n)`);

    const leseB = await B.client.from("purchase_calculations").select("id, name");
    check("B sieht die von A NICHT", !(leseB.data ?? []).some((r) => r.id === idA),
          `${(leseB.data ?? []).length} Zeile(n)`);

    /* Auch nicht gezielt mit der ID — die Policy filtert, sie meldet nicht. */
    const gezielt = await B.client.from("purchase_calculations")
      .select("id").eq("id", idA);
    check("auch nicht gezielt über die ID", (gezielt.data ?? []).length === 0,
          `${(gezielt.data ?? []).length} Zeile(n)`);

    const gast = await anonClient().from("purchase_calculations").select("id");
    check("ein Gast sieht gar nichts", gast.error !== null || (gast.data ?? []).length === 0,
          gast.error?.code ?? `${(gast.data ?? []).length} Zeile(n)`);

    /* --------------------------------------------------- 4. Fremdes Ändern */
    heading("4. Ändern und Löschen — nur die eigenen");
    const updB = await B.client.from("purchase_calculations")
      .update({ name: "von B überschrieben" }, { count: "exact" }).eq("id", idA);
    check("B kann die Kalkulation von A nicht ändern",
          updB.error !== null || updB.count === 0,
          updB.error?.code ?? `${updB.count} Zeile(n) getroffen`);

    const delB = await B.client.from("purchase_calculations")
      .delete({ count: "exact" }).eq("id", idA);
    check("und nicht löschen", delB.error !== null || delB.count === 0,
          delB.error?.code ?? `${delB.count} Zeile(n) getroffen`);

    const nachher = await A.client.from("purchase_calculations")
      .select("name").eq("id", idA).single();
    check("die Zeile von A ist unverändert",
          nachher.data?.name === "A: Willhaben 35 Figuren",
          nachher.data?.name ?? "(fort)");

    const updA = await A.client.from("purchase_calculations")
      .update({ name: "A: umbenannt", status: "negotiating" }, { count: "exact" })
      .eq("id", idA);
    check("A kann seine eigene ändern", updA.error === null && updA.count === 1,
          updA.error?.code ?? `${updA.count} Zeile(n)`);

    /* `updated_at` pflegt der Trigger, nicht der Client. */
    const zeiten = await A.client.from("purchase_calculations")
      .select("created_at, updated_at").eq("id", idA).single();
    check("updated_at ist seit dem Anlegen fortgeschritten (Trigger aus 0001)",
          zeiten.data !== null
          && new Date(zeiten.data.updated_at) > new Date(zeiten.data.created_at),
          `${zeiten.data?.created_at} → ${zeiten.data?.updated_at}`);

    /* ------------------------------------------------- 5. Was die Form abweist */
    heading("5. Die Grenzen der Spalte");
    const keinArray = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("A: kaputt"), user_id: A.user.id,
                lines: { version: 1, lines: "nein" } }).select("id");
    check("`lines` ohne Array wird abgewiesen", keinArray.error !== null,
          keinArray.error?.code ?? "DURCHGELAUFEN — Befund");

    const leerName = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("   "), user_id: A.user.id }).select("id");
    check("ein leerer Name wird abgewiesen", leerName.error !== null,
          leerName.error?.code ?? "DURCHGELAUFEN — Befund");

    const falscherStatus = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("A: Status"), user_id: A.user.id, status: "erfunden" })
      .select("id");
    check("ein unbekannter Status wird abgewiesen", falscherStatus.error !== null,
          falscherStatus.error?.code ?? "DURCHGELAUFEN — Befund");

    const faktor = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("A: Faktor"), user_id: A.user.id, factor_percent: 140 })
      .select("id");
    check("ein Faktor über 100 wird abgewiesen", faktor.error !== null,
          faktor.error?.code ?? "DURCHGELAUFEN — Befund");

    /* --------------------------------- 6. Mehrere nebeneinander, unabhängig */
    heading("6. Mehrere Kalkulationen nebeneinander");
    const zweite = await A.client.from("purchase_calculations")
      .insert({ ...PROBE("A: eBay 12 Figuren"), user_id: A.user.id })
      .select("id, name").single();
    check("A kann eine zweite anlegen", zweite.error === null, zweite.error?.code ?? "");

    const beide = await A.client.from("purchase_calculations")
      .select("id, name, positions").order("updated_at", { ascending: false });
    check("beide stehen nebeneinander und haben eigene Inhalte",
          (beide.data ?? []).length === 2
          && new Set((beide.data ?? []).map((r) => r.name)).size === 2,
          (beide.data ?? []).map((r) => r.name).join(" · "));

    /* ------------------------------------- 7. Die Sperre gegen zwei Übernahmen */
    heading("7. Ein Einkauf, höchstens eine Kalkulation");
    /*
     * Die halbe Sperre gegen eine zweite Übernahme ins Orderbuch (ADR-0131,
     * Punkt 6), gefahren statt behauptet. `purchase_id` setzt im Betrieb
     * später ausschließlich der Server — hier schreibt die Dienstrolle, weil
     * genau der Index geprüft werden soll und nicht der Weg dorthin.
     */
    const einkauf = await admin.from("purchases").select("id").limit(1).maybeSingle();
    if (einkauf.data?.id === undefined) {
      console.log("  INFO  kein Einkauf auf Staging — der Index bleibt hier ungeprüft");
    } else {
      const ersteZuordnung = await admin.from("purchase_calculations")
        .update({ purchase_id: einkauf.data.id }).eq("id", idA).select("id");
      check("eine Kalkulation darf einen Einkauf beanspruchen",
            ersteZuordnung.error === null, ersteZuordnung.error?.code ?? "");

      const zweiteZuordnung = await admin.from("purchase_calculations")
        .update({ purchase_id: einkauf.data.id }).eq("id", zweite.data?.id ?? "")
        .select("id");
      check("eine zweite auf denselben Einkauf NICHT",
            zweiteZuordnung.error !== null,
            zweiteZuordnung.error?.code ?? "DURCHGELAUFEN — Befund");
    }
  } finally {
    /* ------------------------------------------------------- 8. Aufräumen */
    heading("8. Aufräumen");
    /* Die Zeilen gehen mit den Konten (`on delete cascade`) — gelöscht wird
       trotzdem ausdrücklich, damit ein Fehlschlag beim Konto nichts
       zurücklässt. */
    for (const konto of [A, B]) {
      await admin.from("purchase_calculations").delete().eq("user_id", konto.user.id);
    }
    const restA = await admin.from("purchase_calculations")
      .select("id", { count: "exact", head: true }).eq("user_id", A.user.id);
    check("keine Probezeile bleibt zurück", (restA.count ?? 0) === 0,
          `${restA.count ?? "?"} Zeile(n)`);

    for (const konto of [A, B]) {
      const weg = await admin.auth.admin.deleteUser(konto.user.id);
      check(`Testkonto entfernt`, weg.error === null, weg.error?.message ?? "");
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}  (${f.detail})`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
