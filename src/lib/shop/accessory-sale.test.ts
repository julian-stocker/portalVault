/**
 * SPIELE UND PORTALE IM EIGENEN SHOP — die Sicherungen von `0139`.
 *
 * `0139` ist die Migration, die Zubehör verkäuflich MACHEN kann. Sie ist
 * damit die gefährlichste dieser Arbeit: ein Fehler darin veröffentlicht
 * Ware, die niemand freigegeben hat. Diese Datei prüft ihren TEXT.
 *
 * WAS HIER GEPRÜFT WIRD UND WAS WOANDERS
 *
 *   hier                 der Text: welche Bedingung in welchem Tor steht,
 *                        welche Tür welches Tor fragt, dass die vier Türen
 *                        Zeichen für Zeichen ihre alten Fassungen sind,
 *                        und was die Migration NICHT anfasst.
 *   verify:check-sql     das Verhalten gegen echtes PostgreSQL, Durchgänge
 *                        P34–P37: nichts wird veröffentlicht, eine
 *                        freigegebene Portalposition wird zum Angebot, ein
 *                        Spiel ohne USK bleibt draußen, die Freigabefunktion
 *                        lehnt ab, was sie ablehnen muss.
 *   das Ergebnisblatt    dass sie auf Staging läuft. Bis dahin ist sie
 *                        NICHT ANGEWENDET.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { allMigrations, code, latestFunction, migrationSource } from "@/test-support/migrations";

const M139 = migrationSource("0139_accessory_sale_release.sql");
/* Die Rücknahme liegt unter `supabase/rollback/`, nicht unter `migrations/`. */
const ROLLBACK = readFileSync("supabase/rollback/R0139_drop_sale_release.sql", "utf8");

/** Der Rumpf einer Funktion, wie sie VOR 0139 zuletzt definiert war. */
function vorherigeFassung(name: string, datei: string): string {
  const sql = migrationSource(datei);
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(start, `${name} in ${datei}`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end + 4);
}

/** Dieselbe Funktion, wie sie in 0139 steht. */
function neueFassung(name: string): string {
  /* Beide Schreibweisen: `shop_offers()` wird gedroppt und neu angelegt,
     weil PostgreSQL den Rückgabetyp nicht ersetzen lässt. */
  const start = Math.max(
    M139.lastIndexOf(`create or replace function public.${name}(`),
    M139.lastIndexOf(`\ncreate function public.${name}(`) + 1,
  );
  expect(start, `${name} in 0139`).toBeGreaterThan(0);
  const end = M139.indexOf("\n$$;", start);
  return M139.slice(start, end + 4);
}

/**
 * DREI der vier Verkaufstüren, und die Datei, die sie zuletzt definiert hat.
 *
 * `shop_offers()` fehlt hier mit Absicht: sie ist die einzige, die mehr als
 * eine Zeile ändert — sie bekommt eine fünfte Spalte. Sie hat deshalb einen
 * eigenen Block weiter unten, der jede Abweichung einzeln aufzählt, statt
 * sie in einer lockereren Regel für alle vier verschwinden zu lassen.
 */
const TUEREN = [
  ["shop_quantity_available", "0028_v1_loose_only_commerce.sql"],
  ["create_order", "0040_shop_platform_responsibilities.sql"],
  ["reserve_for_order", "0010_commerce_core.sql"],
] as const;

/** Die vierte. */
const OFFERS_VORHER = "0029_v1_loose_only_offers.sql";

/* ===================================================================== */
describe("1. drei Türen — eine getauschte Zeile, und sonst nichts", () => {
  it.each(TUEREN)("%s unterscheidet sich von %s in GENAU einer Zeile", (name, datei) => {
    /*
     * DIE SCHÄRFSTE PRÜFUNG DIESER DATEI. `0139` muss jede der vier
     * Funktionen vollständig neu schreiben — `create or replace` kennt kein
     * „nur diese Zeile". Dabei kann unbemerkt etwas anderes mitwandern: ein
     * umgestellter Filter, ein verlorener Kommentar, eine Bedingung, die
     * beim Abschreiben verrutscht.
     *
     * Deshalb wird hier nicht beschrieben, was gleich sein soll, sondern
     * nachgerechnet: die alte Fassung, mit der EINEN erlaubten Ersetzung,
     * muss Zeichen für Zeichen die neue sein.
     */
    const alt = vorherigeFassung(name, datei);
    const erwartet = alt.replace("public.is_shop_eligible(i.sky_id)",
                                 "public.is_position_sellable(i.id)");
    expect(erwartet, `${name}: die Ersetzung greift nicht`).not.toBe(alt);
    expect(neueFassung(name)).toBe(erwartet);
  });

  it("und die Rücknahme stellt sie Zeichen für Zeichen wieder her", () => {
    for (const [name, datei] of TUEREN) {
      const alt = vorherigeFassung(name, datei);
      const start = ROLLBACK.lastIndexOf(`create or replace function public.${name}(`);
      expect(start, `${name} in R0139`).toBeGreaterThan(-1);
      const end = ROLLBACK.indexOf("\n$$;", start);
      expect(ROLLBACK.slice(start, end + 4), name).toBe(alt);
    }
  });
});

