/**
 * One stock position, as an operator uses it (Lager V2).
 *
 * A card rather than a table row, because this page is used on a phone with
 * one thumb. The layout follows the three questions in the order they are
 * asked: what is this, how much of it is there, what does it cost — and then,
 * on request, where the number came from.
 *
 *   [40px] Bash · SKY-0007 · Spyro's Adventure · Lose     [Im Shop]
 *   Eingekauft 8    Verkauft 12    Bestand [−] 4 [+]
 *   Marktpreis 4,99 €    Shoppreis 4,49 € · Automatisch · 90 %
 *   ──────────────────────────────────────────────────────────
 *   Historie                                        17 Einträge
 *
 * THREE ROWS, EACH ONE LINE. A card is a dossier in a list of hundreds, not
 * a detail page. Two earlier passes stacked these and then tried to claw
 * the height back with smaller paddings; this one starts from the row.
 *
 * Each row groups its content to the LEFT and lets the spare width sit at
 * the end, rather than pushing the last item to the far edge. On a wide
 * card `justify-between` was what produced the empty middle.
 *
 * WRITES. Stock through one movement per save (`StockStepper`), price and
 * release through `set_shop_listing` (`PriceEditor`, the switch). The card
 * never assigns `quantity`, never touches `reserved`, and never confuses the
 * shop price with the catalog's market price (ADR-0033, ADR-0037).
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdminThumb } from "@/components/admin/admin-thumb";
import { PriceEditor } from "@/components/admin/price-editor";
import { StockLedger } from "@/components/admin/stock-ledger";
import { StockStepper } from "@/components/admin/stock-stepper";
import {
  setDeliveryScope, setListing, setSaleRelease, setUskRating,
} from "@/lib/admin/actions";
import {
  hasSaleControls, isOperativeCondition, isShopGoods, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import { loadCardHistory } from "@/lib/admin/legacy-actions";
import {
  mergeHistory, tradeCounters,
  type CardHistory, type LedgerEntry, type TradeTotals,
} from "@/lib/admin/stock-history";
import { automaticShopPrice } from "@/lib/shop/offer";
import {
  USK_RATINGS, deliveryScopeLabel, scopesFor,
} from "@/lib/shop/delivery-scope";
import { formatNumber, formatPrice } from "@/lib/format";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

/** A counter: quiet label, number beside it. One line, no box. */
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="truncate text-[11px] text-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}

