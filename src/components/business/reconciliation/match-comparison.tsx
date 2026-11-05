/**
 * One match of a session, report on the left and SkyIsles on the right
 * (ADR-0174, phase 4 step 5). Read-only: no decision, no button.
 *
 * WHAT THE COLOURS MEAN comes from `compareMatch` — green only for a value the
 * database PROVED equal, red only for a recorded deviation of a certain pair.
 * Every other state is neutral and said in words (WCAG 1.4.1); `unbekannt`
 * is never written as 0 or as a dash that could pass for "nothing".
 *
 * ONE LAYOUT FOR BOTH SIZES. The field table is a list of rows: stacked with
 * its labels on a phone, five columns from `sm:` up — nothing scrolls
 * sideways. The details open with `<details>`, which needs no script.
 *
 * Every value is text through React — nothing from a report is rendered as HTML.
 */
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  compareMatch, toneOf, type ComparisonField, type FieldStatus, type MatchComparison, type Tone, type ValueKind,
} from "@/lib/reconciliation/compare";
import type { AtAnalysisValue, JsonScalar, Match } from "@/lib/reconciliation/view";

const copy = de.business.reconciliation;
const t = copy.detail;

const TONE_RING: Record<Tone, string> = {
  match: "ring-success/40",
  deviation: "ring-danger/60",
  neutral: "ring-border/70",
};
const TONE_CHIP: Record<Tone, string> = {
  match: "text-success ring-success/40",
  deviation: "text-danger ring-danger/40",
  neutral: "text-muted ring-border/70",
};

/** A value as text. Null means "not there" (—); `unbekannt` is said by the caller. */
export function valueText(kind: ValueKind, value: JsonScalar): string {
  if (value === null) return t.noValue;
  const n = typeof value === "number" ? value : Number(value);
  switch (kind) {
    case "date": return typeof value === "string" ? formatDate(value) : String(value);
    case "money": return Number.isFinite(n) ? formatPrice(n) : String(value);
    case "count": return Number.isFinite(n) ? formatNumber(n) : String(value);
    case "text": return String(value);
  }
}

function StatusChip({ status }: { status: FieldStatus }) {
  return (
    <span data-status={status} className={`inline-block rounded-sky-md px-2 py-0.5 text-xs ring-1 ${TONE_CHIP[toneOf(status)]}`}>
      {t.statuses[status]}
    </span>
  );
}

function AtAnalysis({ kind, at }: { kind: ValueKind; at: AtAnalysisValue | null }) {
  if (at === null) return <span className="text-muted">{t.noValue}</span>;
  return (
    <span data-basis={at.basis}>
      {at.basis === "unknown"
        ? <span className="italic text-muted">{t.unknownValue}</span>
        : <span className="tabular-nums">{valueText(kind, at.value)}</span>}
      <span className="mt-0.5 block text-xs text-muted" title={t.basisHints[at.basis]}>{t.bases[at.basis]}</span>
    </span>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-xs text-muted sm:sr-only">{label}</dt>
      <dd className="text-right text-sm sm:text-left">{children}</dd>
    </div>
  );
}

function FieldRow({ f }: { f: ComparisonField }) {
  return (
    <li data-field={f.field} data-status={f.status}
        className="border-t border-border/50 py-2 first:border-t-0 sm:grid sm:grid-cols-[8rem_repeat(3,minmax(0,1fr))_10rem] sm:gap-3">
      <p className="text-sm font-medium sm:font-normal">{copy.fields[f.field]}</p>
      <dl className="mt-1 flex flex-col gap-1 sm:contents">
        <Cell label={t.csvValue}><span className="tabular-nums">{valueText(f.kind, f.csv)}</span></Cell>
        <Cell label={t.atAnalysis}><AtAnalysis kind={f.kind} at={f.atAnalysis} /></Cell>
        <Cell label={t.current}><span className="tabular-nums">{valueText(f.kind, f.current)}</span></Cell>
        <Cell label={t.result}><StatusChip status={f.status} /></Cell>
      </dl>
    </li>
  );
}

