import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { decide, type StripeEventShape } from "../../../supabase/functions/stripe-webhook/event.ts";

/**
 * Wie `stripe-webhook` mit der Datenbank spricht — und der Fehler, der diese
 * Datei nötig gemacht hat (0101).
 *
 * WAS PASSIERT IST. Die beiden 0101-Aufrufe `record_payment_method` und
 * `attach_payment_intent` waren gegen `admin.rpc(...)` geschrieben. Einen
 * `admin`-Client gibt es in dieser Function nicht und hat es nie gegeben: sie
 * spricht seit B2.3 ausschließlich nacktes `fetch` auf PostgREST. Ein freier
 * Bezeichner fällt beim Bündeln nicht auf — esbuild hält ihn für ein Global —
 * und wirft zur Laufzeit `ReferenceError`.
 *
 * WAS DAS KOSTETE. Auf Staging war `SI-2026-001068` bezahlt und gebucht, und
 * die Anfrage starb genau danach: keine Rechnung, keine Auftragsbestätigung,
 * kein Verkäuferhinweis, keine Zahlungsart. Ein Fehler, vier Symptome — der
 * Wurf liegt zwischen `confirm_order_payment()` und `mailFor()`, und `mailFor()`
 * beginnt mit der Rechnung.
 *
 * WAS HIER GEPRÜFT WIRD. Die Entscheidungen selbst hat `webhook.test.ts`; hier
 * steht die Verdrahtung: dass kein Bezeichner frei ist, dass beide RPCs über
 * denselben Weg gehen wie alles andere, und dass die Reihenfolge nach der
 * bestätigten Zahlung unverändert ist.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** Die Quelle ohne Kommentare — die Prosa hier nennt `admin` beim Namen. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const WEBHOOK = "supabase/functions/stripe-webhook/index.ts";

/* ------------------------------------------------------------------------ */
/* 1. Kein freier Bezeichner mehr — der eigentliche Regressionsschutz         */
/* ------------------------------------------------------------------------ */

/** Was in einer Edge Function ohne Deklaration dastehen darf. */
const RUNTIME_GLOBALS = new Set([
  "Deno", "JSON", "Math", "Object", "String", "Number", "Boolean", "Array", "Promise",
  "console", "crypto", "fetch", "Response", "Request", "Headers", "URL", "URLSearchParams",
  "Date", "Error", "TextEncoder", "TextDecoder", "globalThis", "Map", "Set", "Intl",
  "atob", "btoa",
]);

/**
 * Jeder Name, den die Datei selbst einführt.
 *
 * Bewusst großzügig — Import, Deklaration, Destrukturierung, Funktionsname,
 * `catch`-Bindung und Parameter. Ein zu großzügiger Satz macht diesen Test
 * milder, niemals falsch-positiv: was hier fehlt, ist wirklich nirgends
 * deklariert.
 */
function declaredNames(text: string): Set<string> {
  const names = new Set<string>();
  const add = (n: string | undefined) => {
    if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
  };

  for (const m of text.matchAll(/\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) add(m[1]);
  for (const m of text.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) add(part.replace(/\btype\b/, "").split(/\s+as\s+/).pop()?.trim());
  }
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) add(part.split(":").pop()?.split("=")[0].trim());
  }
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*|\basync\s*)?\(([^()]*)\)\s*(?::[^=>{]+)?(?:=>|\{)/g)) {
    for (const part of m[1].split(",")) add(part.trim().split(":")[0].replace(/^\.\.\./, "").trim());
  }
  return names;
}

/** Die Empfänger von `await X.…` — genau die Form, in der der Fehler stand. */
function awaitedReceivers(text: string): string[] {
  return [...new Set([...text.matchAll(/\bawait\s+([A-Za-z_$][\w$]*)\s*\./g)].map((m) => m[1]))];
}

const EDGE_FUNCTIONS = [
  WEBHOOK,
  "supabase/functions/stripe-webhook/event.ts",
  "supabase/functions/send-order-mail/index.ts",
  "supabase/functions/send-order-mail/templates.ts",
  "supabase/functions/create-payment/index.ts",
  // 0111: die Function, die Geld zurückgibt. Genau hier wäre ein freier
  // Bezeichner am teuersten.
  "supabase/functions/refund-payment/index.ts",
  "supabase/functions/refund-payment/refund.ts",
];

