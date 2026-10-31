/**
 * RIEGEL 3 DES KATALOGABGLEICHS — WANN IST EINE SKY-ID EIN IDENTITAETSKONFLIKT?
 *
 * Diese Datei ist der Riegel selbst, nicht seine Beschreibung. `catalog-sync.mts`
 * und `sync-collision-report.mts` rufen sie beide auf, damit es genau EINE
 * Definition gibt — und sie ist rein: keine Datenbank, keine Datei, kein Netz.
 * Deshalb ist sie pruefbar, ohne irgendeine Umgebung anzufassen.
 *
 * *** WARUM DIE ERSTE FASSUNG ZU ENG WAR ***
 *
 * Sie fragte: Name UND Slug verschieden. Das hat zwei Fehler.
 *
 * Der eine ist der Name. Nach ADR-0030 liegt die Namenshoheit bei der Excel,
 * und PortalVault darf denselben Artikel anders DARSTELLEN. Ein abweichender
 * Name ist damit das schwaechste Merkmal, das es hier gibt — gemessen am
 * 2026-10-30 trugen 35 von 37 abweichenden Zeilen denselben Slug, dieselbe
 * Serie und dasselbe Bild. Das sind keine Konflikte, das sind Namensfaelle
 * (SYNC-02).
 *
 * Der andere ist das UND. Wo der Name gleich blieb und nur die Serie wechselte,
 * lief die alte Fassung durch — `SKY-9998` („RLS Shop Fixture", `SA` auf
 * Production, `TEST` auf Staging) ist so ein Fall. Harmlos, weil er ohnehin
 * ausgeschlossen ist; als Riegel trotzdem die falsche Frage.
 *
 * *** WAS EINE IDENTITAET TRAEGT ***
 *
 *   `slug`         die gespeicherte, stabile Kennung. Sie ueberlebt eine
 *                  Umbenennung — genau das zeigen die 35 Namensfaelle.
 *   `series_code`  ein Sammelobjekt gehoert zu genau einem Spiel. Eine andere
 *                  Serie ist ein anderes Objekt.
 *
 * Weicht eines von beiden ab, stehen hinter der SKY-ID zwei verschiedene
 * Sachen, und der Lauf haelt an.
 *
 * *** UND WAS KEINE TRAEGT ***
 *
 *   `name`         Darstellung, nicht Identitaet (ADR-0030).
 *   `image_file`   Inhalt ZUR Identitaet, nicht die Identitaet. Ein neuer Scan
 *                  oder ein zweiter Import aendert den Hashnamen, ohne dass
 *                  die Figur eine andere waere. Eine Abweichung wird
 *                  BERICHTET und haelt den Lauf NICHT an — ein Riegel, der
 *                  bei jedem Neuimport eines Bildes zuschlaegt, wird
 *                  weggeklickt, und dann schuetzt er nichts mehr.
 *
 * *** DER AUSSCHLUSS IST NICHT EIGENSTAENDIG ***
 *
 * Der Riegel ignoriert GENAU das, was der Plan ignoriert: eine Zeile ist
 * ausserhalb, wenn sie auf BEIDEN Seiten ausgeschlossen ist — dieselbe
 * `&&`-Bedingung, mit der der Planbau Feldabweichungen ueberspringt. Waere der
 * Riegel strenger als der Plan, blieben Konflikte an Zeilen unentdeckt, die
 * der Plan sehr wohl anfasst. `sync-collision-gate.test.ts` haelt die beiden
 * Regeln gegeneinander.
 */

/** Die Felder, die der Riegel ueberhaupt ansieht. */
export type Figur = {
  sky_id: string;
  name: string | null;
  slug: string | null;
  series_code: string | null;
  image_file: string | null;
  catalog_status: string | null;
};

/** `ausschluss` aus `resources/sync/bootstrap-decisions.json`. */
export type Ausschluss = {
  testserien: string[];
  /** Untergrenze des reservierten System- und Testbereichs, heute `SKY-9000`. */
  band_ab: string;
  status: string[];
};

/** Die Merkmale, an denen eine Identitaet haengt — und nur sie. */
export const IDENTITAETSMERKMALE = ["slug", "series_code"] as const;

/** Beobachtet, aber nicht riegelrelevant. */
export const BEOBACHTETE_MERKMALE = ["image_file"] as const;

export type Einordnung =
  | { art: "ausserhalb"; grund: string }
  | { art: "identitaetskonflikt"; merkmale: string[]; beobachtet: string[] }
  | { art: "namensabweichung"; beobachtet: string[] }
  | { art: "gleich"; beobachtet: string[] };

