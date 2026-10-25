import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CatalogView } from "@/components/catalog/catalog-view";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { isCollector } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { fetchSeries } from "@/lib/catalog/queries";
import { fetchCatalogMarketBoost } from "@/lib/catalog/market-boost-server";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { fetchFavorites } from "@/lib/favorites/queries";
import { offerRecord } from "@/lib/shop/offer";
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

  const [figures, series, owned, offers, seller, marketBoost, freeShippingFrom] =
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
    ]);

  const favorited = figures.map((f) => f.skyId);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold md:text-3xl">{de.favorites.title}</h1>
        <p className="mt-1 text-sm text-muted">{de.favorites.subline}</p>
        <p className="mt-3 max-w-prose text-sm text-muted">{de.favorites.intro}</p>
        {figures.length > 0 ? (
          <p className="mt-2 text-sm font-medium tabular-nums">
            {de.favorites.count(figures.length)}
          </p>
        ) : null}
      </header>

      {figures.length === 0 ? (
        /*
         * Der leere Zustand: ein Satz, der sagt, was zu tun ist, und ein
         * Weg dorthin. Kein Bild, kein Ausrufezeichen — eine leere
         * Wunschliste ist kein Fehler, sondern der Anfang.
         */
        <section className="rounded-sky-lg border border-line bg-panel px-5 py-8 text-center">
          <h2 className="text-base font-semibold">{de.favorites.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{de.favorites.emptyBody}</p>
          <Link href="/" className={`${ACTION_NEUTRAL} mt-5 w-auto px-4`}>
            {de.favorites.emptyAction}
          </Link>
        </section>
      ) : (
        <CatalogView
          figures={figures}
          series={series}
          ownedSkyIds={[...owned]}
          favoritedSkyIds={favorited}
          favorites
          favoritesOnly
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
