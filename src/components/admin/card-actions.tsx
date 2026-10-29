/**
 * What an administrator can do to a figure from the catalogue itself (V3.8).
 *
 * ONE ACTION, AND IT OPENS THE EDITOR.
 *
 * Until V3.8 this row carried three things stacked on top of each other: a
 * show/hide button, a "Details" link and, when a write failed, an error line.
 * They did not fit. The trade row is 9.05 % of the card's height — 29 px on a
 * two-column phone — and `ACTION_CARD` alone is 40 px, so the button was
 * clipped and the link below it was invisible. Three controls were being put
 * where the public card puts one.
 *
 * So there is one control now, in the same box the public offer line uses,
 * and it opens a dialog that holds all five editable fields — visibility
 * included. Hiding a figure is a decision, and a decision belongs in the
 * place where you can see what you are deciding about, not under a thumb
 * scrolling a grid (ADR-0042 said the same thing about tapping the card).
 *
 * NEUTRAL, ON PURPOSE. Gold means possession, silver means trade, amber means
 * a purchase. Editing is none of those: it is an action on the interface, so
 * it takes the neutral card action and says what it does.
 *
 * It is not a permission either. The dialog's writes call server actions that
 * call database functions that ask `is_shop_admin()` themselves; this decides
 * what a button looks like.
 */
"use client";

import { useState, useTransition } from "react";

import { deleteFigure, setCatalogStatus } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

export function AdminEditAction({
  name,
  onEdit,
}: {
  /** Named for a screen reader: a grid of these is otherwise 561 "Bearbeiten". */
  name: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={de.admin.editFigure(name)}
      /*
       * The same box as `OfferLink`: `h-full w-full`, no minimum height, and
       * type that scales with the card. The row IS the target — full width
       * inside the trade inset — and giving this one a `min-h` would push it
       * out of a row whose height is fixed by the artwork.
       */
      className={
        "focus-ring flex h-full w-full items-center justify-center gap-1 rounded-sky-sm " +
        "whitespace-nowrap px-1.5 sm:px-2 " +
        "text-[clamp(9px,4.8cqw,11px)] leading-none font-semibold " +
        "transition-opacity hover:opacity-75 active:opacity-60"
      }
      style={{ color: INK_EDIT }}
    >
      <span>{de.admin.edit}</span>
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
        ›
      </span>
    </button>
  );
}

/**
 * The ink, inline for the reason `offer-link.tsx` records: a class only paints
 * if its rule arrives, and the card falls back to the page's near-white when
 * none does. An inline style carries the value itself.
 *
 * The same near-black the buyable offer uses, because both sit on the card's
 * own printed surface and the surface decides what is legible — not what the
 * action means. What the action MEANS is carried by the word.
 */
const INK_EDIT = "var(--trade-ink, #11161c)";

/**
 * Die zwei Admin-Handlungen in der Aktionsleiste der Kachel (UX-01G).
 *
 * WARUM HIER UND NICHT IN EINER NEUEN DATEI: `AdminEditAction` oben ist
 * dieselbe Handlung in der Handelszeile der klassischen Karte. Beide stehen
 * jetzt nebeneinander, und wer eine ändert, sieht die andere.
 *
 * ZWEI KNÖPFE, DIE FORM DER LEISTE. Die Kachel hat eine Aktionsleiste aus
 * 44-px-Feldern — `[Glocke] [Info] [Herz]` beim Sammler. Ein Admin bekommt
 * dort `[Info] [Stift] [Auge]`, und die zwei neuen sind Icons in genau
 * demselben Feld: kein eigenes Layout, keine zweite Geometrie,
 * `row-template.ts` rechnet weiter mit derselben Breite.
 *
 * DAS AUGE SCHREIBT ÜBER DIE VORHANDENE AKTION. `setCatalogStatus` (`0152`)
 * ruft `admin_set_catalog_status`, und die Funktion fragt
 * `is_platform_admin()` SELBST — in der Datenbank. Ein ausgeblendeter Knopf
 * ist hier Darstellung, nicht Grenze; ein Aufruf ohne Recht scheitert mit
 * `42501`, auch wenn er diese Datei nie gesehen hat.
 *
 * DREI WERTE, ZWEI ZUSTÄNDE AM AUGE. `catalog_status` kennt `public`,
 * `hidden` und `draft` (ADR-0151). Das Auge schaltet zwischen den ersten
 * beiden; ein ENTWURF wird hier nicht veröffentlicht — das ist eine
 * Entscheidung mit eigenem Dialog (CAT-02B), und ein Auge, das aus einem
 * Entwurf eine öffentliche Figur macht, wäre genau der stille Griff, den
 * ADR-0042 ausschliesst. Auf einem Entwurf ist das Auge deshalb aus.
 */
