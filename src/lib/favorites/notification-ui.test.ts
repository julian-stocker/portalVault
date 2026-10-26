import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { columnsOf } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";

/**
 * DIE OBERFLÄCHE ZU DEN VERFÜGBARKEITSMELDUNGEN (Phase 4 S4, `0149`).
 *
 * WAS HIER GEPRÜFT WIRD, und warum es nicht im DOM steht. Die Aussagen
 * dieses Schritts sind Aussagen über WEGE — welche Datei schreibt, welche
 * nicht, wer die Grenze hält, was ein Fehler auslöst. Ein gerenderter Baum
 * zeigt davon nichts: er zeigt, dass eine Karte erscheint, nicht dass das
 * Erscheinen nichts markiert.
 *
 * DIE WICHTIGSTE AUSSAGE STEHT IN „die Anzeige markiert nichts". Der Auftrag
 * nennt sie ausdrücklich, und sie ist die einzige, bei der ein Fehler
 * unbemerkt bliebe: eine Meldung, die beim Ansehen als gelesen gilt, ist
 * weg, bevor jemand sie gelesen hat — und niemand merkt es, weil die Seite
 * genauso aussieht.
 */

const QUERIES = "src/lib/favorites/notification-queries.ts";
const ACTIONS = "src/lib/favorites/notification-actions.ts";
const CLAIM = "src/lib/favorites/notifications.ts";
const REFRESH = "src/lib/favorites/offer-state.ts";
const SECTION = "src/components/catalog/availability-notices.tsx";
const PAGE = "src/app/(app)/favoriten/page.tsx";
const NAV = "src/components/layout/site-nav.tsx";
const BADGE = "src/components/ui/attention-badge.tsx";
const APP_LAYOUT = "src/app/(app)/layout.tsx";
const PUBLIC_LAYOUT = "src/app/(public)/layout.tsx";
const MIG = "supabase/migrations/0149_notification_read_state.sql";

const quelle = (p: string): string => readFileSync(p, "utf8");

/**
 * SQL ohne Kommentare — und das ist hier nicht Kosmetik.
 *
 * `0149` ERKLÄRT in ihrem Kopf ausführlich, warum sie
 * `grant update (read_at) … to authenticated` NICHT nimmt. Eine Prüfung
 * gegen den Dateitext würde genau diese Erklärung als Verstoß lesen. Gefragt
 * wird, was die Datei TUT.
 */
function sqlCode(p: string): string {
  return quelle(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !z.trimStart().startsWith("--"))
    .join("\n");
}

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

/* =========================================================================
 * 1. DIE ANZEIGE MARKIERT NICHTS
 * ====================================================================== */

