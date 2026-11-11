/** @vitest-environment jsdom */
/**
 * The preview sections and the sample-PDF route (ADR-0184, AP6/AP7), rendered.
 *
 * What they promise: the real templates with the real seller and example
 * everything-else; a visible MUSTER label; mails in a sandboxed frame, none
 * sent; the PDF only for a seller operator; no invoice issued, no Stripe call.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ operator: true, load: null as unknown }));
vi.mock("@/lib/auth/capabilities", () => ({ canOperateSeller: async () => MOCK.operator }));
vi.mock("@/lib/identity/server", () => ({ fetchIdentity: async () => MOCK.load }));

const { InvoicePreview, MailPreviews, StripeOverview, MAIL_FROM_FALLBACK, SPECIMEN_PDF_HREF } =
  await import("./document-previews");
const { GET } = await import("@/app/(business)/business/profile/rechnung-muster/route");
const { NO_SHOP_SETTINGS } = await import("@/lib/admin/shop-profile-model");
const { buildIdentity } = await import("@/lib/identity/model");
const { SPECIMEN_LABEL, SPECIMEN_MAIL_LABEL, specimenMailOrder } = await import("@/lib/identity/specimen");
const { InvoiceView } = await import("@/components/legal/invoice-view");
const { specimenInvoice } = await import("@/lib/identity/specimen");
const { render } = await import("../../../supabase/functions/send-order-mail/templates.ts");
const { de } = await import("@/lib/i18n/de");

const SETTINGS = {
  ...NO_SHOP_SETTINGS,
  identity: {
    ...NO_SHOP_SETTINGS.identity, displayName: "skyisles.shop", legalName: "Julian Stocker",
    street: "Lechhalde 1 1/2", postalCode: "87629", city: "Füssen", countryCode: "DE", vatId: "DE321022065",
  },
  contacts: { ...NO_SHOP_SETTINGS.contacts, contactEmail: "info@skyisles.de", replyTo: "antwort@skyisles.de" },
};
const IDENTITY = buildIdentity(SETTINGS, null);
const NOW = new Date("2026-11-11T10:00:00Z");

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.operator = true; MOCK.load = { ok: true, identity: IDENTITY, settings: SETTINGS }; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove(); root = null; container = null;
});
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}
const text = () => document.body.textContent ?? "";

describe("Rechnungen", () => {
  it("is the real invoice view with the real seller, marked MUSTER", async () => {
    await mount(createElement(InvoicePreview, { identity: IDENTITY, now: NOW }));
    expect(document.querySelector('[role="note"]')!.textContent).toBe(SPECIMEN_LABEL);
    expect(text()).toContain("Julian Stocker");
    expect(text()).toContain("skyisles.shop");
    expect(text()).toContain("USt-IdNr. DE321022065");
    expect(text()).toContain("Beispiel Kundin");
    expect(text()).toContain("MUSTER");
    /* Embedded: the page around it owns <main> and <h1>. */
    expect(document.querySelector("main")).toBeNull();
    expect(document.querySelector("h1")).toBeNull();
  });

  it("its PDF link is the seller-gated sample route, never a real invoice address", async () => {
    await mount(createElement(InvoicePreview, { identity: IDENTITY, now: NOW }));
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent === de.invoice.download)!;
    expect(link.getAttribute("href")).toBe(SPECIMEN_PDF_HREF);
    expect(SPECIMEN_PDF_HREF.startsWith("/business/")).toBe(true);
  });
});