/* ===================================================================== */
describe("1b. shop_offers — die eine Tür, die eine Spalte dazubekommt", () => {
  const alt = vorherigeFassung("shop_offers", OFFERS_VORHER);
  const neu = neueFassung("shop_offers");

  /** Zeilen, die in `b` stehen und in `a` nicht — ohne Einrückung. */
  const dazu = (a: string, b: string): string[] => {
    const vorhanden = new Set(a.split("\n").map((l) => l.trim()));
    return b.split("\n").map((l) => l.trim())
      .filter((l) => l !== "" && !vorhanden.has(l));
  };

  it("sie wird GEDROPPT und neu angelegt, nicht ersetzt", () => {
    /*
     * PostgreSQL lässt den Rückgabetyp einer Funktion nicht ersetzen. Eine
     * fünfte Spalte heißt deshalb: `drop`, dann `create`. Das ist kein
     * Stilwechsel, sondern die einzige Form, die läuft — und weil ein
     * `drop` die Rechte mitnimmt, müssen sie danach wieder dastehen.
     */
    expect(code(M139)).toContain("drop function if exists public.shop_offers();");
    expect(neu.startsWith("create function public.shop_offers()")).toBe(true);
    const nachDrop = M139.indexOf("drop function if exists public.shop_offers();");
    expect(M139.indexOf("create function public.shop_offers()")).toBeGreaterThan(nachDrop);
    expect(M139.indexOf("grant execute on function public.shop_offers()"))
      .toBeGreaterThan(nachDrop);
  });

  it("und bringt GENAU diese Zeilen mit — keine weitere", () => {
    /*
     * Dieselbe Rechnung wie für die drei anderen Türen, nur mit mehr als
     * einer erlaubten Änderung. Verglichen werden Zeilen ohne Einrückung:
     * die Spaltenliste wird neu ausgerichtet, wenn ein längerer Name
     * dazukommt, und eine Einrückung ist keine Aussage.
     *
     * Was hier nicht aufgezählt ist, ist beim Neuschreiben hineingeraten.
     */
    expect(dazu(alt, neu).sort()).toEqual([
      "-- Was im Paket liegt. NULL fuer jede Figur — siehe Kopf.",
      "(i.available_quantity > 0) as available,",
      "and public.is_position_sellable(i.id)",
      "available      boolean,",
      "condition      text,",
      "create function public.shop_offers()",
      "delivery_scope text",
      "i.delivery_scope",
      "price          numeric,",
      "sky_id         text,",
    ].sort());
  });

  it("und verliert GENAU diese — keine weitere", () => {
    expect(dazu(neu, alt).sort()).toEqual([
      "(i.available_quantity > 0) as available",
      "and public.is_shop_eligible(i.sky_id)",
      "available boolean",
      "condition text,",
      "create or replace function public.shop_offers()",
      "price     numeric,",
      "sky_id    text,",
    ].sort());
  });

  it("die Projektion liefert GENAU fünf Spalten, und das sind diese", () => {
    /*
     * Gelesen wird die `returns table (...)`-Liste, nicht der Rumpf: dort
     * steht, was nach draußen geht. `sale_price` etwa kommt im Rumpf vor —
     * als Argument von `shop_price()` —, verlässt die Funktion aber nicht.
     */
    const kopf = neu.slice(neu.indexOf("returns table ("), neu.indexOf(")\nlanguage"));
    const spalten = kopf.split("\n").slice(1)
      .map((l) => l.trim().replace(/,$/, "").split(/\s+/)[0])
      .filter((n) => n !== "");
    expect(spalten).toEqual(["sky_id", "condition", "price", "available", "delivery_scope"]);
    /* Und keine davon ist eine Menge oder ein interner Wert. */
    for (const verboten of ["quantity", "reserved", "note", "inventory_id",
      "sale_price", "seller"]) {
      expect(spalten, verboten).not.toContain(verboten);
    }
  });

  it("und die Rücknahme gibt ihr die vier Spalten zurück", () => {
    expect(ROLLBACK).toContain("drop function if exists public.shop_offers();");
    const start = ROLLBACK.lastIndexOf("create function public.shop_offers()");
    expect(start).toBeGreaterThan(-1);
    const end = ROLLBACK.indexOf("\n$$;", start);
    const zurueck = ROLLBACK.slice(start, end + 4);
    /* Zeichen für Zeichen die Fassung aus 0029 — bis auf das `or replace`,
       das nach dem `drop` nichts mehr zu ersetzen hätte. */
    expect(zurueck).toBe(alt.replace("create or replace function public.shop_offers()",
                                     "create function public.shop_offers()"));
  });
});

