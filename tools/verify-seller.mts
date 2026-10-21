/**
 * Functional verification of the public seller projection (migration 0027).
 *
 *   npm run verify:seller:staging
 *
 * Read-only. It creates nothing, writes nothing and prints no value that is
 * not already public: the trade name is on every order mail and belongs in
 * the Impressum. Addresses, Reply-To and ids of the people who edited a row
 * are asserted to be ABSENT and are never printed even when they are found —
 * the check reports the key, not the value (docs/SECURITY.md).
 *
 * It proves the ten properties 0027 has to have, in the order in which one
 * would doubt them.
 */
import { createClient } from "@supabase/supabase-js";

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
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

/** Exactly the keys the allow-list names. */
const PUBLIC_KEYS = ["id", "display_name"];

/** Fields that must never leave the sellers table through this door. */
const FORBIDDEN = [
  "contact_email",
  "transactional_reply_to",
  "updated_by",
  "created_at",
  "updated_at",
  "is_active",
];

async function main(): Promise<void> {
  console.log(`seller_public() on ${new URL(URL_).host}\n`);

  heading("1-3. The projection answers, and answers with exactly two columns");

  const { data, error } = await anon.rpc("seller_public");
  check("anon may execute seller_public()", error === null, error?.code ?? error?.message ?? "");
  if (error) {
    console.log("\nNothing further can be checked. Is migration 0027 applied?");
    process.exit(1);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  check("returns exactly one active seller", rows.length === 1, `${rows.length} row(s)`);

  const row = rows[0] ?? {};
  const keys = Object.keys(row).sort();
  check(
    "returns exactly id and display_name",
    JSON.stringify(keys) === JSON.stringify([...PUBLIC_KEYS].sort()),
    keys.join(", "),
  );

  heading("4. The active seller is the one the product says it is");
  const name = typeof row.display_name === "string" ? row.display_name : "";
  // The trade name is public by law and by design; printing it reveals nothing.
  check("display_name is a non-empty trade name", name.trim().length > 0, name);
  check("id is a number", typeof row.id === "number", String(typeof row.id));

  heading("5-7. Nothing private came with it");
  for (const field of FORBIDDEN) {
    // The KEY is reported, never a value — a failure must not print the thing
    // that leaked.
    check(`${field} is absent`, !(field in row));
  }

  heading("8. active_seller() is still closed to visitors");
  const active = await anon.rpc("active_seller");
  check(
    "anon cannot execute active_seller()",
    active.error !== null,
    active.error?.code ?? "NO ERROR — it answered",
  );

  heading("9. The table itself is still unreadable");
  const table = await anon.from("sellers").select("display_name").limit(1);
  check("anon cannot select from sellers", table.error !== null, table.error?.code ?? "NO ERROR");

  heading("10. shop_offers() carries no seller, and nothing else new");
  const offers = await anon.rpc("shop_offers");
  check("shop_offers() still answers", offers.error === null, offers.error?.code ?? "");
  const offerRow = ((offers.data ?? []) as Record<string, unknown>[])[0];
  if (offerRow) {
    const offerKeys = Object.keys(offerRow).sort();
    /*
     * FIVE COLUMNS SINCE 0139, not four.
     *
     * `delivery_scope` says what is in the parcel and is NULL for every
     * figure; an offer for used goods has to state it (ADR-0129/0130). The
     * list is pinned so a sixth column has to be a deliberate addition,
     * named here — exactly as the fourth was.
     */
    check(
      "shop_offers() returns its five columns",
      JSON.stringify(offerKeys)
        === JSON.stringify(["available", "condition", "delivery_scope", "price", "sky_id"]),
      offerKeys.join(", "),
    );
    check("shop_offers() carries no seller field", !offerKeys.some((k) => k.includes("seller")));
    /* And still no stock level: `available` is a boolean, never a count. */
    check(
      "shop_offers() carries no quantity",
      !offerKeys.some((k) => k.includes("quantity") || k === "reserved"),
      offerKeys.join(", "),
    );
  } else {
    check("shop_offers() has a row to inspect", false, "no offers listed");
  }

  heading("11. seller_sale_state() is there, and closed to visitors");
  /*
   * ZWEI FRAGEN IN EINER ANTWORT (0141).
   *
   * Die Lagerkarte liest `sale_released`, `delivery_scope` und `usk_rating`
   * ueber diese Funktion. Sie verhaelt sich unterschiedlich, je nachdem
   * WARUM sie nicht antwortet, und die Anwendung verlaesst sich darauf:
   *
   *   PGRST202  „gibt es nicht" — `0141` ist nicht angewendet. Dann zeigt
   *             die Karte die drei Steuerungen schlicht nicht.
   *   42501     „darf nicht" — die Funktion steht und der Riegel haelt.
   *
   * Ein `42501` beweist hier also beides auf einmal: angewendet UND dicht.
   */
  const saleState = await anon.rpc("seller_sale_state");
  check(
    "seller_sale_state() exists (0141 applied)",
    saleState.error?.code !== "PGRST202",
    saleState.error?.code ?? "it answered",
  );
  check(
    "anon cannot execute seller_sale_state()",
    saleState.error !== null,
    saleState.error?.code ?? "NO ERROR — it answered",
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
