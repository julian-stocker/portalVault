/**
 * Adding a thing to an existing purchase (ADR-0088, ADR-0091).
 *
 * The same picker the create screen uses — `FigureSearch` — so an article is
 * found the same way whether the purchase exists yet or not. Before 0064
 * these were two different boxes with two different result orders, which is
 * exactly the kind of difference that makes somebody pick the wrong variant
 * on the screen they use less often.
 *
 * ONE UNIT PER SELECTION, and the same article may be selected again. Three
 * Wash Bucklers are three rows here as well; there is no quantity to type,
 * because a purchase item is one physical object.
 *
 * ---------------------------------------------------------------------------
 * UND ZUBEHÖR IST JETZT EIN ARTIKEL (0137)
 *
 * Hier stand: „AND SOME THINGS ARE NOT FIGURES. A portal or a game belongs to
 * the purchase and to the money, but not to the figure catalog — so it is
 * added by name with no sky_id and can never be booked into figure
 * inventory." Das war der Stand bis `0135`: ein Portal hatte keine
 * Katalogzeile, also auch keine SKY-ID, also keinen Bestand, keinen
 * Einkaufspreis je Artikel und keine Historie.
 *
 * Spiele waren schon immer Katalogzeilen — 39 davon, einbuchbar, verkäuflich,
 * nur nicht im Shop (docs/SKYLANDERS_DATA.md). Portale fehlten vollständig.
 * Seit `0137` kann der Betrieb sie anlegen: `seller_create_catalog_item`,
 * vier Arten, niemals `figure`.
 *
 * DREI WEGE, UND SIE SIND NACH HÄUFIGKEIT GEORDNET
 *
 *   1. SUCHEN — der Normalfall, und er findet jetzt auch Spiele und Portale.
 *   2. NEU ANLEGEN — wenn die Suche nichts findet. Der getippte Name reist
 *      mit, damit niemand ihn zweimal eingibt, und die Position entsteht
 *      zusammen mit dem Artikel.
 *   3. OHNE KATALOG — der Rückfall, und er BLEIBT. Ein Konvolut-Restposten,
 *      ein Disney-Infinity-Teil, eine Beigabe, die nie eine Identität
 *      bekommen soll: dafür gibt es weiter die Freitextposition, ohne
 *      `sky_id`, ohne Bestand. Die 206 historischen Positionen dieser Art
 *      bleiben unverändert und werden nie automatisch umgehängt.
 * ---------------------------------------------------------------------------
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";
import { addPurchaseItem } from "@/lib/orderbook/actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";
import { NewCatalogItem } from "./new-catalog-item";

const copy = de.business.orderbook;

/**
 * Kept as the module's public name for the catalog row so the detail page's
 * existing imports stay valid. It IS `FigureChoice` — one type, one shape.
 */
export type CatalogChoice = FigureChoice;

/** Welcher der drei Wege gerade offen ist. Einer, nie zwei. */
type Mode = "search" | "new" | "free";

