/**
 * Der Figuren-Kalkulator (V1).
 *
 * WOFÜR ER GEBAUT IST. Nicht für zwei Figuren, sondern für dreißig aus einem
 * Kleinanzeigen-Angebot. Der ganze Bildschirm ist auf einen Rhythmus hin
 * gebaut: Namen tippen → Enter → nächster Name. Das Suchfeld leert sich
 * selbst und behält den Fokus (das macht `FigureSearch` seit `0064`), die
 * neue Position erscheint oben, und keine Bestätigung steht dazwischen.
 *
 * WAS ER RECHNET UND WORAUS. Jede Position startet mit
 * `skylanders.market_price` — im Projekt der kanonische Marktwert und genau
 * der, gegen den das Orderbuch seinen Einkaufsfaktor bildet. NICHT der
 * Shoppreis (`shop_price()` ist die Verkaufsseite) und NICHT der
 * Katalog-Aufschlag aus `0094`, der ausdrücklich nur eine Anzeigeeinstellung
 * ist. Die Rechnung selbst steht in `lib/calculator/calculation.ts`, in Cent
 * und ohne React.
 *
 * WAS ER NICHT TUT. Er schreibt nichts in den Geschäftsbetrieb — kein
 * Lager, keine Bewegung, keine Bestellung, keinen Warenkorb, keinen
 * Katalogpreis. Ein von Hand gesetzter Einzelwert gilt für diese Kalkulation
 * und überschreibt keinen `market_price`.
 *
 * ---------------------------------------------------------------------------
 * ZWEI GEDÄCHTNISSE, UND SIE WERDEN NIE VERWECHSELT (V2, ADR-0131)
 *
 * **Der Arbeitsstand** liegt im Browser (`localStorage`, `draft.ts`). Er
 * entsteht von selbst, kommt nach einem Neuladen zurück und ist keine
 * gespeicherte Kalkulation. Wer nur schnell ein Inserat prüft, muss nichts
 * anlegen und hinterlässt nichts.
 *
 * **Eine gespeicherte Kalkulation** liegt in `purchase_calculations` (0142)
 * und entsteht ausschließlich durch einen Druck auf „Speichern". Sie
 * überlebt ein Zurücksetzen, ein anderes Gerät und ein Jahr.
 *
 * Automatisch merken ist also NICHT automatisch anlegen — und das ist keine
 * Feinheit: eine Liste, in die jede flüchtige Preisprüfung rutscht, ist nach
 * einer Woche unbenutzbar.
 *
 * WAS DAVOR SCHÜTZT, DASS ETWAS UNBEMERKT VERLOREN GEHT. Ein Abdruck des
 * Stands beim Öffnen (`loadedFingerprint`), verglichen mit dem Stand jetzt.
 * Daran hängen die drei Rückfragen: vor dem Zurücksetzen, vor dem Öffnen
 * einer anderen Kalkulation, und beim Speichern die Wahl zwischen
 * „aktualisieren" und „als neue". Kein Versionsverlauf, keine Sperren —
 * die Frage „habe ich hier etwas, das noch nicht gespeichert ist?" hat eine
 * Antwort, und die genügt.
 * ---------------------------------------------------------------------------
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FigureSearch } from "@/components/business/figure-search";
import { Modal } from "@/components/ui/modal";
import { ACTION_NEUTRAL, ACTION_PRIMARY, COMMERCE_INK } from "@/components/ui/action";
import { SavedPanel } from "@/components/calculator/saved-panel";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { loadCalculatorContext } from "@/lib/calculator/actions";
import {
  createCalculation, deleteCalculation, listCalculations, renameCalculation,
  updateCalculation,
} from "@/lib/calculator/saved-actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  addFigure, centsToEuro, changeQuantity, clampFactor, FALLBACK_FACTOR, initialFactor,
  lineTotalCents, maxPurchaseCents, parseAmountToCents, parseFactor, removeLine,
  resetUnitCents, setQuantity, setUnitCents, totals, type CalculationLine,
} from "@/lib/calculator/calculation";
import {
  clearDraft, draftFingerprint, readDraft, writeDraft,
} from "@/lib/calculator/draft";
import {
  normalizeName, suggestName, type SavedCalculation,
} from "@/lib/calculator/saved";

const copy = de.calculator;

/** Die Stufen, die ein Händler tatsächlich benutzt. Tippen geht daneben weiter. */
const FACTOR_PRESETS = [40, 50, 60, 70] as const;

/**
 * Wie viele Treffer die Suche zeigt.
 *
 * Weniger als die acht der Orderbuch-Bildschirme: dort steht der Kasten auf
 * einer ganzen Seite, hier in einem Dialog über einer Liste, die ebenfalls
 * sichtbar bleiben muss.
 */
