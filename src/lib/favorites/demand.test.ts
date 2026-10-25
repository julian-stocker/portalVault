import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import { MAX_DEMAND_SKY_IDS } from "@/lib/favorites/queries";

/**
 * Die Nachfrageanzeige (0145, ADR-0136).
 *
 * Was hier geprüft wird und was nicht. Die FUNKTION `favorite_demand()` ist
 * an echtem PostgreSQL gefahren (Probelauf **P52**) und auf Staging
 * funktional nachgewiesen (`verify:rls:staging`, Abschnitt 10: ein Sammler,
 * `anon` UND der Dienstschlüssel werden abgewiesen). Hier steht der WEG von
 * ihr auf den Schirm: dass gebündelt geladen wird, dass die Decke greift,
 * dass ein Fehler nichts blockiert, dass die Zahl an der SKY-ID hängt und
 * dass sie nirgends zu einer Zusage wird.
 */

const QUERIES = "src/lib/favorites/queries.ts";
const INDICATOR = "src/components/business/favorite-demand-indicator.tsx";
const SEARCH = "src/components/business/figure-search.tsx";
const ORDERBOOK = "src/lib/orderbook/queries.ts";
const INVENTORY = "src/lib/admin/inventory.ts";
const CARD = "src/components/admin/inventory-card.tsx";
const MIGRATION = "supabase/migrations/0145_favorites.sql";

const quelle = (p: string): string => readFileSync(p, "utf8");
function code(p: string): string {
  return quelle(p).split("\n").filter((z) => {
    const t = z.trimStart();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  }).join("\n");
}


describe("gebündelt geladen, nicht je Figur", () => {
  it("es gibt EINE Quelle, und beide Ansichten benutzen sie", () => {
    expect(code(QUERIES)).toContain("export const fetchFavoriteDemand = cache(");
    expect(code(ORDERBOOK)).toContain("fetchFavoriteDemand()");
    expect(code(INVENTORY)).toContain("fetchFavoriteDemand()");
  });

  it("`cache()` bindet sie an die Anfrage — eine Seite zahlt sie einmal", () => {
    /*
     * Katalog und Lager fragen beide. Ohne `cache()` wären das zwei RPCs je
     * Seitenaufbau für dieselbe Antwort.
     */
    const q = code(QUERIES);
    expect(q).toContain('import { cache } from "react"');
    const block = q.slice(q.indexOf("fetchFavoriteDemand"));
    expect(block.slice(0, 80)).toContain("cache(");
  });

  it("je Ansicht EIN Aufruf, und er steht in der vorhandenen Runde", () => {
    const ob = code(ORDERBOOK);
    expect((ob.match(/fetchFavoriteDemand\(\)/g) ?? []).length).toBe(1);
    /*
     * IM RICHTIGEN BLOCK suchen. `orderbook/queries.ts` hat mehrere
     * `Promise.all` — die erste gehört `fetchPurchase`. Ab Dateianfang
     * gesucht, fand die Prüfung also eine fremde Runde und schlug an,
     * obwohl der Aufruf an der richtigen Stelle stand.
     */
    const block = ob.indexOf("export const fetchOrderbookCatalog");
    expect(block).toBeGreaterThan(-1);
    const ab = ob.indexOf("await Promise.all([", block);
    const runde = ob.slice(ab, ob.indexOf("]);", ab));
    expect(runde, "nicht in derselben Runde wie Katalog und Preise")
      .toContain("fetchFavoriteDemand()");

    const inv = code(INVENTORY);
    expect((inv.match(/fetchFavoriteDemand\(\)/g) ?? []).length).toBe(1);
    expect(inv).toContain("await Promise.all([fetchSaleState(), fetchFavoriteDemand()])");
  });

  it("keine Komponente holt sie selbst", () => {
    /* Eine Abfrage je Zeile wären im Picker hunderte Anfragen. */
    for (const p of [INDICATOR, SEARCH, CARD]) {
      expect(code(p), p).not.toContain("fetchFavoriteDemand");
      expect(code(p), p).not.toContain("favorite_demand");
      expect(code(p), p).not.toContain("supabase");
    }
  });

  it("die Suche filtert weiter ein Array — keine Anfrage je Tastendruck", () => {
    /*
     * Die Zahl reist MIT dem Katalog, den der Picker schon im Speicher hat.
     * Dadurch bleibt `searchFigures` eine reine Funktion, und es gibt keine
     * Antwort, die verspätet eine neuere überschreiben könnte.
     */
    const suche = code(SEARCH);
    expect(suche).toContain("useMemo(() => searchFigures(catalog, query, limit)");
    expect(suche).not.toContain("useEffect");
    expect(suche).not.toContain("fetch(");
  });

  it("und die Nachfrage ändert die Trefferreihenfolge nicht", () => {
    /* Sie ist Anzeige, keine Suchgrundlage: wer nach Nachfrage sortieren
       wollte, stellte eine andere Frage. */
    expect(code("src/lib/orderbook/figure-search.ts")).not.toContain("favoriteDemand ?");
    const fs = code("src/lib/orderbook/figure-search.ts");
    const suchteil = fs.slice(fs.indexOf("export function searchFigures"));
    expect(suchteil).not.toContain("favoriteDemand");
  });
});


