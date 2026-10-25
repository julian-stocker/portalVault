/**
 * Das Herz an einer Katalogkarte (0145, ADR-0136).
 *
 * WARUM DIESE KOMPONENTE NICHT IM KARTENKOERPER SITZT — die eine Sache, die
 * man hier wissen muss. Seit ADR-0038 IST die gesamte Kartenflaeche der
 * Sammeln-Toggle. Ein Herz als Kind dieses Koerpers wuerde beim Antippen die
 * Figur sammeln; mit `stopPropagation()` haette man zwei Dinge, die
 * gleichzeitig auf denselben Klick hoeren, und eine Regel darueber, welches
 * gewinnt.
 *
 * Deshalb liegt es in der GESCHWISTER-EBENE ueber der Karte, die
 * `FigureCard` fuer die Angebotszeile schon haelt: ein `absolute inset-0`
 * Raster mit `pointer-events-none`, dessen Slots sich die Klicks einzeln
 * zurueckholen. Dieselbe Loesung, die „Info" und die Angebotszeile seit V3.2
 * benutzen, und sie braucht kein Event-Handling.
 *
 * ENDZUSTAND, NICHT UMSCHALTEN (ADR-0027). Ein Herz ist klein, und auf einem
 * Telefon wird es doppelt getippt. `setFavorite(skyId, desired)` sagt, was
 * gelten soll — zweimal dasselbe gesagt ist dasselbe. Das Gegenstueck im
 * Server ist `0145`: `(user_id, sky_id)` ist der Primaerschluessel, und ein
 * doppeltes `insert` gilt dort als Erfolg.
 *
 * UND DER OPTIMISTISCHE ZUSTAND WIRD ZURUECKGENOMMEN, WENN DER SERVER
 * WIDERSPRICHT. Ein falsches Herz auf dem Schirm ist schlimmer als eine
 * Fehlermeldung: es behauptet, etwas sei gespeichert. Scheitert der Aufruf,
 * springt die Anzeige zurueck UND die Karte sagt es.
 */
"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { setFavorite } from "@/lib/favorites/actions";
import { de } from "@/lib/i18n/de";

/**
 * Das Symbol. Gefuellt oder nur umrissen — derselbe Pfad, zwei Fuellungen.
 *
 * Eine Form fuer beide Zustaende ist Absicht: ein gefuelltes und ein leeres
 * Herz liest man am selben Ort als denselben Gegenstand in zwei Zustaenden.
 * Zwei verschiedene Umrisse waeren zwei Gegenstaende.
 */
function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          "M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1" +
          "C19.5 15.9 12 20.5 12 20.5Z"
        }
      />
    </svg>
  );
}

/*
 * DIE TRAGFLAECHE, und sie ist groesser als das Symbol.
 *
 * Das Herz zeichnet 14 px, der Knopf misst 36 px. Auf einem Telefon ist das
 * der Unterschied zwischen „getroffen" und „die Karte hat gesammelt, weil
 * ich daneben kam" — und daneben liegt hier wirklich der Sammeln-Toggle.
 * 36 px ist unter den 44 px, die Apple empfiehlt, und so gross, wie es neben
 * dem Variantensiegel auf einer 211-px-Karte sein kann; der Abstand zum
 * Kartenrand kommt dazu.
 */
const KNOPF =
  "pointer-events-auto grid h-9 w-9 place-items-center rounded-full " +
  "bg-black/45 backdrop-blur-[2px] transition " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-white";

/** Das Symbol darin — klein, damit die Flaeche nicht wie ein Knopf aussieht. */
const SYMBOL = "h-[14px] w-[14px]";