const CALC_RESULTS = 6;

/** Was das Fenster gerade zeigt: die Kalkulation oder die Liste. */
type View = "calc" | "saved";

/** Eine Rückfrage, die noch aussteht. `null` heißt: keine. */
type Pending =
  | { kind: "reset" }
  | { kind: "open"; calculation: SavedCalculation };

export function CalculatorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const headingId = "calculator-title";
  const [catalog, setCatalog] = useState<readonly FigureChoice[] | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * DER LETZTE ARBEITSSTAND, EINMAL UND ALS ANFANGSZUSTAND (V2, ADR-0131).
   *
   * Nicht in einem Effekt: ein Effekt, der synchron Zustand setzt, löst eine
   * zweite Renderrunde aus, und die Regel dagegen gilt in diesem Projekt
   * (dieselbe Begründung steht unten am Schließen). Ein verzögerter
   * `useState`-Initialisierer läuft genau einmal, vor dem ersten Bild.
   *
   * Und er darf `localStorage` lesen, ohne eine Hydration zu gefährden:
   * `calculator-launcher.tsx` hängt dieses Fenster erst nach einem Klick
   * ein, der Server rendert es also nie. Für Bauteile, die der Server mit
   * rendert, ist `useSyncExternalStore` der Weg (`view-mode.ts`) — hier
   * wäre er Aufwand ohne Grund.
   */
  const [restored] = useState(readDraft);
  /** Hatte der wiederhergestellte Stand etwas zu sagen? Siehe Katalog-Effekt. */
  const draftHadState = restored.lines.length > 0 || restored.loadedId !== null;

  const [lines, setLines] = useState<CalculationLine[]>(restored.lines);

  /* ------------------------------------------------- V2: Arbeitsstand und Liste */

  /**
   * Das Band zur gespeicherten Kalkulation.
   *
   * `loadedId === null` heißt „diese Rechnung gehört noch keiner". Steht eine
   * ID darin, hat „Speichern" zwei Bedeutungen, und der Betreiber wählt.
   */
  const [loadedId, setLoadedId] = useState<string | null>(restored.loadedId);
  const [loadedName, setLoadedName] = useState<string | null>(restored.loadedName);
  /** Der Abdruck beim Öffnen — die einzige Quelle für „ungespeichert". */
  const [loadedFingerprint, setLoadedFingerprint] =
    useState<string | null>(restored.loadedFingerprint);

  const [view, setView] = useState<View>("calc");
  const [saved, setSaved] = useState<readonly SavedCalculation[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  /*
   * Der historische Schnitt aus dem Orderbuch, nur als Referenz. `null`
   * heißt: es gibt keinen belastbaren — dann wird unten der Rückfall
   * gezeigt, und zwar als das, was er ist.
   */
  const [historicFactor, setHistoricFactor] = useState<number | null>(null);
  const [factor, setFactor] =
    useState<number>(draftHadState ? restored.factor : FALLBACK_FACTOR);
  const [confirmClear, setConfirmClear] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  /*
   * Einmal je Seitenaufruf, und erst beim ersten Öffnen. Der Katalog ist
   * groß genug, dass es sich lohnt, ihn nicht mitzuschleppen — und klein
   * genug, dass ein zweites Öffnen ihn nicht noch einmal holen muss.
   */
  useEffect(() => {
    if (!open || catalog !== null) return;
    let alive = true;
    void loadCalculatorContext()
      .then((context) => {
        if (!alive) return;
        setCatalog(context.catalog);
        setFailed(context.catalog.length === 0);
        setHistoricFactor(context.historicFactor);
        /*
         * DER EIGENE SCHNITT IST DER AUSGANGSPUNKT, NICHT DIE VORGABE.
         *
         * Nur beim ersten Laden. Wer den Faktor danach verstellt, soll ihn
         * beim nächsten Öffnen so vorfinden, wie er ihn gelassen hat — und
         * ein zweites Laden gibt es ohnehin nicht.
         *
         * UND NUR, WENN KEIN ARBEITSSTAND DA WAR (V2). Der Katalog kommt
         * asynchron, also NACH der Wiederherstellung — ohne diese Bedingung
         * überschriebe er den Faktor, mit dem der Händler gestern aufgehört
         * hat. Ein wiederhergestellter Stand gewinnt; das ist der Sinn des
         * Wiederherstellens.
         */
        if (!draftHadState) setFactor(initialFactor(context.historicFactor));
      })
      .catch(() => { if (alive) { setCatalog([]); setFailed(true); } });
    return () => { alive = false; };
  }, [open, catalog, draftHadState]);

  /*
   * JEDE ÄNDERUNG ZURÜCK IN DEN BROWSER.
   *
   * Ein Schreibvorgang je Tastendruck ist hier richtig: `localStorage` ist
   * synchron und die Nutzlast sind dreißig kleine Objekte. Eine Debounce
   * würde genau das verlieren, was sie schützen soll — den letzten
   * Tastendruck vor dem Schließen des Tabs.
   *
   * **Das legt keine Kalkulation an.** Diese Zeile schreibt in den Browser
   * und sonst nirgendwohin (ADR-0131).
   */
  useEffect(() => {
    writeDraft({ lines, factor, loadedId, loadedName, loadedFingerprint });
  }, [lines, factor, loadedId, loadedName, loadedFingerprint]);

  /*
   * DIE LISTE, WENN SIE GEBRAUCHT WIRD.
   *
   * Beim ersten Öffnen des Fensters geholt, damit die Zahl am Knopf
   * („Gespeichert (3)") stimmt, ohne dass jemand erst hineinsehen muss. Ein
   * Fehlschlag ist ein eigener Zustand: „keine gespeicherten" und „konnte
   * nicht nachsehen" sind zwei verschiedene Auskünfte.
   */
  const refreshList = useCallback(async () => {
    /*
     * KEIN `setListState("loading")` HIER. Der Anfangszustand ist schon
     * `loading`, und ein synchrones setState in einem Effekt löst eine
     * zweite Renderrunde aus — die Regel, an der dieses Projekt sich hält.
     * Der Wiederholungsknopf setzt den Zustand selbst; er ist eine
     * Handlung, kein Effekt.
     */
    const result = await listCalculations();
    if (result.ok) {
      setSaved(result.calculations);
      setListState("ready");
    } else {
      setListState("failed");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    /*
     * In der Zusage und nicht im Effektkörper — dieselbe Form wie der
     * Katalog darüber. Ein synchrones setState in einem Effekt löst eine
     * zweite Renderrunde aus; was nach einem `await` passiert, ist eine
     * Antwort auf ein Ereignis und keine zweite Runde.
     */
    void listCalculations().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setSaved(result.calculations);
        setListState("ready");
      } else {
        setListState("failed");
      }
    }).catch(() => { if (alive) setListState("failed"); });
    return () => { alive = false; };
  }, [open]);

  /*
   * SOFORT TIPPEN KÖNNEN — der ganze Zweck dieses Fensters.
   *
   * `autoFocus` allein reicht hier nicht: `Modal` holt den Fokus in seinem
   * eigenen Effekt auf das Panel, und Kindeffekte laufen vor denen des
   * Elternteils. Dieser Effekt gehört dem Elternteil, läuft also danach und
   * gewinnt. Er hängt zusätzlich am Katalog, weil das Feld erst existiert,
   * wenn geladen ist.
   */
  useEffect(() => {
    if (!open || catalog === null) return;
    searchInput.current?.focus();
  }, [open, catalog]);

  /*
   * Eine begonnene Bestätigung gilt nicht für das nächste Öffnen. Direkt im
   * Schließen erledigt statt in einem Effekt auf `open`: ein Effekt, der
   * synchron Zustand setzt, löst eine zweite Renderrunde aus, und hier gibt
   * es nichts zu beobachten — das Schließen ist eine Handlung mit einem Ort.
   */
  const close = useCallback(() => {
    setConfirmClear(false);
    onClose();
  }, [onClose]);

  const add = useCallback((choice: FigureChoice) => {
    setLines((current) => addFigure(current, choice));
    setConfirmClear(false);
  }, []);

  const sums = useMemo(() => totals(lines), [lines]);
  const maxCents = maxPurchaseCents(sums.totalCents, factor);

  /* ------------------------------------------------------- V2: die Handlungen */

  /**
   * Gibt es ungespeicherte Änderungen?
   *
   * Ein Vergleich, kein Schalter. Wer eine Menge erhöht und wieder senkt,
   * hat nichts geändert — ein `dirty`-Schalter hätte hier „ja" gesagt und
   * eine Rückfrage für nichts erzeugt.
   */
  const unsaved = useMemo(() => {
    const jetzt = draftFingerprint(lines, factor);
    if (loadedFingerprint === null) return lines.length > 0;
    return jetzt !== loadedFingerprint;
  }, [lines, factor, loadedFingerprint]);

  /** Den Arbeitsstand leeren — und NUR ihn (ADR-0131). */
  const resetDraft = useCallback(() => {
    setLines([]);
    setLoadedId(null);
    setLoadedName(null);
    setLoadedFingerprint(null);
    /*
     * Auch aus dem Browser fort. Sonst stünde beim nächsten Öffnen wieder
     * da, was der Betreiber gerade weggeräumt hat. Gespeicherte
     * Kalkulationen sind davon nicht berührt — sie liegen in der Datenbank.
     */
    clearDraft();
    setConfirmClear(false);
    setPending(null);
    setSavedNote(null);
    setView("calc");
  }, []);

  /** Eine gespeicherte Kalkulation in den Kalkulator laden. */
  const loadCalculation = useCallback((calculation: SavedCalculation) => {
    setLines(calculation.lines);
    setFactor(calculation.factorPercent);
    setLoadedId(calculation.id);
    setLoadedName(calculation.name);
    /*
     * Der Abdruck des geladenen Stands. Ab hier heißt „ungespeichert":
     * abweichend von genau diesem. Deshalb wird er aus denselben Werten
     * gebildet, die gerade gesetzt wurden — nicht aus dem Zustand, der in
     * dieser Runde noch der alte ist.
     */
    setLoadedFingerprint(draftFingerprint(calculation.lines, calculation.factorPercent));
    setPending(null);
    setSavedNote(null);
    setView("calc");
  }, []);

  /**
   * Öffnen, aber nicht über etwas Ungespeichertes hinweg.
   *
   * Das ist der Fall, der im Alltag passiert: man rechnet an einem Inserat,
   * will kurz in ein älteres sehen und wäre die halbe Arbeit los.
   */
  const requestOpen = useCallback((calculation: SavedCalculation) => {
    if (unsaved) {
      setPending({ kind: "open", calculation });
      return;
    }
    loadCalculation(calculation);
  }, [unsaved, loadCalculation]);

  /** Das Speicherfeld aufmachen — mit einem Namensvorschlag, der etwas sagt. */
  const openSave = useCallback(() => {
    setSaveError(false);
    setSavedNote(null);
    setSaveName(loadedName ?? suggestName(lines, new Date()));
    setSaveOpen(true);
  }, [loadedName, lines]);

  /**
   * Speichern — als neue Kalkulation oder über die geladene.
   *
   * `mode` entscheidet, und die Oberfläche fragt danach, sobald eine
   * geladen ist. Ein stilles Überschreiben gibt es nicht (ADR-0131).
   *
   * EIN FEHLSCHLAG VERLIERT NICHTS. Der Arbeitsstand liegt im Browser und
   * wird hier nicht angefasst; die Meldung sagt genau das und bietet einen
   * zweiten Versuch an. Das ist die Antwort auf den Netzabbruch.
   */
  const save = useCallback(async (mode: "new" | "update") => {
    const name = normalizeName(saveName);
    if (name === "" || lines.length === 0) return;

    setSaving(true);
    setSaveError(false);
    const payload = { name, lines, factorPercent: factor };
    const result = mode === "update" && loadedId !== null
      ? await updateCalculation(loadedId, payload)
      : await createCalculation(payload);
    setSaving(false);

    if (!result.ok) {
      setSaveError(true);
      return;
    }

    setLoadedId(result.calculation.id);
    setLoadedName(result.calculation.name);
    /* Ab jetzt ist DAS der gespeicherte Stand. */
    setLoadedFingerprint(draftFingerprint(result.calculation.lines, result.calculation.factorPercent));
    setSaveOpen(false);
    setSavedNote(result.calculation.name);
    void refreshList();
  }, [saveName, lines, factor, loadedId, refreshList]);

  const rename = useCallback(async (id: string, name: string) => {
    const result = await renameCalculation(id, name);
    if (result.ok && id === loadedId) setLoadedName(normalizeName(name));
    void refreshList();
  }, [loadedId, refreshList]);

  const remove = useCallback(async (id: string) => {
    await deleteCalculation(id);
    /*
     * War es die geladene, ist der Rechenstand jetzt niemandes mehr — die
     * Positionen bleiben aber stehen. Sie fortzuwerfen, weil jemand einen
     * Listeneintrag gelöscht hat, wäre ein Datenverlust, den niemand
     * verlangt hat.
     */
    if (id === loadedId) {
      setLoadedId(null);
      setLoadedName(null);
      setLoadedFingerprint(null);
    }
    void refreshList();
  }, [loadedId, refreshList]);

  return (
    <Modal open={open} onClose={close} labelledBy={headingId} size="xl">
      {/*
        DIE HÖHENKETTE, UND WARUM SIE HIER GESCHLOSSEN WERDEN MUSS.

        Das Panel ist `flex flex-col` mit einer Deckelhöhe und
        `overflow-hidden`. Ohne `flex-1` bliebe dieser Kasten
        inhaltsgroß — bei dreißig Positionen wäre die Liste einfach
        abgeschnitten und der Fuß mit der wichtigsten Zahl außer Sicht,
        statt dass die Liste rollt. `min-h-0` daneben, sonst weigert sich
        ein Flex-Kind, unter seine Inhaltsgröße zu schrumpfen, und der
        innere Rollbereich bekäme nie eine Grenze.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-gold-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-on-deep">{copy.title}</h2>
            {/*
              WAS HIER STEHT, BEANTWORTET EINE FRAGE: woran arbeite ich
              gerade, und ist es gesichert? Ohne geladene Kalkulation bleibt
              es der Satz über den Arbeitsstand — eine Zeile, die beides
              erklärt, ist besser als zwei, die sich abwechseln.
            */}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-on-deep-muted">
              {loadedName === null ? (
                <span>{copy.draftHint}</span>
              ) : (
                <span className="truncate font-medium text-on-deep">
                  {copy.loadedName(loadedName)}
                </span>
              )}
              {unsaved && lines.length > 0 ? (
                <span className="rounded-sky-sm bg-deep/50 px-1.5 py-0.5">{copy.unsaved}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={copy.close}
            className="focus-ring -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-deep-muted hover:text-on-deep"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/*
          DIE WERKZEUGLEISTE — drei Knöpfe, und zwar sichtbar.
          „Zurücksetzen" war in V1 ein unterstrichener Text im Fuß. Jetzt ist
          es ein Knopf neben „Speichern", weil beide dieselbe Frage
          beantworten: was passiert mit dem, was hier steht?
          `flex-wrap` statt einer zweiten Anordnung für Telefone — bei wenig
          Platz rutschen die Knöpfe in die nächste Zeile und bleiben 44 px
          hoch.
        */}
        <div className="shrink-0 border-b border-gold-line px-4 py-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openSave}
              disabled={lines.length === 0}
              className={`${ACTION_PRIMARY} h-11 w-auto min-h-11 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => setView(view === "saved" ? "calc" : "saved")}
              aria-pressed={view === "saved"}
              className={`${ACTION_NEUTRAL} h-11 w-auto min-h-11 px-3 text-sm`}
            >
              {copy.savedListOpen(saved.length)}
            </button>

            <span className="ml-auto flex items-center gap-2">
              {confirmClear ? (
                <>
                  <span role="alert" className="text-xs text-on-deep">
                    {copy.clearConfirm(sums.positions)}
                  </span>
                  <button type="button" onClick={resetDraft}
                          className={`${ACTION_NEUTRAL} h-11 w-auto min-h-11 px-3 text-xs`}>
                    {copy.discardYes}
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)}
                          className="focus-ring h-11 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
                    {copy.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  /*
                   * EINE RÜCKFRAGE NUR, WENN ES ETWAS ZU VERLIEREN GIBT.
                   * Ein leerer oder gespeicherter Stand wird ohne Nachfrage
                   * geleert — eine Bestätigung für nichts bringt bei, sie
                   * wegzuklicken.
                   */
                  onClick={() => (unsaved ? setConfirmClear(true) : resetDraft())}
                  disabled={lines.length === 0}
                  className={`${ACTION_NEUTRAL} h-11 w-auto min-h-11 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {copy.clear}
                </button>
              )}
            </span>
          </div>

          {/* Das Speicherfeld. Kein zweiter Dialog über dem Dialog: eine
              Zeile, die aufklappt, und der Fokus liegt im Namensfeld. */}
          {saveOpen ? (
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save(loadedId === null ? "new" : "update");
              }}
            >
              <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                <span className="text-xs text-on-deep-muted">{copy.saveNameLabel}</span>
                <input
                  autoFocus
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={copy.saveNamePlaceholder}
                  className="h-11 w-full rounded-sky-sm bg-surface px-2 text-sm ring-1 ring-border-strong focus-ring"
                />
              </label>

              {/*
                ZWEI WEGE, WENN EINE KALKULATION GELADEN IST (ADR-0131).
                „Aktualisieren" überschreibt die geladene, „als neue" legt
                eine zweite an — so lassen sich Varianten eines Inserats
                rechnen, ohne das Original zu verlieren.
              */}
              {loadedId === null ? (
                <button type="submit" disabled={saving || !normalizeName(saveName)}
                        className={`${ACTION_PRIMARY} h-11 w-auto min-h-11 px-3 text-sm disabled:opacity-40`}>
                  {saving ? copy.saving : copy.saveSubmit}
                </button>
              ) : (
                <>
                  <button type="submit" disabled={saving || !normalizeName(saveName)}
                          className={`${ACTION_PRIMARY} h-11 w-auto min-h-11 px-3 text-sm disabled:opacity-40`}>
                    {saving ? copy.saving : copy.saveUpdate}
                  </button>
                  <button type="button" disabled={saving || !normalizeName(saveName)}
                          onClick={() => void save("new")}
                          className={`${ACTION_NEUTRAL} h-11 w-auto min-h-11 px-3 text-sm disabled:opacity-40`}>
                    {copy.saveNew}
                  </button>
                </>
              )}
              <button type="button" onClick={() => setSaveOpen(false)}
                      className="focus-ring h-11 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
                {copy.cancel}
              </button>

              {saveError ? (
                <p role="alert" className="basis-full text-xs text-danger">{copy.saveFailed}</p>
              ) : null}
            </form>
          ) : null}

          {/* Die Rückfrage vor dem Öffnen über einen ungespeicherten Stand. */}
          {pending?.kind === "open" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span role="alert" className="text-xs text-on-deep">
                {copy.discardOpen(pending.calculation.name)}
              </span>
              <button type="button" onClick={() => loadCalculation(pending.calculation)}
                      className={`${ACTION_NEUTRAL} h-11 w-auto min-h-11 px-3 text-xs`}>
                {copy.discardYes}
              </button>
              <button type="button" onClick={() => { setPending(null); openSave(); }}
                      className={`${ACTION_PRIMARY} h-11 w-auto min-h-11 px-3 text-xs`}>
                {copy.discardSaveFirst}
              </button>
              <button type="button" onClick={() => setPending(null)}
                      className="focus-ring h-11 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
                {copy.cancel}
              </button>
            </div>
          ) : null}

          {savedNote === null ? null : (
            <p role="status" className="mt-2 text-xs text-on-deep-muted">
              {copy.saved(savedNote)}
            </p>
          )}
        </div>

        {/* Die Suche bleibt stehen, die Liste darunter rollt. Bei dreißig
            Positionen ist das der Unterschied zwischen Tippen und Suchen. */}
        {/*
          Gedeckelt, damit acht Treffer auf einem Telefon nicht die ganze
          Fläche einnehmen und die Positionsliste auf null drücken. Sechs
          Treffer reichen für den Ablauf hier — wer eintippt, was er in der
          Hand hält, nimmt ohnehin den ersten.
        */}
        {/*
          ZWEI ANSICHTEN, EINE FLÄCHE (ADR-0131).

          Kopf, Werkzeugleiste und Fuß bleiben stehen; getauscht wird nur die
          Mitte. Die Summen unten bleiben dadurch sichtbar, während man in der
          Liste blättert — und auf einem Telefon ist es die einzige Anordnung,
          die beides zeigen kann, ohne zu scrollen.
        */}
        {view === "saved" ? (
          <SavedPanel
            state={listState}
            calculations={saved}
            onOpen={requestOpen}
            onRename={(id, name) => void rename(id, name)}
            onDelete={(id) => void remove(id)}
            onBack={() => setView("calc")}
            onRetry={() => { setListState("loading"); void refreshList(); }}
          />
        ) : (
        <>
        <div className="max-h-[45dvh] shrink-0 overflow-y-auto border-b border-gold-line px-4 py-3 sm:px-5">
          {catalog === null ? (
            <p className="text-sm text-on-deep-muted">{copy.loading}</p>
          ) : failed ? (
            <p role="alert" className="text-sm text-danger">{copy.loadFailed}</p>
          ) : (
            <FigureSearch
              catalog={catalog}
              onSelect={add}
              label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              showImage
              inputRef={searchInput}
              limit={CALC_RESULTS}
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {lines.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-on-deep">{copy.empty}</p>
              <p className="mt-1 text-xs text-on-deep-muted">{copy.emptyHint}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <PositionRow
                  key={line.skyId}
                  line={line}
                  onQuantity={(delta) => setLines((c) => changeQuantity(c, line.skyId, delta))}
                  onQuantitySet={(q) => setLines((c) => setQuantity(c, line.skyId, q))}
                  onUnit={(cents) => setLines((c) => setUnitCents(c, line.skyId, cents))}
                  onReset={() => setLines((c) => resetUnitCents(c, line.skyId))}
                  onRemove={() => setLines((c) => removeLine(c, line.skyId))}
                />
              ))}
            </ul>
          )}
        </div>
        </>
        )}

        {/*
          WAS EIN SCREENREADER SONST NICHT MITBEKÄME.
          Der ganze Ablauf ist Tippen und Enter; die Liste wächst dabei
          lautlos. Eine höfliche Region sagt nach jeder Aufnahme, wie viele
          Positionen und Stücke es jetzt sind — nicht bei jedem Tastendruck
          an einem Wertfeld, denn `positions` und `units` ändern sich dabei
          nicht.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {lines.length === 0
            ? copy.empty
            : `${sums.positions} ${copy.positionsLabel}, ${sums.units} ${copy.unitsLabel}`}
        </p>

        {/*
          DER FUSS TRÄGT NUR NOCH ZAHLEN.

          „Zurücksetzen" stand hier als unterstrichener Text und ist in die
          Werkzeugleiste gewandert — neben „Speichern", weil beide dieselbe
          Frage beantworten. Der Fuß ist dadurch, was er sein soll: die
          Herleitung der einen Zahl, wegen der jemand das Fenster öffnet.
        */}
        <Summary
          historicFactor={historicFactor}
          positions={sums.positions}
          units={sums.units}
          totalCents={sums.totalCents}
          withoutValue={sums.withoutValue}
          factor={factor}
          onFactor={setFactor}
          maxCents={maxCents}
        />
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Position */