/* ===================================================================== */
describe("2. das neue Tor", () => {
  const tor = code(latestFunction("is_position_sellable").body);

  it("ruft die Figurenregel auf, statt sie abzuschreiben", () => {
    /*
     * Der Kern des Sicherheitsarguments: „für Figuren ändert sich nichts"
     * ist keine Zusage, die jemand pflegen müsste, sondern eine Eigenschaft
     * des Textes. Eine Kopie der Regel könnte auseinanderlaufen; ein Aufruf
     * nicht.
     */
    expect(tor).toContain("public.is_shop_eligible(i.sky_id)");
    /* Und die Figurenregel selbst wird von 0139 NICHT angefasst. */
    expect(latestFunction("is_shop_eligible").file).toBe("0135_catalog_item_type.sql");
  });

  it("verlangt für Zubehör alle fünf Bedingungen", () => {
    for (const bedingung of [
      "s.item_type in ('game', 'portal')",   // nicht bundle, nicht other
      "s.is_active",
      "s.catalog_visible",
      "s.usk_rating is not null",            // nur bei Spielen
      "i.sale_released",                     // die ausdrückliche Freigabe
    ]) {
      expect(tor, bedingung).toContain(bedingung);
    }
  });

  it("KATALOGSICHTBARKEIT ALLEIN BEWIRKT KEINE FREIGABE", () => {
    /*
     * Punkt 1 des Auftrags. Die beiden Bedingungen stehen mit `and`
     * verbunden nebeneinander — sichtbar ist notwendig, nie hinreichend.
     * Nachgefahren wird das in P35: nur sichtbar → 0 Angebote.
     */
    const zubehoerzweig = tor.slice(tor.indexOf("or ("));
    expect(zubehoerzweig).toContain("s.catalog_visible");
    expect(zubehoerzweig).toContain("and i.sale_released");
    expect(zubehoerzweig).not.toContain("or i.sale_released");
  });

  it("und sagt nichts über Bestand, Preis oder Beschaffenheit", () => {
    /* Die bleiben, wo sie waren — in den Türen. Ein Tor, das auch noch den
       Bestand prüft, wäre eine zweite Stelle, an der „verfügbar" definiert
       ist. */
    for (const fremd of ["available_quantity", "sale_price", "shop_price",
      "v1_sale_condition", "is_listed"]) {
      expect(tor, fremd).not.toContain(fremd);
    }
  });
});

/* ===================================================================== */
describe("3. die Altlast wird nicht veröffentlicht", () => {
  it("die Freigabe steht auf `not null default false`", () => {
    /*
     * DER SATZ, AN DEM ALLES HÄNGT. 13 Lagerzeilen auf Spielen tragen
     * `is_listed = true` — und sie tragen zwingend auch einen Preis, denn
     * `shop_inventory_listed_needs_price` (0003) verbietet das eine ohne
     * das andere. Ihnen fehlt zur Veröffentlichung ausschließlich das Tor.
     */
    expect(code(M139)).toContain(
      "add column sale_released boolean not null default false");
    /* Und der CHECK aus 0003, auf den sich das Argument stützt, steht wirklich. */
    expect(allMigrations).toContain("constraint shop_inventory_listed_needs_price");
  });

  it("die Migration schreibt KEINE Freigabe und KEINE USK-Angabe", () => {
    const anweisungen = code(M139)
      .split(/\$\$/)
      .filter((_, i) => i % 2 === 0)        // außerhalb der Funktionsrümpfe
      .join("\n");
    expect(anweisungen).not.toContain("set sale_released = true");
    expect(anweisungen).not.toContain("update public.shop_inventory");
    expect(anweisungen).not.toContain("update public.skylanders");
    expect(anweisungen).not.toContain("insert into public.shop_inventory");
  });

  it("und ihre Nachbedingung zählt beides nach", () => {
    expect(M139).toContain("from public.shop_inventory where sale_released");
    expect(M139).toContain("Positionen stehen auf sale_released = true, erwartet 0");
    expect(M139).toContain("Zeilen tragen eine USK-Angabe, erwartet 0");
  });

  it("sie beweist die Gleichheit ZEILE FÜR ZEILE, nicht als Summe", () => {
    /* Eine Figur, die herausfällt, und ein Zubehörteil, das dazukommt,
       heben sich in einer Summe auf. Deshalb der Vergleich je Position. */
    expect(M139).toContain(
      "public.is_position_sellable(i.id) is distinct from public.is_shop_eligible(i.sky_id)");
  });
});

