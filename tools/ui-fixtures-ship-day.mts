/**
 * Throwaway sales for the UI acceptance of `0112` and `0113`.
 *
 *   npm run ui-fixtures:ship-day:staging -- create
 *   npm run ui-fixtures:ship-day:staging -- cleanup
 *
 * STAGING ONLY, AND IT WRITES. It creates five sales on two days that staging
 * leaves empty and then stops — they stay until `cleanup` removes them, which
 * is the point: a human has to look at them in a browser first.
 *
 * WHY THESE FIVE AND NOT MORE. Three of the four features can be accepted on
 * data that already exists:
 *
 *   B  repeat buyers    39 real groups are already there; #335 → #336 sit on
 *                       one day next to each other
 *   B  internal name    the four internal sales carry a frozen shipping
 *                       address, which is where `buyer_label` comes from
 *   A  action hidden    the same four internal sales must NOT offer it
 *   C  the (i) icon     every one of 303 rows has one
 *
 * What cannot be done on existing data is the part that WRITES: shipping a
 * sale and swapping two places. Doing that to real history is exactly what
 * must not happen, so those five rows are made fresh and thrown away.
 *
 * EVERY SALE IS FLAGGED AS A TEST. They are left behind on purpose, so the
 * flag is what keeps them out of every business total (0063) while they wait
 * for the acceptance. That is the `flags-every-sale` contract in
 * `sales-release.test.ts`, and it is checked there.
 *
 * ONE VISIBLE SIDE EFFECT, NAMED: the mixed sale holds one catalogue figure,
 * so `reserved` is 1 and that figure is out of `shop_offers()` until cleanup.
 * A figure with at least two in stock is picked, so the staging shop keeps
 * offering it.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";

const MODE = (process.argv[2] ?? "").trim();
if (MODE !== "create" && MODE !== "cleanup") {
  console.error("usage: … tools/ui-fixtures-ship-day.mts create|cleanup");
  process.exit(1);
}

/**
 * The ids, written down rather than re-derived.
 *
 * Cleanup deletes EXACTLY what create wrote. No pattern on a note, no name
 * matching, nothing that could widen to a row somebody else made.
 */