describe("die Anzeige markiert nichts", () => {
  it("der Leseweg schreibt nirgends", () => {
    const c = code(QUERIES);
    /* Kein Schreibaufruf des Clients, in keiner Form. */
    expect(c).not.toContain(".update(");
    expect(c).not.toContain(".insert(");
    expect(c).not.toContain(".upsert(");
    expect(c).not.toContain(".delete(");
    /* Und kein Aufruf der Markierfunktion — auch nicht über die Aktion. */
    expect(c).not.toContain("mark_availability_notifications_read");
    expect(c).not.toContain("markNoticesRead");
    /*
     * `read_at` kommt hier nur LESEND vor: als Feld des Zeilentyps, in der
     * Spaltenliste, in der Zuordnung nach `readAt` und als Filter des
     * Zählers. Nie als Zuweisung.
     */
    expect(c).not.toMatch(/read_at:\s*(now|new Date|"|')/);
    expect(c).not.toMatch(/read_at\s*=/);
    expect(c).toContain('.is("read_at", null)');
    expect(c).toContain("readAt: row.read_at,");
  });

  it("die Komponente ruft das Markieren NUR aus einem Klick", () => {
    const c = code(SECTION);
    /*
     * ZWEI `onClick` UND KEIN `useEffect`. Ein Effekt beim Einblenden wäre
     * genau die Falle: er markiert, weil die Karte da ist, nicht weil
     * jemand sie gelesen hat.
     */
    expect(c).not.toContain("useEffect");
    expect(c).not.toContain("useLayoutEffect");
    expect(c).not.toContain("IntersectionObserver");

    /* `markNoticesRead` wird genau einmal aufgerufen, in `mark()`. */
    expect(c.match(/markNoticesRead\(/g)).toHaveLength(1);
    /* Und `mark()` wird nur aus Klickhandlern gerufen. */
    /* Drei Treffer: die Definition und genau zwei Aufrufe, beide am Klick. */
    const treffer = c.match(/mark\((?!NoticesRead)/g) ?? [];
    expect(treffer.length).toBe(3);
    expect(c).toContain("function mark(skyIds: readonly string[] | undefined");
    expect(c).toContain("onClick={() => mark(undefined, null)}");
    expect(c).toContain("onMarkRead={(skyId) => mark([skyId], skyId)}");
  });

  it("und der Weg zum Angebot markiert auch nichts", () => {
    /*
     * Ein Klick auf „Zum Angebot" ist ein Weg und keine Lesebestätigung.
     * Verlockend wäre es — wer das Angebot ansieht, hat die Meldung
     * gesehen — und falsch: es ist eine Markierung ohne Handlung, und sie
     * wäre nicht rückholbar.
     */
    const c = code(SECTION);
    const link = c.slice(c.indexOf("<Link"), c.indexOf("</Link>"));
    expect(link).not.toContain("onClick");
    expect(link).not.toContain("mark");
  });

  it("die Seite markiert beim Laden nichts", () => {
    const c = code(PAGE);
    expect(c).not.toContain("markNoticesRead");
    expect(c).not.toContain("mark_availability_notifications_read");
  });

  it("und die Datenbank hat keinen zweiten Weg: kein update-Recht für Clients", () => {
    const sql = sqlCode(MIG);
    /* Weder ein Tabellenrecht … */
    expect(sql).not.toMatch(/grant\s+update[^;]*availability_notifications/i);
    expect(sql).not.toMatch(/grant\s+all[^;]*availability_notifications/i);
    /* … noch eine Schreibrichtlinie dahinter. */
    expect(sql).not.toMatch(/create\s+policy[^;]*for\s+update/i);
    /* Die Migration MISST, dass es bei genau `SELECT` bleibt. */
    expect(quelle(MIG)).toContain("erwartet wird genau SELECT");
  });
});

/* =========================================================================
 * 2. WER DARF WAS — DIE GRENZE
 * ====================================================================== */

describe("die Grenze", () => {
  it("steht in der Datenbank, nicht im Code: kein user_id-Filter beim Lesen", () => {
    /*
     * Die `select`-Richtlinie aus `0148` lässt genau die eigenen Zeilen
     * sehen. Ein `eq("user_id", …)` daneben wäre eine zweite Rechnung über
     * dieselbe Frage — und die erste, die abweicht (`docs/SECURITY.md`).
     */
    expect(code(QUERIES)).not.toContain('eq("user_id"');
    expect(code(QUERIES)).not.toContain("auth.getUser");
  });

  it("die Markierfunktion trägt die Eigentümerbedingung im where", () => {
    const sql = quelle(MIG);
    /* Wort für Wort wie die `select`-Richtlinie aus `0148`. RLS gilt für
       eine Definer-Funktion nicht, also IST dieses `where` die Grenze. */
    expect(sql).toContain("(select auth.uid()) = n.user_id");
    expect(sql).toContain("public.is_collector_account()");
    /* Und die Migration misst, dass beides drinsteht. */
    expect(sql).toContain("der Rumpf traegt die Eigentuemerbedingung nicht");
    expect(sql).toContain("markiert sie auch nicht");
  });

  it("sie läuft nur für ein Sammlerkonto, und das fragt auch die Aktion", () => {
    expect(code(ACTIONS)).toContain("if (!(await isCollector())) return { ok: false, reason: \"auth\" };");
  });

  it("nichts für anon, nichts für PUBLIC", () => {
    const sql = quelle(MIG);
    expect(sql).toContain("revoke all on function public.mark_availability_notifications_read(text[]) from public;");
    expect(sql).toContain("revoke all on function public.mark_availability_notifications_read(text[]) from anon;");
    expect(sql).toContain("grant execute on function public.mark_availability_notifications_read(text[]) to authenticated;");
    expect(sql).toContain("EXECUTE fuer anon oder PUBLIC");
  });

  it("und kein fremder Nutzer kommt in die Anzeige: die Ansicht kennt keine user_id", () => {
    /*
     * `NoticeView` trägt Figur, Preis, Zeitpunkt und Lesezustand — keine
     * Kontokennung. Was nicht im Prop steht, kann auch nicht im Browser
     * landen (ADR-0026).
     */
    const typ = code(SECTION);
    const view = typ.slice(typ.indexOf("export type NoticeView"), typ.indexOf("/** Ein kleines Herz"));
    expect(view).not.toContain("userId");
    expect(view).not.toContain("user_id");
    expect(view).not.toContain("email");
  });

  it("die Markierung läuft über eine Serveraktion, nicht aus dem Browser", () => {
    expect(quelle(ACTIONS).startsWith("/**")).toBe(true);
    expect(code(ACTIONS)).toContain('"use server";');
    /* Die Komponente importiert die Aktion, nicht den Supabase-Client. */
    expect(code(SECTION)).not.toContain("@/lib/supabase");
    expect(code(SECTION)).toContain('from "@/lib/favorites/notification-actions"');
  });
});

/* =========================================================================
 * 3. DER ZÄHLER
 * ====================================================================== */

describe("der Ungelesen-Zähler", () => {
  it("fragt nur die Zahl, nicht die Zeilen", () => {
    const c = code(QUERIES);
    expect(c).toContain('{ count: "exact", head: true }');
    expect(c).toContain('.is("read_at", null)');
  });

  it("und benutzt den Teilindex aus 0149", () => {
    const sql = quelle(MIG);
    expect(sql).toContain("create index availability_notifications_unread_idx");
    expect(sql).toContain("where read_at is null;");
    /* TEILindex, nicht voller: die Migration misst `indpred is not null`. */
    expect(sql).toContain("i.indpred is not null");
  });

  it("hängt am VORHANDENEN Menüpunkt — keine Glocke, kein neues Ziel", () => {
    const c = code(NAV);
    expect(c).toContain("badge: (_counts, unread) => unread.notices,");
    expect(c).toContain('badgeTone: "favorite",');
    /* Genau ein Ziel trägt diesen Ton. */
    expect(c.match(/badgeTone: "favorite"/g)).toHaveLength(1);
    expect(c).not.toContain('href: "/benachrichtigungen"');
    expect(c).not.toMatch(/BellGlyph|NotificationGlyph/);
  });

  it("ist dezent und nicht die Farbe eines Zwischenfalls", () => {
    /*
     * Rot heißt in dieser Leiste „etwas ist kaputt" (eine gekennzeichnete
     * Bestellung, ADR-0050). „Deine Figur ist wieder da" ist das Gegenteil.
     */
    const c = code(BADGE);
    expect(c).toContain('favorite: "bg-favorite-ink/15 text-favorite-ink ring-favorite-ink/45"');
    expect(c).toContain('attention: "bg-danger/20 text-danger ring-danger/60"');
    /* Und der bisherige Ton bleibt der Standard — nichts anderes verfärbt sich. */
    expect(c).toContain('tone = "attention"');
  });

  it("wird nur für ein Sammlerkonto erhoben", () => {
    /*
     * Die Wunschliste wird nur einem Sammler angeboten (ADR-0078), also
     * trägt nur dort eine Marke eine Aussage — und nur dort wird gefragt.
     */
    expect(code(APP_LAYOUT))
      .toContain("notices: !platformAdmin && !sellerOperator ? await fetchUnreadNoticeCount() : 0,");
    expect(code(PUBLIC_LAYOUT)).toContain("user && !caps.platformAdmin && !caps.sellerOperator");
    /* Der Betrieb und die Plattform fragen gar nicht. */
    for (const p of ["src/app/(business)/layout.tsx", "src/app/(admin)/layout.tsx"]) {
      expect(code(p)).toContain("notices: 0 }");
      expect(code(p)).not.toContain("fetchUnreadNoticeCount");
    }
  });

  it("und er wird auch im Katalog gezeigt — dort ist der Sammler", () => {
    /* Eine Marke, die nur in den geschützten Bereichen erscheint, erreicht
       genau den nicht, für den sie gedacht ist. */
    expect(code(PUBLIC_LAYOUT)).toContain("fetchUnreadNoticeCount()");
  });

  it("nach dem Lesen stimmt er wieder", () => {
    /*
     * `revalidatePath("/favoriten")` erneuert die Route SAMT ihren Layouts —
     * und die Marke steht im Layout von `(app)`. Deshalb genügt dieser eine
     * Aufruf, und es braucht keinen zweiten Weg für die Zahl.
     */
    expect(code(ACTIONS)).toContain('revalidatePath("/favoriten");');
  });

  it("und wird einmal je Anfrage geholt, nicht je Leser", () => {
    expect(code(QUERIES)).toContain("export const fetchUnreadNoticeCount = cache(");
    expect(code(QUERIES)).toContain("export const fetchAvailabilityNotices = cache(");
  });
});

/* =========================================================================
 * 4. WAS DIE KARTE SAGT
 * ====================================================================== */

describe("die Karte", () => {
  it("sagt: wieder verfuegbar — und nicht: jetzt verfuegbar", () => {
    /*
     * WIEDER ist die ganze Aussage dieser Funktion: gemeldet wird nur ein
     * echter Wechsel von nicht kaufbar zu kaufbar (`0147`). Eine Figur, die
     * beim Vormerken schon zu haben war, erzeugt nichts — „jetzt verfügbar"
     * würde dieselbe Karte auch dafür behaupten.
     */
    expect(de.favorites.noticeHeadline("Trigger Happy")).toBe("Trigger Happy ist wieder verfügbar!");
  });

  it("nennt den GEMELDETEN Preis als den von damals", () => {
    expect(de.favorites.noticePriceThen("9,90 €")).toContain("bei der Meldung");
    /* Cent, und die Umrechnung steht an EINER Stelle. */
    expect(code(SECTION)).toContain("formatPrice(notice.cheapestCents / 100)");
  });

  it("verspricht keine Kaufbarkeit, wenn das Angebot weg ist", () => {
    const c = code(SECTION);
    expect(c).toContain("notice.stillBuyable ? null : (");
    expect(c).toContain("de.favorites.noticeGone");
    /* Und die Beschriftung des Wegs wechselt mit. */
    expect(c).toContain("notice.stillBuyable ? de.favorites.noticeToOffer : de.favorites.noticeToFigure");
  });

  it("und `stillBuyable` kommt aus der bestehenden Angebotslogik", () => {
    /*
     * `hasV1BuyableOffer()` ist dieselbe Funktion, die die Kennzahl im Kopf
     * und die Angebotszeile jeder Karte benutzen — aus denselben `offers`,
     * die ohnehin geladen sind. Keine zweite Definition von „kaufbar".
     */
    const c = code(PAGE);
    expect(c).toContain("stillBuyable: hasV1BuyableOffer(offersFor(offers, n.figure.skyId)),");
    expect(c.match(/fetchOffers\(\)/g)).toHaveLength(1);
  });

  it("zeigt Bild, Namen und Zeitpunkt", () => {
    const c = code(SECTION);
    expect(c).toContain("src={notice.picture}");
    /* Der Umschlag traegt die Groesse, nicht das Bild — der Platz ist auch
       reserviert, wenn es fehlt. Und `alt=""`, weil der Name daneben steht. */
    expect(c).toContain('alt=""');
    expect(c).toContain("de.favorites.noticeHeadline(notice.name)");
    expect(c).toContain("formatDate(notice.createdAt)");
  });

  it("und der Name ist derselbe wie auf der Katalogkarte", () => {
    /*
     * `toFigure()` und die drei Anreicherungen — dieselben Funktionen, die
     * `fetchFavorites()` benutzt. Eine Meldung darf die Figur nicht anders
     * nennen als die Karte darunter (ADR-0030).
     */
    const c = code(QUERIES);
    expect(c).toContain("withCharacterElement(");
    expect(c).toContain("withCharacterFamily(withVariants(figures, nameIndex)");
    expect(c).toContain("toFigure(row.skylanders, lookups)");
  });

  it("eine gelesene bleibt stehen und wird nur ruhiger", () => {
    const c = code(SECTION);
    /* Kein Filter, der gelesene wegwirft. */
    expect(c).not.toContain("filter((n) => !n.read)\n");
    expect(c).toContain('? "bg-deep/50 ring-1 ring-border-strong/40"');
    expect(c).toContain('text-on-deep-muted"');
    /* Und sie sagt, dass sie gesehen ist — „ruhiger" darf nicht „kaputt" heißen. */
    expect(c).toContain("de.favorites.noticeRead");
  });

  it("ohne Meldungen gibt es keinen Abschnitt", () => {
    expect(code(SECTION)).toContain("if (notices.length === 0) return null;");
  });

  it("die Unterzeile zählt die UNGELESENEN und behauptet keine Verfügbarkeit", () => {
    /*
     * „3 vorgemerkte Figuren sind wieder zu haben" stand hier zuerst und war
     * falsch: in der Liste stehen auch gesehene Meldungen und solche, deren
     * Angebot inzwischen weg ist. Eine Zusammenfassung darf nicht mehr
     * versprechen als die Karten darunter.
     */
    expect(code(SECTION)).toContain("de.favorites.noticesSubline(unread)");
    expect(de.favorites.noticesSubline(0)).toBe("Alles gesehen.");
    expect(de.favorites.noticesSubline(1)).toBe("1 neue Meldung.");
    expect(de.favorites.noticesSubline(3)).toBe("3 neue Meldungen.");
    for (const n of [0, 1, 3]) {
      expect(de.favorites.noticesSubline(n)).not.toContain("zu haben");
    }
  });

  it("der Weg auf die Figurenseite wird nicht vorgeladen", () => {
    /* Bis zu 24 Karten: 24 vorgeladene Detailseiten wären 24 Anfragen für
       höchstens einen Klick — dieselbe Regel wie überall sonst. */
    expect(code(SECTION)).toContain("prefetch={false}");
  });
});

/* =========================================================================
 * 5. AUF DEM TELEFON
 * ====================================================================== */

describe("auf dem Telefon", () => {
  const c = code(SECTION);

  it("bricht um statt abzuschneiden", () => {
    /* Die Beiwerkzeile trägt Datum, Preis und ggf. „vergriffen" — auf
       360 px passt das nicht in eine Zeile, also bricht es um. */
    expect(c).toContain("flex-wrap");
    expect(c.match(/flex-wrap/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("das Bild reserviert seinen Platz, damit die Zeile beim Laden nicht springt", () => {
    expect(c).toContain("h-14 w-14 shrink-0");
    expect(c).toContain('width={56}');
    expect(c).toContain('height={56}');
  });

  it("der Text darf schrumpfen, das Bild nicht", () => {
    expect(c).toContain("min-w-0 flex-1");
  });

  it("nichts ist breiter als das Telefon", () => {
    /* Keine feste Mindestbreite irgendwo — die einzige feste Größe ist das
       56-px-Bild. */
    expect(c).not.toMatch(/min-w-\[/);
    expect(c).not.toMatch(/w-\[\d{3,}px\]/);
  });

  it("und jede Handlung ist mit dem Daumen zu treffen", () => {
    /* 40 px ist die Untergrenze für einen Textknopf in dieser Zeile; die
       Karte ist eine Liste, keine Werkzeugleiste. */
    expect(c.match(/min-h-10/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("Zahlen wandern nicht", () => {
    expect(c).toContain("tabular-nums");
  });
});

/* =========================================================================
 * 6. WENN ETWAS SCHIEFGEHT
 * ====================================================================== */

describe("Fehlerfälle", () => {
  it("ein Fehler beim Lesen nimmt nicht die Wunschliste mit", () => {
    /*
     * Eine Meldung ist eine Beigabe. Scheitert sie, soll die Seite trotzdem
     * laden — dieselbe Regel wie bei `fetchFavoriteDemand()`.
     */
    const c = code(QUERIES);
    expect(c).toContain("if (result.error) return [];");
    expect(c).toContain("if (error || typeof count !== \"number\") return 0;");
    expect(c).not.toContain("throw new Error");
  });

  it("und ein Fehler beim Verarbeiten auch nicht", () => {
    expect(code(CLAIM)).toContain("return 0;");
    expect(code(CLAIM)).not.toContain("throw");
  });

  it("eine fehlgeschlagene Markierung wird gesagt, nicht verschluckt", () => {
    const c = code(SECTION);
    expect(c).toContain("if (!r.ok) setFailed(true);");
    expect(c).toContain("de.favorites.noticeMarkFailed");
    expect(c).toContain('role="status"');
  });

  it("und ein abgerissener Aufruf laesst den Knopf nicht gesperrt zurueck", () => {
    /*
     * Die Aktion WIRFT nicht — sie gibt `{ ok: false }`. Der Aufruf selbst
     * kann aber scheitern (abgerissene Verbindung). Ohne `finally` blieben
     * Knopf und Rad hängen: eine Seite, die arbeitet und nichts tut.
     */
    const c = code(SECTION);
    expect(c).toContain("} catch {");
    expect(c).toContain("} finally {");
    expect(c).toContain("setWorking(null);");
    /* Genau einmal, im `finally` — nicht zusätzlich im Erfolgszweig. */
    expect(c.match(/setWorking\(null\);/g)).toHaveLength(1);
  });

  it("eine LEERE Liste markiert nichts — und nicht alles", () => {
    /*
     * `undefined` heißt „alle", und das ist Absicht. Eine leere Liste darf
     * NICHT dasselbe bedeuten: sonst würde aus „markiere diese null Karten"
     * stillschweigend „markiere alles".
     */
    const c = code(ACTIONS);
    expect(c).toContain("if (skyIds.length === 0) return { ok: true, marked: 0 };");
    const leer = c.indexOf("skyIds.length === 0");
    const pruefung = c.indexOf("skyIds.every((id) => SKY_ID.test(id))");
    expect(leer).toBeGreaterThan(-1);
    expect(pruefung).toBeGreaterThan(leer);
  });

  it("eine ungültige SKY-ID wird abgewiesen, nicht weitergegeben", () => {
    expect(code(ACTIONS)).toContain("const SKY_ID = /^SKY-[0-9]{4}$/;");
    expect(code(ACTIONS)).toContain('return { ok: false, reason: "invalid" };');
  });

  it("vor 0149 antwortet sie mit einer leeren Liste statt zu scheitern", () => {
    /*
     * Beide Abfragen nennen `read_at` ausdrücklich. Fehlt die Spalte — weil
     * die Migration in dieser Umgebung noch nicht angewendet ist —, antwortet
     * PostgREST mit einem Fehler, und beide geben ihren neutralen Wert. Die
     * Wunschliste lädt dann ganz normal, nur ohne Abschnitt und ohne Marke.
     * Deshalb darf der Code VOR der Migration ausgerollt werden.
     */
    const c = code(QUERIES);
    expect(c).toContain("read_at,");
    expect(c).toContain("if (result.error) return [];");
    expect(quelle(QUERIES)).toContain("VOR `0149` ANTWORTET SIE");
  });

  it("und eine Decke steht an der Abfrage, nicht erst in der Antwort", () => {
    expect(code(QUERIES)).toContain("export const MAX_NOTICES = 24;");
    expect(code(QUERIES)).toContain(".limit(MAX_NOTICES)");
  });

  it("eine Meldung ohne Katalogzeile wird übersprungen, nicht halb gezeigt", () => {
    expect(code(QUERIES)).toContain("if (!figure) continue;");
  });
});

/* =========================================================================
 * 7. DIE VERARBEITUNG HÄNGT AM AUFRUF DER SEITE
 * ====================================================================== */

describe("die Verarbeitung", () => {
  it("wird beim authentifizierten Aufruf von /favoriten angestoßen", () => {
    const c = code(PAGE);
    expect(c).toContain("claimAvailabilityNotifications()");
    /* Und sie steht VOR dem Lesen, sonst fehlte die gerade entstandene
       Meldung auf genau dieser Seite. */
    expect(c).toContain(".then(() => fetchAvailabilityNotices())");
  });

  it("UND DER SPIEGEL WIRD VORHER NACHGEZOGEN — genau das hat gefehlt", () => {
    /*
     * DER BEFUND VOM 2026-10-26. `0146` hat den Spiegel ohne Trigger gebaut
     * und den Aufrufer dem Seitenaufbau eines angemeldeten Sammlers
     * überlassen („deren eigener Seitenaufbau frischt auf") — gebaut hatte
     * ihn NIEMAND. Vier Schritte (S1–S4) hingen damit an einer Tabelle, die
     * seit der Erstbefüllung niemand mehr nachgezogen hat: eine eingebuchte
     * Figur erschien sofort in `shop_offers()`, aber `offer_state` erfuhr es
     * nie, also wurde NIE etwas fällig und NIE eine Meldung erzeugt.
     *
     * Diese Zeile ist der Riegel dagegen. Fällt der Aufruf weg, ist das
     * Feature wieder vollständig stumm — und zwar lautlos.
     */
    const c = code(PAGE);
    expect(c).toContain("refreshOfferState()");
    expect(c).toContain('from "@/lib/favorites/offer-state"');
  });

  it("und die REIHENFOLGE ist die Sache selbst: nachziehen → beanspruchen → lesen", () => {
    /*
     * Nachziehen muss vor dem Beanspruchen liegen, sonst sieht der Aufruf
     * die gerade eingebuchte Figur nicht. Beanspruchen vor dem Lesen, sonst
     * steht die gerade entstandene Meldung erst beim nächsten Mal da.
     * Eine Kette, kein `Promise.all` — dort wäre die Reihenfolge verloren.
     */
    const c = code(PAGE);
    const nachziehen = c.indexOf("refreshOfferState()");
    const beanspruchen = c.indexOf("claimAvailabilityNotifications())");
    const lesen = c.indexOf("fetchAvailabilityNotices())");
    expect(nachziehen).toBeGreaterThan(-1);
    expect(beanspruchen, "beanspruchen nach nachziehen").toBeGreaterThan(nachziehen);
    expect(lesen, "lesen nach beanspruchen").toBeGreaterThan(beanspruchen);
    /* Und nicht nebeneinander in `Promise.all`, wo die Reihenfolge fehlte. */
    expect(c).toMatch(/refreshOfferState\(\)\s*\n?\s*\.then/);
  });

  it("der Nachzieher liest `locked` nicht als Erfolg", () => {
    /*
     * `0146` sagt es im Funktionskommentar: „ein Aufrufer darf locked
     * NIEMALS als eigenen Erfolg lesen". Deshalb gibt dieser Aufrufpunkt den
     * Grund unverändert zurück, statt ihn auf einen Wahrheitswert zu
     * verkürzen — wer `locked` als „ran" liest, glaubt an einen Lauf, den
     * jemand anders gerade erst begonnen hat.
     */
    const c = code(REFRESH);
    expect(c).toContain('export type RefreshResult = "ran" | "throttled" | "locked" | "failed";');
    expect(c).toContain('if (grund === "ran" || grund === "throttled" || grund === "locked") return grund;');
    expect(c).not.toMatch(/return\s+true/);
  });

  it("und er baut die Drossel nicht nach", () => {
    /*
     * `offer_state_window()` und das Transaktionsschloss entscheiden in der
     * Datenbank. Eine zweite Drossel hier wäre eine zweite Wahrheit darüber,
     * wann zuletzt nachgezogen wurde.
     */
    const c = code(REFRESH);
    expect(c).not.toContain("offer_state_window");
    expect(c).not.toContain("Date.now()");
    expect(c).not.toContain("setTimeout");
    expect(c).not.toContain("checked_at");
  });

  it("ein Fehler beim Nachziehen hält die Seite nicht auf", () => {
    const c = code(REFRESH);
    expect(c).toContain('if (error) return "failed";');
    expect(c).not.toContain("throw");
  });

  it("und nirgends sonst — kein Scheduler, kein Hintergrundlauf", () => {
    expect(code(APP_LAYOUT)).not.toContain("claimAvailabilityNotifications");
    expect(code(PUBLIC_LAYOUT)).not.toContain("claimAvailabilityNotifications");
    expect(code(ACTIONS)).not.toContain("claimAvailabilityNotifications");
  });

  it("ohne zweite Erkennung: die Karenzzeit steht in der Datenbank", () => {
    /*
     * 30 Minuten sind `offer_availability_grace()` aus `0147`. Keine Zahl
     * im Anwendungscode, die davon abweichen könnte.
     */
    for (const p of [PAGE, QUERIES, ACTIONS, CLAIM, SECTION]) {
      expect(code(p)).not.toMatch(/30\s*\*\s*60/);
      expect(code(p)).not.toContain("1800");
      expect(code(p)).not.toContain("grace");
    }
  });

  it("und `read_at` ist die einzige Spalte, die 0149 hinzufügt", () => {
    const spalten = [...columnsOf("availability_notifications")];
    expect(spalten).toEqual([
      "user_id", "sky_id", "buyable_since", "cheapest_cents", "created_at", "read_at",
    ]);
  });

  it("eine neue Meldung entsteht ungelesen", () => {
    /*
     * Das entscheidet die FEHLENDE Spaltenangabe im `insert` von `0148` —
     * kein Wert. `0149` misst, dass `claim_…()` `read_at` nicht nennt.
     */
    const sql = quelle(MIG);
    expect(sql).toContain("claim_availability_notifications() nennt read_at");
    expect(sql).toContain("add column read_at timestamptz;");
    expect(sql).not.toMatch(/add column read_at[^;]*default/i);
    expect(sql).not.toMatch(/update\s+public\.availability_notifications\s+set\s+read_at\s*=\s*now\(\)\s*;/i);
  });
});
