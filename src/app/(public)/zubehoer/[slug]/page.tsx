import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OfferPanel } from "@/components/shop/offer-panel";
import { accessoryDetail, seriesScopeOf } from "@/lib/catalog/accessory-facts";
import { deliveryScopeLabel } from "@/lib/shop/delivery-scope";
import { fetchAccessoryBySlug, fetchSeries, fetchUskRating } from "@/lib/catalog/queries";
import { fetchFreeShippingFrom } from "@/lib/commerce/shipping-queries";
import { itemTypeOf } from "@/lib/catalog/item-type";
import { offersFor } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";

type Params = { params: Promise<{ slug: string }> };

const copy = de.accessories;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const item = await fetchAccessoryBySlug(slug);
  return { title: item && item.catalogVisible ? item.displayName : copy.title };
}

/**
 * Die Seite eines Zubehörartikels — Spiel oder Portal.
 *
 * SIE IST NICHT DIE FIGURENSEITE, und das ist der Grund, warum es sie gibt.
 * `/skylanders/[slug]` zeigt Charakter, Element, Variante, Besitzsiegel und
 * Marktwert; für ein Portal ist davon nichts wahr, und sie antwortet
 * deshalb für jedes Zubehörteil mit 404 (ADR-0029). Zwei Bereiche, zwei
 * Adressräume, keine Vermischung.
 *
 * WAS SIE DAFÜR ZEIGT, UND WARUM GERADE DAS
 *
 * Ein Angebot für gebrauchte Ware muss sagen, was man bekommt. Diese Seite
 * ist der Platz dafür, den eine Kachel nicht hat:
 *
 *   Zustand        der EINE SkyIsles-Standard, im Klartext (ADR-0130) —
 *                  gebraucht, mindestens gut, voll funktionsfähig. Keine
 *                  Klasse, keine Auswahl.
 *   Lieferumfang   was im Paket liegt, aus dem Angebot selbst
 *                  (`shop_offers().delivery_scope`, 0139).
 *   USK            bei Spielen, gesetzlich erforderlich. Nie geraten: ohne
 *                  erfasste Kennzeichnung gibt es gar kein Angebot.
 *   Plattform      nur bei Spielen und nur aus dem Rohnamen. Bei einem
 *                  Portal steht keine — die Arbeitsmappe führt dort eine
 *                  Lesehilfe, keine nachgewiesene Kompatibilität.
 *
 * KEINE SAMMLUNG. Kein Sammelknopf, kein Besitzsiegel, kein Fortschritt —
 * Zubehör ist nicht sammelbar (ADR-0128), und ein Steuerelement, das es
 * anböte, wäre eine Falle.
 *
 * DER KAUF IST DER BESTEHENDE. `OfferPanel` ist dieselbe Komponente wie auf
 * der Figurenseite, mit demselben `AddToCartButton` und demselben Warenkorb
 * — die Warenkorbzeile ist `sky_id + condition` und kennt keinen Artikeltyp
 * (ADR-0043). Es gibt hier nichts Eigenes zu kaufen.
 *
 * Kein `loading.tsx`: eine Suspense-Grenze über einem `notFound()` lässt die
 * Antwort streamen, und der 404-Status ginge an eine 200 verloren
 * (docs/ARCHITECTURE.md, 3c).
 */
