"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  mergeDraftIntoFigure, publishDraftStandalone, publishDraftVariantAuto,
  publishDraftWithBase,
} from "@/lib/admin/actions";
import { searchMergeTargets, type Zielzeile } from "@/lib/admin/merge-search";
import {
  searchBaseFigures, type Basiszeile, type Basissuche,
} from "@/lib/admin/base-figure-search";
import {
  GESCHUETZT, nutzlast, tabellenzeilen, vorschau,
  type MergeFeld, type Tabellenzeile, type Werte,
} from "@/lib/admin/merge-candidates";
import type { Zeilenkopf } from "@/components/admin/row-actions";
import { ACTION_PRIMARY } from "@/components/ui/action";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

/**
 * CAT-06 — ein Dialog, drei Wege: was soll aus diesem Entwurf werden?
 *
 *   A  Bestehende Figur aktualisieren   Zielsuche · Änderungstabelle · Kästchen
 *   B  Als Variante hinzufügen          Familiensuche · Zuordnungsvorschau
 *   C  Als eigenständige Figur          eine Bestätigung, keine Suche
 *
 * DIE FRAGE KOMMT ZUERST, und danach steht nur, was der gewählte Weg
 * braucht. Drei Formulare nebeneinander wären auf einem Telefon unbenutzbar,
 * und zwei davon wären immer falsch.
 *
 * KEIN WEG ERFINDET EINEN MECHANISMUS. A ist `admin_merge_draft`
 * (0154/0156/0157), B ist `admin_publish_as_variant` (0158) — zuordnen und
 * veröffentlichen in einer Transaktion —, C ist `admin_set_catalog_status`
 * (0152), unverändert. Weg C brauchte nie eine neue Funktion: ein Entwurf
 * hat SKY-ID und Slug schon, veröffentlichen heißt den Status setzen.
 *
 * DIE FAMILIE IST EINE ZUORDNUNG, KEIN DATENSATZ ZUM ABSCHREIBEN. Bei Weg B
 * wird kein Feld der Grundfigur gelesen; der Entwurf behält Namen, Bild,
 * Edition, SKY-ID und Slug. „Chrome Spyro" bleibt „Chrome Spyro" und wird
 * nicht zu „Spyro (Chrome)" — die Klammerschreibweise wird abgeschafft, und
 * diese Oberfläche erzeugt sie an keiner Stelle.
 *
 * -------------------------------------------------------------------------
 * WEG A, unverändert aus CAT-05F/G: die Änderungstabelle mit Kästchen.
 *
 * VIER SCHRITTE: suchen, Ziel wählen, Änderungen abwählen, bestätigen. Jede
 * anstehende Änderung ist eine Zeile; unveränderte Felder kommen nicht vor.
 * Standardmäßig ist alles angekreuzt — der häufigste Fall ist „alles
 * übernehmen", der zweithäufigste „alles außer dem Bild".
 *
 * DIE KÄSTCHEN WIRKEN WIRKLICH. Was abgewählt ist, wird nicht geschickt, und
 * `0156` übernimmt nur, was dasteht. Ein Kästchen, das bloß die Anzeige
 * ändert, wäre eine Behauptung — und beim Bild zusätzlich ein unnötiger
 * Speichervorgang.
 *
 * DIE VORSCHAU IST DIESELBE RECHNUNG WIE IN `0156`. `vorschau()` spiegelt
 * `admin_merge_plan()`; der Server glaubt dieser Spiegelung aber nicht, er
 * vergleicht sie mit seiner eigenen Rechnung und bricht bei Abweichung ab.
 * Eine veraltete Vorschau kann deshalb keinen fremden Wert schreiben.
 *
 * ER TÄUSCHT KEINE FUNKTION VOR. Liegt `0156` auf dieser Datenbank nicht,
 * sagt er das und sperrt — dasselbe bei Referenzen auf den Entwurf.
 */

const FELDNAMEN: Record<MergeFeld, string> = {
  name: "Name",
  display_name_override: "Anzeigename",
  series_code: "Serie",
  category_id: "Kategorie",
  card_type: "Edition",
  item_type: "Objekttyp",
  character_id: "Charakter",
  image_override_path: "Bild",
};

