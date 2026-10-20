/**
 * Eine Zubehörkachel — Spiel, Portal, und was sonst keine Figur ist.
 *
 * EIN EIGENES KACHELDESIGN, UND ZWAR ABSICHTLICH.
 *
 * Die Figurenkarte ist eine Sammelkarte: eine Artwork-Vorlage, ein Fenster
 * für das Foto, Element, Charakter, Variante, Besitzsiegel, Marktpreis
 * (ADR-0038). Für ein Portal ist jede dieser Antworten leer oder falsch, und
 * eine Sammelkarte zur Hälfte leer sieht aus wie ein Fehler. Diese Kachel
 * nimmt deshalb die Formensprache der Seite — dieselbe Bildbühne, dieselben
 * Ecken, dieselben Ringe — aber nicht die Vorlage. **An `FigureCard` ändert
 * sich nichts.**
 *
 * ---------------------------------------------------------------------------
 * DIE BILDBÜHNE IST DA, BEVOR ES BILDER GIBT
 *
 * `bg-plate` ist dieselbe Bühne, auf der die 475 Figurenfotos stehen. Steht
 * eines Tages ein Produktfoto in `image_file`, fällt es genau hierhin, ohne
 * dass sich am Raster etwas verschiebt.
 *
 * Solange keines da ist, steht dort die ART in grossen, weit gesperrten
 * Lettern — `SPIEL`, `PORTAL`. Das ist ausdrücklich KEIN Platzhalter, der
 * ein Foto vortäuscht: es ist Schrift, es ist wahr, und niemand hält es für
 * eine Aufnahme. Eine graue Fläche mit einem Kamerasymbol hätte behauptet,
 * hier fehle etwas; hier fehlt nichts, es gibt nur noch kein Bild.
 *
 * KEIN SAMMELN, KEIN SIEGEL, KEIN FORTSCHRITT (ADR-0128). Die Kachel trägt
 * keinen Knopf, der eine Sammlung ändert, und kein Besitzsiegel — Zubehör
 * gehört nicht in eine Sammlung, und ein Steuerelement, das es trotzdem
 * anbietet, wäre eine Falle.
 * ---------------------------------------------------------------------------
 */
import { accessoryDetail } from "@/lib/catalog/accessory-facts";
import { itemTypeOf } from "@/lib/catalog/item-type";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import type { Offer } from "@/lib/shop/offer";
import { de } from "@/lib/i18n/de";

const copy = de.accessories;
const markLabels = de.inventory.itemTypes;

export function AccessoryCard({
  item,
  seriesScope,
  offers = [],
  admin = false,
}: {
  item: CatalogFigure;
  /**
   * Alle Serien, für die der Artikel gilt — bei `SKY-0637` drei.
   * Die eingeordnete steht vorn; die übrigen werden als Zusatz genannt.
   */
  seriesScope: readonly string[];
  /**
   * Was SkyIsles für diesen Artikel anbietet — heute immer nichts.
   *
   * `shop_offers()` schliesst Zubehör am Artikeltyp aus (`0135`), also ist
   * diese Liste leer und die Kachel sagt „Aktuell kein Angebot". Sie wird
   * trotzdem schon durchgereicht: wenn Zubehör eines Tages angeboten werden
   * darf, füllt sich dieselbe Stelle, ohne dass eine Kachel umgebaut wird.
   * Die Entscheidung darüber ist eine eigene (ADR-0128, Punkt 8).
   */
  offers?: readonly Offer[];
  /** Nur für die Kennzeichnung einer ausgeblendeten Zeile. */
  admin?: boolean;
}) {
  const art = itemTypeOf(item);
  const detail = accessoryDetail(item);
  const guenstigstes = offers.reduce<Offer | null>(
    (beste, o) => (beste === null || o.price < beste.price ? o : beste), null);
  /* Weitere Serien, für die dieses Portal laut Arbeitsmappe gilt. */
  const weitere = seriesScope.slice(1);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-sky-lg bg-surface/80 ring-1 ring-border/70 transition-colors hover:ring-border-strong">
      {/*
        DIE BÜHNE. Festes Seitenverhältnis, damit das Raster ruhig bleibt —
        mit Bild wie ohne. `aspect-[4/3]` statt des hochkanten Figurenformats:
        ein Spiel ist eine Hülle und ein Portal eine flache Scheibe.
      */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-plate">
        <span
          aria-hidden="true"
          className="text-[clamp(11px,7cqw,15px)] font-semibold tracking-[0.22em] text-on-plate-muted uppercase"
        >
          {markLabels[art] ?? art}
        </span>
        {/* Die Art auch als Marke oben links — sie bleibt lesbar, wenn hier
            eines Tages ein Foto steht. */}
        <span className="absolute top-1.5 left-1.5 rounded-sky-sm bg-deep/70 px-1.5 py-0.5 text-[0.6875rem] font-medium tracking-wide text-on-deep-muted uppercase backdrop-blur-sm">
          {markLabels[art] ?? art}
        </span>
        {admin && !item.catalogVisible ? (
          <span className="absolute top-1.5 right-1.5 rounded-sky-sm bg-deep/70 px-1.5 py-0.5 text-[0.6875rem] text-on-deep-muted backdrop-blur-sm">
            {copy.hiddenMark}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        {/* Der Name darf umbrechen, aber nicht wachsen: zwei Zeilen, dann
            Auslassung. Abgeschnittene Namen mitten im Wort gibt es nicht. */}
        <p className="line-clamp-2 text-sm leading-tight font-medium" title={item.displayName}>
          {item.displayName}
        </p>

        {/* Plattform oder Modellnummer — die Angabe, die den Artikel genau
            bestimmt. Fehlt sie, steht hier nichts. */}
        {detail !== null ? (
          <p className="truncate text-xs font-medium text-foreground">{detail}</p>
        ) : null}

        <p className="truncate text-xs text-muted">
          {item.seriesLabel}
          {weitere.length > 0 ? (
            /* `SKY-0637` gilt für drei Serien. Die Einordnung steht vorn,
               die übrigen daneben — ohne zu behaupten, es seien drei
               Artikel. */
            <span className="text-muted"> · {copy.alsoFor(weitere.join(", "))}</span>
          ) : null}
        </p>

        {/* Die SKY-ID zuletzt und am leisesten: eine Zusatzangabe, keine
            Überschrift. */}
        <p className="truncate font-mono text-[0.6875rem] text-muted">{item.skyId}</p>

        {/*
          DAS ANGEBOT, oder sein Fehlen. Heute immer das Fehlen: Zubehör ist
          nicht shopfähig (`is_shop_eligible()` seit `0135`). Der Satz sagt
          das ruhig, statt eine Leerstelle zu lassen.
        */}
        <p className="mt-auto pt-1.5 text-xs">
          {guenstigstes === null ? (
            <span className="text-muted">{copy.noOffer}</span>
          ) : (
            <span className="font-semibold text-foreground">
              {formatPrice(guenstigstes.price)}
              {guenstigstes.available ? "" : ` · ${copy.soldOut}`}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
