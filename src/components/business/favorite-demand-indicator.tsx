/**
 * Wie viele Konten eine Figur vorgemerkt haben — als eine Zeile Text.
 *
 * WOFÜR. Beim Ankauf und beim Durchsehen des Lagers ist „wie viele suchen
 * das" eine der wenigen Zahlen, die eine Entscheidung tragen: welche Figur
 * kaufe ich bevorzugt an, welche Lagerposition hat Interessenten. Sie steht
 * deshalb dort, wo diese Entscheidung fällt, und nicht in einer eigenen
 * Ansicht.
 *
 * WAS SIE NICHT BEHAUPTET. Ein Favorit ist eine Vormerkung, keine
 * Kaufabsicht. Die Beschriftung heißt „vorgemerkt" — nicht „Käufer", nicht
 * „Interessenten", nicht „wartet". Die Zahl stützt eine Einschätzung; sie
 * verspricht keinen Verkauf.
 *
 * KEINE EIGENE ABFRAGE. Diese Komponente bekommt eine Zahl und zeichnet sie.
 * Geladen wird gebündelt, einmal je Ansicht, von `fetchFavoriteDemand()` —
 * eine Abfrage je Figur wären im Picker hunderte Anfragen.
 *
 * NULL ZEIGT NICHTS. Die meisten Figuren haben keinen Favoriten, und 500
 * Nullen in einer Liste sind kein Befund, sondern Rauschen. `null` und
 * `undefined` ebenfalls nichts: „nicht geladen" ist nicht dasselbe wie
 * „niemand", und eine 0 für etwas Unbekanntes wäre eine Behauptung.
 *
 * KEINE BREITE, DIE SIE NICHT BRAUCHT. `shrink-0` und `whitespace-nowrap`,
 * damit sie in einer vorhandenen Zeile mitfährt statt eine Spalte zu
 * erzwingen; die Beschriftung erscheint erst ab `sm:`, weil auf dem Telefon
 * die Zahl neben dem Herz genügt und der vollständige Satz als `title` und
 * für Hilfstechnik daneben steht.
 */
import { de } from "@/lib/i18n/de";

const copy = de.favorites;

/** Dasselbe Herz wie an der Katalogkarte und in der Navigationsleiste. */
const HERZ =
  "M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1"
  + "C19.5 15.9 12 20.5 12 20.5Z";

export function FavoriteDemandIndicator({
  count,
  className = "",
}: {
  /**
   * Wie viele Konten. `0`, `null` und `undefined` zeichnen nichts — siehe
   * oben, die drei bedeuten nicht dasselbe, aber keiner von ihnen ist eine
   * Auskunft, die eine Zeile verdient.
   */
  count: number | null | undefined;
  className?: string;
}) {
  /*
   * DREI BEDINGUNGEN, UND JEDE EINE ANDERE.
   *
   * `typeof` schliesst `null` und `undefined` aus — und zwar so, dass
   * TypeScript es auch sieht: `Number.isFinite` allein verengt den Typ
   * nicht, und die Zeilen unten bekamen dann `number | null | undefined`.
   *
   * `Number.isFinite` faengt `NaN` ab. `NaN` IST eine Zahl, und `NaN <= 0`
   * ist falsch — die erste Fassung haette „NaN vorgemerkt" gezeichnet.
   * Gefunden vom Test dieser Datei, nicht im Browser.
   *
   * `<= 0` ist der eigentliche Fall: die meisten Figuren haben keinen
   * Favoriten.
   */
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;

  return (
    <span
      /*
       * `title` UND ein unsichtbarer Satz: der `title` ist für die Maus, der
       * `sr-only`-Text für eine Hilfstechnik. Die sichtbare Zahl bleibt
       * damit kurz, ohne ihre Bedeutung zu verlieren.
       */
      title={copy.demandFull(count)}
      className={
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs "
        + "tabular-nums text-favorite-ink "
        + className
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3 w-3 shrink-0"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={HERZ} />
      </svg>
      <span aria-hidden="true">{copy.demandShort(count)}</span>
      {/* Erst ab `sm:` — auf dem Telefon ist die Zeile des Pickers eng, und
          die Zahl neben dem Herz sagt dort genug. */}
      <span aria-hidden="true" className="hidden sm:inline">{copy.demandLabel}</span>
      <span className="sr-only">{copy.demandFull(count)}</span>
    </span>
  );
}
