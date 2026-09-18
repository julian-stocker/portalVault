import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { AGB } from "@/lib/legal/agb";
import { DATENSCHUTZ } from "@/lib/legal/datenschutz";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { IMPRESSUM } from "@/lib/legal/impressum";
import { NEVER_CLAIMED, SELLER_IDENTITY } from "@/lib/legal/seller-identity";
import { KONTAKT, VERSAND, ZAHLUNG } from "@/lib/legal/service-pages";
import { WIDERRUF, WIDERRUFSFORMULAR, WITHDRAWAL_PATH } from "@/lib/legal/widerruf";
import { latestFunction, migrationSource } from "@/test-support/migrations";

/**
 * The legal layer (ADR-0086).
 *
 * These tests do not check that the texts are *correct* — no test can do that,
 * and `docs/LEGAL.md` records what still needs a lawyer. They check the things
 * a test genuinely can: that nothing is claimed which does not exist, that the
 * statutory wording is reproduced rather than improved, that every version a
 * customer is told about is the version the database records, and that the
 * pages actually exist behind the links.
 */

const SQL = migrationSource("0047_legal_layer.sql");
const DOCS = [IMPRESSUM, DATENSCHUTZ, AGB, WIDERRUF, VERSAND, ZAHLUNG, KONTAKT];

/** Executable code with comments removed. Prose may name what code may not. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every sentence of a document, flattened. */
function textOf(doc: (typeof DOCS)[number]): string {
  const out: string[] = [doc.title, doc.lead];
  for (const section of doc.sections) {
    out.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "text" || block.kind === "quote") out.push(...block.paragraphs);
      else if (block.kind === "list" || block.kind === "steps") out.push(...block.items);
      else for (const [label, value] of block.pairs) out.push(label, value);
    }
  }
  return out.join("\n");
}

describe("nothing is invented", () => {
  it("claims no register entry, no telephone number and no authority", () => {
    /*
     * § 5 DDG asks for register details and a VAT identification number
     * "soweit vorhanden". There is no register entry and no published
     * telephone number, so neither is claimed — and this list is the guard
     * that keeps a well-meaning edit from adding one.
     */
    /*
     * A CLAIM, NOT A WORD. The Impressum has a section headed "Telefon" whose
     * entire content is that there is no telephone number, and the
     * Widerrufsbelehrung says no hygiene-article exception applies. Both are
     * the opposite of a claim, and a guard that banned the words would push
     * the next author into silence instead of accuracy.
     *
     * So each forbidden term is only a failure when it is followed by
     * something that looks like a value rather than by a denial.
     */
    const DENIES = /(kein|keine|keinen|nicht|nie|weder)\b/i;

    for (const doc of DOCS) {
      for (const section of doc.sections) {
        // The whole section, because the Impressum's heading is the bare word
        // "Telefon" and the denial is the sentence under it. Judging the
        // fragment would fail the very page that gets this right.
        const text = textOf({ ...doc, sections: [section] });
        for (const forbidden of NEVER_CLAIMED) {
          if (!new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
            continue;
          }
          expect(
            DENIES.test(text),
            `${doc.slug} / "${section.heading}" mentions ${forbidden} without denying it`,
          ).toBe(true);
        }
      }
    }
  });

  it("does not link the ODR platform, which no longer exists", () => {
    // It was shut down in July 2025. A link would be a dead promise.
    for (const doc of DOCS) {
      expect(textOf(doc), doc.slug).not.toMatch(/ec\.europa\.eu\/consumers|odr/i);
    }
  });

  it("promises no carrier transit time", () => {
    /*
     * Dispatch within 1–2 Werktage is a fact the operator supplied. How long
     * DHL or Hermes then take is not known to this repository, so it is not
     * stated — the statutory 30-day backstop of § 475 Abs. 1 BGB fills the
     * gap instead, which is true rather than comforting.
     */
    const text = textOf(VERSAND);
    expect(text).toContain("1–2 Werktagen");
    expect(text).toContain("§ 475 Abs. 1 BGB");
    expect(text).toMatch(/sagen wir nicht zu|nicht zu\b/);
    expect(text).not.toMatch(/Lieferzeit:\s*1[–-]2/);
    expect(text).not.toMatch(/Zustellung (in|innerhalb von) \d/);
  });

  it("names no payment method Stripe might not offer", () => {
    const text = textOf(ZAHLUNG);
    for (const method of ["PayPal", "Klarna", "Sofort", "Giropay", "Apple Pay", "Google Pay"]) {
      expect(text, method).not.toContain(method);
    }
  });

  it("describes no technology this product does not use", () => {
    // The Phase-1 audit found none of these. A privacy notice that lists them
    // is a copied one, and it makes the true parts harder to believe.
    const text = textOf(DATENSCHUTZ);
    for (const absent of [
      "Google Analytics",
      "Matomo",
      "Google Fonts",
      "reCAPTCHA",
      "Google Maps",
      "Facebook",
      "Remarketing",
    ]) {
      expect(text, absent).not.toContain(absent);
    }
    // "Newsletter" appears once, saying there is not one. That is the useful
    // sentence, not a section describing one.
    expect(text).toContain("Einen Newsletter gibt es nicht");
  });
});

