/**
 * Die Zahl am Rand steht überall, wo die Navigation steht.
 *
 * DER FEHLER, DEN DIESER TEST ABFÄNGT. Nach einer Kundennachricht zeigte der
 * Business-Badge auf dem Katalog keine 1 — erst nach einem Wechsel auf
 * „Sammlung" oder „Konto" erschien sie. Es lag weder an einem Cache noch an
 * der Datenbank: `SiteNav` wird von VIER Layouts gerendert, und nur zwei
 * davon reichten `unread` weiter. Die anderen beiden bekamen die Vorgabe
 * `NO_UNREAD`, also zweimal null — auf jeder öffentlichen und jeder
 * Adminroute.
 *
 * Der Kommentar im öffentlichen Layout sagte die Regel bereits, für die
 * Bestellungen: „A flagged order has to be visible from wherever the operator
 * is, not only from inside /business." Für Nachrichten gilt sie genauso.
 *
 * Deshalb prüft dieser Test nicht eine Route, sondern die Regel: JEDES
 * Layout, das die Navigation rendert, gibt ihr auch die Zahlen. Ein fünftes
 * Layout ohne sie bricht den Test, bevor es jemandem auffällt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Jedes Layout, das die Navigation zeichnet. */
const NAV_LAYOUTS = walk("src/app")
  .filter((path) => path.endsWith("layout.tsx"))
  .filter((path) => /<SiteNav\b/.test(readFileSync(path, "utf8")))
  .sort();

describe("jedes Layout mit Navigation liefert die Ungelesen-Zahlen", () => {
  it("findet alle vier", () => {
    expect(NAV_LAYOUTS).toEqual([
      "src/app/(admin)/layout.tsx",
      "src/app/(app)/layout.tsx",
      "src/app/(business)/layout.tsx",
      "src/app/(public)/layout.tsx",
    ]);
  });

  it("gibt in jedem davon `unread` an die Navigation", () => {
    const missing = NAV_LAYOUTS.filter(
      (path) => !readFileSync(path, "utf8").includes("unread={unread}"));
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("und baut die Zahl in jedem davon aus beiden Seiten", () => {
    for (const path of NAV_LAYOUTS) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("fetchMyUnread");
      expect(source, path).toContain("fetchSellerUnread");
    }
  });

  /*
   * Der Betrieb sieht seine Zahl damit auf jeder Route — Katalog eingeschlossen
   * —, und zwar schon beim ersten, direkt aufgerufenen Render: die Layouts
   * holen sie serverseitig, es gibt keinen Nachladepfad, der zuerst 0 zeigt.
   */
  it("holt sie serverseitig, ohne Nachladen und ohne Vorgabe null", () => {
    for (const path of NAV_LAYOUTS) {
      const source = readFileSync(path, "utf8");
      for (const forbidden of ["useEffect", "setInterval", "setTimeout",
                               "router.refresh", "NO_UNREAD", "<Suspense"]) {
        expect(source, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
      // Die Zahl steht VOR dem Rendern fest.
      expect(source.indexOf("const unread"), path)
        .toBeLessThan(source.indexOf("<SiteNav"));
    }
  });

  /**
   * Ein ausgeloggter Besucher löst dafür keine Abfrage aus — dieselbe Regel,
   * die `fetchOpenOrderCounts()` seit jeher befolgt. Die beiden Layouts ohne
   * garantierte Sitzung fragen deshalb erst, wenn es jemanden gibt.
   */
  it("kostet einen anonymen Besucher nichts", () => {
    const pub = readFileSync("src/app/(public)/layout.tsx", "utf8");
    expect(pub).toContain("mine: user ? await fetchMyUnread() : 0,");
    expect(pub).toContain("seller: caps.sellerOperator ? await fetchSellerUnread() : 0,");
  });

  it("und fragt die Betriebszahl nur, wo es einen Operator geben kann", () => {
    /* Drei Layouts wissen es erst zur Laufzeit und fragen deshalb bedingt. */
    for (const path of ["src/app/(app)/layout.tsx", "src/app/(admin)/layout.tsx",
                        "src/app/(public)/layout.tsx"]) {
      expect(readFileSync(path, "utf8"), path)
        .toMatch(/(sellerOperator|caps\.sellerOperator)\s*\?/);
    }
    /*
     * Das Business-Layout weiß es schon: es schickt jeden anderen mit
     * `notFound()` weg, bevor überhaupt etwas geholt wird. Eine Bedingung
     * danach wäre eine zweite Prüfung derselben Tatsache.
     */
    const business = readFileSync("src/app/(business)/layout.tsx", "utf8");
    expect(business.indexOf("if (!sellerOperator) notFound();"))
      /* Der Aufruf, nicht die Importzeile. */
      .toBeLessThan(business.indexOf("fetchSellerUnread()"));
  });
});

describe("die Navigation zeichnet die Zahl aus dem, was sie bekommt", () => {
  const nav = readFileSync("src/components/layout/site-nav.tsx", "utf8");

  it("nimmt den Betriebsstand für den Menüpunkt Nachrichten", () => {
    expect(nav).toContain('href: "/business/nachrichten"');
    expect(nav).toContain("badge: (_counts, unread) => unread.seller,");
  });

  it("und den eigenen Stand für das Kontosymbol", () => {
    expect(nav).toContain("unread={unread.mine}");
  });

  it("fällt ohne Angabe auf zwei Nullen zurück, statt zu raten", () => {
    expect(nav).toContain("export const NO_UNREAD: Unread = { mine: 0, seller: 0 };");
    expect(nav).toContain("unread = NO_UNREAD,");
  });
});
