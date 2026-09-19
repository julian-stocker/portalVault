/**
 * Adding a thing to an existing purchase (ADR-0088, ADR-0091).
 *
 * The same picker the create screen uses — `FigureSearch` — so a figure is
 * found the same way whether the purchase exists yet or not. Before 0064
 * these were two different boxes with two different result orders, which is
 * exactly the kind of difference that makes somebody pick the wrong variant
 * on the screen they use less often.
 *
 * ONE UNIT PER SELECTION, and the same figure may be selected again. Three
 * Wash Bucklers are three rows here as well; there is no quantity to type,
 * because a purchase item is one physical object.
 *
 * AND SOME THINGS ARE NOT FIGURES. A portal or a game belongs to the purchase
 * and to the money, but not to the figure catalog — so it is added by name
 * with no sky_id and can never be booked into figure inventory.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";
import { addPurchaseItem } from "@/lib/orderbook/actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";

const copy = de.business.orderbook;

/**
 * Kept as the module's public name for the catalog row so the detail page's
 * existing imports stay valid. It IS `FigureChoice` — one type, one shape.
 */
export type CatalogChoice = FigureChoice;

export function AddPurchaseItem({
  purchaseId,
  catalog,
}: {
  purchaseId: number;
  catalog: readonly CatalogChoice[];
}) {
  const [rawName, setRawName] = useState("");
  const [uncategorized, setUncategorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(skyId: string | null, name: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await addPurchaseItem(purchaseId, skyId, name);
      if (!result.ok) setError(result.message);
      else { setRawName(""); setUncategorized(false); }
    });
  }

  return (
    <section className="mt-6 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
      {error ? (
        <p role="alert" className="mb-2 text-sm">{error}</p>
      ) : null}

      {uncategorized ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">{copy.uncategorizedHint}</p>
          <input value={rawName} onChange={(e) => setRawName(e.target.value)}
                 placeholder="z. B. Portal of Power"
                 className="min-h-11 rounded-sky-md bg-surface px-3 ring-1 ring-border/70" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || rawName.trim().length < 2}
                    onClick={() => add(null, rawName.trim())}
                    className={`${ACTION_PRIMARY} min-h-11 w-auto disabled:opacity-40`}>
              {copy.addUncategorized}
            </button>
            <button type="button" onClick={() => setUncategorized(false)}
                    className={`${ACTION_NEUTRAL} min-h-11 w-auto`}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted">{copy.addItem}</p>
          <FigureSearch
            catalog={catalog}
            disabled={pending}
            onSelect={(choice) => add(choice.skyId, choice.name)}
          />
          <button type="button" onClick={() => setUncategorized(true)}
                  className="mt-3 text-xs text-muted underline underline-offset-2">
            {copy.addUncategorized}
          </button>
        </>
      )}
    </section>
  );
}