describe("keine Edge Function ruft etwas auf, das es nicht gibt", () => {
  for (const file of EDGE_FUNCTIONS) {
    it(`${file.split("/").slice(-2).join("/")} dereferenziert nur Deklariertes`, () => {
      const text = code(file);
      const known = declaredNames(text);
      const free = awaitedReceivers(text).filter(
        (name) => !known.has(name) && !RUNTIME_GLOBALS.has(name),
      );
      expect(free, `freie Bezeichner in ${file}`).toEqual([]);
    });
  }

  it("erkennt den Fehler, gegen den er schützt", () => {
    /*
     * Ein Test, der nichts findet, beweist nichts. Hier wird die echte Datei
     * genommen und der Fehler wieder hineingeschrieben — findet der Detektor
     * ihn nicht, ist die Regel oben Dekoration.
     */
    const broken = code(WEBHOOK).replace('await rpc("record_payment_method"', 'await admin.rpc("x"');
    const free = awaitedReceivers(broken).filter(
      (name) => !declaredNames(broken).has(name) && !RUNTIME_GLOBALS.has(name),
    );
    expect(free).toContain("admin");
  });
});

describe("der Webhook hält keinen Supabase-Client", () => {
  const webhook = code(WEBHOOK);

  it("importiert keinen", () => {
    expect(webhook).not.toContain("@supabase/supabase-js");
    expect(webhook).not.toContain("createClient");
  });

  it("ruft kein RPC als Methode eines Objekts auf", () => {
    // `rpc("…")` ja — `irgendwas.rpc("…")` nein. Das ist das Client-Idiom,
    // und dieses Idiom war der Fehler.
    expect(webhook).not.toMatch(/[A-Za-z_$][\w$]*\s*\.\s*rpc\s*\(/);
    expect(webhook).not.toMatch(/[A-Za-z_$][\w$]*\s*\.\s*from\s*\(/);
  });
});

/* ------------------------------------------------------------------------ */
/* 2. Beide 0101-RPCs gehen denselben Weg wie alles andere                    */
/* ------------------------------------------------------------------------ */

describe("ein RPC, ein Transportweg", () => {
  const webhook = code(WEBHOOK);

  it("hat genau einen gemeinsamen Helfer, und er spricht PostgREST", () => {
    expect(webhook).toContain("async function rpc(fn: string");
    const at = webhook.indexOf("async function rpc(fn: string");
    const body = webhook.slice(at, at + 900);
    expect(body).toContain("${SUPABASE_URL}/rest/v1/rpc/${fn}");
    expect(body).toContain("apikey: SERVICE_KEY");
    expect(body).toContain("Authorization: `Bearer ${SERVICE_KEY}`");
    expect(body).toContain('method: "POST"');
  });

  it("schickt beide 0101-Aufrufe hindurch", () => {
    expect(webhook).toContain('await rpc("record_payment_method"');
    expect(webhook).toContain('await rpc("attach_payment_intent"');
  });

  it("übergibt record_payment_method genau die fünf Felder der Ladung", () => {
    const at = webhook.indexOf('rpc("record_payment_method"');
    const call = webhook.slice(at, webhook.indexOf("}", webhook.indexOf("p_wallet_type", at)));
    for (const field of ["p_provider_intent_id", "p_method_type", "p_card_brand",
                         "p_card_last4", "p_wallet_type"]) {
      expect(call).toContain(field);
    }
    // Kein Geld. Der Betrag steht auf der Bestellung, nicht auf der Ladung.
    expect(call).not.toContain("p_amount");
  });
});

/* ------------------------------------------------------------------------ */
/* 3. checkout.session.completed — Reihenfolge und Folgenlosigkeit            */
/* ------------------------------------------------------------------------ */

describe("eine bestätigte Session läuft weiter bis zu Rechnung und Mails", () => {
  const webhook = code(WEBHOOK);

  it("hält die Reihenfolge ein: zahlen, Intent merken, Rechnung, Kundenmail, Verkäuferhinweis", () => {
    /*
     * Genau die Reihenfolge, an der der Fehler sichtbar wurde: der Wurf lag
     * zwischen Schritt 1 und Schritt 3, und deshalb fehlte die Rechnung.
     */
    const confirm = webhook.indexOf("await callDatabase(decision)");
    const attach = webhook.indexOf('rpc("attach_payment_intent"');
    const mail = webhook.indexOf("await mailFor(outcome");
    const notice = webhook.indexOf("await noticeToSeller(");
    expect(confirm).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(confirm);
    expect(mail).toBeGreaterThan(attach);
    expect(notice).toBeGreaterThan(mail);
  });

  it("lässt einen misslungenen Intent-Vermerk die Rechnung nicht aufhalten", () => {
    /*
     * Die Zahlungsart ist Anzeige, die Rechnung ist Pflicht. Der Block muss
     * fangen und darf weder werfen noch zurückkehren — sonst steht wieder
     * dasselbe Loch im Ablauf.
     */
    const at = webhook.indexOf('rpc("attach_payment_intent"');
    const block = webhook.slice(webhook.lastIndexOf("try {", at), webhook.indexOf("await mailFor", at));
    expect(block).toContain("catch");
    expect(block).not.toContain("return ");
  });

  it("vermerkt nur, was die Session wirklich mitbringt", () => {
    // Ohne Intent kein Aufruf — `attach_payment_intent` mit null wäre eine
    // Behauptung über etwas, das im Ereignis nicht stand.
    expect(webhook).toContain("const intentId = session0101(event);");
    expect(webhook).toContain('decision.action === "confirm" && intentId');
  });

  it("entscheidet eine bezahlte Session weiterhin als confirm", () => {
    const event: StripeEventShape = {
      id: "evt_test_session",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          object: "checkout.session",
          id: "cs_test_abc",
          payment_status: "paid",
          status: "complete",
          amount_total: 967,
          currency: "eur",
          payment_intent: "pi_test_abc",
        },
      },
    } as unknown as StripeEventShape;

    const decision = decide(event, false);
    expect(decision.action).toBe("confirm");
    if (decision.action === "confirm") {
      expect(decision.sessionId).toBe("cs_test_abc");
      // Exakte Dezimalzahl als String, nicht als Float (B2.3).
      expect(decision.amount).toBe("9.67");
    }
  });
});