function PositionRow({
  line, onQuantity, onQuantitySet, onUnit, onReset, onRemove,
}: {
  line: CalculationLine;
  onQuantity: (delta: number) => void;
  onQuantitySet: (quantity: number) => void;
  onUnit: (cents: number) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  /*
   * Das Feld hält seinen eigenen Text, solange jemand darin tippt: würde es
   * bei jedem Tastendruck aus Cent zurückgerechnet, könnte man kein Komma
   * setzen, ohne dass der Cursor springt. Beim Verlassen gilt wieder der
   * gerechnete Wert.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const shown = draft ?? (line.unitCents === 0 ? "" : centsToEuro(line.unitCents).toFixed(2));

  function commit(raw: string) {
    const cents = parseAmountToCents(raw);
    if (cents !== null) onUnit(cents);
    setDraft(null);
  }

  function commitQuantity(raw: string) {
    // Leer heißt: der Händler hat gelöscht, um neu zu tippen, und es dann
    // gelassen. Die Menge bleibt, was sie war.
    if (raw.trim() !== "") onQuantitySet(Number(raw));
    setQtyDraft(null);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sky-md bg-surface/70 px-3 py-2 ring-1 ring-border/70">
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-sky-sm bg-deep/40 ring-1 ring-border/60">
        {line.image ? (
          /* Wie `FigureImage`: vorab optimiert und statisch ausgeliefert,
             `next/image` brächte hier nichts als Kosten (ADR-0026). */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.image} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className="truncate text-sm font-medium text-on-deep">{line.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-on-deep-muted">
          <span className="uppercase">{line.series}</span>
          <span className="tabular-nums">{line.skyId}</span>
          {line.manual ? (
            <button type="button" onClick={onReset} aria-label={copy.resetLabel(line.name)}
                    className="focus-ring rounded-sky-sm px-1 underline underline-offset-2">
              {copy.manual}
            </button>
          ) : line.suggestedCents === null ? (
            <span className="text-danger">{copy.noPrice}</span>
          ) : null}
        </span>
      </span>

      {/* Menge */}
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => { setQtyDraft(null); onQuantity(-1); }}
                aria-label={copy.less(line.name)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-sky-sm ring-1 ring-border/70 hover:ring-border-strong">
          −
        </button>
        <label className="sr-only" htmlFor={`qty-${line.skyId}`}>{copy.quantity}</label>
        {/*
          Wie das Wertfeld darunter mit eigenem Entwurf, und aus demselben
          Grund: ein gebundenes `type="number"` springt beim Leeren sofort
          auf 1 zurück, weil `Number("")` NaN ist und die Menge nie unter 1
          fällt. Wer „12" statt „1" tippen will, müsste das Feld also gegen
          sich selbst bedienen. Übernommen wird beim Verlassen.
        */}
        <input
          id={`qty-${line.skyId}`}
          type="text"
          inputMode="numeric"
          value={qtyDraft ?? String(line.quantity)}
          onChange={(e) => setQtyDraft(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={(e) => { commitQuantity(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitQuantity(e.currentTarget.value); }
          }}
          className="h-9 w-12 rounded-sky-sm bg-surface px-1 text-center text-sm tabular-nums ring-1 ring-border/70 focus-ring"
        />
        <button type="button" onClick={() => { setQtyDraft(null); onQuantity(1); }}
                aria-label={copy.more(line.name)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-sky-sm ring-1 ring-border/70 hover:ring-border-strong">
          +
        </button>
      </span>

      {/* Einzelwert */}
      <span className="flex shrink-0 items-center gap-1">
        <label className="sr-only" htmlFor={`unit-${line.skyId}`}>{copy.unitValue}</label>
        <input
          id={`unit-${line.skyId}`}
          type="text"
          inputMode="decimal"
          value={shown}
          placeholder="0,00"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value); } }}
          className="h-9 w-20 rounded-sky-sm bg-surface px-2 text-right text-sm tabular-nums ring-1 ring-border/70 focus-ring"
        />
        <span aria-hidden="true" className="text-xs text-on-deep-muted">€</span>
      </span>

      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-on-deep">
        {formatPrice(centsToEuro(lineTotalCents(line)))}
      </span>

      <button type="button" onClick={onRemove} aria-label={copy.remove(line.name)}
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-sky-sm text-on-deep-muted hover:text-danger">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none"
             stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ Summe */

function Summary({
  historicFactor, positions, units, totalCents, withoutValue, factor, onFactor, maxCents,
}: {
  historicFactor: number | null;
  positions: number; units: number; totalCents: number; withoutValue: number;
  factor: number; onFactor: (value: number) => void; maxCents: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <footer className="shrink-0 border-t border-gold-line bg-deep/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.positionsLabel}</dt>
            <dd className="font-semibold tabular-nums text-on-deep">{positions}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.unitsLabel}</dt>
            <dd className="font-semibold tabular-nums text-on-deep">{units}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs text-on-deep-muted">{copy.totalLabel}</dt>
            <dd className="text-lg font-semibold tabular-nums text-on-deep">
              {formatPrice(centsToEuro(totalCents))}
            </dd>
          </div>
        </dl>

        {/*
          ZWEI FAKTOREN, EINER DAVON EDITIERBAR.
          Oben die Referenz — der Schnitt, zu dem tatsächlich eingekauft
          wurde —, darunter das Feld, mit dem dieses eine Paket gerechnet
          wird. Die Referenz ist kleiner und ruhiger: sie soll erinnern, nicht
          konkurrieren. Ohne Datenlage steht dort, dass es keine gibt, und
          nicht der Rückfallwert als wäre er einer.
        */}
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-on-deep-muted">
            {historicFactor === null
              ? copy.historicFactorNone
              : copy.historicFactor(historicFactor)}
          </p>
          <div className="flex items-center gap-2">
          <label htmlFor="calc-factor" className="text-xs text-on-deep-muted">
            {copy.factorLabel}
          </label>
          <span className="flex items-center gap-1">
            {FACTOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setDraft(null); onFactor(preset); }}
                aria-pressed={factor === preset}
                className={`focus-ring h-9 rounded-sky-sm px-2 text-xs tabular-nums ring-1 ${
                  factor === preset
                    ? "bg-surface text-on-deep ring-border-strong"
                    : "text-on-deep-muted ring-border/70 hover:ring-border-strong"
                }`}
              >
                {preset}%
              </button>
            ))}
          </span>
          <input
            id="calc-factor"
            type="text"
            inputMode="numeric"
            value={draft ?? String(factor)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              const parsed = parseFactor(e.target.value);
              if (parsed !== null) onFactor(clampFactor(parsed));
              setDraft(null);
            }}
            className="h-9 w-14 rounded-sky-sm bg-surface px-2 text-right text-sm tabular-nums ring-1 ring-border/70 focus-ring"
          />
          <span aria-hidden="true" className="text-xs text-on-deep-muted">%</span>
          </div>
        </div>

        {/*
          DIE ZAHL, WEGEN DER JEMAND DAS FENSTER ÖFFNET.
          Deshalb die einzige hier, die eine eigene Fläche und die
          Commerce-Farbe bekommt — sie ist die Entscheidung, alles andere ist
          ihre Herleitung.
        */}
        <div className="rounded-sky-md bg-surface px-4 py-2 ring-1 ring-commerce-line">
          <p className="text-[11px] text-on-deep-muted">{copy.maxPurchase}</p>
          {/* Inline wie überall in dieser Rolle: die Farbe kommt aus dem
              Token, nicht aus einer Klasse, die erst erzeugt werden muss. */}
          <p className="text-2xl font-semibold tabular-nums" style={COMMERCE_INK}>
            {formatPrice(centsToEuro(maxCents))}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-on-deep-muted">
          {copy.maxPurchaseHint}
          {withoutValue > 0 ? ` · ${copy.withoutValue(withoutValue)}` : ""}
        </p>
        {/* `positions` bleibt im Vertrag dieser Komponente, auch ohne den
            Knopf: der Fuß nennt die Zahl oben, und ein Parameter, der nur
            für einen entfernten Knopf da war, wäre jetzt ein toter. */}
        <p className="sr-only">{positions}</p>
      </div>
    </footer>
  );
}
