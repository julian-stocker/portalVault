/**
 * The sales that block taking over an order number (`rival_sale`, 0180) —
 * named, dated, with their figures and a way to look at them in the
 * Orderbuch. Display only: nothing here can make the take-over pass; the
 * refusal stays the database's (`rivals.ts`).
 */
import Link from "next/link";

import { formatDate } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { orderbookItemsHref, type ReturnTarget } from "@/lib/reconciliation/routes";
import type { RivalSale } from "@/lib/reconciliation/view";

const t = de.business.reconciliation.reconcile.rivals;

export function RivalSales({ rivals, back = null }: { rivals: readonly RivalSale[]; back?: ReturnTarget | null }) {
  if (rivals.length === 0) return null;
  return (
    <div data-rivals="" className="mt-2 rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-attention/60">
      <p className="font-medium">{t.title}</p>
      <p className="mt-0.5 text-muted">{t.why}</p>
      <ul className="mt-1 space-y-1">
        {rivals.map((r) => (
          <li key={r.saleId} data-rival={r.saleId} className="break-words">
            <span className="font-medium">{t.sale(r.saleId, formatDate(r.soldOn))}</span>
            {" · "}{t.shared}: <span className="font-medium">{r.shared.join(", ")}</span>
            {" · "}{t.all}: {r.pieces.join(", ")}
            {" · "}
            <Link href={orderbookItemsHref(r.saleId, back)} data-rival-link=""
                  className="focus-ring underline underline-offset-2">
              {t.open}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