/* ------------------------------------------------------------------------ */
/* 4. charge.succeeded — erreicht record_payment_method                       */
/* ------------------------------------------------------------------------ */

describe("eine Ladung trägt die Zahlungsart und sonst nichts", () => {
  const webhook = code(WEBHOOK);
  /*
   * Genau der `method`-Zweig: von seiner Bedingung bis zu der Zeile, mit der
   * der Sessionpfad beginnt. Ein Ausschnitt nach Zeichenzahl wäre eine Zahl,
   * die beim nächsten Kommentar nicht mehr stimmt.
   */
  const branch = webhook.slice(
    webhook.indexOf('decision.action === "method"'),
    // Seit 0111 folgt der Erstattungszweig; er hat seinen eigenen Abschnitt.
    webhook.indexOf('decision.action === "refunds"'),
  );

  const charge = (extra: Record<string, unknown> = {}): StripeEventShape =>
    ({
      id: "evt_test_charge",
      type: "charge.succeeded",
      livemode: false,
      data: {
        object: {
          object: "charge",
          payment_intent: "pi_test_abc",
          payment_method_details: {
            type: "card",
            card: { brand: "visa", last4: "4242", wallet: { type: "apple_pay" } },
          },
          ...extra,
        },
      },
    }) as unknown as StripeEventShape;

  it("wird als method entschieden und liest die fünf Felder", () => {
    const decision = decide(charge(), false);
    expect(decision.action).toBe("method");
    if (decision.action === "method") {
      expect(decision.charge).toEqual({
        paymentIntent: "pi_test_abc",
        methodType: "card",
        cardBrand: "visa",
        cardLast4: "4242",
        walletType: "apple_pay",
      });
    }
  });

  it("wird ignoriert, wenn der Intent fehlt — es gäbe nichts zuzuordnen", () => {
    const decision = decide(charge({ payment_intent: null }), false);
    expect(decision.action).toBe("ignore");
  });

  it("schließt keinen Versuch und bestätigt keine Zahlung", () => {
    /*
     * Der Zweig endet in sich: er steht vor `callDatabase()` und kehrt in
     * jedem seiner drei Fälle zurück. Eine Ladung darf niemals Bestand buchen.
     */
    expect(webhook.indexOf('decision.action === "method"')).toBeGreaterThan(-1);
    expect(webhook.indexOf('decision.action === "method"'))
      .toBeLessThan(webhook.indexOf("await callDatabase(decision)"));
    expect(branch).not.toContain("confirm_order_payment");
    expect(branch).not.toContain("callDatabase");
    // Jeder der drei Ausgänge kehrt zurück, keiner fällt in den Sessionpfad.
    expect(branch.match(/return respond\(/g)).toHaveLength(3);
  });

  it("lässt Stripe wiederholen, wenn die Ladung vor der Sitzung kommt", () => {
    expect(branch).toContain('recorded === "unknown_intent"');
    expect(branch).toContain('respond(500, { error: "not_yet" })');
  });

  it("antwortet 500 auch dann, wenn der Aufruf selbst scheitert", () => {
    // Vorher trug das ein `error`-Feld des Clients; jetzt wirft `rpc()`, und
    // der Zweig fängt. Dieselbe Antwort, damit Stripe dieselbe Wiederholung
    // macht.
    expect(branch).toContain("catch (error)");
    expect(branch).toContain('respond(500, { error: "internal" })');
  });
});

/* ------------------------------------------------------------------------ */
/* 5. Idempotenz, unverändert                                                 */
/* ------------------------------------------------------------------------ */

describe("die Idempotenz bleibt, wo sie war", () => {
  const webhook = code(WEBHOOK);
  const migration = source("supabase/migrations/0101_payment_method_snapshot.sql");

  it("führt das Ereignis weiterhin mit an die Bestätigung", () => {
    // `confirm_order_payment()` erkennt eine Wiederholung an der Event-Id;
    // daran hat diese Korrektur nichts zu ändern.
    expect(webhook).toContain("p_provider_event_id: decision.eventId");
  });

  it("schickt die Kundenmail weiterhin nur für genau ein Ergebnis", () => {
    const at = webhook.indexOf("MAIL_FOR_OUTCOME");
    const map = webhook.slice(at, webhook.indexOf("};", at));
    expect(map).toContain('confirmed: "order_confirmation"');
    expect(map).not.toContain("duplicate_event");
    expect(map).not.toContain("already_confirmed");
  });

  it("schreibt den Schnappschuss weiterhin genau einmal", () => {
    // Die Schreibsperre liegt in der Datenbank, nicht im Webhook — diese
    // Korrektur fasst 0101 nicht an.
    expect(migration).toContain("method_recorded_at");
    expect(migration).toContain("unknown_intent");
  });
});


/* ===================================================================== */
describe("der Erstattungszweig bestätigt Geld und bewegt keines (0111)", () => {
  const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
  const branch = webhook.slice(
    webhook.indexOf('decision.action === "refunds"'),
    webhook.indexOf("let attemptMode"),
  );

  it("endet in sich und erreicht den Zahlungspfad nicht", () => {
    expect(branch).not.toContain("confirm_order_payment");
    expect(branch).not.toContain("callDatabase");
    expect(webhook.indexOf('decision.action === "refunds"'))
      .toBeLessThan(webhook.indexOf("await callDatabase(decision)"));
  });

  it("ruft genau eine Datenbankfunktion, und keinen Zahlungsdienst", () => {
    expect(branch).toContain('rpc("record_refund_event"');
    /*
     * Diese Function hält weiterhin KEINEN Stripe-Schlüssel — sie bestätigt,
     * was im signierten Rumpf steht, und fragt Stripe nichts. Genau diese
     * Eigenschaft ist der Grund, warum der Erstattungsaufruf in einer
     * ANDEREN Function liegt.
     */
    for (const forbidden of ["api.stripe.com", "STRIPE_REFUND_KEY", "Idempotency-Key"]) {
      expect(webhook, forbidden).not.toContain(forbidden);
    }
  });

  it("gibt jeder Erstattung einer Lieferung ihre eigene Ereigniskennung", () => {
    /*
     * `charge.refunded` trägt ALLE Erstattungen des Charges. Ohne den Zusatz
     * würde die zweite Teilerstattung derselben Lieferung als Duplikat der
     * ersten verworfen — die Entprellung hängt an
     * `(provider, provider_event_id)`.
     */
    expect(branch).toContain("p_provider_event_id: `${decision.eventId}:${refund.id}`");
  });

  it("antwortet 500 nur, wenn die Datenbank nicht antwortet", () => {
    // Damit Stripe wiederholt. Ein Befund wie `unmatched_refund` ist dagegen
    // ein 200: festgehalten, und kein Grund, eine Lieferung zu verweigern.
    expect(branch).toContain('return respond(500, { error: "internal" });');
    expect(branch).toContain("return respond(200, { received: true, outcomes });");
  });
});