describe("die Decke von 2000 SKY-IDs", () => {
  it("die Anwendung kennt dieselbe Zahl wie die Migration", () => {
    expect(MAX_DEMAND_SKY_IDS).toBe(2000);
    expect(quelle(MIGRATION)).toContain("> 2000");
  });

  it("und sie weist VORHER ab, nicht erst die Datenbank", () => {
    /*
     * Eine Decke, die erst in der Datenbank greift, ist eine Fehlermeldung
     * statt einer Grenze: der Aufruf ist dann schon unterwegs.
     */
    const q = code(QUERIES);
    expect(q).toContain("skyIds.length > MAX_DEMAND_SKY_IDS");
    const abweisung = q.indexOf("skyIds.length > MAX_DEMAND_SKY_IDS");
    const aufruf = q.indexOf('supabase.rpc("favorite_demand"');
    expect(abweisung).toBeGreaterThan(-1);
    expect(abweisung, "die Decke steht nach dem Aufruf").toBeLessThan(aufruf);
  });

  it("eine leere Liste fragt gar nicht", () => {
    expect(code(QUERIES)).toContain("skyIds.length === 0) return new Map()");
  });

  it("ohne Liste wird `null` gesendet — alle mit mindestens einem Favoriten", () => {
    /*
     * Das ist die KLEINERE Anfrage: Figuren ohne Favorit fehlen in der
     * Antwort. 534 SKY-IDs zu senden, um dreißig Zahlen zu bekommen, wäre
     * mehr Daten in beide Richtungen.
     */
    expect(code(QUERIES)).toContain("p_sky_ids: skyIds ? [...skyIds] : null");
  });
});


