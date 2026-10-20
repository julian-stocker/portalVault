import type { Metadata } from "next";

import { AccessoryView } from "@/components/catalog/accessory-view";
import { fetchAccessoryCatalog, fetchSeries } from "@/lib/catalog/queries";
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
 * KEINE SAMMLUNG, KEIN SHOP. Diese Seite fragt weder `fetchOwnedSkyIds()`
 * noch `fetchOffers()` — nicht aus Sparsamkeit, sondern weil beide Antworten
 * für Zubehör nein lauten und eine Anzeige davon etwas versprechen würde,
 * das `isCollectible()` und `is_shop_eligible()` ablehnen (ADR-0128).
 */
export default async function AccessoryPage() {
  const admin = await isAdmin();
  const [items, series] = await Promise.all([
    fetchAccessoryCatalog({ includeHidden: admin }),
    fetchSeries(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-10 md:pt-12">
      <AccessoryView items={items} series={series} admin={admin} />
    </main>
  );
}