/** Die Überschrift einer Tabellenzeile — gekoppelte Felder zusammengefasst. */
const zeilenname = (z: Tabellenzeile) =>
  z.felder.map((f) => FELDNAMEN[f]).join(" / ");

const werteVon = (z: Zielzeile): Werte => ({
  /* `nameRaw` und NICHT `name`: `0156` rechnet mit der Spalte `name`. Der
     Anzeigename ist ein eigenes Feld und steht eine Zeile darunter. */
  name: z.nameRaw,
  display_name_override: z.displayNameOverride,
  series_code: z.seriesCode,
  category_id: String(z.categoryId),
  card_type: z.cardType,
  item_type: z.itemType,
  character_id: z.characterId === null ? null : String(z.characterId),
  image_override_path: z.imageOverridePath,
});

const kurz = (v: string | null) =>
  v === null || v === "" ? de.admin.mergeEmpty : (v.length > 48 ? `${v.slice(0, 45)}…` : v);

/**
 * Ein Vorschaubild, oder ein neutraler Platzhalter.
 *
 * Der Platzhalter ist ein gerahmtes Feld und kein gebrochenes Bild: „kein
 * Bild" ist ein echter Zustand und kein Fehler (ADR-0009).
 */
function Bildchen({ src, alt }: { src: string | null; alt: string }) {
  /* 48 x 48 in BEIDEN Fällen — Bild und Platzhalter —, damit die Zeile nicht
     springt, je nachdem ob die bestehende Figur schon ein Bild hat. */
  if (src === null) {
    return (
      <span
        aria-label={de.admin.mergeImageNone}
        title={de.admin.mergeImageNone}
        className="flex size-12 shrink-0 items-center justify-center rounded-sky-sm
                   bg-surface-raised text-[10px] text-muted ring-1 ring-border"
      >
        {de.admin.mergeEmpty}
      </span>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element --
       Zwei 40-px-Vorschaubilder in einem Adminfenster; `next/image` brächte
       hier einen Optimierungsdurchlauf für Bilder, die niemand ausliefert. */
    <img
      src={src} alt={alt} width={48} height={48} loading="lazy"
      className="size-12 shrink-0 rounded-sky-sm object-contain
                 bg-surface-raised ring-1 ring-border"
    />
  );
}

/** Welcher der drei Wege gerade bedient wird. `null` = die Frage steht noch. */
type Weg = "a" | "b" | "c";

export function DraftDialog({
  entwurf, onClose,
}: {
  entwurf: Zeilenkopf;
  onClose: () => void;
}) {
  const [weg, setWeg] = useState<Weg | null>(null);
  const [suche, setSuche] = useState("");
  /*
   * WEG B: die BASISFIGURSUCHE, getrennt von der Zielsuche aus Weg A.
   *
   * Gesucht wird eine Basisfigur DERSELBEN Serie — nicht eine Familie. Die
   * vier Filter (gleiche Serie, keine Varianten, keine Entwürfe, nicht sie
   * selbst) stehen im Server; hier wird nur angezeigt, was übrig bleibt.
   */
  const [basSuche, setBasSuche] = useState("");
  const [basis, setBasis] = useState<Basissuche | null>(null);
  const [gewaehlteBasis, setGewaehlteBasis] = useState<Basiszeile | null>(null);
  const [basGesperrt, setBasGesperrt] = useState(false);
  const [treffer, setTreffer] = useState<Zielzeile[]>([]);
  const [entwurfVoll, setEntwurfVoll] = useState<Zielzeile | null>(null);
  const [zustand, setZustand] = useState<"laedt" | "ok" | "gesperrt" | "ausgeschaltet" | "fehler">("laedt");
  const [sperrgrund, setSperrgrund] = useState<string | null>(null);
  const [ziel, setZiel] = useState<Zielzeile | null>(null);
  /*
   * DIE ABWAHL, nicht die Auswahl.
   *
   * Angekreuzt ist der Normalfall — gespeichert wird deshalb, was der
   * Bediener ABGEWÄHLT hat. Das erspart den Effekt, der die Auswahl bei
   * jedem neuen Ziel zurücksetzen müsste: die Abwahl trägt ihr Ziel mit
   * sich, und zu einem anderen Ziel gilt sie einfach nicht mehr.
   */
  const [abwahl, setAbwahl] =
    useState<{ ziel: string; ids: ReadonlySet<string> }>({ ziel: "", ids: new Set() });
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /* WEG A lädt nur, wenn Weg A gewählt ist — die Zielsuche liest 730
     Katalogzeilen, und für Weg B und C braucht sie niemand. */
  useEffect(() => {
    if (weg !== "a") return;
    let abgebrochen = false;
    const t = setTimeout(() => {
      void searchMergeTargets(entwurf.skyId, suche).then((antwort) => {
        if (abgebrochen) return;
        if (antwort === null) { setZustand("fehler"); return; }
        setTreffer(antwort.treffer);
        setEntwurfVoll(antwort.entwurf);
        const r = antwort.referenzen;
        if (r.art === "nicht_freigeschaltet") {
          setZustand("ausgeschaltet"); setSperrgrund(de.admin.mergeNotEnabled);
        } else if (r.art === "fehler") {
          setZustand("fehler"); setSperrgrund(de.admin.mergeReferencesUnknown);
        } else if (r.referenzen.length > 0) {
          setZustand("gesperrt");
          setSperrgrund(`${de.admin.mergeBlocked} (${
            r.referenzen.map((x) => `${x.tabelle} ${x.zeilen}`).join(", ")})`);
        } else {
          setZustand("ok"); setSperrgrund(null);
        }
      });
    }, suche === "" ? 0 : 250);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [entwurf.skyId, suche, weg]);

  /* WEG B: die Basisfiguren. Eigene Suche, eigener Zustand, dieselbe Form. */
  useEffect(() => {
    if (weg !== "b") return;
    let abgebrochen = false;
    const t = setTimeout(() => {
      void searchBaseFigures(entwurf.skyId, basSuche).then((antwort) => {
        if (abgebrochen) return;
        if (antwort === null) { setBasGesperrt(true); return; }
        setBasGesperrt(false);
        setBasis(antwort);
      });
    }, basSuche === "" ? 0 : 250);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [entwurf.skyId, basSuche, weg]);

  /* Die Tabelle. `useMemo`, weil sie an zwei Stellen gebraucht wird — für die
     Anzeige und für die Nutzlast — und beide dieselbe sein müssen. */
  const zeilen = useMemo(
    () => (ziel && entwurfVoll
      ? tabellenzeilen(vorschau(werteVon(ziel), werteVon(entwurfVoll), ziel.skyId))
      : []),
    [ziel, entwurfVoll],
  );
  const behalten = useMemo(
    () => (ziel && entwurfVoll
      ? vorschau(werteVon(ziel), werteVon(entwurfVoll), ziel.skyId).behalten
      : []),
    [ziel, entwurfVoll],
  );

  /* Eine Abwahl zu einem anderen Ziel zählt nicht — dann ist alles an. */
  const aus = abwahl.ziel === ziel?.skyId ? abwahl.ids : new Set<string>();
  const gewaehlt: ReadonlySet<string> =
    new Set(zeilen.filter((z) => !aus.has(z.id)).map((z) => z.id));

  const alleAn = zeilen.length > 0 && gewaehlt.size === zeilen.length;
  const bedienbar = zustand === "ok";
  const anzahl = gewaehlt.size;

  function umschalten(id: string) {
    if (!ziel) return;
    const n = new Set(aus);
    if (n.has(id)) n.delete(id); else n.add(id);
    setAbwahl({ ziel: ziel.skyId, ids: n });
  }

  function alleUmschalten() {
    if (!ziel) return;
    setAbwahl({ ziel: ziel.skyId,
                ids: alleAn ? new Set(zeilen.map((z) => z.id)) : new Set() });
  }

  /*
   * Zeigt die Liste mehr als eine Kategorie? Dann unterscheidet die Angabe
   * etwas und gehört in die Zeile; sonst wäre sie achtmal dasselbe Wort.
   * Abgeleitet und nicht gespeichert — ein Zustand mehr wäre ein Zustand,
   * der veralten kann.
   */
  const katUnterschiedlich =
    new Set((basis?.treffer ?? []).map((b) => b.categoryName)).size > 1;

  function absendenVariante() {
    if (!gewaehlteBasis) return;
    setFehler(null);
    start(async () => {
      /*
       * ZWEI WEGE, UND DIE ARTIKELART ENTSCHEIDET (CAT-08 Korrektur).
       *
       * `0161` regelt die CHARAKTERFAMILIE — übernehmen, suchen, anlegen.
       * Für einen Trap, ein Fahrzeug oder einen Kristall ist das falsch:
       * `characters` führt keine solchen Zeilen (`character-data.test.ts`),
       * und `0161` kennt die Artikelart nicht. Bis eine Folgemigration ihr
       * die Frage beibringt, geht dieser Dialog für Nicht-Charaktere den
       * Weg aus `0159` mit `p_create_family = false` — er setzt die
       * Basiszuordnung und veröffentlicht, und er fasst die Familie
       * NACHWEISLICH nicht an.
       *
       * Das ist eine Zwischenlösung an der sicheren Seite, und sie steht
       * hier und nicht in der Datenbank, weil eine Datenbankänderung eine
       * eigene Freigabe braucht.
       */
      const ergebnis = basis?.art === "character"
        ? await publishDraftVariantAuto(entwurf.skyId, gewaehlteBasis.skyId)
        : await publishDraftWithBase(entwurf.skyId, gewaehlteBasis.skyId, false);
      if (ergebnis.ok) onClose();
      else setFehler(ergebnis.message);
    });
  }

  function absendenEigen() {
    setFehler(null);
    start(async () => {
      const ergebnis = await publishDraftStandalone(entwurf.skyId);
      if (ergebnis.ok) onClose();
      else setFehler(ergebnis.message);
    });
  }

  function absenden() {
    if (!ziel || !entwurfVoll || !bedienbar || anzahl === 0) return;
    setFehler(null);
    const auswahl = nutzlast(zeilen, gewaehlt);
    start(async () => {
      const ergebnis = await mergeDraftIntoFigure(
        entwurf.skyId, ziel.skyId, auswahl, entwurfVoll.imageOverridePath);
      if (ergebnis.ok) onClose();
      else setFehler(ergebnis.message);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${de.admin.rowMerge}: ${entwurf.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/*
        Am Telefon von unten, am Schreibtisch mittig — dieselbe Fläche.

        `text-left` IST DIE WURZEL EINES ECHTEN FEHLERS und keine Zierde.
        Dieser Dialog wird INNERHALB der Katalogtabelle gerendert, in der
        Zelle der Aktionsspalte — und die trägt `text-right`, damit die drei
        Icons rechts stehen (`admin/catalog/page.tsx`). `position: fixed`
        nimmt das Element aus dem Fluss, aber `text-align` ist eine
        VERERBTE Eigenschaft und kaskadiert durch den DOM-Baum weiter,
        unabhängig von der Positionierung. Jede Tabellenzelle hier erbte
        deshalb rechtsbündig, während die Kopfzeile ihr `text-left` selbst
        setzte — Kopf links, Inhalt rechts, genau das sichtbare Bild.

        Die Ausrichtung wird deshalb EINMAL hier gesetzt, für den ganzen
        Dialog, und nicht in jeder Zelle noch einmal.
      */}
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-sky-md bg-surface
                      p-4 text-left ring-1 ring-border-strong sm:rounded-sky-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{de.admin.mergeHeading}</h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {entwurf.name} <span className="font-mono">{entwurf.skyId}</span>
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label={de.admin.discardConfirmNo}
            className="focus-ring -m-2 flex size-11 shrink-0 items-center justify-center rounded-sky-md"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {weg === "a" && sperrgrund !== null ? (
          <p role="alert" className="mt-3 rounded-sky-md bg-base p-2 text-xs text-danger">
            {sperrgrund}
          </p>
        ) : null}

        {/*
          DIE FRAGE ZUERST. Solange kein Weg gewählt ist, steht nur sie da —
          drei Formulare nebeneinander wären auf einem Telefon unbenutzbar,
          und zwei davon wären immer falsch.
        */}
        {weg === null ? (
          <div className="mt-3">
            <p className="text-xs font-medium">{de.admin.draftWhat}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {([
                ["a", de.admin.draftWayUpdate, de.admin.draftWayUpdateHint],
                ["b", de.admin.draftWayVariant, de.admin.draftWayVariantHint],
                ["c", de.admin.draftWaySolo, de.admin.draftWaySoloHint],
              ] as const).map(([k, titel, hinweis]) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => { setWeg(k); setFehler(null); }}
                    className="focus-ring flex min-h-11 w-full flex-col items-start
                               rounded-sky-md px-3 py-2 text-left ring-1 ring-border
                               hover:ring-border-strong"
                  >
                    <span className="text-sm font-medium">{titel}</span>
                    <span className="text-[11px] text-muted">{hinweis}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setWeg(null); setZiel(null); setGewaehlteBasis(null);
                             setFehler(null); }}
            className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1 text-xs text-muted"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {de.admin.draftWhat}
          </button>
        )}

        {/* ------------------------------------------ WEG B: Basisfigur */}
        {weg === "b" ? (
          <div className="mt-3">
            {basGesperrt ? (
              <p role="alert" className="rounded-sky-md bg-base p-2 text-xs text-danger">
                {de.admin.mergeReferencesUnknown}
              </p>
            ) : null}

            <label className="flex flex-col gap-1 text-xs text-muted">
              {de.admin.baseSearch}
              <input
                value={basSuche}
                onChange={(e) => { setBasSuche(e.target.value); setGewaehlteBasis(null); }}
                className="focus-ring min-h-11 rounded-sky-md bg-base px-3 text-sm
                           text-foreground ring-1 ring-border-strong"
              />
            </label>
            {basis?.serie && basis.art !== null ? (
              <p className="mt-1 text-[11px] text-muted">
                {de.admin.baseSearchHintClass(basis.serie,
                                              de.admin.baseClassName(basis.art))}
              </p>
            ) : null}

            {/* KEINE AUSKUNFT IST EIN ERGEBNIS (Anforderung 7). Lässt sich
                die Artikelart nicht sicher sagen, wird nichts angeboten —
                und der Grund steht da, statt dass die Liste leer bleibt. */}
            {basis !== null && basis.art === null ? (
              <p role="status" className="mt-2 text-xs text-muted">
                {de.admin.baseClassUnknown}
              </p>
            ) : null}

            {basis !== null && basis.art === null ? null
             : basis !== null && basis.moeglich === 0 ? (
              <p className="mt-2 text-xs text-muted">{de.admin.baseNoneAtAll}</p>
            ) : (basis?.treffer.length ?? 0) === 0 ? (
              <p className="mt-2 text-xs text-muted">{de.admin.baseNone}</p>
            ) : (
              <>
                {/* WIE VIELE ES SIND. Die Liste zeigt höchstens acht; ohne
                    diese Zeile wüsste der Bediener nicht, ob er alles sieht
                    oder nur den Anfang. */}
                <p className="mt-2 text-[11px] text-muted">
                  {de.admin.baseShown(basis?.treffer.length ?? 0, basis?.gefunden ?? 0)}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(basis?.treffer ?? []).map((b) => (
                    <li key={b.skyId}>
                      <button
                        type="button"
                        onClick={() => {
                          setGewaehlteBasis(b);
                          setFehler(null);
                        }}
                        aria-pressed={gewaehlteBasis?.skyId === b.skyId}
                        className={"focus-ring flex min-h-11 w-full flex-col items-start "
                          + "justify-center gap-0.5 rounded-sky-md px-3 py-1.5 text-left "
                          + "ring-1 "
                          + (gewaehlteBasis?.skyId === b.skyId
                              ? "ring-action-neutral-edge bg-surface-raised" : "ring-border")}
                      >
                        {/* DER NAME TRÄGT. Er ist das Einzige, was in der
                            Liste groß ist — auf dem Telefon bleibt daneben
                            kein Platz für mehr. */}
                        <span className="text-sm font-medium leading-tight">{b.name}</span>
                        <span className="text-[11px] leading-tight text-muted">
                          <span className="font-mono">{b.skyId}</span>
                          {" · "}{b.seriesCode}
                          {/* DIE KATEGORIE NUR, WENN SIE HIER ETWAS
                              UNTERSCHEIDET. Stehen alle Treffer in derselben,
                              ist sie achtmal dasselbe Wort. */}
                          {katUnterschiedlich ? ` · ${b.categoryName}` : ""}
                          {/* UND DIE VARIANTEN NUR, WENN ES WELCHE GIBT.
                              „bisher ohne Varianten" stand vorher bei fast
                              jeder Zeile. */}
                          {b.varianten > 0 ? ` · ${de.admin.baseVariantsShort(b.varianten)}` : ""}
                        </span>
                        {/* WARUM SIE OBEN STEHT — eine Begründung, keine
                            Auswahl. Angeklickt wird weiterhin von Hand. */}
                        {basis?.empfehlung?.skyId === b.skyId ? (
                          <span className="text-[11px] leading-tight text-action-neutral-edge">
                            {de.admin.baseLikely(basis.empfehlung.vorsilbe)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {gewaehlteBasis ? (
              <div className="mt-3 rounded-sky-md bg-base p-3 ring-1 ring-border">
                <p className="text-xs font-medium">{de.admin.basePreview}</p>
                <p className="mt-1 text-xs">
                  <span className="font-medium">{entwurf.name}</span>
                  <span className="text-muted"> — {de.admin.baseAssign} </span>
                  <span className="font-medium">{gewaehlteBasis.name}</span>
                  <span className="ml-1 font-mono text-[11px] text-muted">
                    {gewaehlteBasis.skyId}
                  </span>
                </p>

                {/* DIE FAMILIE IST EINE ANKÜNDIGUNG, KEINE FRAGE (CAT-08,
                    `0161`). Vorher stand hier eine Checkbox „neue Familie
                    anlegen?" — eine Frage, die der Bediener nicht beantworten
                    kann, weil sie nur eine Folge seiner Wahl der Basisfigur
                    ist. Jetzt steht hier EIN Satz, der sagt, was geschieht.

                    Widerspricht die Familie der Variante der der Basisfigur,
                    weist `0161` ab, statt zu überschreiben; findet es eine
                    gleichnamige Familie, deren Mitglieder nicht passen,
                    ebenso. Beide Meldungen landen in `fehler` und stehen
                    unten im Dialog. */}
                <p className="mt-1 text-[11px] text-muted">
                  {basis?.art !== "character"
                    /* NUR CHARAKTERFIGUREN BEKOMMEN EINE FAMILIE. Ein Trap,
                       ein Fahrzeug, ein Kristall ist kein Charakter —
                       `characters` führt sie nicht, und `0161` darf ihnen
                       keine anlegen. Für sie geht der Dialog den Weg aus
                       `0159` mit `p_create_family = false`. */
                    ? de.admin.baseFamilyOnlyCharacters
                    : gewaehlteBasis.characterId !== null
                      ? de.admin.baseFamilyFromBase(`#${gewaehlteBasis.characterId}`)
                      : de.admin.baseFamilyAuto(gewaehlteBasis.nameRaw)}
                </p>

                <p className="mt-2 text-[11px] text-muted">{de.admin.baseKeeps}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {de.admin.mergeProtected}: {GESCHUETZT.join(" · ")}
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={absendenVariante}
                  className={`mt-3 ${ACTION_PRIMARY} disabled:opacity-50`}
                >
                  {de.admin.baseSubmit}
                </button>
              </div>
            ) : null}
            {fehler ? (
              <p role="alert" className="mt-2 text-xs text-danger">{fehler}</p>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------- WEG C: eigenständig */}
        {weg === "c" ? (
          <div className="mt-3 rounded-sky-md bg-base p-3 ring-1 ring-border">
            <p className="text-xs">{de.admin.soloKeeps}</p>
            <p className="mt-2 text-[11px] text-muted">
              {de.admin.mergeKeepsId}: <span className="font-mono">{entwurf.skyId}</span>
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={absendenEigen}
              className={`mt-3 ${ACTION_PRIMARY} disabled:opacity-50`}
            >
              {de.admin.soloSubmit}
            </button>
            {fehler ? (
              <p role="alert" className="mt-2 text-xs text-danger">{fehler}</p>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------- WEG A: Merge */}
        {weg === "a" ? (
        <>
        <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
          {de.admin.mergeSearch}
          <input
            value={suche}
            onChange={(e) => { setSuche(e.target.value); setZiel(null); setFehler(null); }}
            className="focus-ring min-h-11 rounded-sky-md bg-base px-3 text-sm text-foreground
                       ring-1 ring-border-strong"
          />
        </label>

        {zustand === "laedt" ? (
          <p className="mt-3 text-xs text-muted">…</p>
        ) : treffer.length === 0 ? (
          <p className="mt-3 text-xs text-muted">{de.admin.mergeNoSuggestions}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {treffer.map((t) => (
              <li key={t.skyId}>
                <button
                  type="button"
                  onClick={() => { setZiel(t); setFehler(null); }}
                  aria-pressed={ziel?.skyId === t.skyId}
                  className={"focus-ring flex min-h-11 w-full flex-col items-start rounded-sky-md "
                    + "px-3 py-2 text-left text-xs ring-1 "
                    + (ziel?.skyId === t.skyId
                        ? "ring-action-neutral-edge bg-surface-raised" : "ring-border")}
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {t.skyId} · {t.seriesCode} · {t.categoryName}
                    {t.stufe ? ` · ${t.stufe}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {ziel && entwurfVoll ? (
          <div className="mt-4 rounded-sky-md bg-base p-3 ring-1 ring-border">
            <p className="text-xs font-medium">{de.admin.mergePreview}</p>

            {zeilen.length === 0 ? (
              <p className="mt-1 text-xs text-muted">{de.admin.mergeNoChange}</p>
            ) : (
              /* HORIZONTAL SCROLLBAR, FALLS NÖTIG — und nur die Tabelle, nicht
                 die Seite. Abgeschnitten wird nichts. */
              /* HORIZONTAL SCROLLBAR, FALLS NÖTIG — und nur die Tabelle, nicht
                 die Seite. Abgeschnitten wird nichts. */
              <div className="mt-2 -mx-1 overflow-x-auto px-1">
                {/*
                  `table-fixed` MIT `colgroup`: die Spaltenbreiten stehen an
                  EINER Stelle und gelten für Kopf und Rumpf gleich. Ohne
                  `table-fixed` ist eine Breitenangabe nur ein Vorschlag —
                  der Browser rechnet dann aus dem Inhalt, und zwei Zeilen mit
                  unterschiedlich langen Werten verschieben die Spalten
                  gegeneinander.

                  44 px für das Kästchen, 88 px für den Feldnamen, der Rest zu
                  gleichen Teilen auf die beiden Wertespalten — bei der
                  Mindestbreite von 28 rem sind das die gewünschten 35 %, und
                  am Schreibtisch wachsen nur die beiden Wertespalten mit.
                */}
                <table className="w-full min-w-[28rem] table-fixed border-collapse text-xs">
                  <colgroup>
                    <col className="w-11" />
                    <col className="w-[5.5rem]" />
                    <col className="w-[35%]" />
                    <col className="w-[35%]" />
                  </colgroup>
                  <thead>
                    <tr className="text-muted">
                      <th scope="col" className="px-2 pb-1.5 font-normal">
                        <label className="flex size-11 cursor-pointer items-center justify-start">
                          <span className="sr-only">
                            {alleAn ? de.admin.mergeSelectNone : de.admin.mergeSelectAll}
                          </span>
                          <input
                            type="checkbox"
                            checked={alleAn}
                            onChange={alleUmschalten}
                            className="focus-ring size-4 accent-action-neutral-edge"
                          />
                        </label>
                      </th>
                      <th scope="col" className="px-2 pb-1.5 font-normal">{de.admin.mergeField}</th>
                      <th scope="col" className="px-2 pb-1.5 font-normal">{de.admin.mergeOldValue}</th>
                      <th scope="col" className="px-2 pb-1.5 font-normal">{de.admin.mergeNewValue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zeilen.map((z) => {
                      const an = gewaehlt.has(z.id);
                      const bild = z.id === "image_override_path";
                      return (
                        <tr key={z.id} className="border-t border-border">
                          {/* EIN Padding für alle Zellen, EINE vertikale
                              Ausrichtung — sonst sitzt eine Textzelle anders
                              als die Zelle daneben mit dem Vorschaubild. */}
                          <td className="px-2 py-1.5 align-middle">
                            <label className="flex size-11 cursor-pointer items-center justify-start">
                              <span className="sr-only">
                                {de.admin.mergeSelectRow(zeilenname(z))}
                              </span>
                              <input
                                type="checkbox"
                                checked={an}
                                onChange={() => umschalten(z.id)}
                                className="focus-ring size-4 accent-action-neutral-edge"
                              />
                            </label>
                          </td>
                          <td className={`px-2 py-1.5 align-middle font-medium
                                          ${an ? "" : "text-muted"}`}>
                            {zeilenname(z)}
                          </td>
                          {bild ? (
                            /* DIE BILDZEILE: zwei Vorschaubilder, gleiche
                               Größe, gleiche Zellform wie jede andere Zeile.
                               „Bisher" ist, was die Karte heute zeigt — auch
                               wenn das ein Altimportbild ohne Override ist. */
                            <>
                              <td className="px-2 py-1.5 align-middle">
                                <Bildchen
                                  src={imageSrc({ imageFile: ziel.imageFile,
                                                  imageOverridePath: ziel.imageOverridePath })}
                                  alt={de.admin.mergeImageOld}
                                />
                              </td>
                              <td className="px-2 py-1.5 align-middle">
                                <Bildchen
                                  src={imageSrc({ imageFile: null,
                                                  imageOverridePath: entwurfVoll.imageOverridePath })}
                                  alt={de.admin.mergeImageNew}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-2 py-1.5 align-middle text-muted">
                                <span className={`break-words ${an ? "line-through" : ""}`}>
                                  {kurz(z.aenderungen.map((a) => a.alt ?? "").join(" · ") || null)}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 align-middle">
                                <span className={`break-words
                                                  ${an ? "" : "text-muted line-through"}`}>
                                  {kurz(z.aenderungen.map((a) => a.neu ?? "").join(" · ") || null)}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {behalten.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-0.5 text-[11px] text-muted">
                {behalten.map((a) => (
                  <li key={a.feld}>
                    {FELDNAMEN[a.feld]}: {de.admin.mergeKept} — {a.grund}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* DIE DREI SÄTZE, die der Betreiber vor dem Klick sehen muss:
                welche Kennung bleibt, welches Bild gilt danach, und was
                unverändert bleibt. */}
            <p className="mt-2 text-xs">
              <span className="text-muted">{de.admin.mergeKeepsId}: </span>
              <span className="font-mono">{ziel.skyId}</span>
            </p>
            <p className="mt-1 text-xs">
              <span className="text-muted">{de.admin.mergeImageAfter}: </span>
              <span className="break-all font-mono text-[11px]">
                {(gewaehlt.has("image_override_path")
                  ? zeilen.find((z) => z.id === "image_override_path")
                      ?.aenderungen[0]?.neu
                  : null)
                  ?? ziel.imageOverridePath ?? de.admin.mergeEmpty}
              </span>
            </p>
            {/*
              DIE NOTIZ IST KEINE ZEILE UND KEIN KÄSTCHEN (CAT-05I) — aber
              sie ist auch kein Geheimnis. Ein Satz sagt, was mit ihr
              geschieht; eine Kästchenzeile würde eine Entscheidung
              vortäuschen, die es nicht gibt.
            */}
            <p className="mt-1 text-[11px] text-muted">{de.admin.mergeNoteAuto}</p>
            <p className="mt-1 text-[11px] text-muted">
              {de.admin.mergeProtected}: {GESCHUETZT.join(" · ")}
            </p>

            <button
              type="button"
              disabled={!bedienbar || pending || anzahl === 0}
              onClick={absenden}
              className={`mt-3 ${ACTION_PRIMARY} disabled:opacity-50`}
            >
              {anzahl === 0 ? de.admin.mergeNothing : de.admin.mergeSubmitCount(anzahl)}
            </button>
            {fehler ? <p role="alert" className="mt-2 text-xs text-danger">{fehler}</p> : null}
          </div>
        ) : null}
        </>
        ) : null}
      </div>
    </div>
  );
}
