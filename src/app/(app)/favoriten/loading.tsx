/**
 * Was die Wunschliste zeigt, sobald jemand sie anfordert.
 *
 * DIESE DATEI IST DER GRUND, DASS DER NAVIGATIONSPUNKT SOFORT REAGIERT.
 * `/favoriten` ist eine dynamische Route, und Next.js überspringt das
 * Prefetching einer dynamischen Route vollständig, solange sie keine
 * `loading`-Grenze hat — ein Klick müsste dann erst eine ganze
 * Serverrunde abwarten, bevor sich auf dem Schirm etwas ändert. Dieselbe
 * Messung und derselbe Schluss wie bei `/collection` (V4.4).
 *
 * Gezeigt wird der eigene Kopf der Seite und ein Kartenraster als Gerüst,
 * kein Spinner: der Punkt ist, dass man in den Favoriten ANGEKOMMEN ist und
 * sie noch füllen, nicht dass etwas kreist.
 *
 * Alles hier ist statisches Markup — keine Daten, keine Client-Komponente —,
 * also erreicht es den Browser im ersten Schub, bevor eine Abfrage
 * geantwortet hat.
 */
import { de } from "@/lib/i18n/de";

/* Zwölf Platzhalter, nicht alle: sichtbar sein muss die Struktur, und ein
   Telefonschirm hält etwa so viele. */
const KARTEN = Array.from({ length: 12 }, (_, index) => index);

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold md:text-3xl">{de.favorites.title}</h1>
        <p className="mt-1 text-sm text-muted">{de.favorites.subline}</p>
      </header>
      <div
        className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        aria-busy="true"
        aria-label={de.favorites.loading}
      >
        {KARTEN.map((i) => (
          <span
            key={i}
            aria-hidden="true"
            /* Dasselbe Seitenverhältnis wie eine Katalogkarte, damit das
               Gerüst nicht springt, wenn die echten Karten eintreffen. */
            className="block aspect-[211/330] rounded-sky-md bg-white/10"
          />
        ))}
      </div>
    </main>
  );
}