export function FavoriteHeart({
  skyId,
  initialFavorited,
  signInHref,
  onFavoritedChange,
}: {
  skyId: string;
  initialFavorited: boolean;
  /** `null`, wenn jemand angemeldet ist; sonst der Weg in die Anmeldung. */
  signInHref: string | null;
  /**
   * Sagt der Seite, was dieses Herz gerade getan hat.
   *
   * Dafuer da, dass die Wunschliste die Karte im SELBEN Bild verlieren kann:
   * entfernt heisst dort, dass sie nicht mehr dazugehoert. Im Katalog ist es
   * dieselbe Meldung und bleibt folgenlos — die Liste dort filtert nicht
   * nach Favoriten.
   *
   * Es wird AUCH bei einem Fehlschlag gerufen, mit dem alten Wert. Das ist
   * der Teil, der zaehlt: eine Karte, die aus der Wunschliste verschwunden
   * ist, weil ein Aufruf scheiterte, muss zurueckkommen.
   */
  onFavoritedChange?: (skyId: string, favorited: boolean) => void;
}) {
  const [favorited, setLocal] = useState(initialFavorited);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * DER ZULETZT GEAEUSSERTE WUNSCH, und warum er nicht im State steht.
   *
   * Zwei Tipps im SELBEN React-Takt lesen beide denselben State — React hat
   * zwischen ihnen nicht neu gezeichnet. Beide rechneten dann `!false` und
   * schickten zweimal „vorgemerkt": aus „an, wieder aus" wuerde „an, an".
   * Nicht falsch im Ergebnis, aber nicht, was ein Doppeltipp bedeutet.
   *
   * Gefunden hat es `favorite-interaction.test.tsx`, indem es zwei Klicks in
   * einem `act` abschickt. Auf einem Telefon liegen echte Tipps weiter
   * auseinander, und dann hat React dazwischen gezeichnet — der Fall ist
   * also selten, aber er ist der Fall, fuer den die Endzustandssemantik da
   * ist. Eine Referenz ist sofort aktuell, also bleibt der naechste Tipp die
   * Umkehrung des vorigen, auch im selben Takt.
   *
   * `setCollected` hat dieselbe Stelle und bisher dasselbe Verhalten
   * (`collect-button.tsx`). Das wird hier NICHT mitgeaendert: die Sammlung
   * ist nicht Teil dieses Auftrags.
   */
  const wunsch = useRef(initialFavorited);

  /*
   * AUSGELOGGT IST DAS HERZ EIN LINK (ADR-0027).
   *
   * Dasselbe Verhalten wie am Sammeln: der Besucher landet in der Anmeldung
   * und kommt in denselben Kontext zurueck — dieselbe Serie, dieselbe Suche.
   * Die Aktion wird danach ABSICHTLICH nicht nachgeholt. Ein Herz, das sich
   * nach einer Anmeldung von selbst setzt, hat etwas gespeichert, worum
   * niemand in diesem Moment gebeten hat.
   */
  if (signInHref) {
    return (
      <Link href={signInHref} aria-label={de.catalog.favoriteSignedOut}
            title={de.catalog.favoriteSignedOut}
            className={`${KNOPF} text-white/70 hover:bg-black/60 hover:text-white`}>
        <span className={SYMBOL}><HeartGlyph filled={false} /></span>
      </Link>
    );
  }

  function onClick() {
    const desired = !wunsch.current;
    wunsch.current = desired;
    setLocal(desired);                     // optimistisch
    onFavoritedChange?.(skyId, desired);
    setFailed(false);

    startTransition(async () => {
      const result = await setFavorite(skyId, desired);
      if (!result.ok) {
        /*
         * ZURUECK, UND ZWAR AN BEIDEN STELLEN.
         *
         * Nur das Herz zurueckzusetzen genuegt nicht: auf der Wunschliste
         * ist die Karte dann schon aus der Liste gefallen, und ein Herz, das
         * niemand mehr sieht, kann nichts richtigstellen. Deshalb geht die
         * Meldung auch nach oben — die Karte kommt zurueck.
         */
        wunsch.current = !desired;
        setLocal(!desired);
        onFavoritedChange?.(skyId, !desired);
        setFailed(true);
      }
    });
  }

  const hinweis = favorited ? de.catalog.unfavoriteHint : de.catalog.favoriteHint;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={favorited}
      aria-label={hinweis}
      title={hinweis}
      /*
       * Nicht `disabled` waehrend des Fluges, mit Absicht: ein Knopf, der
       * unter dem Finger abschaltet, verliert den zweiten Tipp. Der
       * Endzustand oben haelt beide aus.
       */
      aria-busy={pending || undefined}
      className={
        `${KNOPF} ${pending ? "opacity-70" : ""} ` +
        (failed
          ? "text-danger ring-1 ring-danger"
          : favorited
            ? "text-[#ff7b8a] hover:bg-black/60"
            : "text-white/70 hover:bg-black/60 hover:text-white")
      }
    >
      <span className={SYMBOL}><HeartGlyph filled={favorited} /></span>
      {/* Der Zustand steht in `aria-pressed`; dies ist der Satz, der ihn
          ausspricht, falls eine Hilfstechnik ihn nicht vorliest. */}
      <span className="sr-only">
        {favorited ? de.catalog.favorited : de.catalog.favorite}
        {failed ? ` — ${de.catalog.favoriteFailed}` : ""}
      </span>
    </button>
  );
}
