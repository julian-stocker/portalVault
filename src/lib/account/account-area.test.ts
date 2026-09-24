import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

import { customerStatus, readMyOrders } from "./orders";
import { contactRow, hasContact, readContact, EMPTY_CONTACT } from "./contacts";
import { activeSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

/**
 * The account area, and the rules that keep it honest.
 *
 * `/settings` was a username field, a password field and a sign-out button in
 * one column, with nowhere to see an order and nowhere to keep an address.
 * Four named destinations replace it (ADR-0061).
 */

const source = (path: string) => readFileSync(path, "utf8");

describe("the account area is one place with four destinations", () => {
  const ROUTES = [
    "src/app/(app)/account/page.tsx",
    "src/app/(app)/account/profile/page.tsx",
    "src/app/(app)/account/contact/page.tsx",
    "src/app/(app)/account/orders/page.tsx",
    "src/app/(app)/account/security/page.tsx",
  ];

  it.each(ROUTES)("%s exists", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it("every one of them is behind a session check", () => {
    for (const path of ROUTES) {
      const page = source(path);
      expect(page, path).toContain("currentProfile()");
      expect(page, path).toContain("SIGN_IN_PATH");
    }
  });

  it("the middleware protects the whole area, not one page of it", () => {
    expect(source("src/lib/supabase/middleware.ts")).toContain('"/account"');
  });

  /**
   * EINE TÜR INS KONTO, UND SIE TRÄGT DAS PERSONENSYMBOL.
   *
   * V3.4.1 hatte eine, V3.4.2 machte zwei daraus — Name plus Person auf
   * `/account/profile`, eine Karte daneben auf `/account`. Zwei Symbole für
   * denselben Bereich, und keinem sah man an, welches wohin führt: das Profil
   * ist eine Kachel im Konto, keine Nebentür. Jetzt wieder eine.
   */
  it("wird über genau einen Knopf im Kopf erreicht", () => {
    const nav = source("src/components/layout/site-nav.tsx");
    expect(nav.match(/<ProfileAction\b/g)).toHaveLength(1);
    // Die zweite Tür ist weg, samt ihrem Symbol.
    expect(nav).not.toContain("AccountHubAction");
    expect(nav).not.toContain("AccountHubGlyph");
    expect(existsSync("src/components/layout/nav-glyphs.tsx")).toBe(true);
    expect(source("src/components/layout/nav-glyphs.tsx")).not.toContain("AccountHubGlyph");
  });

  it("und dieser Knopf führt auf die Übersicht, nicht auf eine Unterseite", () => {
    const nav = source("src/components/layout/site-nav.tsx");
    const profile = nav.slice(nav.indexOf("function ProfileAction("), nav.indexOf("function NavItem("));
    expect(profile).toContain('href={signedIn ? "/account" : "/login"}');
    expect(profile).not.toContain('"/account/profile"');
  });

  it("und ist auch nicht zurück in der Leiste", () => {
    const nav = source("src/components/layout/site-nav.tsx");
    expect(nav).not.toContain('href: "/account"');
    expect(nav).not.toContain('href: "/login"');
    expect(nav).not.toContain('section: "account"');
  });

  it("das Profil bleibt eine Kachel der Übersicht", () => {
    expect(source("src/app/(app)/account/page.tsx")).toContain('{ href: "/account/profile"');
    expect(existsSync("src/app/(app)/account/profile/page.tsx")).toBe(true);
  });

  /* Die Zahl ungelesener Nachrichten hing an der Karte — mit ihr wäre sie
     verschwunden. Sie sitzt jetzt am verbleibenden Knopf. */
  it("trägt die Nachrichtenmarke weiter", () => {
    const nav = source("src/components/layout/site-nav.tsx");
    expect(nav).toContain("unread={unread.mine}");
    const profile = nav.slice(nav.indexOf("function ProfileAction("), nav.indexOf("function NavItem("));
    expect(profile).toContain("<AttentionBadge count={unread}");
    expect(profile).toContain("de.messages.unreadBadgeLabel(unread)");
    // Und der vorgelesene Name nennt sie mit.
    expect(profile).toContain("unread > 0 ? `${base}");
  });

  it("leuchtet auf jeder Konto-Route, nicht nur auf einer", () => {
    const nav = source("src/components/layout/site-nav.tsx");
    expect(nav).toContain('const accountActive = active === "account";');
    expect(nav).not.toContain("accountHubActive");
    expect(nav).not.toContain("profileActive");
  });

  it("the old path still resolves instead of 404ing", () => {
    // `/settings` is in bookmarks and in the onboarding flow.
    const settings = source("src/app/(app)/settings/page.tsx");
    expect(settings).toContain("permanentRedirect");
    expect(settings).toContain("/account");
  });

  it("the nav model knows the new routes", () => {
    expect(activeSection("/account")).toBe("account");
    expect(activeSection("/account/orders")).toBe("account");
    expect(activeSection("/account/orders/SI-2026-001042")).toBe("account");
    expect(activeSection("/settings")).toBe("account");
  });

  /**
   * ABMELDEN UNTEN AUF DER ÜBERSICHT (ADR-0085 umgekehrt).
   *
   * Die frühere Begründung: `/settings` leitet auf `/account` um, ein Knopf
   * dort wäre also ein Knopf unter Einstellungen — und Abmelden ist keine
   * Einstellung. Das galt, solange der Kopf zwei Türen hatte und „Profil"
   * eine eigene war. Seit es nur noch eine Tür gibt, ist diese Seite der
   * Bereich, und der Ausgang gehört an sein Ende statt in eine Kachel, in der
   * ihn niemand sucht.
   *
   * Nicht unter „Konto & Sicherheit": dort wird etwas am Konto geändert, und
   * Gehen ist keine Änderung daran (ADR-0062). Nicht im Kopf und nicht in der
   * Leiste: ein Knopf, der die Sitzung beendet, gehört nicht auf jeden
   * Bildschirm.
   */
  it("Abmelden steht unten auf der Übersicht", () => {
    expect(source("src/app/(app)/account/page.tsx")).toContain('action="/auth/signout"');
    expect(source("src/app/(app)/account/page.tsx")).toContain("border-t border-border/70");
  });

  it("und nirgendwo sonst", () => {
    for (const path of ["src/app/(app)/account/profile/page.tsx",
                        "src/app/(app)/account/security/page.tsx",
                        "src/components/layout/site-nav.tsx"]) {
      expect(source(path), path).not.toContain("/auth/signout");
    }
  });

  it("genau einmal", () => {
    expect(source("src/app/(app)/account/page.tsx").match(/auth\/signout/g)).toHaveLength(1);
  });

  it("ist ein POST, damit kein Vorauslader eine Sitzung beendet", () => {
    const hub = source("src/app/(app)/account/page.tsx");
    expect(hub).toContain('method="post"');
    expect(hub).not.toContain('href="/auth/signout"');
  });

  it("every account type can reach it — USER, BUSINESS and ADMIN alike", () => {
    /*
     * The whole fix rests on this. If `/account/profile` were gated the way
     * `/collection` is, moving the button here would have taken logout away
     * from a seller and an administrator entirely.
     *
     * The `(app)` layout asks for a session and nothing more; only
     * `/collection` narrows to a collector (ADR-0078). Neither the profile
     * page nor the account hub mentions a capability at all.
     */
    const layout = source("src/app/(app)/layout.tsx");
    expect(layout).toContain("if (!profile) redirect(SIGN_IN_PATH);");
    expect(layout).not.toContain("notFound()");
    expect(source("src/app/(app)/collection/page.tsx")).toContain(
      "if (!(await isCollector())) notFound();",
    );
    for (const file of [
      "src/app/(app)/account/page.tsx",
      "src/app/(app)/account/profile/page.tsx",
    ]) {
      const page = source(file);
      expect(page, file).not.toContain("isCollector");
      expect(page, file).not.toContain("canOperateSeller");
      expect(page, file).not.toContain("isPlatformAdmin");
      expect(page, file).not.toContain("notFound");
    }
  });

  it("and the hub still leads to Profil, so the button is one tap from it", () => {
    // Moving it must not make it harder to find than it was.
    const hub = source("src/app/(app)/account/page.tsx");
    expect(hub).toContain('{ href: "/account/profile", copy: de.account.profile }');
  });

  it("security keeps the password and is where account changes will land", () => {
    const security = source("src/app/(app)/account/security/page.tsx");
    expect(security).toContain("updatePasswordAction");
  });

  it("reuses the existing auth actions rather than growing parallel ones", () => {
    expect(source("src/app/(app)/account/profile/page.tsx")).toContain("setUsernameAction");
    expect(source("src/app/(app)/account/security/page.tsx")).toContain("updatePasswordAction");
  });
});

describe("what a customer sees about their own order", () => {
  it("folds the two state axes into one word", () => {
    expect(customerStatus("pending", "unfulfilled", false)).toBe("awaiting_payment");
    expect(customerStatus("paid", "unfulfilled", false)).toBe("paid");
    expect(customerStatus("paid", "shipped", false)).toBe("shipped");
    expect(customerStatus("paid", "completed", false)).toBe("shipped");
    expect(customerStatus("cancelled", "cancelled", false)).toBe("closed");
    expect(customerStatus("expired", "unfulfilled", false)).toBe("closed");
  });

  it("says a flagged order is being looked at, whatever else is true", () => {
    expect(customerStatus("paid", "shipped", true)).toBe("needs_attention");
    expect(customerStatus("pending", "unfulfilled", true)).toBe("needs_attention");
  });

  it("drops a row with no order number rather than rendering a blank one", () => {
    expect(readMyOrders([{ order_number: "" }, null, 7])).toEqual([]);
    expect(readMyOrders("nonsense")).toEqual([]);
  });

  it("reads a real row", () => {
    const [row] = readMyOrders([
      {
        order_number: "SI-2026-001042",
        placed_at: "2026-09-11T10:00:00Z",
        payment_status: "paid",
        fulfillment_status: "shipped",
        needs_resolution: false,
        total_amount: "9.31",
        line_count: 2,
        commerce_mode: "sandbox",
      },
    ]);
    expect(row).toEqual({
      orderNumber: "SI-2026-001042",
      placedAt: "2026-09-11T10:00:00Z",
      totalAmount: 9.31,
      lineCount: 2,
      commerceMode: "sandbox",
      status: "shipped",
    });
  });
});

describe("saved contact details", () => {
  it("turns blanks into NULL rather than storing an empty string", () => {
    const row = contactRow({ ...EMPTY_CONTACT, firstName: "  Ada  ", city: "   " });
    expect(row.first_name).toBe("Ada");
    expect(row.city).toBeNull();
    expect(row.company).toBeNull();
  });

  it("normalises the country the way the CHECK expects", () => {
    expect(contactRow({ ...EMPTY_CONTACT, countryCode: "de" }).country_code).toBe("DE");
    expect(contactRow({ ...EMPTY_CONTACT, countryCode: "" }).country_code).toBe("DE");
  });

  it("reads a row back, with missing fields as empty strings", () => {
    expect(readContact({ first_name: "Ada", city: null })).toMatchObject({
      firstName: "Ada",
      city: "",
      countryCode: "DE",
    });
    expect(readContact(null)).toBeNull();
  });

  it("knows when there is nothing worth prefilling", () => {
    expect(hasContact(null)).toBe(false);
    expect(hasContact(EMPTY_CONTACT)).toBe(false);
    // The country alone is a default, not something somebody entered.
    expect(hasContact({ ...EMPTY_CONTACT, countryCode: "DE" })).toBe(false);
    expect(hasContact({ ...EMPTY_CONTACT, city: "Berlin" })).toBe(true);
  });
});

describe("the client half reaches no server module", () => {
  /**
   * The build said so: a `"use client"` component that imports a module
   * reaching `@/lib/supabase/server` drags the server client into the browser
   * bundle. Same split as `commerce-model.ts` / `commerce.ts`.
   */
  it("the model is pure", () => {
    const model = source("src/lib/account/contact-model.ts");
    expect(model).not.toContain("@/lib/supabase/server");
    expect(model).not.toContain('from "react"');
  });

  it("the form imports the model, never the reader", () => {
    const form = source("src/components/account/contact-form.tsx");
    expect(form).toContain('from "@/lib/account/contact-model"');
    expect(form).not.toContain('from "@/lib/account/contacts"');
  });
});

describe("the checkout prefills but never delegates", () => {
  const view = source("src/components/checkout/checkout-view.tsx");

  it("takes the saved details as a starting value only", () => {
    expect(view).toContain("...(contact ?? {})");
    // What is submitted is what is in the form, and `create_order()` is what
    // snapshots it. The saved row is never sent to the database as an order.
    expect(view).toContain("const { email: contactEmail, ...address } = fields;");
  });

  it("offers to save a default only to an account", () => {
    expect(view).toContain("saveDefaultAllowed ? (");
    expect(view).toContain("saveAsDefault && saveDefaultAllowed");
  });

  it("saves the default after the order and never instead of it", () => {
    const submit = view.slice(view.indexOf("if (result.ok)"), view.indexOf("await toPayment"));
    expect(submit.indexOf("setPlaced(result.order)")).toBeLessThan(submit.indexOf("saveContact("));
    // Not awaited: a failure to remember an address must not cost the order.
    expect(submit).toContain("void saveContact(");
  });

  it("defaults the checkbox to off", () => {
    // Keeping somebody's postal address is their decision, not something
    // that happens to them.
    expect(view).toContain("useState(false)");
  });
});

/**
 * Die Nachrichtenkachel auf /account (0098-UI).
 *
 * Sie steht zwischen „Meine Bestellungen" und „Konto & Sicherheit", weil
 * Nachrichten zu Bestellungen gehören — und trägt dieselbe Marke wie der
 * Kopf, damit beide Zahlen nicht auseinanderlaufen können.
 */
describe("Nachrichten auf der Kontoübersicht", () => {
  const page = readFileSync("src/app/(app)/account/page.tsx", "utf8");

  it("steht zwischen Bestellungen und Sicherheit", () => {
    const order = ["/account/orders", "/account/nachrichten", "/account/security"]
      .map((href) => page.indexOf(`"${href}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("trägt Titel und Untertitel", () => {
    expect(de.account.messages.title).toBe("Nachrichten");
    expect(de.account.messages.hint).toBe("Fragen und Nachrichten zu deinen Bestellungen.");
  });

  it("zeigt die Marke nur, wenn etwas ungelesen ist", () => {
    expect(page).toContain('{"unread" in section && unread > 0 ? (');
    expect(page).toContain("<AttentionBadge count={unread}");
  });

  it("nennt der Vorlesehilfe, was die Zahl bedeutet", () => {
    expect(page).toContain("label={de.messages.unreadBadgeLabel(unread)}");
  });

  /*
   * `fetchMyUnread` ist `cache()`-gebunden: das Layout hat sie für dieselbe
   * Anfrage bereits geholt, die Kachel teilt sich denselben Rundgang. Kein
   * zweiter RPC, kein Polling, keine eigene Zählung.
   */
  it("holt die Zahl aus dem bestehenden Datenfluss", () => {
    expect(page).toContain("const unread = await fetchMyUnread();");
    expect(readFileSync("src/lib/messages/queries.ts", "utf8"))
      .toContain("export const fetchMyUnread = cache(");
    for (const forbidden of ["setInterval", "setTimeout", 'rpc("', "useEffect"]) {
      expect(page, forbidden).not.toContain(forbidden);
    }
  });

  it("lässt den Kopf unverändert", () => {
    const nav = readFileSync("src/components/layout/site-nav.tsx", "utf8");
    expect(nav).toContain("unread={unread.mine}");
    expect(nav).toContain('href: "/business/nachrichten"');
  });

  /* Eine Marke, zwei Orte — nicht zweimal abgeschrieben. */
  it("benutzt dieselbe Marke wie der Kopf", () => {
    const badge = readFileSync("src/components/ui/attention-badge.tsx", "utf8");
    expect(badge).toContain("export function AttentionBadge");
    expect(page).toContain('from "@/components/ui/attention-badge"');
    expect(readFileSync("src/components/layout/site-nav.tsx", "utf8"))
      .toContain('from "@/components/ui/attention-badge"');
    // Und nirgends eine zweite Definition.
    expect(readFileSync("src/components/layout/site-nav.tsx", "utf8"))
      .not.toContain("function AttentionBadge(");
  });
});
