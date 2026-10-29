/**
 * WELCHER TYPE AUF DER KACHEL STEHT — ein Dropdown, und nichts weiter
 * (CAT-10).
 *
 * ES BIETET NUR AN, WAS HINTERLEGT IST. Das war eine ausdrueckliche
 * Anforderung, und sie hat einen Grund: alle siebzehn Werte hier anzubieten
 * waere ein ZWEITER Weg, die Typmenge zu aendern — und den gibt es nur im
 * Bearbeiten-Dialog. Dieses Feld entscheidet ausschliesslich, welcher der
 * schon zugeordneten Types als Banner erscheint.
 *
 * „–" IST EINE WAHL UND KEIN LEERZUSTAND. Sie schreibt `visible_type = NULL`
 * UND `visible_type_decided = true`: „ausdruecklich kein Banner". Deshalb
 * ueberschreibt der Prioritaetsvorschlag sie nicht, und nach einem Neuladen
 * steht sie wieder da (Entscheidung D4).
 *
 * DER VORSCHLAG IST EINE VORAUSWAHL UND NIE EIN BANNER. Hat noch niemand
 * entschieden, steht die Prioritaet (`proposeVisibleType`) als Vorschlag
 * daneben — als Knopf, den der Bediener druecken kann. Die Kachel zeigt bis
 * dahin KEIN Banner. Ein abgeleitetes Banner haette auf 248 oeffentlichen
 * Kacheln eines erscheinen lassen, das niemand gewaehlt hat.
 *
 * WO ES STEHT: im `trade`-Slot der Kachel — dort, wo ein Sammler die
 * Angebotszeile sieht. Keine neue Geometrie, kein neuer Slot, keine zweite
 * Kachel. `row-template.ts` rechnet weiter mit derselben Breite.
 *
 * ES IST KEINE BERECHTIGUNG. `admin_set_visible_type` fragt
 * `is_platform_admin()` SELBST in der Datenbank und weist einen Type ab, der
 * der Zeile nicht zugeordnet ist — ein Aufruf ohne Recht scheitert mit
 * `42501`, auch wenn er diese Datei nie gesehen hat.
 */
"use client";

import { useState, useTransition } from "react";

import { setVisibleType } from "@/lib/admin/actions";
import {
  TYPE_LABELS, asCatalogTypes, isCatalogType, proposeVisibleType,
  type CatalogType,
} from "@/lib/catalog/catalog-type";
import { de } from "@/lib/i18n/de";

export function TypeSelect({
  skyId,
  name,
  types,
  visibleType,
  decided,
}: {
  skyId: string;
  /** Für die Vorlesehilfe: ein Raster davon ist sonst 561-mal „Banner". */
  name: string;
  /** Die hinterlegte Menge — nur daraus wird gewählt. */
  types: readonly string[];
  visibleType: string | null;
  decided: boolean;
}) {
  const vorhanden = asCatalogTypes(types);
  const [wert, setWert] = useState<CatalogType | null>(
    isCatalogType(visibleType) ? visibleType : null);
  const [entschieden, setEntschieden] = useState(decided);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /*
   * OHNE TYPES GIBT ES NICHTS ZU WÄHLEN — und dann steht hier auch kein
   * leeres Feld. Ein Dropdown mit genau einem Eintrag („–") wäre ein
   * Bedienelement, das nichts kann; der Satz sagt stattdessen, wo die Types
   * herkommen.
   */
  if (vorhanden.length === 0) {
    return (
      <span className="ml-auto shrink-0 text-[10px] leading-tight text-muted">
        {de.admin.typeNone}
      </span>
    );
  }

  function waehlen(roh: string) {
    const ziel = roh === "" ? null : roh;
    if (ziel !== null && !isCatalogType(ziel)) return;
    const vorher = wert;
    const vorherEntschieden = entschieden;
    setWert(ziel as CatalogType | null);   /* optimistisch, wie das Auge */
    setEntschieden(true);
    setFehler(null);
    start(async () => {
      const ergebnis = await setVisibleType(skyId, ziel);
      if (!ergebnis.ok) {
        setWert(vorher);
        setEntschieden(vorherEntschieden);
        setFehler(ergebnis.message);
      }
    });
  }

  /* Der Vorschlag — nur solange niemand entschieden hat. */
  const vorschlag = entschieden ? null : proposeVisibleType(vorhanden);

  return (
    <span className="relative ml-auto flex min-h-11 shrink-0 items-center gap-1">
      {/*
        * EIN ECHTES `<select>`, und das ist eine Entscheidung. Auf dem
        * Telefon öffnet es die Liste des Betriebssystems — mit der
        * Bedienung, die der Nutzer kennt, und ohne dass eine 44-px-Kachel
        * ein eigenes Menü aufziehen muss, das über die Nachbarzeile läuft.
        */}
      <select
        value={wert ?? ""}
        onChange={(e) => waehlen(e.target.value)}
        disabled={pending}
        aria-label={de.admin.typeBannerFor(name)}
        title={de.admin.typeBanner}
        className={
          "focus-ring min-h-11 max-w-[8.5rem] rounded-sky-sm bg-deep/40 px-1.5 "
          + "text-[11px] leading-none text-foreground ring-1 ring-border/50 "
          + "disabled:opacity-60"
        }
      >
        <option value="">{de.admin.typeNoBanner}</option>
        {vorhanden.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>

      {/*
        * DER VORSCHLAG, als Knopf und nicht als Wirkung. Er steht nur da,
        * solange niemand entschieden hat, und ein Druck darauf IST die
        * Entscheidung.
        */}
      {vorschlag !== null && vorschlag !== wert ? (
        <button
          type="button"
          onClick={() => waehlen(vorschlag)}
          disabled={pending}
          aria-label={de.admin.typeProposeFor(name, TYPE_LABELS[vorschlag])}
          title={de.admin.typePropose(TYPE_LABELS[vorschlag])}
          className={
            "focus-ring min-h-11 shrink-0 rounded-sky-sm px-1 text-[10px] "
            + "leading-none text-muted hover:text-foreground disabled:opacity-40"
          }
        >
          {de.admin.typeProposeShort}
        </button>
      ) : null}

      {fehler ? (
        <span role="alert"
              className="absolute right-0 bottom-11 z-10 w-56 rounded-sky-md bg-surface
                         p-2 text-[11px] leading-snug text-danger shadow-card
                         ring-1 ring-border-strong">
          {fehler}
        </span>
      ) : null}
    </span>
  );
}