describe("Kunden-E-Mails", () => {
  it("shows both mails a customer receives, from the real dispatch", async () => {
    await mount(createElement(MailPreviews, { identity: IDENTITY, now: NOW, origin: "http://localhost:3000" }));
    const articles = document.querySelectorAll("article");
    expect(articles).toHaveLength(2);
    expect(articles[0].getAttribute("aria-label")).toBe(de.business.identity.mails.received);
    expect(articles[1].getAttribute("aria-label")).toBe(de.business.identity.mails.confirmation);
    expect(text()).toContain("Bestellung MUSTER-0001 — bestätigt");
  });

  it("the HTML is the template's, with the shop name, in a frame that can do nothing", async () => {
    await mount(createElement(MailPreviews, { identity: IDENTITY, now: NOW, origin: "http://localhost:3000" }));
    for (const frame of document.querySelectorAll("iframe")) {
      expect(frame.getAttribute("sandbox")).toBe("");
      const html = frame.getAttribute("srcdoc")!;
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("MUSTER-0001");
    }
    expect(document.querySelectorAll("iframe")[1].getAttribute("srcdoc")).toContain("skyisles.shop");
    expect(text()).toContain(SPECIMEN_MAIL_LABEL);
  });

  it("names the reply address and does not invent a sender", async () => {
    await mount(createElement(MailPreviews, { identity: IDENTITY, now: NOW, origin: "http://localhost:3000" }));
    expect(text()).toContain("antwort@skyisles.de");
    expect(text()).toContain("MAIL_FROM");
    expect(text()).toContain("hier nicht lesbar");
    /* The fallback shown is the one the function really has. */
    const fn = readFileSync("supabase/functions/send-order-mail/index.ts", "utf8");
    expect(fn).toContain(`Deno.env.get("MAIL_FROM") ?? "${MAIL_FROM_FALLBACK}"`);
  });

  it("payment_confirmation really is the order confirmation — said, not a separate preview", () => {
    const templates = readFileSync("supabase/functions/send-order-mail/templates.ts", "utf8");
    expect(templates).toMatch(/case "order_confirmation":\s*case "payment_confirmation":\s*return orderConfirmation\(order, site\);/);
  });

  it("sends nothing: no mail client, no function call", () => {
    const source = readFileSync("src/components/business/document-previews.tsx", "utf8");
    for (const forbidden of ["resend", "Resend", "fetch(", "send-order-mail/index", "functions.invoke"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the embedded invoice keeps a proper heading order", () => {
  const headings = () => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName);

  it("embedded: one level under the page's section (h3, then h4), no h1 or h2", async () => {
    await mount(createElement(InvoicePreview, { identity: IDENTITY, now: NOW }));
    /* The section heading (h2) is the preview's own. */
    expect(headings()).toEqual(["H2", "H3", "H4", "H4"]);
  });

  it("a real invoice page is unchanged: h1, then h2", async () => {
    await mount(createElement(InvoiceView, { invoice: specimenInvoice(IDENTITY, NOW), token: null }));
    expect(headings()).toEqual(["H1", "H2", "H2"]);
    expect(document.querySelector("main")).not.toBeNull();
  });

  it("the visual classes are the same in both modes", async () => {
    await mount(createElement(InvoicePreview, { identity: IDENTITY, now: NOW }));
    const embedded = [...document.querySelectorAll("h3,h4")].map((h) => h.className);
    await act(async () => { root!.unmount(); });
    container!.remove();
    await mount(createElement(InvoiceView, { invoice: specimenInvoice(IDENTITY, NOW), token: null }));
    expect([...document.querySelectorAll("h1,h2")].map((h) => h.className)).toEqual(embedded);
  });
});

describe("links in the mail preview lead nowhere", () => {
  it("no anchor in any preview frame has an address, and nothing can load", async () => {
    await mount(createElement(MailPreviews, { identity: IDENTITY, now: NOW, origin: "http://localhost:3000" }));
    for (const frame of document.querySelectorAll("iframe")) {
      const html = frame.getAttribute("srcdoc")!;
      expect(html).not.toMatch(/\shref\s*=/i);
      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(frame.getAttribute("sandbox")).toBe("");
      expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
    /* The confirmation's links are still there as text. */
    const confirmation = document.querySelectorAll("iframe")[1].getAttribute("srcdoc")!;
    expect(confirmation).toContain('aria-disabled="true"');
  });

  it("the plain-text version is text only — no anchor anywhere outside the frames", async () => {
    await mount(createElement(MailPreviews, { identity: IDENTITY, now: NOW, origin: "http://localhost:3000" }));
    expect(document.querySelectorAll("pre a")).toHaveLength(0);
    expect(document.querySelectorAll("article a")).toHaveLength(0);
    expect(document.querySelector("pre")!.textContent).toContain("http://localhost:3000/widerrufen");
  });

  it("the real template is untouched: a sent mail keeps its links", () => {
    const order = specimenMailOrder(IDENTITY, NOW, { agb: "2026-09-17", widerruf: "2026-09-17" });
    const html = render("order_confirmation", order, { origin: "https://skyisles.app" }).html;
    expect(html).toContain('href="https://skyisles.app/widerrufen"');
    expect(html).not.toContain("Content-Security-Policy");
  });
});

describe("Stripe & Zahlungsdarstellung", () => {
  it("separates sent, not sent, dashboard-only (unknown) and Stripe/bank", async () => {
    await mount(createElement(StripeOverview));
    const s = de.business.identity.stripe;
    for (const heading of [s.sent, s.notSent, s.dashboard, s.bank]) expect(text()).toContain(heading);
    expect(text()).toContain("Statement Descriptor");
    expect(document.querySelectorAll("li span.rounded-full").length).toBeGreaterThanOrEqual(5);
    const link = document.querySelector('a[href="https://dashboard.stripe.com/settings"]')!;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("the sample PDF route", () => {
  const ROUTE = readFileSync("src/app/(business)/business/profile/rechnung-muster/route.ts", "utf8");

  it("answers 404 to anyone who is not a seller operator — before reading", async () => {
    MOCK.operator = false;
    MOCK.load = null; // would throw if read
    const response = await GET();
    expect(response.status).toBe(404);
    expect(ROUTE.indexOf("canOperateSeller()")).toBeLessThan(ROUTE.indexOf("fetchIdentity()"));
  });

  it("answers 404 when the seller row cannot be read", async () => {
    MOCK.load = { ok: false, reason: "unavailable" };
    expect((await GET()).status).toBe(404);
  });

  it("returns the labelled PDF, uncached, for a seller operator", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toContain("MUSTER-Rechnung.pdf");
    const body = Array.from(new Uint8Array(await response.arrayBuffer()), (b) => String.fromCharCode(b)).join("");
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body).toContain("MUSTER \x96 KEINE G\xdcLTIGE RECHNUNG");
    expect(body).toContain("Julian Stocker");
  });

  it("issues, numbers and stores nothing", () => {
    for (const forbidden of ["issue_invoice", "invoice_number_seq", "rpc(", "insert", "createClient"]) {
      expect(ROUTE, forbidden).not.toContain(forbidden);
    }
  });
});
