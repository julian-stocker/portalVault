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

/** Der eine Pfad. Derselbe in der Navigationsleiste (`nav-glyphs.tsx`). */
const HERZ =
  "M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1"
  + "C19.5 15.9 12 20.5 12 20.5Z";

/**
 * KEINE PLATTE, SONDERN EIN HALO — die eine Entscheidung dieser Komponente.
 *
 * Das Herz liegt ueber dem Artwork im Kartenfenster, und das Artwork ist
 * nicht eine Farbe: `standard` ist elfenbeinhell, `dark` und `legendary`
 * sind dunkel, `chase` und `prestige` sind Ornament. Ein weisser Umriss
 * verschwindet auf dem hellen, ein dunkler auf dem dunklen.
 *
 * Die erste Fassung loeste das mit einer dauerhaft sichtbaren grauen Scheibe
 * (`bg-black/45`) — lesbar, aber ein 36-px-Knopf auf jeder von bis zu 561
 * Karten, und damit das Erste, was man im Raster sieht. Fuer ein Herz, das
 * leise sein soll, war das die falsche Loesung.
 *
 * Stattdessen traegt der GLYPH selbst seinen Kontrast: ein enger dunkler
 * Schatten direkt am Umriss trennt ihn vom Hintergrund, auf hellem Grund
 * wie auf dunklem, und er kostet keine Flaeche. Dieselbe Technik, mit der
 * die Ueberschrift des Katalogs in der Welt steht, nur in klein.
 *
 * Eine Form fuer beide Zustaende ist Absicht: ein gefuelltes und ein leeres
 * Herz liest man am selben Ort als denselben Gegenstand in zwei Zustaenden.
 * Zwei verschiedene Umrisse waeren zwei Gegenstaende.
 */
const HALO_LEER = "drop-shadow(0 0 2px rgb(10 9 24 / 0.95)) "
  + "drop-shadow(0 0 1px rgb(10 9 24 / 0.9)) "
  + "drop-shadow(0 1px 3px rgb(10 9 24 / 0.65))";
/* Gefuellt kommt das Leuchten dazu — dezent, siehe `--favorite-glow`. */
const HALO_VOLL = "drop-shadow(0 0 1.5px rgb(10 9 24 / 0.8)) "
  + "drop-shadow(0 0 8px var(--favorite-glow))";

function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 1.3 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter: filled ? HALO_VOLL : HALO_LEER }}
    >
      <path d={HERZ} />
    </svg>
  );
}

/*
 * DREI MASSE, UND JEDES HAT EINEN GRUND. Gemessen an den echten Karten, nicht
 * geschaetzt — `src/lib/favorites/geometry.test.ts` rechnet sie aus
 * `CARD_ASPECT`, `ROWS` und `INSET` nach, fuer jeden Rasterpunkt.
 *
 * DAS SYMBOL: 22 px, FEST.
 *
 * Es zeichnete 14 px, und das war auf einem Laptop zu klein: eine Karte ist
 * dort 268 px breit (vier Spalten in `max-w-6xl`), 14 px sind davon **5,2 %**
 * — auf den drei Bash-Karten nebeneinander kaum noch als Bedienelement zu
 * erkennen. 22 px sind 8,2 % dort und 12,7 % auf dem Telefon.
 *
 * FEST und nicht in `cqw`: die Karte schrumpft von 268 auf 173 px, und ein
 * mitschrumpfendes Herz waere genau dort am kleinsten, wo der Finger am
 * groebsten ist. Alles andere auf dieser Karte skaliert mit der Breite, weil
 * es TEXT ist; ein Bedienelement folgt dem Finger, nicht der Typografie.
 *
 * DIE FLAECHE: 44 px, UNSICHTBAR.
 *
 * Die Zahl ist Apples Empfehlung, und die vorige Fassung lag mit 36 px
 * darunter. Sie passt in jedes Fenster: das kleinste misst 136 × 112 px
 * (Telefon, 173-px-Karte), das grosse 210 × 173 px.
 *
 * DER GLYPH SITZT IN DER ECKE DER FLAECHE, nicht in ihrer Mitte — und das ist
 * der Teil, der ohne Nachrechnen falsch wird. Zentriert waere das Herz 11 px
 * weiter innen als die Flaeche, also 11 px vom Fensterrand weg gewandert,
 * sobald die Flaeche groesser wird. So bleibt es, wo es hingehoert, und die
 * zusaetzliche Flaeche waechst nach unten links INS BILD — dorther kommt der
 * Daumen, und dort ist kein Rahmen.
 *
 * DER ABSTAND ZUR ECKE IST 6 PX und steckt im Polster des Hover-Kreises, nicht
 * mehr zusaetzlich am Knopf. Vorher waren es 4 + 5 = 9 px, und zusammen mit
 * einem Slot, der beim Bildpolster statt an der Fensteroeffnung lag, sass das
 * Herz 16 bis 18 px innerhalb der Rahmenkante. `figure-card.tsx` setzt die
 * Flaeche jetzt absolut auf eine GEMESSENE Stelle und zieht genau diese 6 px
 * ab, damit der GLYPH dort landet und nicht der Kasten.
 *
 * Sichtbar wird sie erst, wenn jemand sie sucht: bei Hover und bei Fokus, und
 * dann als kleiner Kreis hinter dem GLYPH, nicht als 44-px-Scheibe. Im
 * Ruhezustand ist nur das Herz da, und die Karte bleibt eine Karte.
 */
