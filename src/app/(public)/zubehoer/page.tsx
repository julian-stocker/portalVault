import type { Metadata } from "next";

import { AccessoryView } from "@/components/catalog/accessory-view";
import { fetchAccessoryCatalog, fetchSeries } from "@/lib/catalog/queries";
import { offerRecord } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";
import { isAdmin } from "@/lib/auth/admin";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = {
  title: `${de.accessories.title} · ${de.catalog.title}`,
  description: de.accessories.intro,
};

/**
 * Zubehör im Katalog — Spiele, Portale und was sonst keine Figur ist.
 *
 * DIESELBE FREIGABEREGEL WIE DER FIGURENKATALOG, und das ist die ganze
 * Sichtbarkeitsentscheidung: `fetchAccessoryCatalog()` liefert ohne Argument
 * nur `is_active AND catalog_visible`, ein Administrator bekommt mit
 * `includeHidden` auch die ausgeblendeten — Zeile für Zeile dasselbe Muster
 * wie `fetchCatalog({ includeHidden: admin })` auf der Startseite (ADR-0042).
 *
 * Die 21 Portale stehen heute auf `catalog_visible = false`; sie erscheinen
 * hier, sobald ein Administrator sie unter `/admin/catalog` einzeln
 * freigibt. Es gibt keinen Weg daran vorbei und keine Sammelfreigabe.
 *
 * KEINE SAMMLUNG. Diese Seite fragt `fetchOwnedSkyIds()` nicht — nicht aus
 * Sparsamkeit, sondern weil Zubehör nicht sammelbar ist und ein Besitzsiegel
 * etwas verspräche, das `isCollectible()` ablehnt (ADR-0128).
 *
 * DAS ANGEBOT DAGEGEN WIRD GEFRAGT, obwohl es heute für jedes Zubehörteil
 * leer ist: `shop_offers()` schliesst es am Artikeltyp aus (`0135`). Es ist
 * DIESELBE Projektion, die der Shop und der Figurenkatalog lesen — ein
 * Aufruf für die ganze Seite (ADR-0043), keine zweite Angebotsverwaltung.
 * Jede Kachel sagt damit heute „Aktuell kein Angebot", und sobald die
 * Produktentscheidung fällt, füllt sich dieselbe Stelle von selbst.
 */
export default async function AccessoryPage() {
  const admin = await isAdmin();
  const [items, series, offers] = await Promise.all([
    fetchAccessoryCatalog({ includeHidden: admin }),
    fetchSeries(),
    /* Wie im Figurenkatalog: ein Administrator bekommt keine Angebote —
       sein Weg zum Preis ist /business/inventory (ADR-0042). */
    admin ? Promise.resolve(new Map()) : fetchOffers(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-10 md:pt-12">
      <AccessoryView
        items={items}
        series={series}
        admin={admin}
        /* Ein einfaches Objekt: eine `Map` überlebt die Grenze
           Server → Client nicht und käme leer an. */
        offers={offerRecord(offers)}
      />
    </main>
  );
}