/* ===================================================================== */
describe("4. die Alterskennzeichnung wird nie geraten", () => {
  it("die Spalte ist nullable, und NULL heißt „nicht erfasst“", () => {
    expect(code(M139)).toContain("add column usk_rating smallint");
    expect(code(M139)).not.toContain("usk_rating smallint not null");
    expect(code(M139)).not.toContain("usk_rating smallint default");
  });

  it("nur die fünf amtlichen Stufen", () => {
    expect(code(M139)).toContain("check (usk_rating is null or usk_rating in (0, 6, 12, 16, 18))");
  });

  it("ein Spiel ohne Eintrag ist nicht freigebbar", () => {
    const fn = code(latestFunction("seller_set_sale_release").body);
    expect(fn).toContain("v_art = 'game' and v_usk is null");
    expect(fn).toContain("has no USK rating recorded");
  });

  it("aber das ZURÜCKNEHMEN geht auch ohne", () => {
    /* Ein Riegel, der das Abschalten verhindert, zeigt in die falsche
       Richtung. Die Prüfung hängt deshalb an `p_released`. */
    expect(code(latestFunction("seller_set_sale_release").body))
      .toContain("if p_released and v_art = 'game' and v_usk is null");
  });

  it("und sie wird aus keinem Namen abgeleitet", () => {
    const fn = code(latestFunction("admin_set_usk_rating").body);
    for (const heuristik of ["ilike", "position(", "lower(", "canonical_name"]) {
      expect(fn.toLowerCase(), heuristik).not.toContain(heuristik);
    }
    /* Nur Spiele — ein Portal ist Hardware und trägt keine Einstufung. */
    expect(fn).toContain("v_art <> 'game'");
  });
});

/* ===================================================================== */
describe("5. die Freigabe hängt an der POSITION, nicht am Artikel", () => {
  it("die Spalte steht auf shop_inventory", () => {
    expect(code(M139)).toContain("alter table public.shop_inventory\n  add column sale_released");
    /* Und NICHT auf skylanders: dort stünde sie für alle Positionen eines
       Artikels zugleich — und müsste beim zweiten Händler migriert werden. */
    expect(code(M139)).not.toContain("alter table public.skylanders\n  add column shop_released");
  });

  it("die Funktion setzt genau eine Position, über sky_id UND condition", () => {
    const fn = code(latestFunction("seller_set_sale_release").body);
    expect(fn).toContain("i.sky_id = p_sky_id");
    expect(fn).toContain("i.condition = p_condition");
    expect(fn).toContain("where id = v_id");
  });

  it("sie legt keine Position an", () => {
    /* `set_shop_listing()` tut das (mit Menge 0), weil ein Preis auch für
       etwas gesetzt werden darf, das gerade nicht da ist. Eine Freigabe für
       eine Position, die es nicht gibt, ist eine Freigabe für nichts. */
    const fn = code(latestFunction("seller_set_sale_release").body);
    expect(fn).not.toContain("insert into");
    expect(fn).toContain("no stock position for");
  });

  it("und eine Figur wird abgelehnt statt stillschweigend ignoriert", () => {
    /* Ein Schalter, von dem schon bekannt ist, dass er nicht wirkt, ist
       keine Auswahl, sondern eine Falle (dieselbe Begründung wie 0108). */
    expect(code(latestFunction("seller_set_sale_release").body))
      .toContain("a figure needs no sale release");
  });

  it("KEIN seller_id, keine Multi-Seller-Struktur (ADR-0021)", () => {
    const text = code(M139) + code(ROLLBACK);
    for (const marketplace of ["seller_id", "stripe_connect", "payout", "commission",
      "marketplace"]) {
      expect(text.toLowerCase(), marketplace).not.toContain(marketplace);
    }
  });
});