describe("who the customer is contracting with", () => {
  it("is one sole proprietorship under two names, and says so", () => {
    const text = textOf(IMPRESSUM);
    expect(text).toContain("Julian Stocker");
    expect(text).toContain("yulez.collectibles");
    expect(text).toContain("Einzelunternehmen");
    // The sentence that stops a reader wondering how many businesses these are.
    expect(text).toMatch(/nicht um zwei Unternehmen|ein\*{0,2} Einzelunternehmen/);
  });

  it("never describes them as separate legal entities", () => {
    for (const doc of DOCS) {
      expect(textOf(doc), doc.slug).not.toMatch(/zwei Rechtssubjekte|zwei Rechtsträger/);
    }
  });

  it("names the contracting party the same way everywhere", () => {
    expect(SELLER_IDENTITY.contractingParty).toBe(
      "Julian Stocker, handelnd unter yulez.collectibles",
    );
    expect(textOf(AGB)).toContain(SELLER_IDENTITY.contractingParty);
  });

  it("agrees with what migration 0047 seeds into the database", () => {
    /*
     * The pages read the constants; invoices and order snapshots read the
     * database. If the two ever disagreed, a customer's invoice would name a
     * different seller than the Impressum they read.
     */
    // Derived from the constants, every one of them. Hardcoding the expected
    // strings here is what let the SQL carry a split street ('Lechhalde' plus
    // a house_number column that does not exist) while `SELLER_IDENTITY` had
    // the correct single line — the test passed and the migration failed.
    for (const value of [
      SELLER_IDENTITY.legalName,
      SELLER_IDENTITY.tradeName,
      SELLER_IDENTITY.street,
      SELLER_IDENTITY.postalCode,
      SELLER_IDENTITY.city,
      SELLER_IDENTITY.vatId,
    ]) {
      expect(SQL, value).toContain(`'${value}'`);
    }
  });

  it("except the contact address, which has deliberately moved on", () => {
    /*
     * `0047` seeds `info@skyisles.app`. The published address is now
     * `info@skyisles.de`, and the two are allowed to differ — which is why
     * this is its own test rather than a gap in the loop above.
     *
     * WHY THE MIGRATION IS NOT UPDATED. `0047` is applied to Staging and
     * Production, and an applied migration is never rewritten. It cannot do
     * any harm either: every contact field is seeded through
     * `coalesce(nullif(btrim(x), ''), …)`, so the seed only ever fills a NULL
     * and can never overwrite a value that exists.
     *
     * WHERE THE TRUTH LIVES NOW. The legal pages render `SELLER_IDENTITY`;
     * the invoice and each new `order_legal_snapshots` row read
     * `public.sellers.contact_email`. Both carry the new address. The seed
     * literal is a historical default, not the authority.
     */
    expect(SELLER_IDENTITY.email).toBe("info@skyisles.de");
    expect(SQL).toContain("'info@skyisles.app'");
    expect(SQL).not.toContain(SELLER_IDENTITY.email);

    // The seed can only fill an empty field — that is what makes the
    // divergence harmless rather than a landmine.
    for (const field of [
      "contact_email",
      "withdrawal_contact_email",
      "complaints_contact_email",
      "transactional_reply_to",
    ]) {
      expect(SQL, field).toContain(`nullif(btrim(${field}), '')`);
    }
  });

  it("no longer says the platform ships", () => {
    // "SkyIsles liefert derzeit nur innerhalb Deutschlands" made the platform
    // the shipper. The seller ships.
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).not.toMatch(/countryHint: "SkyIsles liefert/);
    expect(copy).not.toMatch(/invalid_country: "SkyIsles liefert/);
  });
});

describe("the statutory texts are reproduced, not improved", () => {
  const belehrung = textOf(WIDERRUF);

  it("opens with the words of the Muster", () => {
    expect(belehrung).toContain(
      "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu " +
        "widerrufen.",
    );
  });

  it("starts the period on taking possession, as a Kaufvertrag must", () => {
    expect(belehrung).toContain(
      "die letzte Ware in Besitz genommen haben bzw. hat",
    );
    // Not the Dienstleistung variant.
    expect(belehrung).not.toContain("des Vertragsabschlusses.");
  });

  it("carries the mandatory sentence about the online function", () => {
    // Gestaltungshinweis 3, required because § 356a BGB applies.
    expect(belehrung).toContain("auf einem dauerhaften Datenträger");
    expect(belehrung).toContain("Datum und der Uhrzeit ihres Eingangs");
    expect(belehrung).toContain(WITHDRAWAL_PATH);
  });

  it("says who bears the return cost, in the Muster's words", () => {
    expect(belehrung).toContain("Sie tragen die unmittelbaren Kosten der Rücksendung der Waren.");
  });

  it("keeps the Wertersatz and the Zurückbehaltungsrecht sentences", () => {
    expect(belehrung).toContain("Wir können die Rückzahlung verweigern");
    expect(belehrung).toContain("etwaigen Wertverlust der Waren");
  });

  it("claims no exception that does not apply to these goods", () => {
    expect(belehrung).toContain("keine Ausnahme vom Widerrufsrecht");
    // The exceptions are named only to say none of them applies here.
    expect(belehrung).toMatch(/keine versiegelten Hygieneartikel/);
    expect(belehrung).not.toMatch(/Das Widerrufsrecht (erlischt|besteht nicht)/);
  });

  it("offers the statutory model form rather than one of our own", () => {
    expect(WIDERRUFSFORMULAR.intro).toContain(
      "Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus",
    );
    expect(WIDERRUFSFORMULAR.lines[0]).toContain("Hiermit widerrufe(n) ich/wir (*)");
    expect(WIDERRUFSFORMULAR.footnote).toBe("(*) Unzutreffendes streichen.");
    expect(WIDERRUFSFORMULAR.recipient).toContain(SELLER_IDENTITY.legalName);
  });
});

describe("the contract-formation model is the same in the code and in the AGB", () => {
  const agb = textOf(AGB);

  it("the order is the customer's offer", () => {
    expect(agb).toContain("verbindliches Angebot");
    expect(agb).toContain("Zahlungspflichtig bestellen");
  });

  it("the acknowledgement is explicitly not an acceptance", () => {
    expect(agb).toMatch(/keine\*{0,2} Annahme/);
  });

  it("the acceptance is the order confirmation, and the code agrees", () => {
    expect(agb).toContain("Mit dem Zugang dieser");
    const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(webhook).toMatch(/confirmed:\s*"order_confirmation"/);
  });

  it("a flagged order gets no acceptance, in the AGB and in the wiring", () => {
    expect(agb).toContain("senden wir keine");
    const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(webhook).toMatch(/late_payment_unresolved:\s*"resolution_alert"/);
  });

  it("the § 312i acknowledgement is actually sent", () => {
    // It did not exist at all before this round.
    const actions = readFileSync("src/lib/commerce/actions.ts", "utf8");
    expect(actions).toContain("acknowledgeOrder(orderNumber)");
    expect(actions).toContain('kind: "order_received"');
  });

  it("the button still reads exactly what § 312j Abs. 3 requires", () => {
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).toContain('submit: "Zahlungspflichtig bestellen"');
  });
});