describe("ein Fehler blockiert nichts", () => {
  const q = code(QUERIES);

  it("ein abgewiesener Aufruf gibt eine leere Map, keinen Fehler", () => {
    /*
     * Ein Sammler landet hier regelmäßig — er benutzt denselben Picker im
     * Kalkulator. Für ihn ist „keine Zahlen“ die richtige Antwort und kein
     * Zwischenfall, und ein `throw` hätte den Kalkulator mitgenommen.
     */
    expect(q).toContain("if (error || !Array.isArray(data)) return new Map()");
  });

  it("und die Nachfrage steht in derselben Runde, ohne sie zu stoppen", () => {
    /* `Promise.all` mit einer Funktion, die nicht wirft: der Katalog kommt
       auch dann, wenn die Zahlen nicht kommen. */
    expect(code(ORDERBOOK)).not.toContain("await fetchFavoriteDemand().catch");
    expect(q).not.toMatch(/fetchFavoriteDemand[\s\S]{0,400}throw new Error\(`favorite demand: \$\{skyIds/);
  });

  it("nur die Decke wirft — und das ist ein Programmierfehler, kein Betriebsfall", () => {
    /*
     * NUR IM EIGENEN BLOCK. `fetchFavoritedSkyIds` und `fetchFavorites`
     * werfen ebenfalls, und das ist dort richtig: eine Wunschliste, die
     * nicht geladen werden kann, ist keine leere Wunschliste.
     */
    const block = q.slice(q.indexOf("export const fetchFavoriteDemand"));
    expect((block.match(/throw new Error/g) ?? []).length).toBe(1);
    expect(block).toContain("sind zu viele");
  });

  it("eine Zeile, die nicht passt, wird übergangen statt geraten", () => {
    expect(q).toContain('typeof row.sky_id === "string" && typeof row.users === "number"');
  });
});


describe("die Zahl hängt an der SKY-ID — Varianten bleiben getrennt", () => {
  it("der Picker liest sie je Zeile aus `choice.favoriteDemand`", () => {
    expect(code(SEARCH)).toContain("count={choice.favoriteDemand}");
    /* Und die Zeile hat ihren Schlüssel aus der SKY-ID. */
    expect(code(SEARCH)).toContain("key={choice.skyId}");
  });

  it("die Zuordnung geschieht über die SKY-ID, nicht über den Namen", () => {
    /*
     * „Bash“, „Blue Bash“ und „Legendary Bash“ heißen fast gleich und sind
     * drei SKY-IDs. Eine Zuordnung über den Namen hätte sie zusammengeworfen
     * — und die Datenbank gruppiert ohnehin nach `sky_id` (ADR-0002).
     */
    expect(code(ORDERBOOK)).toContain("demand.get(String(r.sky_id))");
    expect(code(INVENTORY)).toContain("demand.get(row.skyId)");
    expect(code(ORDERBOOK)).not.toContain("demand.get(r.name");
  });

  it("zwei Positionen derselben Figur zeigen dieselbe Zahl", () => {
    /*
     * Lose und originalverpackt sind zwei Lagerpositionen EINER Figur. Ein
     * Favorit hängt an der SKY-ID und kennt den Zustand nicht; die Zahl je
     * Zustand aufzuteilen wäre eine Erfindung.
     */
    /*
     * Geprüft wird die ZUORDNUNG, nicht die ganze Datei: `row.condition`
     * steht dort zu Recht, der Verkaufszustand hängt daran. Die
     * Nachfragezahl darf ihn nur nicht lesen.
     */
    const inv = code(INVENTORY);
    const ab = inv.indexOf("favoriteDemand:");
    expect(inv.slice(ab, inv.indexOf("\n", ab))).toContain("demand.get(row.skyId)");
    expect(inv.slice(ab, inv.indexOf("\n", ab))).not.toContain("condition");
  });

  it("und die Datenbank zählt KONTEN, nicht Angebote", () => {
    /*
     * `count(*)` gruppiert nach `sky_id` über `favorites`, und der
     * Primärschlüssel ist `(user_id, sky_id)` — eine Zeile je Konto und
     * Figur. Die Zahl ist damit die Zahl unterschiedlicher Konten, und zwar
     * strukturell und nicht durch ein `distinct`, das jemand entfernen
     * könnte.
     */
    const m = quelle(MIGRATION);
    expect(m).toContain("select f.sky_id, count(*)::integer as users");
    expect(m).toContain("from public.favorites f");
    expect(m).toContain("group by f.sky_id");
    expect(m).toContain("constraint favorites_pk primary key (user_id, sky_id)");
    /* Und sie liest nichts aus dem Shop. */
    const rumpf = m.slice(m.indexOf("create or replace function public.favorite_demand"));
    const bis = rumpf.indexOf("$$;");
    for (const tabelle of ["shop_inventory", "shop_offers", "orders", "purchases"]) {
      expect(rumpf.slice(0, bis), tabelle).not.toContain(tabelle);
    }
  });
});


describe("null Favoriten zeichnen nichts", () => {
  it("die Komponente gibt bei 0, null und undefined `null` zurück", async () => {
    /*
     * Die meisten Figuren haben keinen Favoriten. 500 Nullen in einer Liste
     * sind kein Befund, sondern Rauschen — und auf einer Lagerkarte wäre
     * jede Zeile einen Hauch höher für eine Zahl, die nichts sagt.
     */
    const { FavoriteDemandIndicator } = await import(
      "@/components/business/favorite-demand-indicator");
    for (const wert of [0, null, undefined, -3, Number.NaN]) {
      expect(FavoriteDemandIndicator({ count: wert as number }), String(wert)).toBeNull();
    }
  });

  it("und bei einer echten Zahl ein Element", async () => {
    const { FavoriteDemandIndicator } = await import(
      "@/components/business/favorite-demand-indicator");
    const el = FavoriteDemandIndicator({ count: 12 });
    expect(el).not.toBeNull();
  });

  it("die Daten tragen `undefined` statt 0 — „nicht geladen“ ist nicht „niemand“", () => {
    /* An der Zuordnungszeile, nicht in der ganzen Datei: `?? 0` steht dort
       anderswo zu Recht. */
    for (const pfad of [ORDERBOOK, INVENTORY]) {
      const c = code(pfad);
      const ab = c.indexOf("favoriteDemand:");
      const zeile = c.slice(ab, c.indexOf("\n", ab));
      expect(zeile, pfad).toContain("demand.get(");
      expect(zeile, pfad).not.toContain("?? 0");
    }
  });
});


describe("die Beschriftung verspricht nichts", () => {
  it("sie heißt „vorgemerkt“ und nicht „Käufer“, „Interessent“ oder „wartet“", () => {
    /*
     * Ein Favorit ist eine Vormerkung, keine Kaufabsicht. „12 Käufer warten“
     * verkauft dem Betrieb eine Gewissheit, die die Zahl nicht hat.
     */
    expect(de.favorites.demandLabel).toBe("vorgemerkt");
    const texte = [de.favorites.demandLabel, de.favorites.demandFull(12),
                   de.favorites.demandShort(12)].join(" ").toLowerCase();
    for (const wort of ["käufer", "kaufer", "interessent", "wartet", "warten",
                        "garantiert", "verkauf", "umsatz", "nachfrage"]) {
      expect(texte, wort).not.toContain(wort);
    }
  });

  it("und sie nennt Nutzer, nicht Angebote", () => {
    expect(de.favorites.demandFull(12)).toContain("Nutzern");
    expect(de.favorites.demandFull(1)).toContain("1 Nutzer");
    expect(de.favorites.demandFull(12)).toContain("vorgemerkt");
  });

  it("die Zahl erscheint nie ohne ihre Bedeutung", () => {
    /*
     * Sichtbar ist auf dem Telefon nur „♥ 12“. Der vollständige Satz steht
     * als `title` und als `sr-only`-Text daneben, damit die Zahl nicht
     * alleine dasteht.
     */
    const k = code(INDICATOR);
    expect(k).toContain("title={copy.demandFull(count)}");
    expect(k).toContain('<span className="sr-only">{copy.demandFull(count)}</span>');
  });
});


describe("Berechtigungen — und die Grenze liegt in der Datenbank", () => {
  it("es gibt KEINE zweite Rollenprüfung in der Anwendung", () => {
    /*
     * Die Funktion ist `security definer` hinter
     * `can_operate_active_seller()`. Eine Prüfung daneben wäre eine zweite
     * Wahrheit darüber, wer fragen darf — und die läuft auseinander.
     */
    const q = code(QUERIES);
    expect(q).not.toContain("canOperateSeller");
    expect(q).not.toContain("isAdmin");
    expect(quelle(MIGRATION)).toContain("if not public.can_operate_active_seller() then");
  });

  it("die Tabelle `favorites` wird für den Betrieb nirgends geöffnet", () => {
    /* Der Weg zur Zahl ist die Funktion, nicht ein Tabellenrecht: ein Grant
       kennt keine Spalten. */
    const q = code(QUERIES);
    const block = q.slice(q.indexOf("fetchFavoriteDemand"));
    expect(block).not.toContain('from("favorites")');
    expect(quelle(MIGRATION)).toContain("grant select, insert, delete on public.favorites to authenticated");
    expect(quelle(MIGRATION)).not.toContain("to service_role");
  });

  it("kein Dienstschlüssel, nirgends auf diesem Weg", () => {
    for (const p of [QUERIES, ORDERBOOK, INVENTORY, INDICATOR, SEARCH, CARD]) {
      expect(code(p), p).not.toContain("SERVICE_ROLE");
      expect(code(p), p).not.toContain("serviceClient");
    }
  });

  it("und die Antwort kann keine Kennung enthalten", () => {
    /* Die Signatur ist die Grenze: `(sky_id, users)` und sonst nichts. */
    expect(quelle(MIGRATION)).toContain("returns table (sky_id text, users integer)");
    expect(code(QUERIES)).toContain("Promise<ReadonlyMap<string, number>>");
  });
});


describe("wo die Zahl erscheint — und wo nicht", () => {
  it("der Einkauf zeigt sie: Entwurfsliste, Position hinzufügen, Position ändern", () => {
    for (const p of ["src/components/business/purchase-draft-list.tsx",
                     "src/components/business/add-purchase-item.tsx",
                     "src/components/business/purchase-items.tsx"]) {
      expect(code(p), p).toContain("showDemand");
    }
  });

  it("der externe VERKAUF zeigt sie nicht — dort fehlt ein Käufer, keine Einschätzung", () => {
    for (const p of ["src/components/business/sale-items.tsx",
                     "src/components/business/new-sale.tsx",
                     "src/components/business/figure-draft.tsx"]) {
      expect(code(p), p).not.toContain("showDemand");
    }
  });

  it("der Kalkulator zeigt sie nicht", () => {
    /* Derselbe Picker, eine andere Frage — und ein Sammler bekäme die Zahl
       ohnehin nicht. */
    expect(code("src/components/calculator/calculator-modal.tsx")).not.toContain("showDemand");
  });

  it("die Vorgabe ist AUS, also bleibt jede andere Fläche unverändert", () => {
    expect(code(SEARCH)).toContain("showDemand = false");
  });

  it("das Lager zeigt sie am Kopf der Karte, vor dem Shop-Schalter", () => {
    const k = code(CARD);
    expect(k).toContain("<FavoriteDemandIndicator count={position.favoriteDemand} />");
    const anzeige = k.indexOf("<FavoriteDemandIndicator");
    const schalter = k.indexOf("aria-pressed={position.isListed}");
    expect(anzeige).toBeGreaterThan(-1);
    expect(anzeige, "sie steht hinter dem Schalter").toBeLessThan(schalter);
  });
});


describe("keine Breite, die sie nicht braucht", () => {
  const k = code(INDICATOR);

  it("sie fährt in einer vorhandenen Zeile mit", () => {
    expect(k).toContain("inline-flex");
    expect(k).toContain("shrink-0");
    expect(k).toContain("whitespace-nowrap");
    /* Kein Block, keine Karte, kein eigener Grund. */
    expect(k).not.toContain("rounded-sky");
    expect(k).not.toMatch(/(^|[\s"'+])bg-/);
  });

  it("auf dem Telefon nur Herz und Zahl, das Wort erst ab `sm:`", () => {
    expect(k).toContain('className="hidden sm:inline"');
  });

  it("im Picker liegt sie INNERHALB des Knopfes — sie überdeckt keine Fläche", () => {
    /*
     * DIE TREFFERZEILE, nicht der erste Knopf der Datei — das ist „freien
     * Artikel anlegen", und der hat mit der Nachfrage nichts zu tun.
     */
    const s = code(SEARCH);
    const liste = s.indexOf("{results.map((choice, index) =>");
    const zeile = s.slice(liste, s.indexOf("</button>", liste));
    expect(zeile).toContain("FavoriteDemandIndicator");
    expect(zeile).toContain("<button");
  });

  it("und das Herz ist dasselbe wie im Katalog, in derselben Farbe", () => {
    const pfad = "M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1";
    expect(quelle(INDICATOR)).toContain(pfad);
    expect(quelle("src/components/catalog/favorite-heart.tsx")).toContain(pfad);
    expect(k).toContain("text-favorite-ink");
  });
});


describe("Lager, Einkauf und Kalkulation bleiben unberührt", () => {
  it("diese Phase schreibt nichts", () => {
    for (const p of [QUERIES, INDICATOR]) {
      const c = code(p);
      for (const wort of [".insert(", ".update(", ".delete(", ".upsert("]) {
        expect(c, `${p}: ${wort}`).not.toContain(wort);
      }
    }
  });

  it("`fetchInventory` liest weiter dieselbe RPC und rechnet nichts anders", () => {
    const inv = code(INVENTORY);
    expect(inv).toContain('supabase.rpc("admin_shop_inventory")');
    expect(inv).not.toContain(".update(");
    /* Die Zahl kommt NEBEN die Zeile, nicht in sie: `toRow` ist unberührt. */
    expect(inv).toContain("...row, figure, saleState: zustand,");
  });

  it("und `FigureChoice` behält Preis und Marktwert unverändert", () => {
    const fs = code("src/lib/orderbook/figure-search.ts");
    expect(fs).toContain("marketPrice: number | null;");
    expect(code(ORDERBOOK)).toContain("marketPrice: fact?.marketPrice ?? null");
  });

  it("keine neue Datenbankfunktion fuer die Nachfrageanzeige", () => {
    /*
     * BERICHTIGT AM 2026-10-25. Hier stand `expect(dateien).not.toContain("0146_")`
     * — und das war die falsche Frage. Gemeint war „Phase 3 braucht keine
     * Migration", gemessen wurde „es gibt keine Migration 0146". Phase 4
     * legt mit `0146` den Angebotsspiegel an, und damit wurde ein Test rot,
     * der über die Nachfrageanzeige gar nichts sagte.
     *
     * Gefragt wird jetzt, was gemeint war: die Anzeige benutzt
     * `favorite_demand()` aus `0145` und bringt keine eigene Funktion mit.
     */
    expect(code(QUERIES)).not.toContain("create function");
    expect(code(QUERIES)).toContain('supabase.rpc("favorite_demand"');
    /* Und die Funktion steht in `0145`, nicht in einer neueren Migration. */
    expect(quelle(MIGRATION)).toContain(
      "create or replace function public.favorite_demand(");
    for (const spaeter of ["0146_offer_state.sql"]) {
      expect(readFileSync(`supabase/migrations/${spaeter}`, "utf8"), spaeter)
        .not.toContain("favorite_demand");
    }
  });
});
