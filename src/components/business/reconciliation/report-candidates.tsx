/**
 * The existing sales an unmatched order could be (ADR-0182) — one compact
 * comparison per candidate, feature by feature, beside the analysis' score.
 *
 * DISPLAY ONLY. A high score is a recommendation; nothing here assigns. The
 * figures carry how they were paired and the hints that are NOT scored
 * (another series than the listing names, a similar name). Every candidate
 * links to its sale with the way back to this card.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { formatDate, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import type { CandidateExplanation } from "@/lib/reconciliation/candidates";
import { orderbookItemsHref, type ReturnTarget } from "@/lib/reconciliation/routes";

import { RivalSales } from "./rival-sales";

const t = de.business.reconciliation.candidates;

const ok = (equal: boolean) => (equal ? "✓" : "≠");

function Row({ label, equal, children }: { label: string; equal: boolean | null; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2" data-feature={label}>
      <dt className="text-muted">{label}:</dt>
      <dd className="min-w-0 break-words">
        {equal === null ? null : <span className={equal ? "text-success" : "text-danger"}>{ok(equal)} </span>}
        {children}
      </dd>
    </div>
  );
}

/** One candidate, compared with the order — the same layout for the list, the search and an assigned sale. */
export function CandidateComparison({ c, back = null, children }: {
  c: CandidateExplanation; back?: ReturnTarget | null; children?: ReactNode;
}) {
  const figuresEqual = c.figures.matched === c.figures.reportPieces && c.figures.reportPieces === c.figures.ledgerPieces;
  return (
    <div data-candidate={c.saleId} className="rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium">{t.sale(c.saleId)}</p>
        <p className="text-muted" data-score={c.score}>
          {t.score(Math.round(c.score))}{c.analysisCandidate ? "" : ` · ${t.outsideWindow}`}
        </p>
      </div>
      <dl className="mt-1 flex flex-col gap-0.5">
        <Row label={t.figures} equal={figuresEqual}>
          {t.figuresMatched(c.figures.matched, c.figures.reportPieces, c.figures.ledgerPieces)}
          <ul className="mt-0.5 list-disc pl-4" data-figure-rows="">
            {c.figures.rows.map((r, k) => (
              <li key={k} className="break-words">
                {r.report !== null && r.ledger !== null ? <>{r.report} ↔ {r.ledger} · {t.tier[r.tier ?? "exact"]}</>
                  : r.report !== null ? <>{r.report} · <span className="text-danger">{t.onlyReport}</span></>
                    : <>{r.ledger} · <span className="text-danger">{t.onlyLedger}</span></>}
                {r.seriesHint ? <span className="block text-attention">{t.seriesHint(r.seriesHint.listing, r.seriesHint.ledger)}</span> : null}
                {r.similarTo ? <span className="block text-attention">{t.similar(r.similarTo)}</span> : null}
              </li>
            ))}
          </ul>
        </Row>
        <Row label={t.goods} equal={c.goods.netEqual}>
          {t.report} {formatPrice(c.goods.report)} · SkyIsles {t.goodsLine(formatPrice(c.goods.ledgerNet), formatPrice(c.goods.ledgerGross), formatPrice(c.goods.discount))}
        </Row>
        <Row label={t.shipping} equal={c.shipping.equal}>
          {t.report} {formatPrice(c.shipping.report)} · SkyIsles {formatPrice(c.shipping.ledger)}
        </Row>
        <Row label={t.date} equal={c.date.delta === 0}>
          {t.report} {formatDate(c.date.report)} · SkyIsles {c.date.ledger ? formatDate(c.date.ledger) : "—"}
          {c.date.delta !== null ? ` (${t.dateDelta(c.date.delta)})` : ""}
        </Row>
        <Row label={t.orderRef} equal={c.orderRef !== null}>
          {c.orderRef === null ? t.refMissing : t.refSame}
        </Row>
      </dl>
      {c.rivals.length > 0 ? <RivalSales rivals={c.rivals} back={back} /> : <p className="mt-1 text-muted">{t.rivalsNone}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={orderbookItemsHref(c.saleId, back)} data-candidate-link=""
              className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-sky-md px-1 underline underline-offset-2 sm:min-h-8">
          {t.open}
        </Link>
        {children}
      </div>
    </div>
  );
}