export function InventoryCard({
  position,
  legacyTotals,
  tradeTotals,
  percentage,
}: {
  position: InventoryPosition;
  /** The reconstruction's lifetime totals for this position, if it has any. */
  legacyTotals?: TradeTotals;
  /** The operative ledger's lifetime totals for this position (0086). */
  tradeTotals?: TradeTotals;
  /** The shop-wide percentage, for the "Automatisch · 90 %" line (ADR-0045). */
  percentage: number;
}) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CardHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const figure = position.figure;
  /*
   * Two complete aggregates, added. The timeline below is NOT part of this
   * and must never become part of it: it is capped, these figures are not
   * (0086). That coupling is the bug this card used to have.
   */
  const { purchased, sold } = tradeCounters(legacyTotals, tradeTotals);

  /**
   * What this position would cost without its override. Only needed while an
   * override IS set — otherwise `effectivePrice` already is the automatic
   * price and the database computed it (ADR-0045).
   */
  const automaticPrice = automaticShopPrice(figure?.marketPrice ?? null, percentage);
  const conditionLabel =
    position.condition === "loose" ? copy.conditionLoose : copy.conditionBoxed;

  /*
   * HISTORISCH ODER OPERATIV (0108).
   *
   * SkyIsles handelt ausschließlich lose. Eine OVP-Position bleibt sichtbar,
   * behält ihr Etikett und ihre Historie — aber `record_inventory_movement()`
   * und `set_shop_listing()` weisen sie seit 0108 ab. Die drei Steuerungen,
   * die genau dort hinführen, werden deshalb nicht angeboten: Listung,
   * Bestandsschritte und Preis. Lesen bleibt ungehindert.
   */
  const operative = isOperativeCondition(position.condition);

  /*
   * IST DAS ÜBERHAUPT SHOPWARE? (ADR-0128)
   *
   * Für ein Spiel oder ein Portal: nein. `set_shop_listing()` würde es
   * durchaus auf `is_listed = true` setzen — aber `shop_offers()` filtert es
   * über `is_shop_eligible()` am Artikeltyp wieder heraus (`0135`). Der
   * Schalter sagte dann „Im Shop", und im Shop stünde nichts.
   *
   * Dieselbe Entscheidung wie bei `operative`, aus demselben Grund und mit
   * demselben Muster: die beiden Steuerungen, die ins Leere führen, werden
   * nicht angeboten — Shopfreigabe und Preis. BESTAND UND HISTORIE BLEIBEN,
   * und das ist der Punkt: `record_inventory_movement()` fragt nur den
   * Zustand, also wird ein Portal gebucht wie jede Figur.
   */
  const shopGoods = isShopGoods(position);
  /** Beides zusammen: nur dann gibt es Preis und Freigabe zu bedienen. */
  const sellable = operative && shopGoods;

  /**
   * BOTH sources are fetched on first open, not with the page.
   *
   * 2 671 reconstructed rows sit across 600 positions, and the operative
   * ledger grows for as long as the shop runs. Only an opened card shows
   * either, so one round trip per open beats 273 on load — which is what
   * this page did before 0086, once per position, for a list it then
   * summed into a counter it had no business summing.
   */
  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (!next || history !== null || loadingHistory) return;
    setLoadingHistory(true);
    void loadCardHistory(position.skyId, position.condition, position.inventoryId)
      .then(setHistory)
      .catch(() => setHistory({ legacy: [], movements: [] }))
      .finally(() => setLoadingHistory(false));
  }

  const entries: LedgerEntry[] = mergeHistory(
    history?.legacy ?? [],
    history?.movements ?? [],
  );

  /**
   * Price and listing travel together, because `set_shop_listing` writes
   * both. Whichever one is being changed, the other is sent as it stands.
   */
  /** Der Verkaufszustand dieser Position, oder null = keine Auskunft. */
  const saleState = hasSaleControls(position) ? (position.saleState ?? null) : null;

  /** Ein Aufruf, ein Ergebnis, ein Neuladen — dreimal dasselbe Muster. */
  function fuehreAus(tun: () => Promise<{ ok: boolean; message?: string }>) {
    setFailed(null);
    startTransition(async () => {
      const result = await tun();
      if (!result.ok) { setFailed(result.message ?? ""); return; }
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

  function save(next: { salePrice?: number | null; isListed?: boolean }) {
    setFailed(null);
    startTransition(async () => {
      const result = await setListing({
        skyId: position.skyId,
        condition: position.condition,
        salePrice: next.salePrice !== undefined ? next.salePrice : position.salePrice,
        isListed: next.isListed !== undefined ? next.isListed : position.isListed,
        note: position.note,
      });
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col gap-2 rounded-sky-lg bg-surface/80 p-2.5 ring-1 ring-border/70">
      {/* 1. What this is — one line. The picture is a fixed square and
             never a flex child that can be squeezed; the name is the only
             part that gives. */}
      <div className="flex items-center gap-2">
        <AdminThumb
          src={figure ? imageSrc(figure) : null}
          name={figure?.displayName ?? position.skyId}
        />
        <p className="min-w-0 flex-1 truncate text-xs leading-tight">
          <span className="text-sm font-medium">{figure?.displayName ?? position.skyId}</span>
          <span className="text-muted">
            {" · "}
            <span className="font-mono">{position.skyId}</span>
            {figure ? ` · ${figure.seriesLabel}` : ""}
            {` · ${conditionLabel}`}
          </span>
        </p>

        {/* The shop release, and the control that changes it (ADR-0048).
            "Im Shop" means released, never "in stock": the two are separate
            questions and both states of each are real. */}
        {sellable ? (
          <button
            type="button"
            onClick={() => save({ isListed: !position.isListed })}
            aria-pressed={position.isListed}
            aria-busy={pending || undefined}
            className={
              "min-h-7 shrink-0 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap ring-1 " +
              (position.isListed
                ? "bg-status-ground text-status-ink ring-status-line"
                : "bg-surface text-muted ring-border/70")
            }
          >
            {position.isListed ? copy.listed : copy.notListed}
          </button>
        ) : !shopGoods ? (
          /* Zubehör ohne Freigabe: hier steht die ART, kein Schalter. „Im
             Shop" wäre erst nach der Freigabe eine Frage, und die hat ihren
             eigenen Schalter weiter unten (ADR-0129). */
          <span className="min-h-7 shrink-0 rounded-full bg-surface px-2.5 text-[11px] font-medium whitespace-nowrap text-muted ring-1 ring-border/70">
            {copy.itemTypes[figure?.itemType ?? ""] ?? copy.accessoryNotShop}
          </span>
        ) : (
          /* Kein Knopf, nur der Zustand: 0108 würde das Umschalten ablehnen. */
          <span className="min-h-7 shrink-0 rounded-full bg-surface px-2.5 text-[11px] font-medium whitespace-nowrap text-muted ring-1 ring-border/70">
            {position.isListed ? copy.listed : copy.notListed}
          </span>
        )}
      </div>

      {/* Warum hier nichts zu bedienen ist — einmal gesagt, nicht an drei
          Stellen angedeutet. */}
      {!operative ? (
        <p className="rounded-sky-md bg-status-ground px-2.5 py-1.5 text-[11px] leading-tight text-status-ink ring-1 ring-status-line">
          <span className="font-medium">{copy.historicalCondition}</span>{" "}
          {copy.historicalConditionHint}
        </p>
      ) : !shopGoods && saleState === null ? (
        /*
         * Zubehör, zu dem die Datenbank nichts sagt — `0141` ist in dieser
         * Umgebung nicht angewendet. Dann gibt es hier auch nichts zu
         * bedienen, und der Satz sagt das, statt eine Steuerung
         * anzubieten, die beim Speichern scheiterte.
         *
         * Ist `0141` da, erklärt der Verkaufsblock weiter unten den Stand
         * — mit dem Grund aus der Datenbank statt mit einem Satz von hier.
         */
        <p className="text-[11px] leading-tight text-muted">
          {copy.accessoryNotShopHint}
        </p>
      ) : null}

      {/* The two reasons a released position is nevertheless not on sale.
          Their own line, so they never widen the header. */}
      {sellable && position.isListed
        && (position.available <= 0 || position.effectivePrice === null) ? (
        <p className="text-[11px] leading-tight text-muted">
          {position.effectivePrice === null ? (
            <span className="text-danger">{copy.noPriceHint}</span>
          ) : (
            copy.soldOutHint
          )}
        </p>
      ) : null}

      {/* 2. How much of it there is — one line, grouped left. `Bestand`
             is last because it is the one that gets touched, so it ends up
             beside the stepper instead of splitting it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Counter label={copy.purchased} value={purchased} />
        <Counter label={copy.sold} value={sold} />
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted">{copy.stockLabel}</span>
          {operative ? (
            <StockStepper
              skyId={position.skyId}
              condition={position.condition}
              quantity={position.quantity}
              reserved={position.reserved}
              onFailed={setFailed}
            />
          ) : (
            /* Die Zahl bleibt, die Schritte nicht: eine Bewegung auf dieser
               Position weist 0108 ab. */
            <span className="text-sm font-medium tabular-nums">
              {formatNumber(position.quantity)}
            </span>
          )}
        </span>
        {/* Only when something is actually promised to a checkout —
            otherwise this repeats the number beside it. */}
        {position.reserved > 0 ? (
          <span className="text-[11px] text-muted">
            {copy.draftReserved(position.reserved)} · {copy.available}{" "}
            <span className="tabular-nums">{formatNumber(position.available)}</span>
          </span>
        ) : null}
      </div>

      {/* 3. What it costs — one line, grouped left. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[11px] text-muted">{copy.marketPrice}</span>
          <span className="text-sm tabular-nums">
            {figure === null || figure.marketPrice === null
              ? "—"
              : formatPrice(figure.marketPrice)}
          </span>
        </span>
        {/*
          DEN SHOP-PREIS GIBT ES NUR FÜR SHOPWARE (ADR-0128). Bei einem
          Portal stünde hier „Shop-Preis —", und das ist keine Auskunft,
          sondern eine leere Zeile: es gibt keinen Shop-Preis, nicht bloß
          keinen eingetragenen. Der Marktpreis links bleibt — ein Spiel hat
          einen, und er ist der Einkaufsmaßstab.
        */}
        {shopGoods ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[11px] text-muted">{copy.salePrice}</span>
            {/* What the shop charges, and whether it follows the rule
                (ADR-0045). The automatic figure is the database's. */}
            {sellable ? (
              <PriceEditor
                position={position}
                automaticPrice={
                  position.priceSource === "automatic" ? position.effectivePrice : automaticPrice
                }
                percentage={percentage}
                onFailed={setFailed}
              />
            ) : (
              /* Nur der Wert: `set_shop_listing` schreibt Preis und Listung
                 gemeinsam und weist diese Position seit 0108 ab. */
              <span className="text-sm tabular-nums">
                {position.effectivePrice === null ? "–" : formatPrice(position.effectivePrice)}
              </span>
            )}
          </span>
        ) : null}
      </div>

      {/*
        5. VERKAUF — nur für Zubehör, und nur wenn die Datenbank Auskunft
           gibt (`seller_sale_state()`, 0141).

        DREI ANGABEN, DREI AUFRUFE. Lieferumfang, USK und Freigabe bleiben
        getrennt: wer sie zusammenlegt, gibt irgendwann beim Pflegen einer
        Angabe versehentlich frei. Für eine FIGUR erscheint der Block nicht
        — dort gibt es nur einen Lieferumfang (die Figur), und die Freigabe
        ist implizit.
      */}
      {saleState !== null ? (
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

            {/* Der Schalter. Zurücknehmen geht immer; freigeben nur, wenn
                die Datenbank alle Bedingungen erfüllt sieht — sie lehnt
                sonst ab, und der Grund steht darunter. */}
            <button
              type="button"
              onClick={() => saveRelease(!saleState.saleReleased)}
              aria-pressed={saleState.saleReleased}
              aria-busy={pending || undefined}
              disabled={pending}
              className={
                /* 44 px auf dem Telefon, 36 ab `sm:` — derselbe Griff wie
                   `INPUT` in `form-section.tsx`. Dieser Schalter stellt
                   einen Artikel öffentlich zum Verkauf; ihn knapp zu
                   treffen ist der falsche Fehler. */
                "min-h-11 shrink-0 rounded-full px-3 text-[11px] font-medium whitespace-nowrap ring-1 disabled:opacity-40 sm:min-h-9 "
                + (saleState.saleReleased
                  ? "bg-status-ground text-status-ink ring-status-line"
                  : "bg-surface text-muted ring-border/70")
              }
            >
              {saleState.saleReleased ? copy.released : copy.notReleased}
            </button>
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
      ) : null}

      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}

      {/* 4. Where the number came from. */}
      <div className="border-t border-border/30 pt-1.5">
        <button
          type="button"
          onClick={toggleHistory}
          aria-expanded={showHistory}
          className="flex w-full items-baseline justify-between gap-2 text-xs text-muted hover:text-foreground"
        >
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="text-[10px]">{showHistory ? "▴" : "▾"}</span>
            {copy.history}
          </span>
          {/* Only once the history has arrived: before that there is
              nothing to count, and a zero that jumps is worse than none. */}
          {history !== null ? (
            <span className="text-[11px] tabular-nums">{copy.historyCount(entries.length)}</span>
          ) : null}
        </button>

        {showHistory ? (
          <div className="mt-1.5">
            {loadingHistory && history === null ? (
              <p className="px-1 py-2 text-xs text-muted">{copy.historyLoading}</p>
            ) : (
              /* Read-only, and structurally so: movements are append-only
                 and legacy events are too. A wrong booking is answered with
                 a correction, never an edit. */
              <StockLedger entries={entries} />
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
