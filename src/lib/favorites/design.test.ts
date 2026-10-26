import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { hasV1BuyableOffer, type Offer } from "@/lib/shop/offer";
import { de } from "@/lib/i18n/de";

/**
 * Was an der Überarbeitung vom 2026-10-25 am Aufbau hängt.
 *
 * Die Arbeitsteilung bleibt: `favorite-interaction.test.tsx` DRÜCKT (echtes
 * DOM, echte Handler), `ui.test.ts` prüft die Architektur, und hier stehen
 * die gestalterischen Zusagen — die nur dann etwas wert sind, wenn ihr
 * Gegenteil auffällt.
 */

const HEART = "src/components/catalog/favorite-heart.tsx";
const HEADING = "src/components/catalog/favorites-heading.tsx";
const PAGE = "src/app/(app)/favoriten/page.tsx";
const VIEW = "src/components/catalog/catalog-view.tsx";
const CSS = "src/app/globals.css";

const quelle = (p: string): string => readFileSync(p, "utf8");

function code(p: string): string {
  return quelle(p)
    .split("\n")
    .filter((z) => {
      const t = z.trimStart();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");
}


describe("das Herz trägt keine Scheibe mehr", () => {
  const herz = code(HEART);

  it("kein dauerhaft sichtbarer Grund — und auch kein Blur", () => {
    /*
     * DER BEFUND, DEN DER BETREIBER GEMELDET HAT. Die erste Fassung trug
     * `bg-black/45 backdrop-blur-[2px]` an der Trägerfläche: lesbar, aber
     * ein 36-px-Knopf auf jeder von bis zu 561 Karten — und damit das
     * Erste, was man im Raster sieht.
     *
     * Geprüft wird die ABWESENHEIT eines unbedingten Grundes. `hover:bg-…`
     * und `focus-visible:bg-…` sind erlaubt und erwünscht; was nicht
     * vorkommen darf, ist ein `bg-` ohne Zustandspräfix an der Fläche.
     */
    const klassen = herz.slice(herz.indexOf("const KNOPF"), herz.indexOf("const SYMBOL"));
    const unbedingt = [...klassen.matchAll(/(^|[\s"'+])(bg-[a-z0-9/[\]._-]+)/g)]
      .map((m) => m[2])
      .filter((k) => !k.includes(":"));
    expect(unbedingt, "die Trägerfläche hat einen unbedingten Hintergrund").toEqual([]);
    expect(klassen).not.toContain("backdrop-blur");
  });

  it("aber bei Hover UND bei Fokus erscheint eine Fläche", () => {
    /*
     * SEIT DEM 2026-10-25 AM GLYPH, nicht am Knopf. Die Fläche ist jetzt
     * 44 px; ein Grund darüber wäre die graue Scheibe zurück, nur größer.
     * Erscheint deshalb als kleiner Kreis hinter dem 22-px-Herz.
     */
    const grund = herz.slice(herz.indexOf("const GRUND"), herz.indexOf("const SYMBOL"));
    expect(grund).toContain("group-hover/fav:bg-");
    expect(grund).toContain("group-focus-visible/fav:bg-");
  });

  it("die Trageflaeche ist 44 px, das Symbol 22 px", () => {
    /*
     * BERICHTIGT AM 2026-10-25. Hier stand 36 px und 14 px, und 14 px waren
     * auf einem Laptop zu klein: eine Karte ist dort 268 px breit, also
     * 5,2 % — an den drei Bash-Karten kaum als Bedienelement erkennbar.
     *
     * Die Maße werden hier nur GELESEN. Ob sie passen, rechnet
     * `geometry.test.ts` aus `CARD_ASPECT`, `ROWS` und `INSET` nach, für
     * jeden Rasterpunkt — eine Prüfung, die nur den Text liest, hätte den
     * Befund nicht verhindert.
     */
    expect(herz).toContain("h-11 w-11");
    expect(herz).toContain('const SYMBOL = "block h-[22px] w-[22px]"');
    expect(herz).not.toContain("h-[14px]");
  });

  it("der Kontrast kommt aus einem Halo am Glyph, nicht aus einer Platte", () => {
    expect(herz).toContain("drop-shadow");
    /* Zwei Fassungen: eng und dunkel im leeren Zustand, Leuchten im
       gefüllten. */
    expect(herz).toContain("HALO_LEER");
    expect(herz).toContain("HALO_VOLL");
  });
});


describe("gefüllt heißt Korall, und Korall ist ein Token", () => {
  it("kein Literal mehr im Bauteil", () => {
    /* Hier stand `text-[#ff7b8a]`. Eine Farbe, die einen Zustand bedeutet,
       gehört in die Tokenliste, damit sie im Dunkelmodus mitgeht. */
    expect(code(HEART)).not.toContain("#ff7b8a");
    expect(code(HEART)).toContain("text-favorite-ink");
  });

  it("die Token sind definiert, abgebildet und im Dunkelmodus angepasst", () => {
    const css = quelle(CSS);
    expect(css).toContain("--favorite-ink:");
    expect(css).toContain("--favorite-glow:");
    expect(css).toContain("--color-favorite-ink: var(--favorite-ink)");
    expect(css).toContain("--color-favorite-glow: var(--favorite-glow)");
    /* Im Dunkelblock eine zweite Fassung — zwei Vorkommen je Name. */
    expect((css.match(/--favorite-ink:/g) ?? []).length).toBe(2);
  });

  it("und Korall ist NICHT das Gold des Besitzes", () => {
    /*
     * Die wichtigste Zusage dieser Gruppe. Gold heißt Besitz — Rahmen,
     * Krone, „In deiner Sammlung“, seit V4.6 sogar die Größe der Karte. Ein
     * Favorit ist die Gegenaussage. Dieselbe Farbe für beides würde den
     * einen Blick, den jemand auf ein Raster wirft, zweideutig machen.
     */
    const css = quelle(CSS);
    const korall = /--favorite-ink:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const gold = /--own-ink:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(korall).toBeTruthy();
    expect(gold).toBeTruthy();
    expect(korall).not.toBe(gold);
    /* Und auch nicht der Alarm: `--danger` ist für einen Alarm reserviert. */
    const danger = /^\s*--danger:\s*(#[0-9a-f]{6})/im.exec(css)?.[1];
    expect(korall).not.toBe(danger);
  });

  it("die Karte selbst wird durch einen Favoriten nicht heller oder größer", () => {
    /*
     * Diese Unterscheidung ist dem SAMMLUNGSSTATUS vorbehalten (V4.6,
     * `understatesCard`). Das Herz bekommt deshalb keinen Durchgriff auf
     * Rahmen, Maßstab oder Grund der Karte: `FigureCard` erhält es als
     * `favoriteSlot`, also als Inhalt, nicht als Zustand.
     */
    const karte = code("src/components/catalog/figure-card.tsx");
    expect(karte).toContain("favoriteSlot");
    /* Kein `favorited`/`favorite`-Zustand in der Kartendarstellung. */
    expect(karte).not.toMatch(/\bfavorited\b/);
    expect(karte).not.toContain("UNCOLLECTED_SCALE * ");
    /* Und die Kartenvorlage kennt das Korall gar nicht. */
    expect(code("src/lib/catalog/card-template.ts")).not.toContain("favorite");
    expect(code("src/lib/catalog/card.ts")).not.toContain("favorite");
  });
});


describe("die Bewegung ist kurz, einmalig und nur beim Setzen", () => {
  it("der Keyframe steht in globals.css, wo die Reduced-Motion-Regel greift", () => {
    /*
     * ABSICHTLICH NICHT IM BAUTEIL. Die Regel in `globals.css` setzt jede
     * Animationsdauer auf 0.01 ms — für alles, was in diesem Block steht.
     * Ein Keyframe in einer Komponente entkäme ihr.
     */
    const css = quelle(CSS);
    expect(css).toContain("@keyframes favorite-pop");
    const keyframe = css.indexOf("@keyframes favorite-pop");
    const regel = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(regel).toBeGreaterThan(keyframe);
    expect(css).toContain("animation-duration: 0.01ms !important");
  });

  it("220 ms, ein Überschwingen und zurück", () => {
    expect(quelle(CSS)).toMatch(/favorite-pop\s*\{[\s\S]*?scale\(1\.2[0-9]\)/);
    expect(code(HEART)).toContain("favorite-pop 220ms");
  });

  it("sie läuft beim Setzen, nicht beim Entfernen", () => {
    const herz = code(HEART);
    expect(herz).toContain("if (desired) setAnimationKey");
    expect(herz).toContain("favorited && animationKey > 0");
  });

  it("und nicht beim ersten Zeichnen einer schon vorgemerkten Figur", () => {
    /* `animationKey` startet auf 0, und 0 heißt „in dieser Sitzung noch
       nicht gesetzt" — sonst poppte beim Laden von `/favoriten` jede Karte. */
    expect(code(HEART)).toContain("useState(0)");
  });
});


describe("kein Schleier während des Fluges", () => {
  it("das Herz wird nicht abgedunkelt, solange der Aufruf läuft", () => {
    /*
     * DER ZWEITE BEFUND DES BETREIBERS („fühlt sich träge an“). Die erste
     * Fassung setzte `opacity-70`, solange die Server-Aktion lief: die
     * Anzeige stimmte sofort, aber das Herz wurde blass und wartete
     * SICHTBAR. Ein optimistisches Update, das anschließend „lade noch“
     * signalisiert, nimmt sich seinen eigenen Zweck.
     */
    const herz = code(HEART);
    expect(herz).not.toContain("opacity-70");
    expect(herz).not.toMatch(/pending \?\s*"opacity/);
  });

  it("aber `aria-busy` bleibt — es ist Auskunft, kein Effekt", () => {
    expect(code(HEART)).toContain("aria-busy={pending || undefined}");
  });

  it("und der Knopf schaltet im Flug nicht ab", () => {
    /* Ein Knopf, der unter dem Finger `disabled` wird, verliert den zweiten
       Tipp — und der zweite Tipp hat seinen eigenen Endzustand. */
    const herz = code(HEART);
    expect(herz).not.toMatch(/disabled=\{/);
  });
});


describe("die Barrierefreiheit des Herzens", () => {
  const herz = code(HEART);

  it("es ist ein Knopf mit `aria-pressed` — Tastatur kommt dadurch gratis", () => {
    expect(herz).toContain('type="button"');
    expect(herz).toContain("aria-pressed={favorited}");
  });

  it("und es hat einen Namen, der die AKTION nennt", () => {
    /* Der Zustand steht in `aria-pressed`; das Label sagt, was ein Druck
       tut. Beides zusammen ist die Auskunft. */
    expect(herz).toContain("aria-label={hinweis}");
    expect(de.catalog.favoriteHint).not.toBe(de.catalog.unfavoriteHint);
  });

  it("der Fokus ist sichtbar, und zwar mit Fläche UND Ring", () => {
    /* Beides am Kreis hinter dem Glyph: ein Ring um die unsichtbare
       44-px-Fläche umschlösse nichts, was man sieht. */
    const grund = herz.slice(herz.indexOf("const GRUND"), herz.indexOf("const SYMBOL"));
    expect(grund).toContain("group-focus-visible/fav:bg-");
    expect(grund).toContain("group-focus-visible/fav:outline");
  });
});


describe("die Kennzahlen kommen aus echten Angeboten", () => {
  const seite = code(PAGE);

  const angebot = (over: Partial<Offer> = {}): Offer => ({
    skyId: "SKY-0001", condition: "loose", price: 12, available: true,
    deliveryScope: null, ...over,
  } as Offer);

  it("„Mit Angebot“ fragt dieselbe Funktion wie die Karte", () => {
    /*
     * KEINE ZWEITE DEFINITION VON „KAUFBAR“. `hasV1BuyableOffer()` ist die
     * Funktion, die die Angebotszeile jeder Karte und die Schnellansicht
     * benutzen — veröffentlicht, loser Zustand, bepreist, auf Lager.
     */
    expect(seite).toContain("hasV1BuyableOffer(offersFor(offers, f.skyId))");
    expect(seite).not.toContain("available &&");
    expect(seite).not.toContain('=== "loose"');
  });

  it("und diese Funktion zählt genau das Richtige", () => {
    /* Nicht die Seite, sondern die Regel selbst — damit die Kennzahl auch
       dann stimmt, wenn jemand die Regel ändert. */
    expect(hasV1BuyableOffer([angebot()])).toBe(true);
    expect(hasV1BuyableOffer([angebot({ available: false })])).toBe(false);
    expect(hasV1BuyableOffer([angebot({ condition: "boxed" })])).toBe(false);
    expect(hasV1BuyableOffer([])).toBe(false);
    expect(hasV1BuyableOffer(undefined)).toBe(false);
    /* Ein kaufbares neben einem nicht kaufbaren zählt. */
    expect(hasV1BuyableOffer([angebot({ available: false }), angebot()])).toBe(true);
  });

  it("„Ohne Angebot“ ist die Differenz, nicht eine zweite Rechnung", () => {
    /* Zwei Zählungen könnten sich widersprechen; eine Differenz nicht. */
    expect(code(HEADING)).toContain("const withoutOffer = total - withOffer");
  });

  it("der Kopf rechnet selbst nichts", () => {
    const kopf = code(HEADING);
    expect(kopf).not.toContain("hasV1BuyableOffer");
    expect(kopf).not.toContain("filter(");
    expect(kopf).not.toContain("offers");
  });

  it("und die Angebote werden nur EINMAL geholt", () => {
    expect((seite.match(/fetchOffers\(\)/g) ?? []).length).toBe(1);
  });
});


describe("die Seite hat eine eigene Identität", () => {
  it("der Kopf ist ein Slot, keine zweite Ansicht", () => {
    /*
     * Hier stand „Skylanders Katalog“ über der Wunschliste, weil
     * `CatalogView` ihren Kopf selbst mitbrachte. Eine zweite Ansicht hätte
     * Suche, Serien-Tabs, Filter, Sortierung und das Raster verdoppelt.
     */
    expect(code(VIEW)).toContain("heading?: ReactNode");
    expect(code(VIEW)).toContain("{heading ?? (");
    /* Seit `0149` gehen ZWEI Dinge in den Slot: der Kopf und die
       Verfügbarkeitsmeldungen. Beide aus demselben Grund dort — innerhalb
       des Blocks, den die Weltkulisse hinterlegt. */
    expect(code(PAGE)).toContain("<FavoritesHeading total={figures.length}");
    expect(code(PAGE)).toMatch(/heading=\{\s*<>\s*<FavoritesHeading/);
    expect(code(PAGE)).toMatch(/<FavoritesHeading[^>]*\/>\s*<AvailabilityNotices/);
  });

  it("und das Suchfeld bleibt, wo es war", () => {
    /* Ersetzt wird der Titel, nicht der Block: das Suchfeld steht weiter in
       derselben Spalte und wird nicht mitübergeben. */
    expect(code(HEADING)).not.toContain("catalog-search");
    expect(code(VIEW)).toContain('htmlFor="catalog-search"');
  });

  it("er heißt „Meine Favoriten“ und nennt den Zweck", () => {
    expect(de.favorites.pageTitle).toBe("Meine Favoriten");
    expect(de.favorites.pageSubline).toContain("Angebote");
    expect(code(HEADING)).toContain("de.favorites.pageTitle");
    expect(code(HEADING)).toContain("de.favorites.pageSubline");
  });

  it("und der Katalog zeigt weiter seinen eigenen Kopf", () => {
    /* Ohne `heading` steht da, was `/` immer zeigte — die Vorgabe ist der
       Katalogkopf, nicht ein leerer Block. */
    expect(code(VIEW)).toContain("de.catalog.heading");
    expect(code("src/app/(public)/(catalog)/page.tsx")).not.toContain("heading=");
  });
});


describe("die drei Kacheln auf einem Telefon", () => {
  const kopf = code(HEADING);

  it("stehen in EINER Zeile, auch schmal — kein Umbruch", () => {
    /*
     * `flex-1` mit `min-w-0` statt `flex-wrap`: auf 360 px bleiben je gut
     * 100 px. Ein Umbruch hätte zwei oben und eine allein darunter ergeben,
     * und das liest sich als „die dritte ist etwas anderes“.
     */
    expect(kopf).toContain("flex items-stretch gap-2");
    expect(kopf).not.toContain("flex-wrap");
    expect(kopf).toContain("flex-1");
    expect(kopf).toContain("min-w-0");
  });

  it("und werden auf Breite größer, nicht anders angeordnet", () => {
    expect(kopf).toContain("sm:gap-3");
    expect(kopf).toContain("sm:px-4");
    expect(kopf).toContain("sm:text-2xl");
  });

  it("die Zahlen wandern nicht, wenn aus 9 eine 10 wird", () => {
    expect(kopf).toContain("tabular-nums");
  });

  it("sie sind EINE Auskunft aus drei Teilen, keine Aufzählung", () => {
    expect(kopf).toContain('role="group"');
    expect(kopf).toContain("aria-label={de.favorites.statsLabel}");
    expect(kopf).not.toContain("<ul");
  });
});


describe("der leere Zustand", () => {
  const seite = code(PAGE);

  it("zeigt keinen Kennzahlenblock aus drei Nullen", () => {
    const leer = seite.slice(seite.indexOf("figures.length === 0"), seite.indexOf("<CatalogView"));
    expect(leer).not.toContain("FavoritesHeading");
    expect(leer).toContain("de.favorites.pageTitle");
  });

  it("trägt ein Herz als Bild, einen Satz und EINEN Weg", () => {
    const leer = seite.slice(seite.indexOf("figures.length === 0"), seite.indexOf("<CatalogView"));
    expect(leer).toContain("M12 20.5s-7.5-4.6-7.5-10.1");
    expect(leer).toContain("de.favorites.emptyBody");
    expect((leer.match(/<Link/g) ?? []).length).toBe(1);
  });

  it("und kein Ausrufezeichen", () => {
    expect(de.favorites.emptyTitle).not.toContain("!");
    expect(de.favorites.emptyBody).not.toContain("!");
  });
});
