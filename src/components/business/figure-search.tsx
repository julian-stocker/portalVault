/**
 * One compact figure picker, used everywhere a figure is chosen (0064).
 *
 * WHY ONE COMPONENT. There were three near-copies of this box: the create
 * screen had none, the detail page's `+ Artikel hinzufügen` had one, and the
 * remap panel inside the item list had another with a different result limit
 * and a different row layout. Three places to fix a ranking bug and three
 * chances for the operator to meet a search that behaves slightly differently
 * from the one they used a minute ago.
 *
 * NO REQUEST PER KEYSTROKE. The catalog is already in memory — the page
 * fetched it once — so this filters an array. That is why there is no
 * debounce and no request sequencing: there is no response that can come back
 * late and overwrite a newer one, because there is no response.
 *
 * KEYBOARD ON THE DESKTOP, THUMBS ON A PHONE. `ArrowUp`/`ArrowDown` move the
 * highlight, `Enter` takes it, `Escape` clears the query and then leaves.
 * Every row is 44 px. Deliberately not a full ARIA combobox: this is a text
 * input and a list of buttons, which screen readers already narrate, and the
 * project has no combobox primitive to reuse.
 */
"use client";

import { useId, useMemo, useRef, useState, type RefObject } from "react";

import { FavoriteDemandIndicator } from "@/components/business/favorite-demand-indicator";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  exactMatchIndex, isAccessory, matchFigures, MAX_RESULTS, moveHighlight, nextPage, searchState,
  type FigureChoice, type SearchOrder,
} from "@/lib/orderbook/figure-search";

const copy = de.business.orderbook.figures;

