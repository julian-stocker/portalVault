import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { activeSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

/**
 * Was an den Favoriten am Aufbau hängt und nicht an einem Klick.
 *
 * DIE ARBEITSTEILUNG MIT `favorite-interaction.test.tsx` IST ABSICHTLICH.
 * Dort wird gedrückt — in einem echten DOM, mit echten Handlern; dort steht
 * „das Herz löst den Gesammelt-Toggle nicht aus" und „die Karte verschwindet
 * sofort". Hier stehen die Aussagen, die ein Klick nicht zeigen kann: dass
 * nichts je Karte abgefragt wird, dass die Sammlung unberührt bleibt, und
 * dass die Seite ihre Tür zumacht.
 */

const ACTIONS = "src/lib/favorites/actions.ts";
const QUERIES = "src/lib/favorites/queries.ts";
const PAGE = "src/app/(app)/favoriten/page.tsx";
const CATALOG_PAGE = "src/app/(public)/(catalog)/page.tsx";
const VIEW = "src/components/catalog/catalog-view.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const HEART = "src/components/catalog/favorite-heart.tsx";
const NAV = "src/components/layout/site-nav.tsx";

const quelle = (p: string): string => readFileSync(p, "utf8");

/** Die Datei ohne Kommentare — fragt, was der Code tut, nicht was er sagt. */
function code(p: string): string {
  return quelle(p)
    .split("\n")
    .filter((zeile) => {
      const t = zeile.trimStart();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");
}


describe("gesammelt geladen, nicht je Karte", () => {
  it("der Katalog holt die Favoriten EINMAL, in derselben Runde wie alles andere", () => {
    /*
     * „Keine 561 Einzelabfragen." Der Beweis dafür ist, WO der Aufruf steht:
     * in der einen `Promise.all`-Runde der Seite, und nirgends sonst.
     */
    const page = code(CATALOG_PAGE);
    expect(page).toContain("fetchFavoritedSkyIds()");
    expect((page.match(/fetchFavoritedSkyIds\(\)/g) ?? []).length).toBe(1);
    /* In derselben Runde: der Aufruf steht zwischen `Promise.all([` und ihrem
       Ende, nicht irgendwo danach. */
    const runde = page.slice(page.indexOf("await Promise.all(["), page.indexOf("]);"));
    expect(runde).toContain("fetchFavoritedSkyIds()");
  });

  it("und keine Karte und keine Ansicht fragt selbst", () => {
    for (const p of [VIEW, CARD, HEART]) {
      expect(code(p), p).not.toContain("fetchFavoritedSkyIds");
      expect(code(p), p).not.toContain("from(\"favorites\")");
    }
  });

  it("die Ansicht bekommt eine Liste und bildet daraus EINE Menge", () => {
    const view = code(VIEW);
    expect(view).toContain("favoritedSkyIds?: readonly string[]");
    expect(view).toContain("const set = new Set(favoritedSkyIds);");
    /* Die Karte liest aus der Menge, sie fragt nicht. */
    expect(view).toContain("initialFavorited={favorited.has(figure.skyId)}");
  });

  it("die Wunschliste holt die Figuren und den Favoritenstand in EINEM Aufruf", () => {
    /*
     * `fetchFavorites()` liefert die Figuren; welche vorgemerkt sind, ist
     * dieselbe Antwort. Ein zweiter Aufruf wäre dieselbe Frage zweimal.
     */
    const page = code(PAGE);
    expect(page).toContain("fetchFavorites()");
    expect(page).not.toContain("fetchFavoritedSkyIds");
    expect(page).toContain("figures.map((f) => f.skyId)");
  });

  it("die Abfragen filtern nicht selbst nach user_id — das tut RLS", () => {
    /*
     * Dieselbe Entscheidung wie bei der Sammlung (`docs/SECURITY.md`): kein
     * `eq("user_id", …)` beim Lesen. Sich auf die Datenbank zu verlassen ist
     * der Punkt, nicht eine Vereinfachung.
     */
    const q = code(QUERIES);
    expect(q).not.toContain('eq("user_id"');
  });
});


describe("die Mutation sagt den Endzustand", () => {
  const a = code(ACTIONS);

  it("nimmt den gewünschten Zustand und kippt nicht", () => {
    expect(a).toContain("setFavorite(skyId: string, favorite: boolean)");
    expect(a).toContain("if (favorite) {");
    /* Kein Lesen vor dem Schreiben: ein Umschalten müsste erst fragen. */
    expect(a).not.toContain(".select(");
  });

  it("ein doppeltes insert ist ERFOLG, nicht Fehler", () => {
    expect(a).toContain("UNIQUE_VIOLATION");
    expect(a).toContain("error.code !== UNIQUE_VIOLATION");
  });

  it("kein upsert — es gibt keine Spalte, die er aktualisieren könnte", () => {
    expect(a).not.toContain("upsert");
  });

  it("die Kennung kommt aus der geprüften Sitzung, nie vom Client", () => {
    expect(a).toContain("await supabase.auth.getUser()");
    expect(a).toContain("user_id: auth.user.id");
    /* Und kein Parameter heißt userId. */
    expect(a).not.toContain("userId");
  });

  it("ein Betriebs- oder Adminkonto wird vorher abgewiesen", () => {
    expect(a).toContain("await isCollector()");
    const vorher = a.indexOf("await isCollector()");
    const schreiben = a.indexOf('.from("favorites")');
    expect(vorher).toBeGreaterThan(-1);
    expect(vorher, "die Rollenfrage steht VOR dem Schreiben").toBeLessThan(schreiben);
  });

  it("prüft die SKY-ID gegen das Format, bevor irgendetwas geschieht", () => {
    expect(a).toContain("SKY_ID.test(skyId)");
  });

  it("und frischt genau die eine Seite auf, die es braucht", () => {
    expect(a).toContain('revalidatePath("/favoriten")');
    expect(a).not.toContain('revalidatePath("/collection")');
  });
});


describe("die Sammlung bleibt, wie sie war", () => {
  it("keine Favoritendatei fasst collection_items an", () => {
    for (const p of [ACTIONS, QUERIES, HEART]) {
      expect(code(p), p).not.toContain("collection_items");
      expect(code(p), p).not.toContain("setCollected");
    }
  });

  it("das Herz und der Sammeln-Toggle sind zwei getrennte Mengen in der Ansicht", () => {
    /*
     * Favorit und Besitz sind zwei Aussagen, und eine Figur kann in jeder
     * Kombination stehen. Eine gemeinsame Map müsste beides in einen Wert
     * pressen — und dann hinge der eine Zustand am anderen.
     */
    const view = code(VIEW);
    expect(view).toContain("const [changed, setChanged]");
    expect(view).toContain("const [favChanged, setFavChanged]");
    expect(view).toContain("const owned = useMemo");
    expect(view).toContain("const favorited = useMemo");
  });

  it("und die Sammlungsdateien wissen nichts von Favoriten", () => {
    for (const p of ["src/lib/collection/actions.ts", "src/lib/collection/queries.ts"]) {
      expect(code(p), p).not.toContain("favorite");
      expect(code(p), p).not.toContain("favorites");
    }
  });
});


describe("wer die Seite sieht", () => {
  const page = code(PAGE);

  it("ein Betriebs- oder Adminkonto bekommt 404, nicht eine leere Liste", () => {
    /*
     * Dieselbe Tür wie bei der Sammlung (ADR-0078): die Seite EXISTIERT für
     * sie nicht. Eine leere Wunschliste wäre eine Antwort auf eine Frage,
     * die für diese Konten nicht gestellt ist.
     */
    expect(page).toContain("if (!(await isCollector())) notFound();");
  });

  it("ohne Benutzernamen führt sie ins Onboarding", () => {
    expect(page).toContain("if (!profile?.username) redirect(ONBOARDING_PATH);");
  });

  it("und sie rendert CatalogView, nicht ein zweites Raster", () => {
    /*
     * Die ganze Entscheidung der Seite. Dieselben Karten, dieselbe Suche,
     * dieselben Serien-Tabs, dieselben Filter, dieselbe Sortierung — nichts
     * davon existiert hier ein zweites Mal.
     */
    expect(page).toContain("<CatalogView");
    expect(page).toContain("favoritesOnly");
    expect(page).not.toContain("<FigureGrid");
    expect(page).not.toContain("<CatalogCard");
    expect(page).not.toContain("<CollectionView");
  });

  it("hat eine Ladegrenze, damit der Navigationspunkt sofort reagiert", () => {
    /* Eine dynamische Route ohne `loading` wird von Next gar nicht
       vorgeladen — dieselbe Messung wie bei `/collection` (V4.4). */
    expect(() => quelle("src/app/(app)/favoriten/loading.tsx")).not.toThrow();
  });

  it("ein ausgeloggter Besucher kommt in die Anmeldung, nicht auf 404", () => {
    /*
     * DER FEHLER VOM 2026-10-25, festgehalten.
     *
     * `PROTECTED_PREFIXES` in `src/lib/supabase/middleware.ts` führte
     * `/collection`, `/account`, `/settings`, `/onboarding` — und
     * `/favoriten` nicht. Die Navigationsleiste bietet „Favoriten" aber
     * einem ausgeloggten Besucher an, genau wie „Sammlung": `viewer.collector`
     * ist für eine Sitzung ohne Konto wahr, weil ein Besucher kein
     * privilegiertes Konto ist.
     *
     * Ohne den Eintrag lief der Klick in die Seite, dort antwortete
     * `isCollector()` mit `false`, und der Besucher bekam **404** auf einen
     * Punkt, den die Leiste ihm gerade gezeigt hatte. Gefunden ohne Browser,
     * beim Durchgehen dessen, was eine ausgeloggte Sitzung erreicht.
     */
    const mw = code("src/lib/supabase/middleware.ts");
    const liste = mw.slice(mw.indexOf("const PROTECTED_PREFIXES"));
    const bis = liste.indexOf("];");
    expect(liste.slice(0, bis), "/favoriten ist nicht geschützt")
      .toContain('"/favoriten"');
    /* Und zwar in derselben Liste wie die Sammlung — nicht in einer zweiten. */
    expect(liste.slice(0, bis)).toContain('"/collection"');
    expect((mw.match(/const PROTECTED_PREFIXES/g) ?? []).length).toBe(1);
  });

  it("und einen leeren Zustand, der einen Weg nennt", () => {
    expect(page).toContain("de.favorites.emptyTitle");
    expect(page).toContain("de.favorites.emptyAction");
    expect(page).toContain('href="/"');
  });
});


describe("die Navigation, auf beiden Breiten", () => {
  const nav = quelle(NAV);

  it("ein Punkt in der EINEN Liste — und die trägt beide Breiten", () => {
    /*
     * Desktop und Mobil sind in dieser Leiste keine zwei Listen und keine
     * zwei Komponenten: es ist ein `<Link>` je Eintrag, und nur das Symbol
     * ist unter `md:` sichtbar. Ein Punkt in der Liste ist damit auf beiden
     * Breiten ein Punkt — deshalb prüft dieser Test die Liste und nicht zwei
     * Darstellungen.
     */
    expect(nav).toContain('href: "/favoriten"');
    expect(nav).toContain("label: de.nav.favorites");
    expect(nav).toContain("icon: FavoritesGlyph");
    expect(nav).toContain('<item.icon className="h-[18px] w-[18px] md:hidden" />');
  });

  it("nur für ein Sammlerkonto — sonst wäre der Punkt eine Einladung an eine Wand", () => {
    const eintrag = nav.slice(nav.indexOf('href: "/favoriten"'));
    const ende = eintrag.indexOf("href: \"/business\"");
    expect(eintrag.slice(0, ende)).toContain("applies: (viewer) => viewer.collector");
  });

  it("und er leuchtet für sich, nicht als Teil der Sammlung", () => {
    expect(activeSection("/favoriten")).toBe("favorites");
    expect(activeSection("/collection")).toBe("collection");
    expect(activeSection("/dashboard")).toBe("collection");
  });

  it("das Symbol ist dasselbe Herz wie an der Karte", () => {
    /*
     * Nicht ein Stern und nicht ein Lesezeichen: was im Katalog getippt
     * wird, ist ein Herz. Derselbe Pfad, damit es dasselbe Ding ist.
     */
    const pfad = "M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1";
    expect(quelle("src/components/layout/nav-glyphs.tsx")).toContain(pfad);
    expect(quelle(HEART)).toContain(pfad);
  });
});


describe("was es nicht gibt", () => {
  it("keine Marketplace-Struktur, keine E-Mail, kein Push, kein Scheduler", () => {
    /*
     * WARUM „notification" NICHT MEHR AUF DER LISTE STEHT. Bis `0147` war
     * das Wort ein guter Stellvertreter: es gab in dieser Domäne nichts,
     * was benachrichtigt, also durfte es auch nicht so heißen. Seit `0148`
     * gibt es persönliche Verfügbarkeitsmeldungen — ausdrücklich beauftragt,
     * in der Datenbank, mit RLS — und seit `0149` ihre Oberfläche. Das Wort
     * zu verbieten hieße jetzt, die Sache falsch zu benennen.
     *
     * VERBOTEN BLEIBT, WAS DIE LISTE EIGENTLICH MEINTE: kein Versandweg nach
     * draußen und kein Hintergrundlauf. Eine Meldung entsteht in der
     * Datenbank und wird auf einer Seite gezeigt — das ist die ganze
     * Zustellung (ADR-0136, ADR-0143).
     */
    const DRAUSSEN = [
      "seller_id", "wishlist_items", "priority",
      /* E-Mail */ "resend", "sendmail", "nodemailer", "send-order-mail",
      /* Push */ "webpush", "onesignal", "firebase", "serviceworker",
      /* Scheduler */ "pg_cron", "setinterval", "cronjob",
      /* Preisalarm */ "pricealert", "price_alert",
    ];
    for (const p of [ACTIONS, QUERIES, HEART, PAGE, "src/app/(app)/favoriten/loading.tsx",
                     "src/lib/favorites/notifications.ts",
                     "src/lib/favorites/notification-queries.ts",
                     "src/lib/favorites/notification-actions.ts",
                     "src/components/catalog/availability-notices.tsx"]) {
      const c = code(p).toLowerCase();
      for (const wort of DRAUSSEN) {
        expect(c, `${p}: ${wort}`).not.toContain(wort);
      }
    }
  });

  it("und kein zweiter Weg, einen Favoriten zu entfernen", () => {
    /*
     * Auf der Wunschliste entfernt dasselbe Herz wie im Katalog. Ein eigener
     * „Entfernen"-Knopf wäre eine zweite Mechanik für dieselbe Sache — und
     * die erste, die auseinanderläuft.
     */
    expect(code(PAGE)).not.toContain("setFavorite");
    expect(de.favorites.removeHint).toContain("Herz");
  });
});