const LEDGER_FILE = "tools/.ui-fixtures-ship-day.json";

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
  createClient(URL_, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const DAY_SHIP = "2026-10-05";
const DAY_INDEX = "2026-10-07";

type Fixture = { id: number; label: string };

/** One temporary operator, for the length of this run only. */
async function withOperator<T>(
  admin: SupabaseClient,
  run: (op: SupabaseClient) => Promise<T>,
): Promise<T> {
  const seller = await admin.from("sellers").select("id").eq("is_active", true).single();
  if (seller.error) throw new Error(`sellers: ${seller.error.message}`);
  const sellerId = seller.data.id as number;

  let user: User | null = null;
  let client: SupabaseClient | null = null;
  try {
    {
      /* Random password, block-scoped, never logged and never written down. */
      const stamp = Date.now().toString(36);
      const credentials = {
        email: `ui-fixtures-${stamp}@skyisles.invalid`,
        password: `uf-${stamp}-${Math.random().toString(36).slice(2)}`,
      };
      const made = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
      if (made.error) throw new Error(`createUser: ${made.error.message}`);
      user = made.data.user;
      client = anonClient();
      const signedIn = await client.auth.signInWithPassword(credentials);
      if (signedIn.error) throw new Error(`signIn: ${signedIn.error.message}`);
    }
    const member = await admin.from("seller_operators")
      .insert({ seller_id: sellerId, user_id: user.id, note: "ui-fixtures:ship-day" });
    if (member.error) throw new Error(`seller_operators: ${member.error.message}`);
    return await run(client);
  } finally {
    if (user !== null) {
      await admin.from("seller_operators")
        .delete().eq("seller_id", sellerId).eq("user_id", user.id);
      await admin.auth.admin.deleteUser(user.id);
      console.log("  temporärer Operator entfernt");
    }
  }
}

async function create(): Promise<void> {
  const admin = serviceClient();

  if (existsSync(LEDGER_FILE)) {
    console.error(`\n  ${LEDGER_FILE} existiert schon — es liegen noch Fixtures auf Staging.`);
    console.error("  Erst `cleanup`, dann erneut `create`. Nichts geschrieben.\n");
    process.exit(1);
  }

  /*
   * DIE ZWEI TAGE MÜSSEN LEER SEIN, sonst heißt „Platz 1 von 3" etwas
   * anderes als es sagt. Ein Lauf, der sich still anpasst, hört still auf zu
   * prüfen, was er behauptet.
   */
  const occupied = await admin.from("sales").select("id,sale_day")
    .in("sale_day", [DAY_SHIP, DAY_INDEX]);
  if (occupied.error) throw new Error(`day check: ${occupied.error.message}`);
  if ((occupied.data ?? []).length > 0) {
    console.error("\n  Die Testtage sind nicht leer: "
      + (occupied.data ?? []).map((r) => `#${r.id} ${r.sale_day}`).join(", "));
    console.error("  Nichts geschrieben.\n");
    process.exit(1);
  }

  /* Mindestens zwei auf Lager, damit der Hold das Angebot nicht leert. */
  const stock = await admin.from("shop_inventory").select("sky_id,quantity,reserved")
    .eq("condition", "loose").eq("reserved", 0).gte("quantity", 2).limit(1);
  if (stock.error) throw new Error(`shop_inventory: ${stock.error.message}`);
  const figure = (stock.data ?? [])[0] as { sky_id: string; quantity: number } | undefined;
  if (!figure) throw new Error("keine lose Lagerzeile mit Menge >= 2 — kein Hold testbar");

  const RUN = Date.now().toString(36);
  const made: Fixture[] = [];

  await withOperator(admin, async (op) => {
    const makeSale = async (label: string, args: Record<string, unknown>) => {
      const got = await op.rpc("seller_create_sale_with_details", args);
      if (got.error) throw new Error(`${label}: ${got.error.code} ${got.error.message}`);
      const id = Number(got.data);
      made.push({ id, label });
      /* Sofort festschreiben: ein Abbruch nach dem dritten Verkauf darf die
         ersten beiden nicht zu Waisen machen. */
      writeFileSync(LEDGER_FILE, JSON.stringify({ run: RUN, made }, null, 2) + "\n");
      console.log(`  #${id}  ${label}`);
      return id;
    };

    await makeSale("A · nur freier Artikel, unverschickt", {
      p_channel: "manual", p_sold_at: DAY_SHIP, p_is_test: true,
      p_buyer_ref: `ui-A-frei-${RUN}`, p_note: `UI-Abnahme 0112 · ${RUN}`,
      p_items_subtotal: 18, p_shipping_charged: 4.5,
      p_items: [{ raw_name: `UI Portal of Power ${RUN}` }],
    });
    await makeSale("A · gemischt: freier Artikel + Katalogfigur", {
      p_channel: "manual", p_sold_at: DAY_SHIP, p_is_test: true,
      p_buyer_ref: `ui-A-gemischt-${RUN}`, p_note: `UI-Abnahme 0112 · ${RUN}`,
      p_items_subtotal: 32, p_shipping_charged: 4.5,
      p_items: [{ raw_name: `UI Trap Team Spiel ${RUN}` }, { sky_id: figure.sky_id }],
    });
    for (const [n, label] of [["A", "erster"], ["B", "zweiter"], ["C", "dritter"]] as const) {
      await makeSale(`D · ${label} Verkauf des Testtags`, {
        p_channel: "manual", p_sold_at: DAY_INDEX, p_is_test: true,
        p_buyer_ref: `ui-D-${n.toLowerCase()}-${RUN}`, p_note: `UI-Abnahme 0113 · ${RUN}`,
        p_items_subtotal: 9 + n.charCodeAt(0) - 65, p_shipping_charged: 2.5,
        p_items: [{ raw_name: `UI Tag ${n} ${RUN}` }],
      });
    }
  });

  const held = await admin.from("shop_inventory").select("sky_id,quantity,reserved")
    .eq("sky_id", figure.sky_id).eq("condition", "loose").single();
  console.log(`\n  Hold: ${figure.sky_id} — Menge ${held.data?.quantity}, `
    + `reserviert ${held.data?.reserved} (war 0). Bleibt bis zum Cleanup.`);
  console.log(`  Notiert in ${LEDGER_FILE}\n`);
}

async function cleanup(): Promise<void> {
  const admin = serviceClient();
  if (!existsSync(LEDGER_FILE)) {
    console.log(`\n  ${LEDGER_FILE} fehlt — nichts zu tun.\n`);
    return;
  }
  const { made } = JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as { made: Fixture[] };
  const left: number[] = [];

  await withOperator(admin, async (op) => {
    /* Absteigend, damit der jüngste zuerst geht — dieselbe Ordnung wie überall. */
    for (const { id, label } of [...made].reverse()) {
      const dropped = await op.rpc("seller_delete_sale", { p_id: id });
      if (dropped.error) {
        console.log(`  WARN  #${id} (${label}) nicht gelöscht — `
          + `${dropped.error.code} ${dropped.error.message}`);
        left.push(id);
      } else {
        console.log(`  #${id} gelöscht`);
      }
    }
  });

  if (left.length > 0) {
    console.error(`\n  ${left.length} Zeile(n) blieben: ${left.join(", ")}. `
      + `${LEDGER_FILE} bleibt stehen, damit nichts verloren geht.\n`);
    process.exit(1);
  }
  rmSync(LEDGER_FILE);
  const stock = await admin.from("shop_inventory")
    .select("reserved", { count: "exact" }).neq("reserved", 0);
  console.log(`\n  Alles entfernt. Lagerzeilen mit reserved <> 0: `
    + `${stock.count ?? "?"}\n`);
}

requireStaging("ui-fixtures:ship-day");
if (MODE === "create") await create();
else await cleanup();
