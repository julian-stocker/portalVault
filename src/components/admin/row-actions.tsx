"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Modal } from "@/components/ui/modal";
import { discardDraft } from "@/lib/admin/actions";
import { DraftDialog } from "@/components/admin/draft-dialog";
import { de } from "@/lib/i18n/de";

/**
 * Was diese Spalte braucht: eine Kennung und einen Namen.
 *
 * Bewusst nicht die ganze Katalogzeile — der Dialog holt die vollständigen
 * Werte selbst vom Server (CAT-05F), und die Liste müsste sie sonst für alle
 * 731 Zeilen ins HTML schreiben.
 */
export type Zeilenkopf = { skyId: string; name: string };

/**
 * CAT-05D — die drei Handlungen einer Katalogzeile.
 *
 *   git-merge   zusammenführen   nur bei Entwürfen
 *   pencil      bearbeiten       immer
 *   trash-2     verwerfen        nur bei Entwürfen, mit Bestätigung
 *
 * WARUM ZWEI DAVON NUR BEI ENTWÜRFEN: eine öffentliche oder versteckte Figur
 * wird nicht zusammengeführt und nicht gelöscht — der Import deaktiviert über
 * `is_active`, statt zu löschen (`0001`). Ein Icon, das nur zum Scheitern da
 * ist, ist eine schlechte Oberfläche; `0155` weist es ohnehin ab.
 *
 * DIE BESTÄTIGUNG GIBT ES NUR BEIM LÖSCHEN. Zusammenführen ist umkehrbar,
 * solange man die Felder noch einmal setzt; Löschen ist es nicht — die
 * SKY-ID kommt nie zurück (ADR-0070).
 *
 * GEOMETRIE: `size-11` sind 44 px, die Berührungsfläche. Das Icon darin ist
 * 16 px, damit die Spalte schmal bleibt — die Tabelle ist schon breit.
 */

const ICON = "focus-ring flex size-11 shrink-0 items-center justify-center rounded-sky-md";
const SVG = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round",
  className: "h-4 w-4", "aria-hidden": "true",
} as const;

export function RowActions({ figur, istEntwurf }: { figur: Zeilenkopf; istEntwurf: boolean }) {
  const [dialog, setDialog] = useState(false);
  const [frage, setFrage] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function loeschen() {
    /* Ein zweiter Klick waehrend des ersten verwirft nicht zweimal. */
    if (pending) return;
    setFehler(null);
    start(async () => {
      const ergebnis = await discardDraft(figur.skyId);
      if (ergebnis.ok) setFrage(false);
      else setFehler(ergebnis.message);
    });
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {istEntwurf ? (
        <button
          type="button"
          onClick={() => setDialog(true)}
          title={de.admin.rowMerge}
          aria-label={`${de.admin.rowMerge}: ${figur.name}`}
          className={`${ICON} text-muted hover:text-foreground`}
        >
          {/* lucide git-merge */}
          <svg {...SVG}>
            <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 0 0 9 9" />
          </svg>
        </button>
      ) : null}

      <Link
        href={`/admin/catalog/${figur.skyId}`}
        title={de.admin.rowEdit}
        aria-label={`${de.admin.rowEdit}: ${figur.name}`}
        className={`${ICON} text-muted hover:text-foreground`}
      >
        {/* lucide pencil */}
        <svg {...SVG}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </Link>

      {istEntwurf ? (
        <button
          type="button"
          onClick={() => setFrage(true)}
          title={de.admin.rowDiscard}
          aria-label={`${de.admin.rowDiscard}: ${figur.name}`}
          className={`${ICON} text-muted hover:text-danger focus-visible:text-danger`}
        >
          {/* lucide trash-2 */}
          <svg {...SVG}>
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M10 11v6" /><path d="M14 11v6" />
          </svg>
        </button>
      ) : null}

      {dialog ? (
        <DraftDialog entwurf={figur} onClose={() => setDialog(false)} />
      ) : null}

      {frage ? (
        <DiscardDialog
          figur={figur}
          pending={pending}
          fehler={fehler}
          onCancel={() => { if (!pending) { setFrage(false); setFehler(null); } }}
          onConfirm={loeschen}
        />
      ) : null}
    </div>
  );
}

/**
 * Die Bestätigung zum Verwerfen eines Entwurfs — dieselbe Bauform wie die
 * Löschfrage an der Kachel (`card-actions.tsx`, CAT-11).
 *
 * IM GEMEINSAMEN `Modal`, nicht als eigenes `fixed`-Overlay: portiert nach
 * `document.body`, Höhe am Viewport gedeckelt, Kopf und Fuß fest, nur der
 * Inhalt scrollt. Escape, Fokusfalle und Rückgabe des Fokus kommen von dort.
 * Vorher hatte diese Frage keine Höhengrenze, keinen Escape und keinen
 * Fokusfang.
 *
 * DIE PRÜFUNGEN BLEIBEN IN DER DATENBANK. `admin_discard_draft` (`0155`)
 * weist alles ab, was kein Admin-Entwurf ist oder auf das etwas zeigt; die
 * Oberfläche entscheidet darüber nichts.
 */
function DiscardDialog({
  figur, pending, fehler, onCancel, onConfirm,
}: {
  figur: Zeilenkopf; pending: boolean; fehler: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const titel = useId();
  return (
    <Modal open onClose={onCancel} labelledBy={titel} size="md" role="alertdialog">
      <header className="shrink-0 border-b border-border/60 px-4 py-3 text-left">
        <h2 id={titel} className="text-base font-semibold">{de.admin.discardConfirmTitle}</h2>
        <p className="mt-1 flex min-w-0 items-baseline gap-2 text-sm">
          <span className="min-w-0 break-words">{figur.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{figur.skyId}</span>
        </p>
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 text-left">
        <p className="text-sm">{de.admin.discardConfirmBody}</p>
        {fehler ? (
          <p role="alert" className="mt-3 rounded-sky-md bg-danger/10 p-2 text-sm text-danger">
            {fehler}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-border/60 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="focus-ring min-h-11 flex-1 rounded-sky-md bg-base px-3 text-sm ring-1 ring-border
                     disabled:opacity-50"
        >
          {de.admin.discardConfirmNo}
        </button>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={onConfirm}
          className="focus-ring min-h-11 flex-1 rounded-sky-md bg-danger px-3 text-sm
                     font-medium text-on-danger disabled:opacity-50"
        >
          {pending ? de.admin.deleting : de.admin.discardConfirmYes}
        </button>
      </footer>
    </Modal>
  );
}
