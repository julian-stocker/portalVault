/**
 * Rechnungen, Kunden-E-Mails, Stripe — the preview sections of
 * "Identität & Dokumente" (ADR-0184, AP6/AP7).
 *
 * THE REAL TEMPLATES, FED SAMPLE DATA. The invoice is `InvoiceView` (and, one
 * link away, `renderInvoicePdf`), the mails come from `render(kind, …)` — the
 * same dispatch `send-order-mail` uses — and the seller in all of them is the
 * current seller row. Nothing is issued, numbered, stored or sent.
 *
 * A MAIL IS ITS OWN DOCUMENT. Its HTML is shown in an `<iframe srcdoc>` with
 * an empty `sandbox`: no script, no form, no navigation of this page, and its
 * inline styles cannot leak into ours. Its links are made inert first
 * (`inertMailHtml`: no `href`, a CSP that loads nothing), so a click cannot
 * load a real page inside the frame either. The plain-text version is shown
 * as text in a `<pre>` — React renders no link in it. The template escapes
 * every value it interpolates (`escapeHtml`).
 */
import { InvoiceView } from "@/components/legal/invoice-view";
import type { Identity } from "@/lib/identity/model";
import {
  SPECIMEN_LABEL, SPECIMEN_MAIL_LABEL, inertMailHtml, specimenInvoice, specimenMailOrder,
} from "@/lib/identity/specimen";
import {
  DASHBOARD_ONLY, NOT_SENT_TO_STRIPE, SENT_TO_STRIPE, STRIPE_DASHBOARD_URL, STRIPE_OR_BANK,
  type StripeFact,
} from "@/lib/identity/stripe-facts";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { de } from "@/lib/i18n/de";
import { render, type MailKind } from "../../../supabase/functions/send-order-mail/templates.ts";

const copy = de.business.identity;
const BOX = "rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70";

/** The PDF of the sample invoice — a seller-gated route of its own. */
export const SPECIMEN_PDF_HREF = "/business/profile/rechnung-muster";

/** `send-order-mail`'s fallback when the MAIL_FROM secret is unset (`index.ts`). */
export const MAIL_FROM_FALLBACK = "SkyIsles <orders@mail.skyisles.app>";

export function InvoicePreview({ identity, now }: { identity: Identity; now: Date }) {
  return (
    <section id="rechnungen" aria-labelledby="identity-invoices" className={BOX}>
      <h2 id="identity-invoices" className="font-medium">{copy.invoices.heading}</h2>
      <p className="mt-1 mb-5 text-sm text-muted">{copy.invoices.hint}</p>
      <div className="rounded-sky-md bg-surface p-4 ring-1 ring-border/50 sm:p-6">
        <InvoiceView
          invoice={specimenInvoice(identity, now)}
          token={null}
          specimen={{ label: SPECIMEN_LABEL, pdfHref: SPECIMEN_PDF_HREF }}
        />
      </div>
    </section>
  );
}

const MAILS: readonly { kind: MailKind; title: string; when: string }[] = [
  { kind: "order_received", title: copy.mails.received, when: copy.mails.receivedWhen },
  { kind: "order_confirmation", title: copy.mails.confirmation, when: copy.mails.confirmationWhen },
];

export function MailPreviews({ identity, now, origin }: { identity: Identity; now: Date; origin: string }) {
  const order = specimenMailOrder(identity, now, { agb: LEGAL_VERSIONS.agb, widerruf: LEGAL_VERSIONS.widerruf });
  const m = copy.mails;
  return (
    <section id="mails" aria-labelledby="identity-mails" className={BOX}>
      <h2 id="identity-mails" className="font-medium">{m.heading}</h2>
      <p className="mt-1 text-sm text-muted">{m.hint}</p>

      <div className="mt-5 flex flex-col gap-8">
        {MAILS.map(({ kind, title, when }) => {
          const mail = render(kind, order, { origin });
          return (
            <article key={kind} aria-label={title} className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-0.5 text-xs text-muted">{when}</p>
              </div>

              <p className="rounded-sky-md bg-danger/10 px-3 py-1.5 text-center text-xs font-semibold tracking-wide text-danger ring-1 ring-danger/40">
                {SPECIMEN_MAIL_LABEL}
              </p>

              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted">{m.subject}</dt>
                <dd className="break-words">{mail.subject}</dd>
                <dt className="text-muted">{m.from}</dt>
                <dd className="text-xs leading-relaxed">
                  {m.fromUnknown} <span className="font-mono">{MAIL_FROM_FALLBACK}</span>
                </dd>
                <dt className="text-muted">{m.replyTo}</dt>
                <dd className="break-words">{identity.shop.effectiveReplyTo ?? m.replyToNone}</dd>
                <dt className="text-muted">{m.to}</dt>
                <dd className="break-words">{order.customer_email}</dd>
              </dl>

              <iframe
                title={m.frameTitle(title)}
                srcDoc={inertMailHtml(mail.html)}
                sandbox=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-[32rem] w-full rounded-sky-md bg-white ring-1 ring-border/70"
              />

              <details className="text-sm">
                <summary className="cursor-pointer text-muted">{m.plainText}</summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-sky-md bg-surface p-3 text-xs whitespace-pre-wrap ring-1 ring-border/50">
                  {mail.text}
                </pre>
              </details>
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">{m.links}</p>
    </section>
  );
}

function FactList({ heading, facts, unknown }: { heading: string; facts: readonly StripeFact[]; unknown?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{heading}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {facts.map((fact) => (
          <li key={fact.label} className="text-sm">
            <span className="font-medium">{fact.label}</span>
            {unknown ? (
              <span className="ml-1.5 rounded-full px-1.5 text-[11px] text-muted ring-1 ring-border/70">{unknown}</span>
            ) : null}
            <span className="block text-xs text-muted">{fact.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StripeOverview() {
  const s = copy.stripe;
  return (
    <section id="stripe" aria-labelledby="identity-stripe" className={BOX}>
      <h2 id="identity-stripe" className="font-medium">{s.heading}</h2>
      <p className="mt-1 text-sm text-muted">{s.hint}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <FactList heading={s.sent} facts={SENT_TO_STRIPE} />
        <FactList heading={s.notSent} facts={NOT_SENT_TO_STRIPE} />
        <FactList heading={s.dashboard} facts={DASHBOARD_ONLY} unknown={s.unknown} />
        <FactList heading={s.bank} facts={STRIPE_OR_BANK} />
      </div>
      <a
        href={STRIPE_DASHBOARD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-block text-sm underline underline-offset-2"
      >
        {s.dashboardLink}
      </a>
    </section>
  );
}
