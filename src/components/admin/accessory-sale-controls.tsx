/**
 * VERKAUF — only for accessories, and only when the database gives
 * information (`seller_sale_state()`, 0141). Shared by the card and the
 * table's details.
 *
 * THREE FIELDS, THREE CALLS. Delivery scope, USK and release stay separate:
 * whoever merges them will one day release by accident while maintaining a
 * field. For a FIGURE this block does not appear — there is only one delivery
 * scope (the figure), and the release is implicit.
 *
 * THE RELEASE ASKS FIRST (Lagerverwaltung V2). Releasing puts the article on
 * public sale and goes through `ReleaseToggle`'s confirmation; taking it back
 * is immediate. The database still decides: it refuses a release whose
 * conditions are not met, and the reason is shown underneath.
 */
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ReleaseToggle } from "@/components/admin/release-toggle";
import { setDeliveryScope, setSaleRelease, setUskRating } from "@/lib/admin/actions";
import type { InventoryPosition, SaleState } from "@/lib/admin/inventory-model";
import { USK_RATINGS, deliveryScopeLabel, scopesFor } from "@/lib/shop/delivery-scope";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

export function AccessorySaleControls({
  position,
  saleState,
  onFailed,
}: {
  position: InventoryPosition;
  saleState: SaleState;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function fuehreAus(tun: () => Promise<{ ok: boolean; message?: string }>) {
    onFailed(null);
    startTransition(async () => {
      const result = await tun();
      if (!result.ok) { onFailed(result.message ?? ""); return; }
      router.refresh();
    });
  }

  const saveRelease = (released: boolean) =>
    fuehreAus(() => setSaleRelease({
      skyId: position.skyId, condition: position.condition, released,
    }));

  const saveScope = (scope: string | null) =>
    fuehreAus(() => setDeliveryScope({
      skyId: position.skyId, condition: position.condition, scope,
    }));

  const saveUsk = (rating: number | null) =>
    fuehreAus(() => setUskRating({ skyId: position.skyId, rating }));

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/30 pt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] font-medium text-muted">{copy.saleSection}</span>

        {/* Was im Paket liegt. Alle Werte der Artikelart stehen zur
            Wahl — es gibt keine Kopplung an den Zustand (ADR-0130). */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">{copy.deliveryScope}</span>
          <select
            value={saleState.deliveryScope ?? ""}
            disabled={pending}
            onChange={(e) => saveScope(e.target.value === "" ? null : e.target.value)}
            className="min-h-11 rounded-sky-md bg-surface px-2 text-xs ring-1 ring-border/70 disabled:opacity-40 sm:min-h-9"
          >
            <option value="">{copy.deliveryScopeNone}</option>
            {scopesFor(saleState.itemType).map((wert) => (
              <option key={wert} value={wert}>{deliveryScopeLabel(wert)}</option>
            ))}
          </select>
        </label>

        {/* Die Alterskennzeichnung — nur bei Spielen, und nie geraten.
            Sie gehört dem Katalog, nicht dem Regal: geschrieben wird
            sie über eine Adminfunktion (ADR-0077). */}
        {saleState.itemType === "game" ? (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{copy.uskRating}</span>
            <select
              value={saleState.uskRating === null ? "" : String(saleState.uskRating)}
              disabled={pending}
              onChange={(e) => saveUsk(e.target.value === "" ? null : Number(e.target.value))}
              className="min-h-11 rounded-sky-md bg-surface px-2 text-xs ring-1 ring-border/70 disabled:opacity-40 sm:min-h-9"
            >
              <option value="">{copy.uskNone}</option>
              {USK_RATINGS.map((stufe) => (
                <option key={stufe} value={stufe}>{copy.uskValue(stufe)}</option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Der Schalter. Zurücknehmen geht immer und sofort; freigeben erst
            nach der Bestätigung, und nur wenn die Datenbank alle
            Bedingungen erfüllt sieht — sie lehnt sonst ab, und der Grund
            steht darunter. 44 px auf dem Telefon: dieser Schalter stellt
            einen Artikel öffentlich zum Verkauf. */}
        <ReleaseToggle
          on={saleState.saleReleased}
          onLabel={copy.released}
          offLabel={copy.notReleased}
          name={position.figure?.displayName ?? position.skyId}
          pending={pending}
          onChange={saveRelease}
          size="touch"
        />
      </div>

      {/*
        WARUM NOCH NICHT. Der Grund kommt aus der einen Gründeleiter
        (`admin_shop_listing_audit()`) und wird hier nur übersetzt —
        nachgerechnet wird er nicht, sonst gäbe es zwei Wahrheiten.

        Der Preis ist der eine Fall, den die Leiter nicht kennt: er
        betrifft nicht die Eignung, sondern das Angebot. Er steht
        deshalb daneben, aus derselben Zeile, die ohnehin da ist.
      */}
      {!saleState.sellable && saleState.reason !== null ? (
        <p className="text-[11px] leading-tight text-muted">
          {copy.saleReasons[saleState.reason] ?? saleState.reason}
        </p>
      ) : null}
      {!saleState.saleReleased && position.effectivePrice === null ? (
        <p className="text-[11px] leading-tight text-muted">{copy.saleNeedsPrice}</p>
      ) : null}
      {!saleState.saleReleased && saleState.sellable === false
        && saleState.reason === "not released for sale"
        && position.effectivePrice !== null ? (
        <p className="text-[11px] leading-tight text-muted">{copy.releaseHint}</p>
      ) : null}
    </div>
  );
}