export function AddPurchaseItem({
  purchaseId,
  catalog,
}: {
  purchaseId: number;
  catalog: readonly CatalogChoice[];
}) {
  const [mode, setMode] = useState<Mode>("search");
  const [rawName, setRawName] = useState("");
  /** Der Name, mit dem die erfolglose Suche in das Anlegen übergeht. */
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(skyId: string | null, name: string | null) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await addPurchaseItem(purchaseId, skyId, name);
      if (!result.ok) setError(result.message);
      else { setRawName(""); setMode("search"); }
    });
  }

  return (
    <section className="mt-6 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
      {error ? (
        <p role="alert" className="mb-2 text-sm">{error}</p>
      ) : null}
      {/* Eine Zeile, kein Dialog: „SKY-0823 angelegt und hinzugefügt." steht
          da, bis der nächste Griff etwas anderes sagt. */}
      {note ? (
        <p role="status" className="mb-2 text-xs text-muted">{note}</p>
      ) : null}

      {mode === "new" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">{copy.newItem.heading}</p>
          <NewCatalogItem
            purchaseId={purchaseId}
            catalog={catalog}
            initialName={draftName}
            onDone={(skyId) => {
              setNote(copy.newItem.created(skyId));
              setDraftName("");
              setMode("search");
            }}
            onCancel={() => { setDraftName(""); setMode("search"); }}
          />
        </div>
      ) : mode === "free" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">{copy.uncategorizedHint}</p>
          {/*
            Auch hier kein Wörterbuch: „Portal of Power" ist ein Produktname,
            und der eingetippte Name wird roh gespeichert (Regel 4). Eine
            Ersetzung wäre eine stillschweigende Korrektur genau dort, wo
            keine stattfinden darf.
          */}
          <input value={rawName} onChange={(e) => setRawName(e.target.value)}
                 placeholder="z. B. Konvolut-Restposten"
                 autoCorrect="off" autoCapitalize="off" spellCheck={false}
                 autoComplete="off"
                 className="min-h-11 rounded-sky-md bg-surface px-3 ring-1 ring-border/70" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || rawName.trim().length < 2}
                    onClick={() => add(null, rawName.trim())}
                    className={`${ACTION_PRIMARY} min-h-11 w-auto disabled:opacity-40`}>
              {copy.addUncategorized}
            </button>
            <button type="button" onClick={() => setMode("search")}
                    className={`${ACTION_NEUTRAL} min-h-11 w-auto`}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted">{copy.addItem}</p>
          <FigureSearch
            showDemand
            catalog={catalog}
            disabled={pending}
            /*
             * KEIN `raw_name` FÜR EINE KATALOGFIGUR (verbindlich entschieden,
             * 0120).
             *
             * Hier stand kurzzeitig der Rohname der gewählten Katalogzeile,
             * um die Position darüber suchbar zu machen. Das war an zwei
             * Stellen falsch. `purchase_items.raw_name` ist „what the source
             * called it" (0053) — Provenienz. Für eine Figur, die gerade aus
             * dem Katalog gewählt wurde, gibt es keine frühere Quelle, und ein
             * Katalogname, der dort hineingeschrieben wird, ist ein erfundener
             * Schnappschuss. Ausserdem hätte es zwei Pfade mit zwei
             * Ergebnissen gegeben: ein neu angelegter Einkauf schreibt
             * ebenfalls keinen Rohnamen.
             *
             * Suchbar ist die Position trotzdem: `0119` hat
             * `display_name_override` in die Ledger-Suche aufgenommen, und der
             * historische Rohname bleibt dort ebenfalls suchbar. Die
             * Anzeigerangfolge löst den Namen live auf, statt ihn zu
             * konservieren.
             */
            onSelect={(choice) => add(choice.skyId, null)}
            /*
             * DER AUSWEG AUS EINER ERFOLGLOSEN SUCHE FÜHRT JETZT IN DEN
             * KATALOG (0137), nicht mehr in den Freitext.
             *
             * `onFree` ist der Einhängepunkt, den `FigureSearch` dafür schon
             * hat; was daran hängt, entscheidet der Aufrufer. Hier hängt das
             * Anlegen daran — mit dem getippten Namen, damit er nicht zweimal
             * eingegeben wird. Der Freitext bleibt als eigener, leiser Weg
             * darunter.
             */
            onFree={(name) => { setDraftName(name); setNote(null); setMode("new"); }}
          />
          {/* Said where `Einbuchen` is, not under the create form's submit
              button — the same place the Verkauf says it. */}
          <p className="mt-2 text-xs text-muted">{copy.createStockHint}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button"
                    onClick={() => { setDraftName(""); setNote(null); setMode("new"); }}
                    className="text-xs text-muted underline underline-offset-2">
              {copy.newItem.open}
            </button>
            <button type="button" onClick={() => { setNote(null); setMode("free"); }}
                    className="text-xs text-muted underline underline-offset-2">
              {copy.addUncategorized}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