export default async function AccessoryDetailPage({ params }: Params) {
  const { slug } = await params;
  const item = await fetchAccessoryBySlug(slug);
  /* Dieselbe Regel wie bei der Figurenseite: was im Katalog nicht sichtbar
     ist, hat auch keine eigene Adresse (ADR-0039). */
  if (!item || !item.isActive || !item.catalogVisible) notFound();

  const supabase = await createClient();
  const [{ data: auth }, offers, series, usk, freeShippingFrom] = await Promise.all([
    supabase.auth.getUser(),
    fetchOffers(),
    fetchSeries(),
    /* Nur bei Spielen gefragt — ein Portal trägt keine Kennzeichnung. */
    itemTypeOf(item) === "game" ? fetchUskRating(item.skyId) : Promise.resolve(null),
    fetchFreeShippingFrom(),
  ]);

  const art = itemTypeOf(item);
  const detail = accessoryDetail(item);
  const eigene = offersFor(offers, item.skyId);
  /* Alle Serien, für die das Portal gilt — bei `SKY-0637` drei. */
  const serien = seriesScopeOf(item, new Set(series.map((s) => s.code)))
    .map((code) => series.find((s) => s.code === code)?.label ?? code);
  /* Der Lieferumfang steht am ANGEBOT, nicht am Artikel: zwei Exemplare
     desselben Spiels können verschieden vollständig sein. */
  const lieferumfang = deliveryScopeLabel(eigene[0]?.deliveryScope ?? null);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 md:pt-10">
      <Link href="/zubehoer" className="text-sm text-on-deep-muted hover:text-on-deep">
        ← {copy.backToList}
      </Link>

      <h1
        className="mt-3 text-2xl leading-tight font-semibold tracking-tight md:text-3xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {item.displayName}
      </h1>

      <div className="mt-5 flex flex-col gap-4 rounded-sky-lg bg-surface/80 p-4 ring-1 ring-border/70">
        {/* Was das ist — die Angaben, die den Artikel bestimmen. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">{copy.detailType}</dt>
          <dd className="font-medium">{de.inventory.itemTypes[art] ?? art}</dd>

          {detail !== null ? (
            <>
              <dt className="text-muted">
                {art === "game" ? copy.detailPlatform : copy.detailModel}
              </dt>
              <dd className="font-medium">{detail}</dd>
            </>
          ) : null}

          <dt className="text-muted">{copy.detailSeries}</dt>
          <dd>{serien.join(", ")}</dd>

          {/* Die Alterskennzeichnung. Steht sie nicht da, gibt es auch kein
              Angebot — `seller_set_sale_release()` lässt ein Spiel ohne sie
              nicht frei (docs/LEGAL.md, 8b). */}
          {art === "game" ? (
            <>
              <dt className="text-muted">{de.inventory.uskRating}</dt>
              <dd className="font-medium">
                {usk === null ? de.inventory.uskNone : de.inventory.uskValue(usk)}
              </dd>
            </>
          ) : null}

          <dt className="text-muted">{de.inventory.condition}</dt>
          <dd className="font-medium">{de.shop.conditionStandard}</dd>

          {/* Nur wenn es ein Angebot gibt: ohne Angebot gibt es auch nichts
              zu liefern, und eine Angabe darüber wäre eine über nichts. */}
          {lieferumfang !== null ? (
            <>
              <dt className="text-muted">{de.shop.deliveryScopeLabel}</dt>
              <dd className="font-medium">{lieferumfang}</dd>
            </>
          ) : null}

          <dt className="text-muted">SKY-ID</dt>
          <dd className="font-mono text-xs">{item.skyId}</dd>
        </dl>

        <p className="text-xs leading-relaxed text-muted">{de.shop.conditionStandardHint}</p>
      </div>

      {/*
        DAS ANGEBOT — dieselbe Komponente wie auf der Figurenseite.
        Ohne kaufbares Angebot zeigt sie nichts, und darunter steht der
        ruhige Satz statt eines ausgegrauten Knopfes (V7).
      */}
      <div id="angebote" className="mt-5">
        {eigene.length > 0 ? (
          <OfferPanel
            offers={eigene}
            name={item.displayName}
            /* Für Zubehör gibt es noch kein Produktbild; der Warenkorb
               speichert dann keines, statt eines zu erfinden. */
            imageSrc={null}
            guest={!auth.user}
            freeShippingFrom={freeShippingFrom}
          />
        ) : (
          <p className="rounded-sky-lg bg-surface/70 px-4 py-6 text-center text-sm text-muted ring-1 ring-border/70">
            {copy.noOffer}
          </p>
        )}
      </div>
    </main>
  );
}