/**
 * Eine einzelne Zeile faellt aus dem Abgleich — Testserie, reservierter
 * Bereich oder Entwurf. Wort fuer Wort die Regel, die der Fingerprint benutzt.
 */
export function istAusgeschlossen(r: Figur, a: Ausschluss): boolean {
  return a.testserien.includes(r.series_code ?? "")
    || r.sky_id >= a.band_ab
    || a.status.includes(r.catalog_status ?? "");
}

/**
 * Warum eine SKY-ID ausserhalb liegt — fuer die Meldung, nicht fuer die
 * Entscheidung. Erst der reservierte Bereich, dann die Testserie, dann der
 * Entwurf: das ist die Reihenfolge, in der ein Mensch danach fragt.
 */
function grundFuerAusserhalb(s: Figur, p: Figur, a: Ausschluss): string {
  if (s.sky_id >= a.band_ab) {
    return `liegt ab ${a.band_ab} und damit im reservierten System- und Testbereich (ADR-0070)`;
  }
  const serien = [s.series_code, p.series_code]
    .filter((c): c is string => c !== null && a.testserien.includes(c));
  if (serien.length > 0) {
    return `Testserie ${[...new Set(serien)].join(" / ")} auf beiden Seiten ausgeschlossen`;
  }
  return `Entwurfsstatus auf beiden Seiten (${a.status.join(", ")})`;
}

/** Welche Merkmale aus einer Liste zwischen den beiden Seiten abweichen. */
function abweichende(s: Figur, p: Figur, felder: readonly (keyof Figur)[]): string[] {
  return felder.filter((f) => (s[f] ?? null) !== (p[f] ?? null));
}

/**
 * Die Einordnung einer SKY-ID, die in BEIDEN Umgebungen steht.
 */
export function einordnen(s: Figur, p: Figur, a: Ausschluss): Einordnung {
  // Genau die Bedingung des Planbaus: beide Seiten ausgeschlossen, also raus.
  if (istAusgeschlossen(s, a) && istAusgeschlossen(p, a)) {
    return { art: "ausserhalb", grund: grundFuerAusserhalb(s, p, a) };
  }

  const beobachtet = abweichende(s, p, BEOBACHTETE_MERKMALE);
  const merkmale = abweichende(s, p, IDENTITAETSMERKMALE);
  if (merkmale.length > 0) return { art: "identitaetskonflikt", merkmale, beobachtet };
  if ((s.name ?? null) !== (p.name ?? null)) return { art: "namensabweichung", beobachtet };
  return { art: "gleich", beobachtet };
}

export type Riegelergebnis = {
  /** Identitaetskonflikte, mit dem Merkmal, das sie ausmacht. */
  konflikte: { sky_id: string; merkmale: string[] }[];
  /** Konflikte ohne Eintrag in `bootstrap-decisions.json` — diese halten an. */
  unbekannt: string[];
  /** Dieselbe Figur, anderer Name (SYNC-02). Kein Konflikt. */
  namensabweichungen: string[];
  /** Ausserhalb des Abgleichs, mit Grund. */
  ausserhalb: { sky_id: string; grund: string }[];
  /** Abweichendes Bild ohne Identitaetsabweichung — Hinweis, kein Riegel. */
  bildhinweise: string[];
};

/**
 * Riegel 3 ueber den gesamten gemeinsamen Bestand.
 *
 * `bekannt` sind die SKY-IDs, zu denen in `bootstrap-decisions.json` eine
 * Entscheidung steht. Ein Konflikt OHNE Entscheidung haelt den Lauf an; das
 * ist der eigentliche Zweck des Riegels.
 */
export function riegel3(
  staging: ReadonlyMap<string, Figur>,
  production: ReadonlyMap<string, Figur>,
  a: Ausschluss,
  bekannt: readonly string[],
): Riegelergebnis {
  const r: Riegelergebnis = {
    konflikte: [], unbekannt: [], namensabweichungen: [], ausserhalb: [], bildhinweise: [],
  };

  for (const id of [...staging.keys()].sort()) {
    const p = production.get(id);
    if (!p) continue;
    const e = einordnen(staging.get(id)!, p, a);
    switch (e.art) {
      case "ausserhalb":
        r.ausserhalb.push({ sky_id: id, grund: e.grund });
        break;
      case "identitaetskonflikt":
        r.konflikte.push({ sky_id: id, merkmale: e.merkmale });
        if (!bekannt.includes(id)) r.unbekannt.push(id);
        break;
      case "namensabweichung":
        r.namensabweichungen.push(id);
        if (e.beobachtet.length > 0) r.bildhinweise.push(id);
        break;
      case "gleich":
        if (e.beobachtet.length > 0) r.bildhinweise.push(id);
        break;
    }
  }
  return r;
}
