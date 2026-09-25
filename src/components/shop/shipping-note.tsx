/**
 * Was zum Preis noch dazukommt — ein Satz, überall derselbe.
 *
 * WARUM ES DIESE KOMPONENTE GIBT
 *
 * Gekauft werden kann an zwei Stellen: im Angebotsblock der Figurenseite und
 * in der Schnellansicht des Katalogs. Beide zeigten bisher einen Preis und
 * einen Kaufknopf, aber nirgends stand, dass Versand hinzukommt — der Hinweis
 * lag eine Seite weiter unter `/versand`. Zwei Flächen mit demselben
 * Rechtsgehalt sind genau der Fall, in dem zwei Textfassungen mit der Zeit
 * auseinanderlaufen, also gibt es hier nur eine.
 *
 * DER BETRAG IST NIE GESCHRIEBEN. `freeFrom` kommt aus
 * `fetchFreeShippingFrom()`, also aus `shipping_free_from()` — derselben
 * Funktion, aus der `/versand` und das Shop-Intro lesen. Ist sie nicht
 * lesbar, steht der Satz ohne Zahl. Ein erfundener Schwellenwert neben einem
 * Preis wäre eine falsche Aussage über den Gesamtbetrag, kein Schönheitsfehler.
 *
 * ZWEI TÖNE, EIN TEXT. Die Figurenseite steht auf hellem Grund, die
 * Schnellansicht auf dunklem; unterschiedlich sind nur die beiden
 * Farb-Tokens, nicht der Satz.
 */
import Link from "next/link";

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function ShippingNote({
  freeFrom,
  tone = "default",
}: {
  /** Warenwert, ab dem der Versand entfällt — oder `null`, wenn unbekannt. */
  freeFrom: number | null;
  /** `deep` für die Schnellansicht, die auf dunklem Grund liegt. */
  tone?: "default" | "deep";
}) {
  const muted = tone === "deep" ? "text-on-deep-muted" : "text-muted";
  const hover = tone === "deep" ? "hover:text-on-deep" : "hover:text-fg";

  return (
    <p className={`text-[11px] leading-snug ${muted}`}>
      {freeFrom === null ? de.shop.shippingNoteBare : de.shop.shippingNote(formatPrice(freeFrom))}{" "}
      <Link href="/versand" className={`underline underline-offset-2 ${hover}`}>
        {de.shop.shippingLink}
      </Link>
    </p>
  );
}
