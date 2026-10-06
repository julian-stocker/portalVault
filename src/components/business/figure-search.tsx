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

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  MAX_RESULTS, moveHighlight, searchFigures, searchState, type FigureChoice,
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
  limit = MAX_RESULTS,
  showImage = false,
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
  limit?: number;
  /*
   * Das Bild vor dem Namen. AUS, wo dieser Kasten schon steht: Einkauf,
   * Verkauf und Remap zeigen seit `0064` Serie, Name, SKY-ID und Preis, und
   * eine Zeile, die über Nacht ein Bild bekommt, wäre eine Änderung an drei
   * abgenommenen Bildschirmen. Der Kalkulator schaltet es ein, weil man ein
   * Kleinanzeigen-Foto mit einem Bild vergleicht und nicht mit einem Namen.
   */
  showImage?: boolean;
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
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const listId = useId();

  const results = useMemo(() => searchFigures(catalog, query, limit), [catalog, query, limit]);
  const state = searchState(catalog, query, results);
  const active = Math.min(highlight, Math.max(0, results.length - 1));

  function choose(choice: FigureChoice) {
    onSelect(choice);
    setQuery("");
    setHighlight(0);
    // Straight on to the next figure: the operator is working through a box.
    input.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(moveHighlight(active, event.key === "ArrowDown" ? 1 : -1, results.length));
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
      if (query !== "") { setQuery(""); setHighlight(0); return; }
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
    setQuery("");
    setHighlight(0);
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
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
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
                onClick={() => chooseFree(free)}
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
              onClick={() => choose(choice)}
              onMouseEnter={() => setHighlight(index)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-sky-md px-3 text-left text-sm ring-1 disabled:opacity-60 ${
                index === active ? "bg-surface ring-fg/40" : "ring-border/70 hover:ring-fg/30"
              }`}
            >
              {showImage ? (
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-sky-sm bg-deep/40 ring-1 ring-border/60">
                  {choice.image ? (
                    /* Wie `FigureImage`: die Dateien sind vorab auf 640 px
                       optimiert und liegen statisch, `next/image` würde sie
                       zur Laufzeit erneut rechnen (ADR-0026). */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={choice.image} alt="" loading="lazy"
                         className="h-full w-full object-contain" />
                  ) : null}
                </span>
              ) : null}
              {/* Serie zuerst: sie unterscheidet zwei gleich benannte Figuren
                  schneller als der Name, den man gerade getippt hat. */}
              <span className="w-10 shrink-0 text-xs uppercase tabular-nums text-muted">
                {choice.series}
              </span>
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{choice.skyId}</span>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {choice.marketPrice === null ? "—" : formatPrice(choice.marketPrice)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {onCancel ? (
        <button type="button" onClick={onCancel}
                className="self-start min-h-11 text-xs text-muted underline underline-offset-2">
          {copy.changeCancel}
        </button>
      ) : null}
    </div>
  );
}
