/**
 * A special edition, as a strip of its own beneath the photograph
 * (UX-01C, revised by UX-01E, ADR-0148).
 *
 * WHICH EDITIONS EXIST, AND IT IS NOT A JUDGEMENT CALL
 *
 * `skylanders.card_type` is the structured classification, and the database
 * restricts it by CHECK to exactly seven values (`0032`):
 *
 *     standard · special · elite · dark · legendary · chase · prestige
 *
 * It is editorial and permanent, and V3.6 settled that it is the ONLY thing
 * that decides how a figure is presented: "no `name.includes(…)` at render
 * time, no re-derivation from `parseVariant()`, no client-side guess — an
 * administrator's correction must outlive every later import and every later
 * rename." This component therefore reads the column through
 * `namesEdition()` and nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT: a "Crystal" banner. There is no crystal card
 * type. Crystal finishes are carried by `chase` — whose artwork the build
 * describes as "a crystal artwork" — and the only Crystal vocabulary in the
 * project is `VARIANT_TOKENS` ("Clear Crystal", "Green Crystal", …), which is
 * matched against NAMES. Using it here would be the name-guessing that
 * ADR-0034 and V3.6 both forbid, so such a figure keeps its `chase` banner
 * and the finish stays part of what it is called.
 *
 * TWO TIERS, FROM THE RANK THAT ALREADY EXISTS
 *
 * `VariantSeal` solved this exact question for the vertical card: two inks,
 * both dark plates with a light edge so they read as stamped into the plate
 * rather than laid on it — Legendary ivory on near-black, "the one finish
 * collectors chase"; everything else a cool grey, quieter. The row keeps that
 * language and picks the tier from `EDITION_RANK`, the project's own
 * ordering, rather than from a new opinion.
 *
 * DELIBERATELY NOT GOLD, for the reason the seal gives: gold means
 * possession and an edition is a property of the OBJECT. A gold banner would
 * make an unowned Legendary look owned.
 *
 * WHERE IT SITS, AND WHY IT MOVED. It used to lie across the foot of the
 * picture stage, absolutely positioned inside it. That covered the bottom
 * fifth of the photograph — the base rather than the face, but artwork all
 * the same — and after the desktop review the operator ruled it out: no
 * overlay on the artwork, and the picture must not be cropped or shrunk to
 * make room for one either.
 *
 * So it is a strip of its own now, directly under the picture and inside the
 * same left column. Two consequences worth stating:
 *
 *   THE PHOTOGRAPH IS WHOLE. No overlay, no filter, no dimming, no scaling,
 *   nothing cropped. The 64 px square is 64 px of picture.
 *
 *   IT STILL COSTS THE ROW NO HEIGHT. 64 px of picture plus 13 px of strip
 *   is 77, and the text block beside it needs 90 anyway (`INFO_HEIGHT`), so
 *   the whole left column still fits inside a height the row was already
 *   paying. A tile with an edition and a tile without are exactly the same
 *   height — which is what "einheitliche Kachelhöhe" requires, and it comes
 *   out of the arithmetic rather than out of a reserved blank.
 *
 * The strip and the picture share one rounded, ringed box, so the two read
 * as one plate with a caption rather than as two stacked objects. That is
 * the whole of the "quiet, high-grade" treatment: a white stage, a dark
 * label under it, one edge around both.
 */