function Figures({ c }: { c: MatchComparison }) {
  const { lines, findings, status } = c.figures;
  return (
    <div data-field="figure" data-status={status} className="mt-3 border-t border-border/50 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t.figures}</h4>
        <StatusChip status={status} />
      </div>
      {lines === null ? (
        <p className="mt-1 text-xs text-muted">{t.linesPurged}</p>
      ) : lines.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t.noLines}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">
          {lines.map((l, i) => (
            <li key={`${l.lineRef ?? "line"}-${i}`} className="break-words">
              {t.figureLine(l.quantity, l.name)}
              {l.variant ? <span className="text-muted"> · {l.variant}</span> : null}
              <span className="ml-1 tabular-nums text-muted">{formatPrice(l.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {findings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs">
          {findings.map((f) => (
            <li key={f.id} className="break-words">
              {t.figureFinding(f.shown.ledger === null ? t.figureMissing : String(f.shown.ledger),
                               f.shown.external === null ? t.figureMissing : String(f.shown.external))}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Side({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{title}</p>
      <div className="mt-0.5 text-sm break-words">{children}</div>
    </div>
  );
}

export function MatchCard({ match: m }: { match: Match }) {
  const c = compareMatch(m);
  const headingId = `recon-match-${m.id}`;
  const cur = m.ledger?.current ?? null;
  return (
    <article aria-labelledby={headingId} data-category={m.category} data-tone={c.tone}
             className={`rounded-sky-md bg-surface/60 p-3 ring-1 sm:p-4 ${TONE_RING[c.tone]}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={headingId} className="sr-only">
          {m.order ? t.order(m.order.orderRef) : t.noOrder} · {m.sale ? t.sale(m.sale.id) : t.noSale}
        </h3>
        <span title={copy.categoryHints[m.category]}
              className={`rounded-sky-md px-2 py-0.5 text-xs ring-1 ${TONE_CHIP[c.tone]}`}>
          {copy.categories[m.category]}
        </span>
        {c.deviations > 0 ? <span className="text-xs text-danger">{t.deviationCount(c.deviations)}</span> : null}
        {c.state ? <span className="text-xs text-muted">{t.ledgerStates[c.state]}</span> : null}
        {cur?.isTest ? <span className="text-xs text-muted">{t.testSale}</span> : null}
      </header>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4">
        <Side title={t.csv}>
          {m.order ? (
            <>
              <span className="font-medium">{t.order(m.order.orderRef)}</span>
              <span className="block tabular-nums text-muted">
                {formatDate(m.order.soldOn)} · {formatPrice(m.order.total)}
              </span>
            </>
          ) : <span className="text-muted">{t.noOrder}</span>}
        </Side>
        <Side title={t.skyisles}>
          {m.sale && cur ? (
            <>
              <span className="font-medium">{t.sale(m.sale.id)}</span>
              <span className="block tabular-nums text-muted">
                {formatDate(cur.soldOn)} · {formatPrice(cur.expectedTotal)} <span className="text-xs">({t.current})</span>
              </span>
            </>
          ) : <span className="text-muted">{t.noSale}</span>}
        </Side>
      </div>

      <details className="group mt-2">
        <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
          {t.details}
        </summary>
        <div className="mt-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {m.certainty ? (
              <div><dt className="inline text-muted">{t.certainty}: </dt><dd className="inline">{copy.certainties[m.certainty]}
                {m.dateDelta !== null ? ` · ${t.dateDelta(m.dateDelta)}` : ""}</dd></div>
            ) : null}
            {m.reason ? (
              <div><dt className="inline text-muted">{t.reason}: </dt><dd className="inline">{copy.notComparableReasons[m.reason]}</dd></div>
            ) : null}
          </dl>
          {c.state ? <p className="mt-1 text-xs">{t.ledgerStateHints[c.state]}</p> : null}
          {cur?.cancelledOn ? <p className="mt-1 text-xs">{t.cancelled(formatDate(cur.cancelledOn))}</p> : null}
          {cur && cur.refundsTotal > 0 ? <p className="mt-1 text-xs">{t.refunds(formatPrice(cur.refundsTotal))}</p> : null}

          {m.competitors.length > 0 ? (
            <div className="mt-2 text-xs">
              <p className="text-muted">{t.competitors}</p>
              <ul className="mt-0.5 flex flex-wrap gap-1">
                {m.competitors.map((x) => (
                  <li key={`${x.saleId}-${x.orderRef}`} className="rounded-sky-md px-2 py-0.5 ring-1 ring-border/70">
                    {t.competitor(x.saleId)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 hidden text-xs text-muted sm:grid sm:grid-cols-[8rem_repeat(3,minmax(0,1fr))_10rem] sm:gap-3" aria-hidden="true">
            <span>{t.field}</span><span>{t.csvValue}</span><span>{t.atAnalysis}</span><span>{t.current}</span><span>{t.result}</span>
          </div>
          <ul className="mt-1">
            {c.fields.map((f) => <FieldRow key={f.field} f={f} />)}
          </ul>
          <Figures c={c} />
        </div>
      </details>
    </article>
  );
}