const KNOPF =
  "group/fav pointer-events-auto flex h-11 w-11 items-start justify-end "
  + "focus-visible:outline-none";

/**
 * Der Kreis hinter dem Glyph — die einzige Flaeche, die je erscheint.
 *
 * Am GLYPH und nicht am Knopf: ein Grund hinter der ganzen 44-px-Flaeche waere
 * wieder die Scheibe, die hier gerade verschwunden ist, nur groesser. Der
 * Fokusring sitzt aus demselben Grund hier — ein Ring um eine unsichtbare
 * Flaeche umschliesst nichts, was man sieht.
 */
const GRUND =
  "grid place-items-center rounded-full p-1.5 transition-colors duration-150 "
  + "group-hover/fav:bg-white/16 group-focus-visible/fav:bg-white/16 "
  + "group-focus-visible/fav:outline group-focus-visible/fav:outline-2 "
  + "group-focus-visible/fav:outline-offset-1 group-focus-visible/fav:outline-white/90";

/** Das Symbol selbst. 22 px, siehe oben. */
const SYMBOL = "block h-[22px] w-[22px]";

/*
 * DIE ZWEI ZUSTAENDE, als Farbe.
 *
 * Leer: fast weiss, nicht ganz — reines Weiss auf einem hellen Artwork ist
 * eine Kante ohne Flaeche. Der Halo im Glyph traegt den Kontrast.
 * Gefuellt: `--favorite-ink`, das Korall des Wunsches. Nicht Gold: Gold
 * heisst Besitz, und das sagt die Karte selbst (V4.6).
 */
const LEER = "text-white/80 hover:text-white";
const VOLL = "text-favorite-ink";

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
  /*
   * Zaehlt jedes SETZEN, und sonst nichts. `0` heisst „noch nie in dieser
   * Sitzung gesetzt" — eine schon vorgemerkte Figur soll beim Laden der
   * Seite nicht aufpoppen, sondern einfach vorgemerkt sein.
   */
  const [animationKey, setAnimationKey] = useState(0);

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
            className={`${KNOPF} ${LEER}`}>
        <span className={GRUND}>
          <span className={SYMBOL}><HeartGlyph filled={false} /></span>
        </span>
      </Link>
    );
  }

  function onClick() {
    const desired = !wunsch.current;
    wunsch.current = desired;
    setLocal(desired);                     // optimistisch
    if (desired) setAnimationKey((n) => n + 1);
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
       *
       * UND AUCH NICHT ABGEDUNKELT. Hier stand `opacity-70`, solange der
       * Aufruf lief — und genau das machte die Bedienung traege: die Anzeige
       * stimmte sofort, aber das Herz wurde blass und wartete sichtbar auf
       * den Server. Ein optimistisches Update, das anschliessend „lade noch"
       * signalisiert, nimmt sich seinen eigenen Zweck. `aria-busy` bleibt —
       * es ist die Auskunft fuer eine Hilfstechnik, kein Effekt.
       */
      aria-busy={pending || undefined}
      className={`${KNOPF} ${failed ? "text-danger" : favorited ? VOLL : LEER}`}
    >
      <span className={GRUND}>
      <span
        className={SYMBOL}
        /*
         * DIE BEWEGUNG LAEUFT NUR BEIM SETZEN, und nur einmal.
         *
         * `animationKey` wechselt mit jedem Setzen, damit React das Element
         * neu einhaengt — sonst spielte die Animation beim zweiten Mal nicht
         * wieder. Beim ENTFERNEN wird sie bewusst nicht gestartet:
         * zuruecknehmen braucht keine Feier.
         *
         * Reduced Motion ist nicht hier geregelt, sondern einmal in
         * `globals.css` — die Regel dort setzt jede Animationsdauer auf
         * 0.01 ms, und zwar fuer alles, was Komponenten mitbringen.
         */
        key={animationKey}
        style={favorited && animationKey > 0
          ? { animation: "favorite-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1)" }
          : undefined}
      >
        <HeartGlyph filled={favorited} />
      </span>
      </span>
      {/* Der Zustand steht in `aria-pressed`; dies ist der Satz, der ihn
          ausspricht, falls eine Hilfstechnik ihn nicht vorliest. */}
      <span className="sr-only">
        {favorited ? de.catalog.favorited : de.catalog.favorite}
        {failed ? ` — ${de.catalog.favoriteFailed}` : ""}
      </span>
    </button>
  );
}
