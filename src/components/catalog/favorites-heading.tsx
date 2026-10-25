/**
 * Der Kopf der Wunschliste (ADR-0136).
 *
 * WARUM EINE EIGENE KOMPONENTE UND NICHT NUR MARKUP IN DER SEITE. Sie geht
 * als `heading` in `CatalogView` und sitzt damit INNERHALB des Blocks, den
 * die Weltkulisse hinterlegt — dieselbe Stelle, an der der Katalogkopf
 * steht, mit derselben Breitenbegrenzung und denselben Textschatten. Als
 * Markup in der Seite stünde sie darüber, auf eigenem Grund, und schnitte
 * ein Rechteck in die Kulisse (dieselbe Begründung wie in `CatalogView`:
 * ADR-0038, V3.3).
 *
 * Bis zum 2026-10-25 stand hier „Skylanders Katalog", weil `CatalogView`
 * ihren Kopf selbst mitbrachte. Das war der Preis dafür, die ganze
 * Katalogmechanik wiederzuverwenden — und er musste nicht bezahlt werden:
 * ein Slot genügt.
 *
 * KEINE EIGENE RECHNUNG. Die drei Zahlen kommen fertig von der Seite, die
 * sie aus `hasV1BuyableOffer()` bildet — derselben Funktion, die die
 * Angebotszeile jeder Karte und die Schnellansicht benutzen. Diese
 * Komponente zählt nichts.
 */
import { de } from "@/lib/i18n/de";

/**
 * Eine Kennzahl. Zahl oben, Beschriftung darunter.
 *
 * `tabular-nums`, damit drei Kacheln nebeneinander nicht wandern, wenn aus
 * einer 9 eine 10 wird.
 */
function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div
      className={
        // Ein ruhiger Stein in der Welt, kein Panel: dieselbe Sprache wie
        // das Suchfeld darunter — dunkel, hauchfein gerandet, verwaschen.
        "flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sky-md "
        + "bg-deep/70 px-3 py-2 ring-1 ring-border-strong/60 backdrop-blur-sm "
        + "sm:px-4 sm:py-2.5"
      }
    >
      <span className={`text-xl leading-none font-semibold tabular-nums sm:text-2xl ${tone}`}>
        {value}
      </span>
      <span className="text-[11px] leading-tight text-on-deep-muted sm:text-xs">{label}</span>
    </div>
  );
}

export function FavoritesHeading({
  total,
  withOffer,
}: {
  /** Wie viele Figuren vorgemerkt sind. */
  total: number;
  /**
   * Wie viele davon ein TATSAECHLICH kaufbares, oeffentliches Angebot haben.
   *
   * Gezaehlt mit `hasV1BuyableOffer()` — veroeffentlicht, lose, bepreist,
   * auf Lager. „Ohne Angebot" ist die Differenz und wird hier gebildet,
   * damit die beiden Zahlen nicht aus zwei Rechnungen stammen koennen.
   */
  withOffer: number;
}) {
  const withoutOffer = total - withOffer;

  return (
    <>
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

      {/*
       * DREI KACHELN IN EINER ZEILE, auch auf dem Telefon.
       *
       * `flex-1` mit `min-w-0`, also drei gleich breite Kacheln statt eines
       * Umbruchs: auf 360 px bleiben je gut 100 px, und darin stehen eine
       * zweistellige Zahl und ein Wort mit 11 px bequem. Ein Umbruch haette
       * zwei oben und eine allein darunter ergeben — das liest sich als
       * „die dritte ist etwas anderes", und sie ist es nicht.
       *
       * `role="group"` statt einer Liste: es sind drei Teile EINER Auskunft,
       * keine Aufzaehlung.
       */}
      <div
        role="group"
        aria-label={de.favorites.statsLabel}
        className="mt-4 flex items-stretch gap-2 sm:gap-3"
      >
        <Stat value={total} label={de.favorites.statTotal} tone="text-on-deep" />
        {/* Korall, wie das gefuellte Herz: dies ist die Zahl, auf die jemand
            wartet. */}
        <Stat value={withOffer} label={de.favorites.statWithOffer}
              tone="text-favorite-ink" />
        <Stat value={withoutOffer} label={de.favorites.statWithoutOffer}
              tone="text-on-deep-muted" />
      </div>
    </>
  );
}