describe("the § 356a electronic withdrawal function", () => {
  const flow = readFileSync("src/components/legal/withdrawal-flow.tsx", "utf8");
  const copy = readFileSync("src/lib/i18n/de.ts", "utf8");

  it("uses the statutory button wording, unchanged", () => {
    // § 356a Abs. 1 and Abs. 3 write these two labels into the statute.
    expect(copy).toContain('continue: "Vertrag widerrufen"');
    expect(copy).toContain('confirm: "Widerruf bestätigen"');
  });

  it("is two steps, with the confirmation separate", () => {
    expect(flow).toContain('setStep("confirm")');
    expect(flow).toContain('type Step = "form" | "confirm" | "done"');
    // The declaration is only submitted from the confirm step.
    const confirmStep = flow.slice(flow.indexOf('if (step === "confirm")'));
    expect(confirmStep).toContain("onClick={submit}");
  });

  it("collects exactly what Abs. 2 requires", () => {
    // name, contract identification, and an electronic address for the receipt
    expect(flow).toContain("copy.name");
    expect(flow).toContain("copy.orderNumber");
    expect(flow).toContain("copy.email");
  });

  it("needs no account, so a guest can use it", () => {
    const page = readFileSync("src/app/(public)/widerrufen/page.tsx", "utf8");
    expect(page).not.toContain("currentProfile");
    expect(page).not.toContain("SIGN_IN_PATH");
    const action = readFileSync("src/lib/legal/withdrawal-actions.ts", "utf8");
    expect(action).not.toContain("canOperateSeller");
    expect(action).not.toContain("currentUser");
  });

  it("cannot be used to discover which orders or addresses exist", () => {
    const fn = latestFunction("receive_withdrawal").body;
    // Identical answer whether or not anything matched.
    expect(fn).toContain("The uniform answer");
    expect(fn).toContain("'accepted', true, 'delivered', false");
    const action = readFileSync("src/lib/legal/withdrawal-actions.ts", "utf8");
    expect(action).toContain("return { ok: true }");
    expect(action).not.toContain("ok: false");
  });

  it("requires the order number AND the e-mail on that order", () => {
    const fn = latestFunction("receive_withdrawal").body;
    expect(fn).toContain("lower(o.customer_email) = lower(btrim(p_email))");
  });

  it("throttles every attempt, not only the ones that matched", () => {
    /*
     * The first version counted `withdrawal_requests` rows — which are only
     * created when something matched. A probe against a fabricated order
     * number created no row and was therefore never counted. The attempt
     * itself is now recorded before anything is known about it.
     */
    const fn = latestFunction("receive_withdrawal").body;
    expect(fn).toContain("public.request_client_hash()");
    expect(fn).toContain("insert into public.withdrawal_attempts");
    expect(fn).toContain("v_recent >= 10");

    // The count is over attempts, and it happens BEFORE the order is looked up
    // — so a non-match is counted exactly like a match.
    expect(fn).toContain("from public.withdrawal_attempts a");
    expect(fn.indexOf("insert into public.withdrawal_attempts")).toBeLessThan(
      fn.indexOf("select o.id, o.order_number"),
    );
    /*
     * The throttle block specifically must not read `withdrawal_requests` —
     * that was the old mistake. The function still reads it once afterwards,
     * to return the timestamp of the row it has just written, which is a
     * different thing entirely.
     */
    const throttleBlock = fn
      .slice(0, fn.indexOf("select o.id, o.order_number"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
    expect(throttleBlock).not.toContain("withdrawal_requests");
  });

  it("answers a throttled caller exactly as it answers a non-match", () => {
    // "You are being rate limited" would itself be a signal worth harvesting.
    const fn = latestFunction("receive_withdrawal").body;
    const throttled = fn.slice(fn.indexOf("if v_recent >= 10"));
    expect(throttled).toContain("'accepted', true, 'delivered', false");
  });

  it("keeps no address and no history", () => {
    // A salted per-request hash and a timestamp. Nothing else.
    expect(SQL).toContain("create table if not exists public.withdrawal_attempts");
    const table = SQL.slice(
      SQL.indexOf("create table if not exists public.withdrawal_attempts"),
      SQL.indexOf("comment on table public.withdrawal_attempts"),
    );
    for (const forbidden of ["order_number", "email", "user_agent", "ip", "consumer_name"]) {
      expect(table, forbidden).not.toContain(forbidden);
    }
    // And the window is pruned by the function that uses it.
    expect(latestFunction("receive_withdrawal").body).toContain(
      "delete from public.withdrawal_attempts",
    );
  });

  it("does not lock a real customer out for long", () => {
    // A sliding hour, not a ban.
    expect(latestFunction("receive_withdrawal").body).toContain(
      "a.attempted_at > now() - interval '1 hour'",
    );
  });

  it("records the statutory timestamp from the database clock", () => {
    expect(SQL).toContain("received_at timestamptz not null default now()");
  });

  it("accepts an order from the world this installation is running in", () => {
    /*
     * Not a hard-coded 'live'. `create_order()` stamps each order with
     * `commerce_mode()`, and this asks the same function — so Staging, which
     * runs in sandbox, can exercise the successful path end to end, while
     * Production, which runs live, still refuses a historical sandbox order.
     */
    const fn = latestFunction("receive_withdrawal").body;
    expect(fn).toContain("o.commerce_mode = public.commerce_mode()");
    expect(fn).not.toContain("o.commerce_mode = 'live'");
  });

  it("and that cannot quietly widen Production", () => {
    // Production would have to be switched to sandbox — an explicit
    // platform-admin act that also stops it taking real orders.
    expect(latestFunction("commerce_mode").body).toContain("from public.commerce_settings");
    expect(SQL).toContain("WHY THIS CANNOT WIDEN PRODUCTION");
  });

  it("confirms receipt with the content, the date and the time", () => {
    // § 356a Abs. 4, all three.
    const templates = readFileSync("supabase/functions/send-order-mail/templates.ts", "utf8");
    expect(templates).toContain("Inhalt deiner Erklärung");
    expect(templates).toContain("Eingegangen am");
    expect(templates).toContain("berlinDateTime");
    expect(templates).toContain("receipt.declaration");
  });

  it("does not treat a withdrawal as a refund", () => {
    // Two events, two tables, two timestamps (ADR-0083).
    expect(SQL).toContain("create table if not exists public.withdrawal_requests");
    expect(SQL).toContain("create table if not exists public.order_refunds");
    const fn = latestFunction("receive_withdrawal").body;
    expect(fn).not.toContain("order_refunds");
    expect(fn).not.toContain("payment_status");
  });

  it("is reachable from every page", () => {
    const footer = readFileSync("src/components/layout/site-footer.tsx", "utf8");
    expect(footer).toContain("WITHDRAWAL_PATH");
  });
});

describe("the abuse fingerprint, and the promise made about it", () => {
  it("is cleared when the order is paid, as the notice says", () => {
    /*
     * `0010` said so in its own column comment and nothing did it; the privacy
     * notice repeated it to customers as a fact. Now a trigger performs it.
     */
    expect(SQL).toContain("create trigger orders_clear_client_hash_trg");
    expect(SQL).toContain("before insert or update on public.orders");
    const fn = latestFunction("orders_clear_client_hash_when_paid").body;
    expect(fn).toContain("if new.payment_status = 'paid'");
    expect(fn).toContain("new.client_hash := null");
  });

  it("and the notice and the implementation now say the same thing", () => {
    const text = textOf(DATENSCHUTZ);
    expect(text).toContain("gelöscht, sobald die Bestellung bezahlt ist");
    expect(text).toContain("IP-Adresse selbst wird dabei nicht");
  });

  it("is cleared on the orders that were already paid, too", () => {
    /*
     * Otherwise the sentence stays false for every order existing on the day
     * the migration runs — on Production, real customers who were told their
     * fingerprint was dropped at payment.
     */
    // Anchored on the backfill itself — 0047 contains other updates to
    // `orders`, and the first one in the file is not this one.
    const backfill = SQL.slice(SQL.indexOf("update public.orders\n   set client_hash = null"));
    expect(backfill).toContain("set client_hash = null");
    expect(backfill).toContain("where payment_status = 'paid'");
    // It SETS that one column and nothing else. (`payment_status` appears in
    // the WHERE clause, which is why only the SET clause is examined.)
    const statement = backfill.slice(0, backfill.indexOf(";") + 1);
    const setClause = statement.slice(statement.indexOf("set "), statement.indexOf("where"));
    expect(setClause.trim()).toBe("set client_hash = null");
    expect(statement).not.toContain("delete");
  });

  it("clearing is permitted by the immutability guard, never fought with it", () => {
    // 0010 allows the hash to be cleared and nothing else, so the two agree by
    // construction rather than by trigger ordering.
    const core = migrationSource("0010_commerce_core.sql");
    expect(core).toMatch(
      /new\.client_hash is distinct from old\.client_hash and new\.client_hash is not null/,
    );
  });

  it("does not weaken the arm of the limit that matters", () => {
    /*
     * `enforce_checkout_limits()` reads the hash for open checkouts (joined to
     * ACTIVE reservations, which a paid order no longer has) and for the
     * hourly count. Only the second changes, and unpaid checkouts — the abuse
     * the limit exists for — keep their hash until they expire.
     */
    const core = migrationSource("0010_commerce_core.sql");
    expect(core).toContain("where r.state = 'active'");
    expect(core).toContain("o.placed_at > now() - interval '1 hour'");
  });
});

describe("the invoice", () => {
  it("is issued on confirmed payment and only then", () => {
    const fn = latestFunction("issue_invoice").body;
    expect(fn).toContain("if v_order.payment_status <> 'paid' then");
  });

  it("is issued once, and never rewritten", () => {
    expect(SQL).toContain("constraint invoices_one_per_order unique (order_id)");
    expect(SQL).toContain("an issued invoice cannot be changed or deleted");
    expect(SQL).toContain("before update or delete on public.invoices");
  });

  it("copies the seller and the customer rather than joining them", () => {
    // A document rendered from live data is not a document.
    for (const column of [
      "seller_legal_name text not null",
      "customer_name    text not null",
      "lines jsonb not null",
    ]) {
      expect(SQL, column).toContain(column);
    }
  });

  it("carries every particular § 34a UStDV asks for", () => {
    const invoice = code("src/lib/legal/invoice.ts");
    // 1 both parties · 2 VAT id · 3 date · 4 quantity and description · 5 sum
    // with the exemption note
    expect(invoice).toContain("seller.legal_name");
    expect(invoice).toContain("customer.name");
    expect(invoice).toContain("vat_id");
    expect(invoice).toContain("issued_at");
    expect(invoice).toContain("line.quantity");
    expect(invoice).toContain("SMALL_BUSINESS_NOTE");
    expect(invoice).toContain("Gesamtbetrag");
  });

  it("states the § 19 exemption in its current wording", () => {
    const invoice = code("src/lib/legal/invoice.ts");
    expect(invoice).toContain("Steuerfreie Leistung eines Kleinunternehmers gemäß § 19 UStG");
    /*
     * The pre-reform phrasing ("die Steuer wird nicht erhoben") describes a
     * rule that no longer applies: since the reform § 19 supplies are
     * steuerfrei. Checked against code, because the file's own comment
     * explains the difference and has to quote the old wording to do it.
     */
    expect(invoice).not.toContain("wird keine Umsatzsteuer berechnet");
    expect(invoice).not.toContain("Steuer wird nicht erhoben");
  });

  it("shows no VAT line anywhere", () => {
    for (const file of [
      "src/lib/legal/invoice.ts",
      "src/components/legal/invoice-view.tsx",
    ]) {
      const source = code(file);
      // A VAT row would need a label and a figure. `USt-IdNr.` is an
      // identifier, not a tax line, and is required by § 34a UStDV Nr. 2.
      expect(source, file).not.toMatch(/MwSt|Mehrwertsteuer|tax_rate|vatAmount|taxAmount/);
      /*
       * A VAT LINE IS A LABEL WITH A FIGURE. `USt-IdNr.` is an identifier that
       * § 34a UStDV Nr. 2 requires, and "§ 19 UStG" is a citation the same
       * regulation's Nr. 5 requires — neither is a tax row. What must never
       * appear is an amount presented as tax.
       */
      expect(source, file).not.toMatch(/USt\s*[:=]|USt\s+\d|Steuer(betrag|satz)/);
    }
  });

  it("is never stored, so it cannot end up in a public bucket", () => {
    const route = readFileSync("src/app/(public)/rechnung/[orderNumber]/pdf/route.ts", "utf8");
    expect(route).not.toContain("storage");
    expect(route).toContain("renderInvoicePdf");
    expect(SQL).not.toContain("storage.buckets");
  });

  it("is private, and a guest reaches their own with the capability", () => {
    const fn = latestFunction("invoice_document").body;
    expect(fn).toContain("public.authorize_order_payment(v_order.id, (select auth.uid()), p_token)");
    const route = readFileSync("src/app/(public)/rechnung/[orderNumber]/pdf/route.ts", "utf8");
    expect(route).toContain('"private, no-store"');
  });

  it("cannot be enumerated: unknown and forbidden answer the same", () => {
    const page = readFileSync("src/app/(public)/rechnung/[orderNumber]/page.tsx", "utf8");
    expect(page).toContain("if (invoice === null) notFound();");
  });

  it("numbers are unique and shaped", () => {
    expect(SQL).toContain("constraint invoices_number_unique unique (invoice_number)");
    expect(SQL).toContain("invoice_number ~ '^SI-R-[0-9]{4}-[0-9]{6}$'");
  });
});

describe("legal document versions", () => {
  it("are recorded per order by a trigger, not by the application", () => {
    // An order with no snapshot would be an order nobody can state the terms
    // of, and a second round trip is a second thing that can fail.
    expect(SQL).toContain("create trigger orders_snapshot_legal_trg");
    expect(SQL).toContain("after insert on public.orders");
  });

  it("match what the migration seeds", () => {
    for (const [slug, version] of Object.entries(LEGAL_VERSIONS)) {
      expect(SQL, slug).toContain(`('${slug}',`);
      expect(SQL, `${slug}@${version}`).toContain(`'${version}'`);
    }
  });

  it("are shown on the page and in the confirmation mail", () => {
    expect(AGB.version).toBe(LEGAL_VERSIONS.agb);
    expect(WIDERRUF.version).toBe(LEGAL_VERSIONS.widerruf);
    const templates = readFileSync("supabase/functions/send-order-mail/templates.ts", "utf8");
    expect(templates).toContain("agb_version");
    expect(templates).toContain("Für diese Bestellung gelten");
  });

  it("cannot be changed or deleted once written", () => {
    // The same protection `invoices` has, for the same reason: a record of
    // what somebody agreed to is worthless if it can be edited afterwards.
    expect(SQL).toContain("create trigger order_legal_snapshots_protect_trg");
    expect(SQL).toContain("before update or delete on public.order_legal_snapshots");
    expect(SQL).toContain(
      "the legal terms recorded for an order cannot be changed or deleted",
    );
    // The initial INSERT stays legitimate — the trigger is UPDATE/DELETE only.
    expect(SQL).not.toContain("before insert or update or delete on public.order_legal_snapshots");
  });

  it("a historical order never points at a later text", () => {
    // The snapshot is a copy, not a foreign key to the live version row.
    expect(SQL).toContain("agb_version      text not null");
    expect(SQL).not.toMatch(/agb_version[^;]*references public\.legal_document_versions/);
  });
});

describe("every legal route exists and is linked", () => {
  const ROUTES = [
    "/impressum",
    "/datenschutz",
    "/agb",
    "/widerruf",
    "/widerrufen",
    "/versand",
    "/zahlung",
    "/kontakt",
  ];

  it("renders from a real page file", () => {
    for (const route of ROUTES) {
      expect(existsSync(`src/app/(public)${route}/page.tsx`), route).toBe(true);
    }
  });

  it("is reachable from the footer", () => {
    const footer = readFileSync("src/components/layout/site-footer.tsx", "utf8");
    for (const route of ROUTES) {
      const linked = footer.includes(`"${route}"`) || footer.includes("WITHDRAWAL_PATH");
      expect(linked, route).toBe(true);
    }
  });

  it("and the checkout links what § 312j Abs. 2 requires before the order", () => {
    const view = readFileSync("src/components/checkout/checkout-view.tsx", "utf8");
    for (const route of ["/agb", "/widerruf", "/versand", "/datenschutz"]) {
      expect(view, route).toContain(route);
    }
  });

  it("and the basket says what § 312j Abs. 1 requires at the start", () => {
    const cart = readFileSync("src/components/cart/cart-view.tsx", "utf8");
    expect(cart).toContain("de.legal.orderStart.delivery");
    expect(cart).toContain("de.legal.orderStart.payment");
  });
});

describe("no cookie banner, and that is a decision", () => {
  it("none is implemented", () => {
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).not.toMatch(/Cookie-Banner|Cookies akzeptieren|Alle akzeptieren/);
  });

  it("and the privacy notice explains why rather than staying silent", () => {
    const text = textOf(DATENSCHUTZ);
    expect(text).toContain("kein** Einwilligungsbanner");
    expect(text).toContain("technisch erforderliche Speicherung");
  });
});