/* ===========================================================================
 * NACHTRAG CAT-10 (`0163`): DIE QUELLE IST NICHT MEHR `card_type`
 * ===========================================================================
 *
 * Alles oben bleibt richtig — bis auf die Quelle. Das Banner liest jetzt
 * `skylanders.visible_type`: den EINEN Type, den ein Administrator aus der
 * Menge der hinterlegten ausgewaehlt hat.
 *
 * WARUM DER WECHSEL. `card_type` konnte nur EINE Eigenschaft tragen, und bei
 * 192 von 701 Zeilen war das zu wenig: „Legendary Giant" war entweder ein
 * Giant (an der Kategorie, nie auf einem Banner) oder ein Legendary. Jetzt
 * traegt die Zeile beide, und der Bediener sagt, welcher erscheint.
 *
 * WAS SICH NICHT AENDERT. `card_type` bleibt die KARTENKUNST der senkrechten
 * Karte in Shop und Sammlung — sieben PNG-Dateien, unveraendert. Und diese
 * Komponente leitet NICHTS ab: sie liest den ausgewaehlten Type und sonst
 * nichts. Eine Ableitung aus der Menge (etwa „der staerkste gewinnt") haette
 * auf 248 oeffentlichen Kacheln ein Banner erscheinen lassen, ohne dass
 * jemand es entschieden hat.
 *
 * DIE ZWEI PLATTEN BLEIBEN, und ihre Zuordnung auch: Legendary und Prestige
 * hell, alles andere leise (`isHeadlineType`). Fuer „Giant" oder „Trap" gibt
 * es keinen Rang — ein Giant ist keine staerkere Ausgabe von irgendetwas —,
 * also stehen sie auf der leisen Platte.
 * ======================================================================== */
/* `EDITION_RANK` bleibt fuer `isHeadlineEdition()` — die Funktion gehoert zur
   senkrechten Karte und wird von `variant-seal.tsx` und ihren Tests gegen
   dieselbe Rangliste gehalten. Die Beschriftung kommt seit CAT-10 aus
   `TYPE_LABELS`. */
import { EDITION_RANK, type CardType } from "@/lib/catalog/card-type";
import { TYPE_LABELS, isHeadlineType, type CatalogType }
  from "@/lib/catalog/catalog-type";

/**
 * The two plates, character for character the pair `variant-seal.tsx` uses.
 *
 * Copied rather than imported, and held against that file by a test so the
 * two cannot drift: the seal belongs to the card's artwork layer and this to
 * a row, and neither should have to import the other to stay in step. The
 * contrast was measured there, not here.
 */
const BRIGHT = "bg-[#241f19] text-[#f3e6c8]";
const QUIET = "bg-[#3a3442] text-[#ded7e8]";

/**
 * Which editions get the bright plate.
 *
 * `EDITION_RANK` is the project's own ordering of the chain
 * (`legendary > dark > special > standard`), with `chase` and `elite`
 * deliberately outside it. Taking the top of that chain gives Legendary and
 * Prestige the bright plate and leaves Dark, Special, Elite and Chase on the
 * quiet one — the same split `VariantSeal` makes, derived instead of
 * restated.
 */
const BRIGHT_FROM_RANK = 3;

export function isHeadlineEdition(cardType: CardType): boolean {
  return EDITION_RANK[cardType] >= BRIGHT_FROM_RANK;
}

export function EditionBanner({ type }: { type: CatalogType | null }) {
  /*
   * KEIN TYPE, KEIN BANNER. Drei Lagen fuehren hierher, und fuer den
   * Betrachter sehen sie gleich aus: niemand hat entschieden, jemand hat
   * ausdruecklich „–" gewaehlt, oder der gewaehlte Type ist aus der Menge
   * gefallen. Welche es war, steht in `visible_type_decided` und gehoert in
   * den Dialog, nicht auf die Kachel.
   */
  if (type === null) return null;

  return (
    <span
      /*
       * Decorative to a screen reader: a row already carries the figure's
       * name, its ownership sentence and its element, and the edition is part
       * of what the figure IS rather than a state anybody acts on. One more
       * word between the picture and the name would be noise.
       *
       * `pointer-events-none` so the strip never eats a tap meant for the
       * row's collect toggle underneath it. It is no longer over the artwork,
       * but it is still over the row.
       */
      aria-hidden="true"
      className={
        /* In flow, full width of the picture column, and `block` so the
           13 px line box is the strip's whole height. */
        "pointer-events-none block w-full truncate px-1 text-center "
        + "font-mono text-[8px] leading-[13px] font-medium tracking-[0.08em] uppercase "
        /* One pixel of highlight inside a dark field is what makes a plate
           look pressed rather than laid on. No radius, no blur, no glow —
           the same treatment the variant seal uses. */
        + "shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] "
        + (isHeadlineType(type) ? BRIGHT : QUIET)
      }
    >
      {TYPE_LABELS[type]}
    </span>
  );
}
