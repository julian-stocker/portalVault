import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AvailabilityNotices, type NoticeView } from "@/components/catalog/availability-notices";
import { CatalogView } from "@/components/catalog/catalog-view";
import { FavoritesHeading } from "@/components/catalog/favorites-heading";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { isCollector } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { fetchSeries } from "@/lib/catalog/queries";
import { fetchCatalogMarketBoost } from "@/lib/catalog/market-boost-server";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { fetchFavorites } from "@/lib/favorites/queries";
import { fetchAvailabilityNotices } from "@/lib/favorites/notification-queries";
import { claimAvailabilityNotifications } from "@/lib/favorites/notifications";
import { imageSrc } from "@/lib/catalog/image";
import { hasV1BuyableOffer, offerRecord, offersFor } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";
import { fetchFreeShippingFrom } from "@/lib/commerce/shipping-queries";
import { fetchSellerPublic } from "@/lib/shop/seller";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.favorites.title };

/**
 * Die Wunschliste (0145, ADR-0136).
 *
 * SIE RENDERT `CatalogView`, UND DAS IST DIE GANZE ENTSCHEIDUNG. Dieselben
 * Karten, dieselbe Suche, dieselben Serien-Tabs, dieselben Filter für
 * Besitz und Verfügbarkeit, dieselbe Sortierung — alles, was der Katalog
 * kann, kann diese Seite dadurch auch, ohne dass eine Zeile davon ein
 * zweites Mal existiert. Übergeben wird nur eine kleinere Figurenmenge und
 * `favoritesOnly`.
 *
 * WARUM NICHT `CollectionView`. Die Vitrine zählt, rechnet Werte und zeigt
 * Duplikate — sie antwortet auf „was besitze ich". Eine Wunschliste
 * antwortet auf „was fehlt mir", und dafür ist der Katalog die richtige
 * Darstellung: es sind Figuren, die man noch sucht.
 *
 * ENTFERNEN GESCHIEHT MIT DEMSELBEN HERZ wie im Katalog. `favoritesOnly`
 * filtert gegen die optimistische Menge in `CatalogView`, also fällt die
 * Karte im selben Bild aus der Liste — und kommt zurück, wenn der Server
 * den Aufruf ablehnt. Kein eigener „Entfernen"-Knopf, der dasselbe nochmal
 * anders täte.
 */
