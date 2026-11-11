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
 * release through `set_shop_listing` (`PriceEditor`, `ListingSwitch`). The
 * card never assigns `quantity`, never touches `reserved`, and never confuses
 * the shop price with the catalog's market price (ADR-0033, ADR-0037).
 *
 * SHARED WITH THE DESKTOP TABLE (Lagerverwaltung V2). Title, status, release
 * switch, accessory block and history are their own components, so the card
 * on a phone and the table row on a desktop show the same data and write the
 * same way. `InventoryView` renders exactly one of the two per position.
 */
"use client";

import { useState } from "react";

import { FavoriteDemandIndicator } from "@/components/business/favorite-demand-indicator";
import { AccessorySaleControls } from "@/components/admin/accessory-sale-controls";
import { ListingSwitch } from "@/components/admin/listing-switch";
import { PositionHistory } from "@/components/admin/position-history";
import { PositionStatusNote } from "@/components/admin/position-status";
import { PositionTitle } from "@/components/admin/position-title";
import { PriceEditor } from "@/components/admin/price-editor";
import { StockStepper } from "@/components/admin/stock-stepper";
import {
  hasSaleControls, isOperativeCondition, isShopGoods, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import { tradeCounters, type TradeTotals } from "@/lib/admin/stock-history";
import { automaticShopPrice } from "@/lib/shop/offer";
import { formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

/** A counter: quiet label, number beside it. One line, no box. */
export function Counter({ label, value }: { label: string; value: number }) {
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
  const [failed, setFailed] = useState<string | null>(null);

  const figure = position.figure;
  /*
   * Two complete aggregates, added. The history below is NOT part of this
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

  const saleState = hasSaleControls(position) ? (position.saleState ?? null) : null;

  return (
    <article className="flex flex-col gap-2 rounded-sky-lg bg-surface/80 p-2.5 ring-1 ring-border/70">
      {/* 1. What this is — one line (`PositionTitle`, shared with the table). */}
      <div className="flex items-center gap-2">
        <PositionTitle position={position} />

        {/*
          DIE NACHFRAGE, ZWISCHEN TITEL UND SHOP-SCHALTER (0145, ADR-0136).

          Hier und nicht in einer eigenen Zeile: der Kopf der Karte ist eine
          Zeile, und eine zweite darunter machte jede der knapp 290 Karten
          hoeher — fuer eine Zahl, die die meisten nicht haben. `shrink-0`,
          also weicht der Titel und nicht die Zahl; und sie steht VOR dem
          Schalter, also ueberdeckt sie keine Bedienflaeche.

          Bei null erscheint nichts (`FavoriteDemandIndicator`). Das ist der
          Normalfall, und 290 Nullen waeren kein Befund, sondern Rauschen.
        */}
        <FavoriteDemandIndicator count={position.favoriteDemand} />

        {/* The shop release, and the control that changes it (ADR-0048).
            Releasing asks first; taking it back does not (`ReleaseToggle`). */}
        {sellable ? (
          <ListingSwitch position={position} onFailed={setFailed} />
        ) : !shopGoods ? (
          /* Zubehör ohne Verkaufsfreigabe: die Art statt eines Zustands. „Nicht im
             Shop" wäre erst nach der Freigabe eine Frage, und die hat ihren
             eigenen Schalter weiter unten (ADR-0129). */
          <span className="min-h-7 shrink-0 rounded-full bg-surface px-2.5 text-[11px] font-medium whitespace-nowrap text-muted ring-1 ring-border/70">
            {copy.itemTypes[figure?.itemType ?? ""] ?? copy.accessoryNotShop}
          </span>
        ) : (
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
        <p className="text-[11px] leading-tight text-muted">
          {copy.accessoryNotShopHint}
        </p>
      ) : null}

      {/* Why a position is not (or not yet) on sale — from `positionStatus()`:
          a release without price or catalog visibility, a sold-out listing,
          a release still to be decided. Its own line, so it never widens the
          header. */}
      <PositionStatusNote position={position} />

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
            /* Nur die Zahl, kein Schritt: eine Buchung auf eine OVP-
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
              /* Nur lesen: `set_shop_listing()` setzt Preis und Listung
                 gemeinsam und weist diese Position seit 0108 ab. */
              <span className="text-sm tabular-nums">
                {position.effectivePrice === null ? "–" : formatPrice(position.effectivePrice)}
              </span>
            )}
          </span>
        ) : null}
      </div>

      {/* 4. VERKAUF — nur für Zubehör, und nur wenn die Datenbank Auskunft
             gibt (`AccessorySaleControls`, geteilt mit der Tabelle). */}
      {saleState !== null ? (
        <AccessorySaleControls position={position} saleState={saleState} onFailed={setFailed} />
      ) : null}

      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed}
        </p>
      ) : null}

      {/* 5. Where the number came from (`PositionHistory`, read-only). */}
      <PositionHistory position={position} />
    </article>
  );
}
