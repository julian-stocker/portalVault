import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SellerSettings } from "@/components/admin/seller-settings";
import { ShopProfilePanel } from "@/components/admin/shop-profile-panel";
import { InvoicePreview, MailPreviews, StripeOverview } from "@/components/business/document-previews";
import { IdentityFindings, NameUsage, PlatformIdentity } from "@/components/business/identity-overview";
import { canOperateSeller, capabilities } from "@/lib/auth/capabilities";
import { identityFindings, nameUsage } from "@/lib/identity/model";
import { fetchIdentity } from "@/lib/identity/server";
import { SELLER_IDENTITY } from "@/lib/legal/seller-identity";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.identity.title };

/**
 * Identität & Dokumente (ADR-0184, AP3) — the former Händlerprofil and
 * Geschäftsdaten & Kontakt on one page.
 *
 *   Hinweise                 what is missing or contradicts, before anything else
 *   1 Plattform              SkyIsles and its support contact — read-only here
 *   2 Shopidentität          shop name, customer contact, reply address
 *                            (`SellerSettings` → `setSellerContact`)
 *   3 Rechtlicher Betreiber  name, legal form, address, contacts, tax, register,
 *                            withdrawal (`ShopProfilePanel` → `setSellerDetails`,
 *                            `setShopPolicies`) — the contact e-mail is shown
 *                            there, not edited a second time
 *   4 Wo erscheint welcher Name?
 *   5 Rechnungen        sample invoice, real `InvoiceView`, PDF via the
 *                       seller-gated `rechnung-muster` route (AP6)
 *   6 Kunden-E-Mails    the real templates with sample data, nothing sent (AP6)
 *   7 Stripe            what is sent, what lives in the dashboard (AP7)
 *
 * THE GATE FIRST. The layout's `notFound()` does not stop a page that renders
 * in parallel from reading, so this page asks the same request-cached
 * question before it reads the seller row (see `business-page-gate.test.ts`).
 *
 * WHAT THIS PAGE DOES NOT DO. It changes no stored value by itself, publishes
 * nothing, and does not touch the legal texts, the invoices or Stripe. The
 * published legal pages still read `SELLER_IDENTITY` until AP5; the findings
 * say where that differs from the data.
 */
export default async function BusinessIdentityPage() {
  if (!(await canOperateSeller())) notFound();

  const [load, { platformAdmin }] = await Promise.all([fetchIdentity(), capabilities()]);
  const copy = de.business.identity;

  if (!load.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
        <p role="alert" className="mt-4 text-sm text-danger">{copy.unavailable}</p>
      </main>
    );
  }

  const { identity, settings } = load;
  const findings = identityFindings(identity, SELLER_IDENTITY);
  /* The sample mails link to this environment; a real mail uses SITE_URL. */
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost";
  const origin = `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${host}`;
  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted">{copy.hint}</p>
      </div>

      <IdentityFindings findings={findings} />

      <PlatformIdentity identity={identity} canEdit={platformAdmin} />

      <section id="shop" aria-labelledby="identity-shop" className="flex flex-col gap-2">
        <div>
          <h2 id="identity-shop" className="text-lg font-semibold">{copy.shop.heading}</h2>
          <p className="mt-1 text-sm text-muted">{copy.shop.hint}</p>
        </div>
        <SellerSettings
          displayName={identity.shop.displayName}
          contactEmail={identity.shop.contactEmail}
          replyTo={identity.shop.replyTo}
        />
        {/* Stated, not faked: there is no seller image yet (ADR-0080). */}
        <p className="text-sm text-muted">{de.business.profileIconMissing}</p>
      </section>

      <div id="betreiber">
        <ShopProfilePanel
          settings={settings}
          groups={["seller", "contact", "tax", "withdrawal"]}
          heading={copy.legal.heading}
          hint={copy.legal.hint}
          contactEmailEditable={false}
        />
      </div>

      <NameUsage rows={nameUsage(identity, SELLER_IDENTITY)} />

      <InvoicePreview identity={identity} now={now} />
      <MailPreviews identity={identity} now={now} origin={origin} />
      <StripeOverview />
    </main>
  );
}
