/**
 * Calculator V3 am laufenden System: eine Kalkulation wird ein Einkauf
 * (`0143`, ADR-0132).
 *
 *   npm run verify:purchase-from-calculation:staging
 *
 * WAS NUR EIN LAUF BEWEISEN KANN. Dass die Funktion die bestehende
 * Einkaufserstellung AUFRUFT, steht im Quelltext und wird von der
 * Nachkontrolle gelesen. Dass dabei ein Einkauf entsteht, der Zeile für
 * Zeile derselbe ist wie ein von Hand angelegter, dass die Verknuepfung
 * sitzt, dass ein zweiter Versuch keinen zweiten Einkauf hinterlaesst und
 * dass nichts eingebucht wird — das zeigt nur eine echte Transaktion.
 *
 * STAGING ONLY, UND ES SCHREIBT. Angelegt werden: ein Auth-Konto als
 * Betriebsnutzer, ein zweites ohne Rolle, zwei Kalkulationen und ZWEI
 * Einkaeufe (beide als `Testvorgang` markiert). **Alles davon wird am Ende
 * wieder entfernt** — Abschnitt 9 zaehlt nach, dass die Bestaende vor und
 * nach dem Lauf gleich sind.
 *
 * BESTEHENDE DATEN WERDEN NICHT ANGEFASST. Gearbeitet wird ausschliesslich
 * mit den eigenen Kennungen; geloescht wird nur, was dieser Lauf angelegt
 * hat, und zwar namentlich. Die Figuren kommen aus dem Katalog, statt im
 * Code zu stehen — eine festgeschriebene SKY-ID machte das Werkzeug von
 * einem Import abhaengig.
 *
 * DIE ROLLEN, GETRENNT: die Dienstrolle legt Konten an, liest Gegenwerte und
 * raeumt auf. Jede Behauptung ueber Rechte faellt mit einem ECHTEN
 * Benutzer-JWT — die Dienstrolle umgeht RLS und `auth.uid()` ist bei ihr
 * NULL, sie wuerde also nichts beweisen.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

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
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const serviceClient = () =>
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
               { auth: { persistSession: false, autoRefreshToken: false } });

const RUN = Date.now().toString(36);
const uuid = () => crypto.randomUUID().toLowerCase();

/** Die Bestaende, gegen die am Ende verglichen wird. */
async function bestand(admin: SupabaseClient) {
  const zahl = async (tabelle: string): Promise<number> => {
    const r = await admin.from(tabelle).select("*", { count: "exact", head: true });
    return r.count ?? -1;
  };
  return {
    purchases: await zahl("purchases"),
    items: await zahl("purchase_items"),
    calculations: await zahl("purchase_calculations"),
    movements: await zahl("inventory_movements"),
  };
}
const zeige = (b: Awaited<ReturnType<typeof bestand>>) =>
  `Einkaeufe ${b.purchases} · Positionen ${b.items} · Kalkulationen ${b.calculations}`
  + ` · Bewegungen ${b.movements}`;

