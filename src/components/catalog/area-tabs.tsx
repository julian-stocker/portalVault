/**
 * Die oberste Ebene des Katalogs: Figuren oder Zubehör (ADR-0128).
 *
 * DREI EBENEN, UND DIESE IST DIE ERSTE.
 *
 *   A  Bereich   Figuren · Zubehör   — diese Datei, ein Seitenwechsel
 *   B  Serie     Trap Team           — `SeriesTabs`, innerhalb der Figuren
 *   C  Gruppe    Fallen, Fahrzeuge   — `ProductGroupTabs`, darunter
 *
 * Sie steht deshalb ÜBER der Serienleiste und trägt dieselben Pillen wie
 * diese, nur eine Spur größer: `text-sm` statt `text-[13px]`. Zwei
 * Formensprachen für zwei Navigationsebenen wären eine zu viel.
 *
 * VERWEISE, KEINE KNÖPFE. Die beiden Bereiche sind zwei Seiten — `/` und
 * `/zubehoer` —, und ein Bereich, den man anklicken kann, gehört in die
 * Adresszeile: er ist teilbar, er ist ein Lesezeichen, und der Zurück-Knopf
 * des Browsers tut, was er soll. `aria-current="page"` sagt derselben
 * Hilfstechnik, wo sie steht, der die Farbe nichts sagt.
 *
 * KEIN ZUSTAND, KEIN HOOK. Welcher Bereich aktiv ist, weiß die Seite, die
 * diese Leiste rendert — sie übergibt es. Damit funktioniert die Leiste in
 * einer Server- wie in einer Client-Komponente, und es gibt keinen zweiten
 * Ort, an dem „wo bin ich" entschieden wird.
 *
 * NICHT IN DER HAUPTNAVIGATION. Die hat drei Ziele und behält sie
 * (ADR-0036); Zubehör ist ein Teil des Katalogs, kein vierter Bereich der
 * Plattform.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";

export type CatalogArea = "figures" | "accessories";

const BEREICHE: readonly { area: CatalogArea; href: string; label: string }[] = [
  { area: "figures", href: "/", label: de.catalog.areaFigures },
  { area: "accessories", href: "/zubehoer", label: de.catalog.areaAccessories },
];

export function CatalogAreaTabs({ active }: { active: CatalogArea }) {
  return (
    <nav
      aria-label={de.catalog.areaNav}
      /* Waagrecht scrollbar wie die Serienleiste — bei zwei Einträgen kommt
         es nie dazu, aber die Regel bleibt dieselbe, falls ein dritter
         Bereich entsteht. */
      className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      {BEREICHE.map((bereich) => {
        const isActive = bereich.area === active;
        return (
          <Link
            key={bereich.area}
            href={bereich.href}
            aria-current={isActive ? "page" : undefined}
            className={
              "flex min-h-11 shrink-0 snap-start items-center rounded-full px-4 text-sm " +
              "whitespace-nowrap shadow-card backdrop-blur-sm transition-colors " +
              (isActive
                ? "bg-status-ground font-semibold text-status-ink ring-1 ring-status-line"
                : "bg-deep/65 font-normal text-muted ring-1 ring-border/70 " +
                  "hover:text-foreground hover:ring-border-strong")
            }
          >
            {bereich.label}
          </Link>
        );
      })}
    </nav>
  );
}
