"use client";

import { useEffect, useState, useTransition } from "react";

import { createCharacterFamily, setFigureCharacter } from "@/lib/admin/actions";
import { searchFamilies, type Familienzeile } from "@/lib/admin/family-search";
import { de } from "@/lib/i18n/de";

/**
 * CAT-06 §7 — die Figurenfamilie einer BESTEHENDEN Figur bearbeiten.
 *
 * WARUM NICHT NUR BEIM IMPORT. Eine Familienzuordnung ist eine redaktionelle
 * Korrektur. Sie wird falsch, sie wird nachgeholt, sie wird zurückgenommen —
 * und das muss an einer längst veröffentlichten Figur genauso gehen wie an
 * einem Entwurf. `admin_set_character` (`0158`) gilt deshalb für jede Figur.
 *
 * SIE SCHREIBT EINE SPALTE. Angebote, Sammlungen, Lager, Favoriten und
 * Bestellungen hängen an der SKY-ID und bleiben unberührt; was sich ändert,
 * ist allein, womit die Figur zusammen angezeigt und sortiert wird. Name,
 * Slug, Status, Edition und Preis fasst sie nicht an.
 *
 * KEINE NAMENSHEURISTIK. Hier wird nichts vorgeschlagen, weil ein Name so
 * anfängt — die Auswahl ist eine Entscheidung, und die trifft ein Mensch.
 * Die Vorschlagsliste dafür ist `supabase/checks/cat06_family_suggestions.sql`
 * und liegt bewusst daneben, nicht darin.
 */
export function FamilySelect({
  skyId, familie, familienname,
}: {
  skyId: string;
  /** Die heutige Zuordnung, oder `null`. */
  familie: number | null;
  /** Ihr Name, falls bekannt — für die Anzeige ohne zweite Abfrage. */
  familienname: string | null;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Familienzeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!offen) return;
    let abgebrochen = false;
    const t = setTimeout(() => {
      void searchFamilies(suche).then((antwort) => {
        if (abgebrochen || antwort === null) return;
        setTreffer(antwort);
      });
    }, suche === "" ? 0 : 250);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [suche, offen]);

  function zuordnen(id: number | null) {
    setFehler(null);
    start(async () => {
      const ergebnis = await setFigureCharacter(skyId, id);
      if (ergebnis.ok) { setOffen(false); setSuche(""); }
      else setFehler(ergebnis.message);
    });
  }

  function anlegen() {
    const name = suche.trim();
    if (name === "") return;
    setFehler(null);
    start(async () => {
      const ergebnis = await createCharacterFamily(name);
      if (!ergebnis.ok) { setFehler(ergebnis.message); return; }
      const antwort = await searchFamilies(name);
      if (antwort !== null) setTreffer(antwort);
    });
  }

  return (
    <div className="text-left">
      <p className="text-sm">
        {familienname ?? de.admin.familyAssignNone}
        {familie !== null ? (
          <span className="ml-1 font-mono text-[11px] text-muted">#{familie}</span>
        ) : null}
      </p>

      {!offen ? (
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="focus-ring mt-1 min-h-11 text-xs text-muted underline decoration-dotted"
        >
          {de.admin.familySubmitAssign}
        </button>
      ) : (
        <div className="mt-2 rounded-sky-md bg-base p-3 ring-1 ring-border">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {de.admin.familySearch}
            <input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-sm
                         text-foreground ring-1 ring-border-strong"
            />
          </label>

          {treffer.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{de.admin.familyNone}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {treffer.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={pending || f.id === familie}
                    onClick={() => zuordnen(f.id)}
                    className={"focus-ring flex min-h-11 w-full flex-col items-start "
                      + "rounded-sky-md px-3 py-2 text-left text-xs ring-1 ring-border "
                      + "disabled:opacity-50"}
                  >
                    <span className="font-medium">{f.name}</span>
                    <span className="text-[11px] text-muted">
                      {de.admin.familyMembers(f.mitglieder)}
                      {f.serien.length > 0 ? ` · ${f.serien.join(" ")}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {suche.trim() !== ""
            && !treffer.some((f) => f.name.toLowerCase() === suche.trim().toLowerCase()) ? (
              <button
                type="button" disabled={pending} onClick={anlegen}
                className="focus-ring mt-2 min-h-11 w-full rounded-sky-md bg-surface px-3
                           text-xs ring-1 ring-border disabled:opacity-50"
              >
                {de.admin.familyCreateAs(suche.trim())}
              </button>
            ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {/* DER RÜCKWEG. Eine falsche Familie muss sich zurücknehmen
                lassen; `0158` nimmt dafür ausdrücklich NULL an. */}
            {familie !== null ? (
              <button
                type="button" disabled={pending} onClick={() => zuordnen(null)}
                className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-xs
                           ring-1 ring-border disabled:opacity-50"
              >
                {de.admin.familyRemove}
              </button>
            ) : null}
            <button
              type="button" onClick={() => { setOffen(false); setFehler(null); }}
              className="focus-ring min-h-11 rounded-sky-md px-3 text-xs text-muted"
            >
              {de.admin.discardConfirmNo}
            </button>
          </div>

          {fehler ? (
            <p role="alert" className="mt-2 text-xs text-danger">{fehler}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