/* ===================================================================== */
describe("6. was 0139 ausdrücklich NICHT anfasst", () => {
  const text = code(M139);

  it("die Sammelbarkeit", () => {
    /* Zubehör bleibt vollständig aus der Sammlung heraus (ADR-0128). */
    expect(text).not.toContain("create or replace function public.non_collectible_categories");
    expect(text).not.toContain("collection_items");
    expect(text).not.toContain("create or replace function public.is_collectible");
  });

  it("die Katalogsichtbarkeit", () => {
    expect(text).not.toContain("set catalog_visible");
    expect(text).not.toContain("create or replace function public.admin_set_catalog_visible");
  });

  it("Storno, Retoure, Erstattung und die Lagerbuchung", () => {
    /* Sie hängen an `order_lines.inventory_id`, nicht am Artikeltyp — sie
       funktionieren für Zubehör unverändert, und deshalb werden sie auch
       nicht angefasst. */
    for (const fremd of ["seller_cancel_order_line", "seller_receive_order_return",
      "submit_order_refund", "record_refund_event", "record_inventory_movement",
      "apply_inventory_movement", "set_shop_listing"]) {
      expect(text, fremd).not.toContain(`create or replace function public.${fremd}`);
    }
  });

  it("die Belegausstellung — und sie prüft, dass die Sperre hält", () => {
    expect(text).not.toContain("platform_receipt_sequence)");
    expect(text).toContain("die Belegsperre ist offen");
    expect(text).not.toContain("grant insert on public.platform_receipts");
  });

  it("und die Preisregel", () => {
    expect(text).not.toContain("create or replace function public.shop_price");
    expect(text).not.toContain("create or replace function public.v1_sale_condition");
  });
});

/* ===================================================================== */
describe("7. die Betriebsdiagnose nennt den richtigen Grund", () => {
  const fn = code(latestFunction("admin_shop_listing_audit").body);

  it("drei neue Gründe, in der Reihenfolge der Prüfung", () => {
    for (const grund of ["item type not sold", "usk rating missing",
      "not released for sale"]) {
      expect(fn, grund).toContain(grund);
    }
  });

  it("„nicht sammelbar“ gilt nur noch für Figuren", () => {
    /* Sonst nennte sie für ein freigegebenes Spiel ein Hindernis, das
       keines mehr ist — während die Spalte daneben `true` sagt. */
    expect(fn).toContain("when s.item_type = 'figure'\n             and c.name = any");
  });

  it("und sie fragt dasselbe Tor wie die vier Türen", () => {
    expect(fn).toContain("public.is_position_sellable(i.id)");
    expect(fn).not.toContain("public.is_shop_eligible(i.sky_id)");
  });
});

/* ===================================================================== */
describe("8. die Migration ist vorbereitet, nicht angewendet", () => {
  it("sie sagt es in ihrem eigenen Kopf", () => {
    expect(M139).toContain("NICHT ANGEWENDET");
    expect(M139.slice(0, 2000)).toContain("Braucht eine eigene Freigabe");
  });

  it("sie prüft sich selbst auf die Transaktionsklammer", () => {
    expect(M139).toContain("laeuft nicht in einer Transaktion");
    expect(M139).toContain("on commit drop");
  });

  it("und sie nennt jede Voraussetzung einzeln", () => {
    for (const voraussetzung of ["is_shop_eligible(text)", "shop_offers()",
      "shop_quantity_available(text, text, integer)",
      "create_order(text, text, jsonb, jsonb, text, text)", "reserve_for_order(bigint)",
      "admin_shop_listing_audit()", "can_operate_active_seller()", "is_platform_admin()"]) {
      expect(M139, voraussetzung).toContain(`to_regprocedure('public.${voraussetzung}')`);
    }
  });

  it("die Rücknahme warnt, bevor sie eine Freigabe löscht", () => {
    expect(ROLLBACK).toContain("Positionen sind freigegeben");
    expect(ROLLBACK).toContain("Spiele tragen eine USK-Angabe");
    /* Reihenfolge: erst die Funktionen, dann die Spalten. */
    expect(ROLLBACK.indexOf("drop function if exists public.is_position_sellable"))
      .toBeLessThan(ROLLBACK.indexOf("drop column if exists sale_released"));
  });
});

/* ===================================================================== */
describe("9. der Warenkorb braucht keine Änderung", () => {
  it("eine Warenkorbzeile ist sky_id + condition, und sonst nichts", () => {
    /*
     * Punkt 4 des Auftrags: keine separate Zubehör-Warenkorbarchitektur.
     * Es gibt gar keine zu bauen — der Warenkorb kennt den Artikeltyp
     * nicht und lädt den Katalog nie.
     */
    const cart = readFileSync("src/lib/cart/cart.ts", "utf8");
    for (const fremd of ["itemType", "isCollectible", "fetchCatalog", "item_type"]) {
      expect(cart, fremd).not.toContain(fremd);
    }
  });
});