export function AdminTileActions({
  skyId,
  name,
  status,
  onEdit,
}: {
  skyId: string;
  /** Für die Vorlesehilfe: ein Raster davon ist sonst 561-mal „Bearbeiten". */
  name: string;
  /** Der redaktionelle Status, wie die Datenbank ihn führt. */
  status: "public" | "hidden" | "draft";
  onEdit: () => void;
}) {
  const [sichtbar, setSichtbar] = useState(status === "public");
  const [fehler, setFehler] = useState<string | null>(null);
  const [frage, setFrage] = useState(false);
  const [weg, setWeg] = useState(false);
  const [pending, start] = useTransition();
  const entwurf = status === "draft";

  function umschalten() {
    if (entwurf) return;
    const ziel = !sichtbar;
    setSichtbar(ziel);          /* optimistisch, wie der Sammelknopf */
    setFehler(null);
    start(async () => {
      const ergebnis = await setCatalogStatus(skyId, ziel ? "public" : "hidden");
      if (!ergebnis.ok) { setSichtbar(!ziel); setFehler(ergebnis.message); }
    });
  }

  function loeschen() {
    setFehler(null);
    start(async () => {
      const ergebnis = await deleteFigure(skyId);
      if (ergebnis.ok) { setFrage(false); setWeg(true); }
      else setFehler(ergebnis.message);
    });
  }

  /*
   * NACH DEM LOESCHEN STEHT DIE KACHEL NOCH DA, BIS DIE SEITE NACHZIEHT.
   * `deleteFigure` ruft `revalidatePath`, aber bis der Server antwortet soll
   * die Zeile nicht so aussehen, als koenne man sie noch bearbeiten. Die
   * Leiste wird deshalb still, und die Kachel sagt es daneben.
   */
  if (weg) {
    return (
      <span className="flex h-11 items-center px-2 text-[11px] leading-tight text-muted">
        {de.admin.deleteDone}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        aria-label={de.admin.editFigure(name)}
        title={de.admin.edit}
        className={`${FELD} text-muted hover:text-foreground`}
      >
        <span className={GRUND}>
          {/* lucide pencil, auf das 22er-Raster gelegt */}
          <svg {...ICON}>
            <path d="M11 18.5h8" />
            <path d="M15.2 3.8a1.9 1.9 0 0 1 2.7 2.7L6.6 17.8l-3.6.9.9-3.6Z" />
          </svg>
        </span>
      </button>

      <button
        type="button"
        onClick={umschalten}
        disabled={pending || entwurf}
        aria-pressed={sichtbar}
        aria-label={de.admin.toggleVisibilityFor(name, sichtbar)}
        title={entwurf ? de.admin.visibilityDraft
                       : sichtbar ? de.admin.visibilityHide : de.admin.visibilityShow}
        className={`${FELD} text-muted hover:text-foreground `
                   + "disabled:cursor-not-allowed disabled:opacity-40"}
      >
        <span className={GRUND}>
          {sichtbar ? (
            /* lucide eye */
            <svg {...ICON}>
              <path d="M2 11s3.2-6.4 9-6.4 9 6.4 9 6.4-3.2 6.4-9 6.4S2 11 2 11Z" />
              <circle cx="11" cy="11" r="2.8" />
            </svg>
          ) : (
            /* lucide eye-off — der Strich bleibt das Zeichen fuer „versteckt" */
            <svg {...ICON}>
              <path d="M9.8 4.8A9.6 9.6 0 0 1 11 4.7c5.8 0 9 6.3 9 6.3a16 16 0 0 1-2 2.8" />
              <path d="M6 6A16 16 0 0 0 2 11s3.2 6.3 9 6.3a9 9 0 0 0 3.6-.7" />
              <path d="m2 2 18 18" />
            </svg>
          )}
        </span>
      </button>

      {/*
       * DER PAPIERKORB, ROT — und er fragt, bevor er etwas tut.
       *
       * ROT IST HIER KEINE FARBWAHL, SONDERN DIE EINZIGE. Die drei anderen
       * Marken sind neutral, weil sie umkehrbar sind: ein Name, ein Status,
       * ein Preis. Diese ist es nicht — die SKY-ID kommt nie zurueck
       * (ADR-0070), und `sky_id_seq` gibt sie nicht wieder aus.
       */}
      <button
        type="button"
        onClick={() => { setFrage(true); setFehler(null); }}
        disabled={pending}
        aria-label={de.admin.deleteFigureFor(name, skyId)}
        title={de.admin.deleteFigure}
        className={`${FELD} text-danger hover:text-danger `
                   + "disabled:cursor-not-allowed disabled:opacity-40"}
      >
        <span className={GRUND}>
          {/* lucide trash-2 */}
          <svg {...ICON}>
            <path d="M3 6h16" />
            <path d="M17 6v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            <path d="M9 10v6" /><path d="M13 10v6" />
          </svg>
        </span>
      </button>

      {/* Die Meldung des Servers, wo sie gelesen wird: an der Kachel. */}
      {fehler ? (
        <span role="alert"
              className="absolute top-11 right-0 z-10 w-56 rounded-sky-md bg-surface
                         p-2 text-[11px] leading-snug text-danger shadow-card
                         ring-1 ring-border-strong">
          {fehler}
        </span>
      ) : null}

      {frage ? (
        <DeleteDialog
          name={name}
          skyId={skyId}
          status={status}
          pending={pending}
          onCancel={() => setFrage(false)}
          onConfirm={loeschen}
        />
      ) : null}
    </>
  );
}

/**
 * Die Bestätigung — Name, SKY-ID, und was dauerhaft heisst.
 *
 * WARUM SIE EIGEN STEHT UND NICHT IM KNOPF: sie ist ein Dialog, und ein
 * Dialog in einem 44-px-Feld waere ein Dialog in einem Knopf. Dieselbe Form
 * wie die Verwerfen-Bestätigung in `row-actions.tsx`, damit zwei
 * Löschfragen nicht zwei verschiedene Dinge zu sein scheinen.
 */
function DeleteDialog({
  name, skyId, status, pending, onCancel, onConfirm,
}: {
  name: string; skyId: string; status: "public" | "hidden" | "draft";
  pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={de.admin.deleteConfirmTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-sky-md bg-surface p-4 text-left
                      ring-1 ring-border-strong">
        <h2 className="text-sm font-medium">{de.admin.deleteConfirmTitle}</h2>
        <p className="mt-2 text-sm">
          {name}{" "}
          <span className="font-mono text-xs text-muted">{skyId}</span>
        </p>
        <p className="mt-2 text-xs text-muted">{de.admin.deleteConfirmBody}</p>
        {/* Was geprüft wird, bevor etwas geschieht — damit niemand rät. */}
        <p className="mt-2 text-[11px] text-muted">{de.admin.deleteConfirmChecks}</p>
        {status === "public" ? (
          <p className="mt-2 text-[11px] text-warning">{de.admin.deleteConfirmPublic}</p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring min-h-11 flex-1 rounded-sky-md bg-base px-3 text-sm
                       ring-1 ring-border"
          >
            {de.admin.discardConfirmNo}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="focus-ring min-h-11 flex-1 rounded-sky-md bg-danger px-3 text-sm
                       font-medium text-on-danger disabled:opacity-50"
          >
            {de.admin.deleteConfirmYes}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * DIESELBE GEOMETRIE WIE INFO, HERZ UND GLOCKE — Zeichen fuer Zeichen.
 *
 * Die drei vorhandenen Marken stehen in einem 44-px-Feld (`h-11 w-11`) mit
 * `items-start justify-end`, und ihr Glyph ist **22 px** auf einem
 * 22er-Raster, gestrichelt mit 1,5. Meine erste Fassung nahm `size-11` mit
 * einem 16-px-Icon — und genau das hat der Betreiber gesehen: „die Icons
 * wirken unterschiedlich groß".
 *
 * Also keine dritte Groesse, sondern die vorhandene: 22 px. Ein Glyph 6 px
 * neben seinem Nachbarn ist die Sorte Sache, die niemand benennen kann und
 * jeder sieht (so steht es in `info-link.tsx`, und es stimmt).
 */
const FELD =
  "group/act pointer-events-auto flex h-11 w-11 shrink-0 items-start justify-end "
  + "focus-visible:outline-none";

const GRUND =
  "grid place-items-center rounded-full p-1.5 transition-colors duration-150 "
  + "group-hover/act:bg-white/16 group-focus-visible/act:bg-white/16 "
  + "group-focus-visible/act:outline group-focus-visible/act:outline-2 "
  + "group-focus-visible/act:outline-offset-1 group-focus-visible/act:outline-white/90";

const ICON = {
  viewBox: "0 0 22 22", fill: "none", stroke: "currentColor",
  strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round",
  className: "block h-[22px] w-[22px]", "aria-hidden": "true",
} as const;

/** The chip that marks a figure the public catalog no longer shows. */
export function HiddenBadge() {
  return (
    <span
      className={
        "absolute top-2 left-2 rounded-full bg-[#3b2a17]/90 px-2 py-0.5 text-[11px] " +
        "leading-none font-medium text-[#f6d9a8] ring-1 ring-[#f0c073]/40"
      }
    >
      {de.admin.hiddenBadge}
    </span>
  );
}