export default async function FavoritesPage() {
  /*
   * Eine Wunschliste ist die eines Sammlers (ADR-0078, ADR-0136). Ein
   * Betriebs- oder Adminkonto hat keine — die Seite existiert für sie nicht,
   * dasselbe 404 wie bei der Sammlung.
   */
  if (!(await isCollector())) notFound();

  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  /*
   * DIE VERARBEITUNG, HIER UND SONST NIRGENDS (Phase 4 S4, Auftrag Punkt 4).
   *
   * `claimAvailabilityNotifications()` ist der bedarfsgesteuerte Anstoß aus
   * S3: es gibt keinen Scheduler, also stößt ein angemeldeter Besuch dieser
   * Seite die Verarbeitung an. Was dabei geschieht, steht vollständig in
   * `0148` — EINE Anweisung, die das Ereignis beansprucht und im selben
   * Zug die Meldungen anlegt. Hier wird nichts erkannt und nichts
   * entschieden; eine zweite Erkennung gibt es nicht.
   *
   * ZUERST VERARBEITEN, DANN LESEN, und deshalb eine Kette statt zweier
   * Einträge in `Promise.all`: eine Meldung, die dieser Aufruf gerade
   * angelegt hat, soll auf DIESER Seite stehen und nicht erst beim nächsten
   * Mal. Die Kette läuft parallel zu allem anderen, kostet also keine
   * zusätzliche Wartezeit.
   *
   * EIN ZWEITER AUFRUF KOSTET NICHTS: ohne fälliges Ereignis liest die
   * Funktion nur. Die 30-Minuten-Karenzzeit steckt in
   * `offer_availability_grace()` und wird hier nicht nachgebaut.
   */
  const noticesPromise = claimAvailabilityNotifications()
    .then(() => fetchAvailabilityNotices());

  const [figures, series, owned, offers, seller, marketBoost, freeShippingFrom, notices] =
    await Promise.all([
      /*
       * Die vorgemerkten Figuren, EIN Aufruf. Die Liste ist zugleich die
       * Antwort auf „welche sind vorgemerkt" — ein zweiter Aufruf für die
       * Herzen wäre dieselbe Frage zweimal.
       */
      fetchFavorites(),
      fetchSeries(),
      /* Der Besitz, damit „Alle · Besitz · Fehlen" hier dasselbe bedeutet
         wie im Katalog. Gesammelt geladen, ein Aufruf. */
      fetchOwnedSkyIds(),
      /* Die Angebote, damit die Angebotszeile auf diesen Karten dasselbe
         sagt wie im Katalog — und damit „vorgemerkt und kaufbar" filterbar
         ist, was auf dieser Seite der nützlichste Blick überhaupt ist. */
      fetchOffers(),
      fetchSellerPublic(),
      fetchCatalogMarketBoost(),
      fetchFreeShippingFrom(),
      noticesPromise,
    ]);

  const favorited = figures.map((f) => f.skyId);

  /*
   * DIE KENNZAHL „MIT ANGEBOT", und sie erfindet keine Regel.
   *
   * `hasV1BuyableOffer()` ist dieselbe Funktion, die die Angebotszeile jeder
   * Karte und die Schnellansicht fragen: veröffentlicht, loser Zustand,
   * bepreist und auf Lager. Hier wird nur gezählt, wie oft sie `true` sagt —
   * keine zweite Definition von „kaufbar", und an der Angebotslogik ändert
   * sich nichts (Auftrag Punkt 3).
   *
   * Aus denselben Angeboten, die unten als Props weitergehen. Kein zweiter
   * Aufruf, und die Zahl im Kopf kann dem Angebot auf der Karte nicht
   * widersprechen.
   */
  const withOffer = figures.filter((f) => hasV1BuyableOffer(offersFor(offers, f.skyId))).length;

  /*
   * DIE MELDUNGEN, FERTIG FÜR DIE ANZEIGE.
   *
   * `stillBuyable` kommt aus `hasV1BuyableOffer()` — derselben Funktion, die
   * die Kennzahl oben und die Angebotszeile jeder Karte benutzen, und aus
   * denselben `offers`, die ohnehin geladen sind. Kein zweiter Aufruf und
   * keine zweite Definition von „kaufbar": sagt sie `false`, nennt die Karte
   * das ausdrücklich, statt eine Kaufbarkeit zu suggerieren, die es nicht
   * mehr gibt (Auftrag Punkt 1).
   *
   * Das Bild über `imageSrc()`, wie überall — Override zuerst, dann die
   * importierte Datei, und `null` ist ein echter Zustand (ADR-0009).
   */
  const noticeViews: NoticeView[] = notices.map((n) => ({
    skyId: n.figure.skyId,
    name: n.figure.name,
    slug: n.figure.slug,
    picture: imageSrc(n.figure),
    cheapestCents: n.cheapestCents,
    createdAt: n.createdAt,
    read: n.readAt !== null,
    stillBuyable: hasV1BuyableOffer(offersFor(offers, n.figure.skyId)),
  }));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      {figures.length === 0 ? (
        <>
          {/* Leer braucht keinen Kennzahlenblock aus drei Nullen — nur den
              Titel und den einen Weg nach vorn. */}
          <header className="mb-6">
            <h1
              className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
              style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
            >
              {de.favorites.pageTitle}
            </h1>
            <p
              className="mt-2 text-sm text-on-deep-muted md:text-base"
              style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
            >
              {de.favorites.pageSubline}
            </p>
          </header>

          {/*
           * DER LEERE ZUSTAND, und er ist kein Fehler.
           *
           * Ein umrissenes Herz als Bild, ein Satz, der sagt was zu tun ist,
           * und ein Weg dorthin. Kein Ausrufezeichen, keine Illustration,
           * kein zweiter Knopf — eine leere Wunschliste ist der Anfang.
           */}
          {/*
            * AUCH OHNE VORGEMERKTE FIGUREN. Wer alles wieder entfernt, hat
            * seine Meldungen noch — sie gehören zu dem, was einmal
            * vorgemerkt war, und nicht zur aktuellen Liste. Sie stehen hier
            * ÜBER dem leeren Zustand, weil eine Meldung eine Nachricht ist
            * und der leere Zustand nur eine Einladung.
            */}
          <AvailabilityNotices notices={noticeViews} />

          <section
            className={
              "mt-5 rounded-sky-lg bg-deep/70 px-5 py-10 text-center "
              + "ring-1 ring-border-strong/60 backdrop-blur-sm"
            }
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="mx-auto h-10 w-10 text-on-deep-muted/70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1C19.5 15.9 12 20.5 12 20.5Z" />
            </svg>
            <h2 className="mt-4 text-base font-semibold text-on-deep">
              {de.favorites.emptyTitle}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-on-deep-muted">
              {de.favorites.emptyBody}
            </p>
            <Link href="/" className={`${ACTION_NEUTRAL} mt-5 w-auto px-4`}>
              {de.favorites.emptyAction}
            </Link>
          </section>
        </>
      ) : (
        <CatalogView
          figures={figures}
          series={series}
          ownedSkyIds={[...owned]}
          favoritedSkyIds={favorited}
          favorites
          favoritesOnly
          /*
           * Der eigene Kopf, INNERHALB der Weltkulisse — siehe
           * `favorites-heading.tsx`. Die Meldungen gehören in denselben
           * Slot und aus demselben Grund: als Markup der Seite stünden sie
           * auf eigenem Grund und schnitten ein Rechteck in die Kulisse.
           */
          heading={
            <>
              <FavoritesHeading total={figures.length} withOffer={withOffer} />
              <AvailabilityNotices notices={noticeViews} />
            </>
          }
          signedIn
          highlightSkyId={null}
          offers={offerRecord(offers)}
          seller={seller}
          freeShippingFrom={freeShippingFrom}
          marketBoostPercent={marketBoost}
        />
      )}
    </main>
  );
}