async function main(): Promise<void> {
  /* Vor jedem Client, damit es kein Fenster gibt, in dem eine Verbindung
     offen ist und der Riegel nicht gelaufen. Kein Production-Modus. */
  requireStaging("verify:purchase-from-calculation");

  const admin = serviceClient();
  let betrieb: { client: SupabaseClient; user: User } | null = null;
  let fremd: { client: SupabaseClient; user: User } | null = null;
  let sellerId: number | null = null;
  const einkaeufe: number[] = [];
  const kalkulationen: string[] = [];
  let vorher: Awaited<ReturnType<typeof bestand>> | null = null;

  try {
    /* ----------------------------------------------------------- 1. Aufbau */
    heading("1. Aufbau (Dienstrolle)");
    vorher = await bestand(admin);
    console.log(`  vorher: ${zeige(vorher)}`);

    const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
    if (seller.error) throw new Error(`active seller: ${seller.error.message}`);
    sellerId = seller.data.id as number;

    const anlegen = async (rolle: string) => {
      const credentials = {
        email: `calc-v3-${rolle}-${RUN}@skyisles.invalid`,
        password: `v3-${RUN}-${Math.random().toString(36).slice(2)}`,
      };
      const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
      if (created.error) throw new Error(`createUser(${rolle}): ${created.error.message}`);
      const client = anonClient();
      const signIn = await client.auth.signInWithPassword(credentials);
      if (signIn.error) throw new Error(`signIn(${rolle}): ${signIn.error.message}`);
      return { client, user: created.data.user };
    };

    betrieb = await anlegen("betrieb");
    fremd = await anlegen("fremd");
    const mitglied = await admin.from("seller_operators").insert({
      seller_id: sellerId, user_id: betrieb.user.id,
      note: "verify:purchase-from-calculation",
    });
    if (mitglied.error) throw new Error(`seller_operators: ${mitglied.error.message}`);
    check("ein Betriebskonto und ein Konto ohne Rolle", betrieb.user.id !== fremd.user.id);

    /* Zwei bepreiste Figuren, aus dem Katalog gewaehlt statt benannt. */
    const priced = await admin.from("skylanders")
      .select("sky_id, name, market_price")
      .not("market_price", "is", null).eq("item_type", "figure")
      .order("sky_id").limit(2);
    if (priced.error || (priced.data?.length ?? 0) < 2) {
      throw new Error(`zwei bepreiste Figuren: ${priced.error?.message ?? "zu wenige"}`);
    }
    const [A, B] = priced.data.map((r) => String(r.sky_id));
    console.log(`  Figuren: ${A} (2 Stueck) und ${B} (1 Stueck)`);

    /* ------------------------------------------- 2. Die Kalkulation anlegen */
    heading("2. Eine gespeicherte Kalkulation (als Betrieb, eigene Zeile)");
    const KALK = {
      name: `V3-Probe ${RUN}`,
      factor_percent: 55,
      lines: {
        version: 1,
        lines: [
          { sky_id: A, name: "A", series: "SA", image: null,
            suggested_cents: 1290, unit_cents: 1290, quantity: 2, manual: false },
          { sky_id: B, name: "B", series: "SA", image: null,
            suggested_cents: 800, unit_cents: 1000, quantity: 1, manual: true },
        ],
      },
      total_cents: 2 * 1290 + 1000,
      positions: 2, units: 3,
    };
    const eigene = await betrieb.client.from("purchase_calculations")
      .insert({ ...KALK, user_id: betrieb.user.id }).select("id, purchase_id").single();
    check("der Betrieb legt seine Kalkulation an", eigene.error === null,
          eigene.error?.code ?? "");
    if (eigene.data) kalkulationen.push(eigene.data.id as string);
    check("sie ist noch nicht uebernommen", eigene.data?.purchase_id === null);

    /* Eine zweite, die dem FREMDEN Konto gehoert. */
    const fremde = await admin.from("purchase_calculations")
      .insert({ ...KALK, name: `V3-fremd ${RUN}`, user_id: fremd.user.id })
      .select("id").single();
    if (fremde.error) throw new Error(`fremde Kalkulation: ${fremde.error.message}`);
    kalkulationen.push(fremde.data.id as string);

    /* Die Nutzlast, wie das Formular sie schickt: eine je STUECK. */
    const items = [{ sky_id: A, state: "ordered" }, { sky_id: A, state: "ordered" },
                   { sky_id: B, state: "ordered" }];
    const ruf = (client: SupabaseClient, id: string, token: string) =>
      client.rpc("seller_create_purchase_from_calculation", {
        p_calculation_id: id, p_purchased_at: "2026-10-24", p_total_cost: 10.00,
        p_note: `Calculator V3 Probe ${RUN}`, p_is_test: true, p_items: items,
        p_platform: "kleinanzeigen", p_seller_name: "Probe",
        p_items_cost: 8.00, p_shipping_cost: 2.00, p_buyer_protection_cost: 0.00,
        p_payment_method: "paypal", p_external_ref: null, p_client_token: token,
      });

    /* --------------------------------------------------- 3. Die drei Riegel */
    heading("3. Wer NICHT darf");
    const ohneRolle = await ruf(fremd.client, fremde.data.id as string, uuid());
    check("ein Konto ohne Betriebsrolle darf nicht", ohneRolle.error !== null,
          ohneRolle.error?.code ?? "DURCHGELAUFEN — Befund");

    const fremdeKalk = await ruf(betrieb.client, fremde.data.id as string, uuid());
    check("der Betrieb kann eine FREMDE Kalkulation nicht uebernehmen",
          fremdeKalk.error !== null,
          fremdeKalk.error?.message?.includes("calculation not found")
            ? "calculation not found" : (fremdeKalk.error?.code ?? "DURCHGELAUFEN — Befund"));

    const erfunden = await ruf(betrieb.client, uuid(), uuid());
    check("und eine erfundene Kennung auch nicht", erfunden.error !== null,
          erfunden.error?.message?.includes("calculation not found")
            ? "calculation not found" : (erfunden.error?.code ?? "DURCHGELAUFEN"));

    const nachRiegeln = await bestand(admin);
    check("dabei ist KEIN Einkauf entstanden",
          nachRiegeln.purchases === vorher.purchases,
          `${nachRiegeln.purchases} statt ${vorher.purchases}`);

    /* ------------------------------------------------- 4. Der gute Fall */
    heading("4. Die eigene Kalkulation wird ein Einkauf");
    const TOKEN = uuid();
    const gut = await ruf(betrieb.client, eigene.data!.id as string, TOKEN);
    check("die Uebernahme laeuft", gut.error === null,
          gut.error?.message?.slice(0, 70) ?? `Einkauf ${gut.data}`);
    const einkaufId = typeof gut.data === "number" ? gut.data : -1;
    if (einkaufId > 0) einkaufe_push(einkaufId);
    function einkaufe_push(id: number) { if (!einkaeufe.includes(id)) einkaeufe.push(id); }

    /*
     * Die Spalten als EINE Zeichenkette, und das Ergebnis ausdruecklich
     * getypt: aus einer verketteten Auswahl leitet der Supabase-Typ keine
     * Spalten ab, und dann waere jeder Zugriff ein Fehler beim Uebersetzen.
     */
    type Kopf = {
      id: number; purchased_at: string | null; total_cost: string | number;
      items_cost: string | number | null; shipping_cost: string | number | null;
      buyer_protection_cost: string | number | null;
      platform: string | null; seller_name: string | null;
      payment_method: string | null; is_test: boolean;
      client_token: string | null; source: string;
    };
    const kopf = await admin.from("purchases")
      .select("id, purchased_at, total_cost, items_cost, shipping_cost, buyer_protection_cost, platform, seller_name, payment_method, is_test, client_token, source")
      .eq("id", einkaufId).single<Kopf>();
    check("der Einkauf traegt genau die uebergebenen Kaufdaten",
          kopf.data !== null && Number(kopf.data.total_cost) === 10
          && Number(kopf.data.items_cost) === 8 && Number(kopf.data.shipping_cost) === 2
          && kopf.data.platform === "kleinanzeigen" && kopf.data.payment_method === "paypal",
          `${kopf.data?.total_cost} = 8 + 2 + 0, ${kopf.data?.platform}`);
    check("er ist als Testvorgang markiert", kopf.data?.is_test === true);
    check("und als normaler Einkauf angelegt (source = manual)",
          kopf.data?.source === "manual", String(kopf.data?.source));

    /*
     * KEINE ZAHL AUS DER KALKULATION. Der Gesamtwert der Kalkulation waere
     * 35,80 €, der maximale Einkaufspreis 19,69 € — im Einkauf stehen 10,00 €,
     * weil genau die uebergeben wurden.
     */
    check("kein Kalkulationswert ist in die Kosten geraten",
          Number(kopf.data?.total_cost) !== KALK.total_cents / 100,
          `${kopf.data?.total_cost} ≠ ${(KALK.total_cents / 100).toFixed(2)} (Kalkulationswert)`);

    /*
     * `movement_id`, NICHT `booked_at`.
     *
     * Die erste Fassung dieser Datei fragte nach `booked_at`. PostgREST
     * antwortete mit `42703 column does not exist`, `data` war `undefined`,
     * und zwei Pruefungen lasen das als „0 Positionen" — waehrend eine
     * dritte „Zeile fuer Zeile dieselben" meldete, weil BEIDE Abfragen
     * gleich leer waren. Ein gruener Haken, der nichts geprueft hat.
     *
     * Deshalb steht unten `wirftNicht`: ein Abfragefehler ist ab jetzt ein
     * FEHLSCHLAG und nie ein leeres Ergebnis. „Eingebucht" heisst in dieser
     * Tabelle: `movement_id` ist gesetzt (0053) — der Beweis, dass eine
     * Bewegung existiert, und nicht ein Datum daneben.
     */
    type Pos = {
      sky_id: string | null; condition: string; state: string; position: number;
      movement_id: number | null; market_price_snapshot: string | number | null;
    };
    const wirftNicht = <T,>(name: string, r: { data: T | null; error: { message: string } | null }): T => {
      if (r.error !== null) {
        check(`${name}: die Abfrage selbst`, false, r.error.message.slice(0, 80));
        return [] as unknown as T;
      }
      return r.data as T;
    };
    const positionen = wirftNicht("Positionen", await admin.from("purchase_items")
      .select("sky_id, condition, state, position, movement_id, market_price_snapshot")
      .eq("purchase_id", einkaufId).order("position").returns<Pos[]>());
    check("drei Positionen — eine je Stueck, Dubletten nicht zusammengefasst",
          positionen.length === 3, `${positionen.length}`);
    check("zwei auf die erste Figur, eine auf die zweite",
          positionen.filter((r) => r.sky_id === A).length === 2
          && positionen.filter((r) => r.sky_id === B).length === 1,
          positionen.map((r) => r.sky_id).join(", "));
    check("jede im Zustand ordered, keine eingebucht (movement_id ist NULL)",
          positionen.length === 3
          && positionen.every((r) => r.state === "ordered" && r.movement_id === null),
          positionen.map((r) => `${r.state}/${r.movement_id ?? "-"}`).join(" "));

    const verknuepft = await admin.from("purchase_calculations")
      .select("purchase_id").eq("id", eigene.data!.id as string).single();
    check("DIE KALKULATION ZEIGT AUF DEN EINKAUF",
          verknuepft.data?.purchase_id === einkaufId,
          `purchase_id = ${verknuepft.data?.purchase_id}`);

    const nachGut = await bestand(admin);
    check("und es wurde nichts eingebucht (Kaufen ist nicht Einlagern)",
          nachGut.movements === vorher.movements,
          `${nachGut.movements} Bewegungen, vorher ${vorher.movements}`);

    /* --------------------------------- 5. Dasselbe nochmal, derselbe Entwurf */
    heading("5. Zweimal auf Speichern — derselbe Entwurf");
    const nochmal = await ruf(betrieb.client, eigene.data!.id as string, TOKEN);
    check("dieselbe Antwort, kein zweiter Einkauf",
          nochmal.error === null && nochmal.data === einkaufId,
          nochmal.error?.code ?? `Einkauf ${nochmal.data}`);
    const nachNochmal = await bestand(admin);
    check("die Zahl der Einkaeufe ist unveraendert",
          nachNochmal.purchases === nachGut.purchases,
          `${nachNochmal.purchases}`);

    /* ------------------------------------ 6. Ein NEUER Entwurf, dieselbe Kalkulation */
    heading("6. Eine zweite Uebernahme derselben Kalkulation");
    const zweimal = await ruf(betrieb.client, eigene.data!.id as string, uuid());
    check("wird abgewiesen", zweimal.error !== null,
          zweimal.error?.message?.includes("already handed over")
            ? "already handed over" : (zweimal.error?.code ?? "DURCHGELAUFEN — Befund"));
    const nachZweimal = await bestand(admin);
    check("UND LAESST KEINEN EINKAUF ZURUECK",
          nachZweimal.purchases === nachGut.purchases
          && nachZweimal.items === nachGut.items,
          `Einkaeufe ${nachZweimal.purchases}, Positionen ${nachZweimal.items}`);

    /* ------------------- 7. Derselbe Einkauf von Hand — Zeile fuer Zeile gleich */
    heading("7. Von Hand angelegt: ist er zu unterscheiden?");
    const vonHand = await betrieb.client.rpc("seller_create_purchase_with_items", {
      p_purchased_at: "2026-10-24", p_total_cost: 10.00,
      p_note: `Calculator V3 Vergleich ${RUN}`, p_is_test: true, p_items: items,
      p_platform: "kleinanzeigen", p_seller_name: "Probe",
      p_items_cost: 8.00, p_shipping_cost: 2.00, p_buyer_protection_cost: 0.00,
      p_payment_method: "paypal", p_external_ref: null, p_client_token: uuid(),
    });
    check("der bestehende Weg funktioniert unveraendert", vonHand.error === null,
          vonHand.error?.code ?? `Einkauf ${vonHand.data}`);
    const handId = typeof vonHand.data === "number" ? vonHand.data : -1;
    if (handId > 0) einkaufe_push(handId);

    const handPositionen = wirftNicht("Positionen von Hand",
      await admin.from("purchase_items")
        .select("sky_id, condition, state, position, movement_id, market_price_snapshot")
        .eq("purchase_id", handId).order("position").returns<Pos[]>());
    const alsText = (rows: Pos[]) =>
      JSON.stringify(rows.map((r) => ({
        sky_id: r.sky_id, condition: r.condition, state: r.state, position: r.position,
        movement_id: r.movement_id, snapshot: r.market_price_snapshot,
      })));
    /*
     * UND ZWAR NICHT „BEIDE LEER".
     *
     * Die Gleichheit zaehlt nur, wenn ueberhaupt etwas da ist — sonst waere
     * ein fehlgeschlagener Lauf der gruenste von allen. Genau das ist beim
     * ersten Versuch passiert.
     */
    check("DIE POSITIONEN SIND ZEILE FUER ZEILE DIESELBEN — und es sind drei",
          positionen.length === 3 && handPositionen.length === 3
          && alsText(positionen) === alsText(handPositionen),
          alsText(positionen) === alsText(handPositionen)
            ? `identisch, je ${positionen.length}`
            : `aus Kalkulation ${alsText(positionen)} vs. von Hand ${alsText(handPositionen)}`);

    const handKopf = await admin.from("purchases")
      .select("total_cost, items_cost, shipping_cost, buyer_protection_cost, platform, seller_name, payment_method, is_test, source")
      .eq("id", handId).single<Omit<Kopf, "id" | "purchased_at" | "client_token">>();
    check("und der Kopf ebenso",
          JSON.stringify(handKopf.data) === JSON.stringify({
            total_cost: kopf.data?.total_cost, items_cost: kopf.data?.items_cost,
            shipping_cost: kopf.data?.shipping_cost,
            buyer_protection_cost: kopf.data?.buyer_protection_cost,
            platform: kopf.data?.platform, seller_name: kopf.data?.seller_name,
            payment_method: kopf.data?.payment_method, is_test: kopf.data?.is_test,
            source: kopf.data?.source,
          }));

    const handVerknuepft = await admin.from("purchase_calculations")
      .select("id").eq("purchase_id", handId);
    check("der von Hand angelegte Einkauf ist mit keiner Kalkulation verknuepft",
          (handVerknuepft.data ?? []).length === 0);

    /* ----------------------------------------- 8. Die Belegsperre ist unberuehrt */
    heading("8. Die Belegsperre");
    const beleg = await betrieb.client.rpc("issue_platform_receipt", { p_purchase_id: einkaufId });
    check("auch der Betrieb kann keinen Eigenbeleg ausstellen", beleg.error !== null,
          beleg.error?.code ?? "DURCHGELAUFEN — Befund");
  } finally {
    /* --------------------------------------------------------- 9. Aufraeumen */
    heading("9. Aufraeumen — nur was dieser Lauf angelegt hat");
    for (const id of einkaeufe) {
      /* `purchase_items` haengt mit `on delete cascade` daran (0053). */
      const weg = await admin.from("purchases").delete().eq("id", id);
      console.log(`  Einkauf ${id}: ${weg.error ? weg.error.message : "entfernt"}`);
    }
    for (const id of kalkulationen) {
      const weg = await admin.from("purchase_calculations").delete().eq("id", id);
      console.log(`  Kalkulation ${id.slice(0, 8)}…: ${weg.error ? weg.error.message : "entfernt"}`);
    }
    if (betrieb && sellerId !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", betrieb.user.id);
    }
    for (const konto of [betrieb, fremd]) {
      if (konto) await admin.auth.admin.deleteUser(konto.user.id);
    }
    console.log("  Konten und Mitgliedschaft entfernt");

    if (vorher !== null) {
      const nachher = await bestand(admin);
      console.log(`  vorher:  ${zeige(vorher)}`);
      console.log(`  nachher: ${zeige(nachher)}`);
      check("die Bestaende sind wieder die von vorher",
            nachher.purchases === vorher.purchases && nachher.items === vorher.items
            && nachher.calculations === vorher.calculations
            && nachher.movements === vorher.movements,
            nachher.purchases === vorher.purchases ? "gleich" : "ABWEICHUNG");
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