export function FigureSearch({
  catalog,
  onSelect,
  label = copy.searchLabel,
  placeholder = copy.search,
  autoFocus = false,
  disabled = false,
  onCancel,
  pageSize = MAX_RESULTS,
  order = "relevance",
  initialQuery = "",
  showImage = true,
  showDemand = false,
  loading = false,
  onFree,
  inputRef,
}: {
  catalog: readonly FigureChoice[];
  /** Called with the chosen row. The box clears itself and stays focused. */
  onSelect: (choice: FigureChoice) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Rendered as a quiet `Abbrechen` when the search is a mode, not a field. */
  onCancel?: () => void;
  /**
   * Wie viele Treffer zuerst zu sehen sind — eine SEITE, keine Obergrenze
   * (V2). Gibt es mehr, steht darunter „Weitere Treffer", und `ArrowDown`
   * auf der letzten Zeile blättert ebenfalls weiter. Bis V2 hieß das
   * `limit` und schnitt ab: „Punch Pop Fizz" stand im Kalkulator auf Platz
   * sieben von acht und war bei sechs sichtbaren Zeilen nicht erreichbar.
   */
  pageSize?: number;
  /** Relevanz (Orderbuch) oder Serie zuerst (Kalkulator), siehe `SearchOrder`. */
  order?: SearchOrder;
  /**
   * Vorbelegung des Suchfelds (0127).
   *
   * Fuer den Figurenwechsel: der heutige Name steht schon da, die Treffer
   * stehen sofort, und „Spyro aus Giants" ist ein Klick entfernt statt sechs
   * Tastendruecke. Leer ist der Normalfall — Einkaufs- und Verkaufsanlage
   * uebergeben ihn nicht und verhalten sich unveraendert.
   */
  initialQuery?: string;
  /*
   * Das Bild vor dem Namen. AN SEIT V2, überall: zuerst nur im Kalkulator
   * (man vergleicht ein Kleinanzeigen-Foto mit einem Bild, nicht mit einem
   * Namen), jetzt auch in Einkauf und Verkauf — dort hält man die Figur in
   * der Hand. Das Bild kommt mit der Katalogzeile (`fetchOrderbookCatalog`),
   * es gibt keine Anfrage je Treffer. Serie, Name und SKY-ID bleiben in der
   * Zeile; das Bild ergänzt sie und ersetzt keine.
   */
  showImage?: boolean;
  /**
   * Ob die Zeile zeigt, wie viele Konten die Figur vorgemerkt haben
   * (`0145`, ADR-0136).
   *
   * AUS ALS VORGABE, und das ist keine Vorsicht: die Zahl gehoert an die
   * Stelle, an der ueber einen ANKAUF entschieden wird. Derselbe Picker
   * steht auch im Kalkulator und in den Verkaufsbildschirmen; dort waere sie
   * eine vierte Zahl in einer Zeile, die drei schon hat, und sie wuerde
   * keine Entscheidung stuetzen.
   *
   * Die Zahl selbst reist mit `FigureChoice.favoriteDemand` und wird hier
   * nicht geholt — gebuendelt von `fetchFavoriteDemand()`, einmal je
   * Ansicht.
   */
  showDemand?: boolean;
  /*
   * Der Katalog ist noch unterwegs.
   *
   * Ohne dieses Wissen wäre ein leerer Katalog nicht von einem
   * fehlgeschlagenen zu unterscheiden, und der Kasten würde „konnte nicht
   * geladen werden" behaupten, während er gerade geladen wird. Gebraucht
   * wird es nur dort, wo der Katalog beim ersten Hineingreifen nachgeladen
   * wird (Verkaufs-Detailseite); wo er als Prop ankommt, bleibt es `false`
   * und ändert nichts.
   */
  loading?: boolean;
  /*
   * „Nichts gefunden" ist manchmal die richtige Antwort.
   *
   * Ein Portal, ein Spiel, ein Konvolut-Restposten steht in keinem
   * Figurenkatalog und soll trotzdem auf den Verkauf. Wo dieser Rückfall
   * erlaubt ist, hängt der Aufrufer ihn hier ein: der Kasten zeigt dann
   * statt „Keine Figur gefunden" einen Knopf, der den eingegebenen Namen
   * übernimmt — als `raw_name`, ohne `sky_id`, siehe `free-items.ts`.
   *
   * NUR BEI `empty`. Solange die Eingabe zu kurz ist oder Treffer da sind,
   * erscheint er nicht: er ist der Ausweg aus einer erfolglosen Suche und
   * keine zweite Art, etwas hinzuzufügen.
   *
   * NICHT AUF `Enter`. Die Taste nimmt die hervorgehobene Zeile, und wo
   * keine ist, tut sie nichts. Ein freier Artikel entsteht durch einen
   * Klick auf einen benannten Knopf, nicht durch eine Taste, die eben noch
   * etwas anderes bedeutet hat.
   */
  onFree?: (name: string) => void;
  /*
   * Zugriff auf das Eingabefeld von außen.
   *
   * `autoFocus` allein genügt nicht, sobald dieser Kasten in einem `Modal`
   * steht: React setzt den Autofokus beim Einhängen, und der Dialog holt
   * sich den Fokus danach in seinem eigenen Effekt auf das Panel (bewusst —
   * er soll keine Handlung unter die Leertaste legen). Wer das Feld
   * trotzdem sofort bespielbar haben will, fokussiert es über diese Referenz
   * in einem Effekt, der nach dem des Dialogs läuft.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  /*
   * Der Startwert gilt beim MOUNTEN. Die Suchflaeche wird je Zeile neu
   * gemountet (sie steht unter der Zeile, die gerade offen ist), also traegt
   * jede ihren eigenen Ausgangspunkt — kein Effekt, der nachtraeglich
   * hineinschreibt.
   */
  const [query, setQuery] = useState(initialQuery);
  /* `null`: noch nicht bewegt — dann gilt die Vorauswahl (`preferred`).
     Eine Zahl: der Betreiber hat mit Pfeil oder Maus gewählt, und das gilt. */
  const [highlight, setHighlight] = useState<number | null>(null);
  /* Wie viele Treffer gerade zu sehen sind. Jede neue Eingabe beginnt
     wieder bei einer Seite — gesetzt dort, wo die Eingabe sich ändert. */
  const [shown, setShown] = useState(pageSize);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const listId = useId();

  /* ALLE Treffer, sortiert; die Seite schneidet erst die Anzeige zu. */
  const matches = useMemo(() => matchFigures(catalog, query, order), [catalog, query, order]);
  /*
   * DIE VORAUSWAHL: der exakte Name, sonst die erste Zeile. Nach Relevanz
   * ist das dieselbe Zeile; nach Serie kann der exakte Name weiter unten
   * stehen (`exactMatchIndex`). Er bleibt dann sichtbar — die Seite reicht
   * notfalls bis zu ihm —, denn eine Markierung, die man nicht sieht, wäre
   * ein `Enter` ins Blaue.
   */
  const preferred = Math.max(0, exactMatchIndex(matches, query));
  const results = matches.slice(0, Math.max(shown, preferred + 1));
  const hidden = matches.length - results.length;
  const state = searchState(catalog, query, matches);
  const active = Math.min(highlight ?? preferred, Math.max(0, results.length - 1));

  function changeQuery(next: string) {
    setQuery(next);
    setHighlight(null);
    setShown(pageSize);
  }

  /* Eine Seite mehr. Die Markierung bleibt auf ihrer Zeile — die neuen
     Treffer kommen darunter, über ihr verschiebt sich nichts. */
  function showMore() {
    setShown(nextPage(results.length, pageSize, matches.length));
    setHighlight(active);
  }

  function choose(choice: FigureChoice) {
    onSelect(choice);
    changeQuery("");
    // Straight on to the next figure: the operator is working through a box.
    input.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const down = event.key === "ArrowDown";
      /* Auf der letzten sichtbaren Zeile blättert `ArrowDown` weiter, statt
         stehen zu bleiben — die Tastatur erreicht jeden Treffer. */
      if (down && hidden > 0 && active === results.length - 1) {
        setShown(nextPage(results.length, pageSize, matches.length));
        setHighlight(active + 1);
        return;
      }
      setHighlight(moveHighlight(active, down ? 1 : -1, results.length));
      return;
    }
    if (event.key === "Enter") {
      // Never let this submit the surrounding form — the form's button is the
      // only thing that may create a purchase.
      event.preventDefault();
      if (results[active]) choose(results[active]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query !== "") { changeQuery(""); return; }
      onCancel?.();
    }
  }

  /*
   * Ein leerer Katalog heisst nicht dasselbe wie ein gescheiterter. Solange
   * `loading` gesetzt ist, sagt der Kasten, dass er wartet — und erst danach,
   * falls dann noch nichts da ist, dass es nicht geklappt hat.
   */
  const free = onFree !== undefined && state === "empty" ? query.trim() : null;
  const message =
    state === "noCatalog" ? (loading ? copy.loadingCatalog : copy.noCatalog)
      : state === "tooShort" ? copy.tooShort
        : state === "empty" && free === null ? copy.empty
          : null;

  /** Den eingegebenen Namen übernehmen — roh, nur außen beschnitten. */
  function chooseFree(name: string) {
    onFree?.(name);
    changeQuery("");
    input.current?.focus();
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          type="search"
          value={query}
          autoFocus={autoFocus}
          disabled={disabled || (state === "noCatalog" && !loading)}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          /*
           * KEINE AUTOKORREKTUR IN EINEM KATALOGFELD.
           *
           * Hier werden Eigennamen getippt — „Doom Stone", „Pop Fizz",
           * „Hex" —, und für ein Wörterbuch sind das Tippfehler. iOS und
           * macOS ersetzen „doom" dann beim Verlassen des Feldes still durch
           * „dem", und die Trefferliste bricht unter dem Finger weg.
           * `autoComplete` allein genügt dafür nicht: es schaltet den
           * Browserverlauf ab, nicht die Textersetzung des Systems.
           */
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="done"
          aria-controls={listId}
          aria-describedby={message ? `${listId}-msg` : undefined}
          /*
           * Dieselbe Geometrie wie `INPUT` in `form-section.tsx` — das Feld
           * stand hier als eigene Kopie und hat die Verdichtung deshalb nicht
           * mitbekommen: auf dem Desktop war es 44 statt 36 Pixel hoch und
           * durch die geerbte Grundschrift auch größer als jedes andere Feld
           * der beiden Formulare.
           *
           * Nur der Desktop wird angeglichen. Auf dem Telefon bleiben 44 px
           * und 16 px stehen, und das ist hier kein Versäumnis: iOS zoomt die
           * Seite beim Fokus auf ein Feld unter 16 px, und dies ist das eine
           * Feld, in das am Telefon wirklich getippt wird.
           */
          className="min-h-11 w-full rounded-sky-md bg-surface px-3 ring-1 ring-border/70 focus-ring sm:min-h-9 sm:text-sm"
        />
      </label>

      {message ? (
        <p id={`${listId}-msg`} className="text-xs text-muted">{message}</p>
      ) : null}

      {/*
        Der Ausweg aus einer erfolglosen Suche. Er trägt den Namen, den der
        Betreiber getippt hat, damit der Knopf sagt, was er anlegt — und
        damit er nicht mit einem Treffer verwechselt wird, steht er unter der
        (dann leeren) Trefferliste und sieht aus wie ein Hinweis mit Knopf,
        nicht wie eine Zeile.
      */}
      {free !== null ? (
        <button type="button" disabled={disabled}
                /*
                 * DERSELBE WEG, UND AUS DEM GLEICHEN GRUND.
                 *
                 * Übergeben wird `free` aus dem Abschluss — der Name, den
                 * dieser Knopf GERADE ANZEIGT. Nicht der Feldinhalt von
                 * jetzt: hätte eine Ersetzung ihn zwischen Darstellung und
                 * Klick geändert, würde sonst etwas anderes angelegt als das,
                 * was dort stand.
                 */
                onMouseDown={(event) => { event.preventDefault(); chooseFree(free); }}
                onClick={(event) => { if (event.detail === 0) chooseFree(free); }}
                className="min-h-11 self-start rounded-sky-md px-3 text-left text-sm ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-60 sm:min-h-9">
          {copy.addFree(free)}
        </button>
      ) : null}

      <ul id={listId} aria-label={copy.results}
          className={results.length > 0 ? "flex flex-col gap-1" : "sr-only"}>
        {results.map((choice, index) => (
          <li key={choice.skyId}>
            <button
              type="button"
              disabled={disabled}
              /*
               * DIE AUSWAHL FÄLLT HIER, AUF `mousedown`, UND NICHT AUF `click`.
               *
               * WAS SONST PASSIERT, UND ES IST KEIN BUBBLING-FEHLER. Zwischen
               * `mousedown` und `click` verliert das Eingabefeld den Fokus.
               * Genau dann greift die Textersetzung des Systems zu und
               * schreibt aus „doom" ein „dem". Das löst ein `change` aus, die
               * Suche findet nichts mehr, die Trefferliste wird LEER — und an
               * derselben Stelle erscheint der Knopf „freien Artikel
               * anlegen". Der Klick landet auf dem, was jetzt dort steht. So
               * entstand aus einem angeklickten Katalogtreffer ein freier
               * Artikel namens „dem".
               *
               * `preventDefault()` verhindert den Fokuswechsel überhaupt:
               * ohne Blur keine verspätete Ersetzung, und die Auswahl ist
               * geschrieben, bevor irgendetwas die Liste ändern könnte.
               *
               * `onClick` bleibt für die TASTATUR. Ein mit Enter oder
               * Leertaste ausgelöster Klick trägt `detail === 0` und hat kein
               * `mousedown` vor sich; alles darüber kommt vom Zeigegerät und
               * ist hier schon erledigt.
               */
              onMouseDown={(event) => { event.preventDefault(); choose(choice); }}
              onClick={(event) => { if (event.detail === 0) choose(choice); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-sky-md px-3 text-left text-sm ring-1 disabled:opacity-60 ${
                index === active ? "bg-surface ring-fg/40" : "ring-border/70 hover:ring-fg/30"
              }`}
            >
              {showImage ? <FigureThumb src={choice.image ?? null} /> : null}
              {/* Serie zuerst: sie unterscheidet zwei gleich benannte Figuren
                  schneller als der Name, den man gerade getippt hat. */}
              <span className="w-10 shrink-0 text-xs uppercase tabular-nums text-muted">
                {choice.series}
              </span>
              {/*
                DIE ART, UND ZWAR NUR WENN SIE EINE IST (0137).
                Eine Figur bekommt keine Marke: sie ist der Normalfall, und
                820 gleiche Etiketten wären nur Rauschen. Ein Artikeltyp, den
                diese Fassung nicht kennt, erscheint ebenfalls nicht — dann
                steht die Zeile da wie vorher.
              */}
              {isAccessory(choice) && copy.itemTypes[choice.itemType ?? ""] ? (
                <span className="shrink-0 rounded-sky-sm bg-deep/40 px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted ring-1 ring-border/60">
                  {copy.itemTypes[choice.itemType ?? ""]}
                </span>
              ) : null}
              {/*
                AUF DEM TELEFON ZWEI ZEILEN FÜR DEN NAMEN (V2).
                Seit das Bild davor steht, bleiben bei 360 px rund 75 px —
                zu wenig für „Birthday Bash Big Bubble Pop Fizz", und die
                Variante steht vorne im Namen, also genau dort, wo nichts
                abgeschnitten wird, aber das Ende fehlt. Zwei Zeilen tragen
                beides; die Zeile wächst dafür über 44 px hinaus, was eine
                Trefferfläche nur größer macht. Ab `sm:` eine Zeile wie bisher.
              */}
              <span className="min-w-0 flex-1 break-words line-clamp-2 leading-tight sm:line-clamp-1 sm:leading-normal"
                    title={choice.name}>
                {choice.name}
              </span>
              {/*
                DIE NACHFRAGE, NEBEN DEM NAMEN (0145, ADR-0136).

                Hier und nicht in einer eigenen Zeile: die Zeile ist 44 px
                hoch und das ist ihre Trefferflaeche — eine zweite Textzeile
                waere eine andere Geometrie fuer dieselbe Liste. `shrink-0`,
                damit der Name weicht und nicht die Zahl, und sie erscheint
                nur, wenn sie groesser als null ist, also auf den wenigen
                Zeilen, auf denen sie etwas sagt.

                Sie liegt INNERHALB des Knopfes, also ueberdeckt sie keine
                Klickflaeche — sie ist Teil derselben.
              */}
              {showDemand ? <FavoriteDemandIndicator count={choice.favoriteDemand} /> : null}
              <span className="shrink-0 text-xs tabular-nums text-muted">{choice.skyId}</span>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {choice.marketPrice === null ? "—" : formatPrice(choice.marketPrice)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/*
        DER REST DER TREFFER, EINE SEITE WEITER.

        Ein Knopf und kein unendliches Scrollen: der Kasten steht im
        Kalkulator in einem gedeckelten Rollbereich und im Orderbuch mitten
        im Formular, und ein Nachladen beim Scrollen wäre an beiden Stellen
        ein Rollbereich, der sich unter dem Finger verlängert. Die Zahl im
        Knopf sagt, wie viele noch fehlen.

        `mousedown` + `preventDefault` aus demselben Grund wie bei den
        Treffern: der Fokus bleibt im Suchfeld, keine Ersetzung des Systems
        kann die Eingabe dazwischen ändern, und `Enter` nimmt danach weiter
        die hervorgehobene Zeile.
      */}
      {hidden > 0 ? (
        <button type="button" disabled={disabled}
                onMouseDown={(event) => { event.preventDefault(); showMore(); }}
                /* Per Tastatur ausgelöst, geht der Fokus zurück ins Suchfeld:
                   dort wirken Pfeile und `Enter`, und der Knopf selbst
                   verschwindet auf der letzten Seite unter dem Fokus. */
                onClick={(event) => {
                  if (event.detail === 0) { showMore(); input.current?.focus(); }
                }}
                className="min-h-11 self-start rounded-sky-md px-3 text-left text-xs text-muted ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-60 sm:min-h-8">
          {copy.moreResults(hidden)}
        </button>
      ) : null}

      {onCancel ? (
        <button type="button" onClick={onCancel}
                className="self-start min-h-11 text-xs text-muted underline underline-offset-2">
          {copy.changeCancel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Das kleine Bild in einer Trefferzeile.
 *
 * DER KASTEN, DEN DER KALKULATOR SCHON HATTE (`bg-deep/40`), unverändert —
 * jetzt auch im Orderbuch. Die Datei ist vorab optimiert und liegt
 * statisch — `next/image` würde sie zur Laufzeit erneut rechnen (ADR-0026).
 *
 * `alt=""`, weil der Name direkt daneben steht: ein Screenreader soll ihn
 * einmal hören, nicht zweimal. Das Bild ist Zusatz, nie die einzige Angabe.
 *
 * OHNE BILD bleibt der Kasten stehen — gleiche Größe, keine verrutschte
 * Zeile — mit einem stillen Strich statt des Textes von `FigureImage`, der
 * in 32 px nicht lesbar wäre.
 */
function FigureThumb({ src }: { src: string | null }) {
  return (
    <span aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sky-sm bg-deep/40 ring-1 ring-border/60">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async"
             className="h-full w-full object-contain" />
      ) : (
        <span className="text-xs text-muted">–</span>
      )}
    </span>
  );
}
