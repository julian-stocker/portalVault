/**
 * ETAPPE E — IST DER KATALOG VERÖFFENTLICHT?
 *
 * Rein, ohne Datenbank, ohne Netz. Die Zeilen kommen als Parameter herein.
 * Geprüft wird das in `publish-compare.test.ts`.
 *
 * ===========================================================================
 * WARUM ES DIESES MODUL GIBT
 * ===========================================================================
 *
 * Am 2026-10-31 lief Etappe D vollständig durch — 573 von 573 Schritten,
 * `journalDelta 331 = erwartet`, TOR 3 ohne Befund, und der neu gerechnete
 * Plan meldete **0 Schritte in beiden Richtungen**. Trotzdem brach Etappe E
 * ab:
 *
 *     die Fingerprints weichen ab: katalog_freigegeben, charaktere.
 *
 * Beides gemessen, beides dieselbe Art Fehler: **die Prüfung verglich
 * Felder, die der Publish weder überträgt noch übertragen darf.**
 *
 *   katalog_freigegeben  Der Abdruck läuft über alle 19 Felder, `name`
 *                        eingeschlossen. Der Planer überspringt `name` und
 *                        `slug` aber ausdrücklich — die Excel ist Hoheit
 *                        (ADR-0030, `name_hoheit: "excel"`). Gemessen: über
 *                        die 17 geregelten Felder sind beide Umgebungen
 *                        ZEICHENGLEICH (655·df54fd6e…); die ganze Differenz
 *                        sind 35 Namen — genau die 35, die Riegel 3 schon
 *                        als „kein Konflikt, dieselbe Figur" meldet. `slug`
 *                        weicht in keiner einzigen Zeile ab.
 *
 *   charaktere           Der Abdruck läuft über sieben Metadatenfelder
 *                        (Element, Spezies, Rolle, Beschreibung, Quelle,
 *                        Quellenlabel, Prüfdatum). Keines davon ist unter
 *                        den 19 synchronisierten Feldern, und
 *                        `admin_create_character` (0158) legt eine Familie
 *                        mit NICHTS ALS DEM NAMEN an — kuratierte Arbeit
 *                        gehört nach ADR-0034 in
 *                        `data/characters/characters.json`. Gemessen: die
 *                        Identität (canonical_name) ist zeichengleich,
 *                        24 zu 24; genau EIN Charakter trägt abweichende
 *                        Metadaten (`Fire Kraken`).
 *
 * Eine Prüfung, die nach etwas fragt, das der Lauf nicht herstellen darf,
 * kann nie bestehen. Richtig gestellt fragt sie zwei Dinge getrennt:
 *
 *   1  Was der Publish regelt, muss GLEICH sein. Keine Toleranz.
 *   2  Was er nicht regelt, muss genau die ENTSCHIEDENE Abweichung sein —
 *      nach Anzahl und nach Abdruck über die Menge. Eine 36. Namensabweichung
 *      hält den Lauf an.
 *
 * Punkt 2 ist der Unterschied zwischen „richtig stellen" und „ignorieren".
 */

import { createHash } from "node:crypto";

/** Die 19 Felder des Abgleichs, in der Reihenfolge aus S3/S4. */
export const FELDER = ["series_code", "kategorie", "name", "slug",
  "display_name_override", "card_type", "item_type", "is_active",
  "catalog_visible", "catalog_status", "base_sky_id", "familie", "types",
  "visible_type", "visible_type_decided", "image_file", "image_override_path",
  "source", "usk_rating"] as const;

/**
 * DIE FELDER, DIE DER PUBLISH NICHT REGELT.
 *
 * Diese Liste ist die EINE Quelle: `tools/catalog-sync.mts` überspringt
 * genau sie im Feldvergleich (vorher stand dort `f === "name" || f ===
 * "slug"` als eigene Bedingung — zwei Quellen für dieselbe Regel, und die
 * Fingerprintprüfung kannte die andere nicht).
 *
 * ADR-0030: der gespeicherte Name folgt der Excel. Staging-Namen werden
 * nicht nach Production übernommen. Was der Besucher sieht, ist
 * `display_name_override` — und DAS ist geregelt und wird übertragen.
 */
export const UNGEREGELT = ["name", "slug"] as const;

/** Was der Publish regelt — und was deshalb gleich sein muss. */
export const GEREGELT = FELDER.filter(
  (f) => !(UNGEREGELT as readonly string[]).includes(f));

/** Die kuratierten Charakterfelder. Keines wird synchronisiert (ADR-0034). */
export const CHARAKTER_METADATEN = ["element", "species", "role_type",
  "short_description", "source_url", "source_label", "verified_at"] as const;

export type Zeile = Record<string, unknown>;

/** Die fachliche Textform eines Werts — dieselbe wie im Planer. */
export const t = (v: unknown): string =>
  v === null || v === undefined ? "~"
  : typeof v === "boolean" ? (v ? "true" : "false")
  : Array.isArray(v) ? (v.length ? [...v].sort().join("+") : "~")
  : String(v);

const md5 = (zz: readonly string[]) =>
  createHash("md5").update(zz.join("\n")).digest("hex");

export type Abdruck = { zeilen: number; abdruck: string };

/** Die geregelte Projektion einer Umgebung: die 17 Felder, nach SKY-ID. */
export function geregelteProjektion(
  sicht: ReadonlyMap<string, Zeile>, freigegeben: readonly string[],
): Abdruck {
  const ids = [...freigegeben].sort();
  return { zeilen: ids.length,
    abdruck: md5(ids.map((id) => [id, ...GEREGELT.map((f) => t(sicht.get(id)![f]))].join("|"))) };
}

export type Abweichung = { schluessel: string; staging: string; production: string };

/** Abweichungen eines einzelnen Felds, über die beidseitig freigegebenen Zeilen. */
export function feldAbweichungen(
  feld: string,
  s: ReadonlyMap<string, Zeile>, p: ReadonlyMap<string, Zeile>,
  beidseitig: readonly string[],
): { anzahl: number; abdruck: string; liste: Abweichung[] } {
  const liste = [...beidseitig].sort()
    .filter((id) => t(s.get(id)![feld]) !== t(p.get(id)![feld]))
    .map((id) => ({ schluessel: id, staging: t(s.get(id)![feld]),
                    production: t(p.get(id)![feld]) }));
  return { anzahl: liste.length,
    abdruck: md5(liste.map((a) => `${a.schluessel}|${a.staging}|${a.production}`)),
    liste };
}

/** Die Identität der Charaktere: nur die Namen, nichts Kuratiertes. */
export function charakterIdentitaet(namen: readonly string[]): Abdruck {
  const n = [...namen].sort();
  return { zeilen: n.length, abdruck: md5(n) };
}

/** Metadatenabweichungen bei gleichnamigen Charakteren. */
export function charakterMetadaten(
  s: ReadonlyMap<string, Zeile>, p: ReadonlyMap<string, Zeile>,
): { anzahl: number; abdruck: string; namen: string[];
     liste: { name: string; feld: string; staging: string; production: string }[] } {
  const namen: string[] = []; const liste: {
    name: string; feld: string; staging: string; production: string }[] = [];
  const zeilen: string[] = [];
  for (const name of [...s.keys()].sort()) {
    const b = p.get(name); if (!b) continue;
    const a = s.get(name)!;
    const ab = CHARAKTER_METADATEN.filter((f) => t(a[f]) !== t(b[f]));
    if (ab.length === 0) continue;
    namen.push(name);
    for (const f of ab) liste.push({ name, feld: f, staging: t(a[f]), production: t(b[f]) });
    zeilen.push(`${name}|${CHARAKTER_METADATEN
      .map((f) => `${t(a[f])}>${t(b[f])}`).join("|")}`);
  }
  return { anzahl: namen.length, abdruck: md5(zeilen), namen, liste };
}

/* ------------------------------------------------------------ Das Urteil */

/** Was der Betreiber als bekannte, entschiedene Abweichung hinterlegt hat. */
export type Erwartung = {
  felder: readonly string[];
  name: { abweichungen: number; abdruck: string | null };
  slug: { abweichungen: number; abdruck: string | null };
  charakter_metadaten: { abweichungen: number; namen: readonly string[]; abdruck: string | null };
};

export type Messung = {
  geregelt: { staging: Abdruck; production: Abdruck };
  ungeregelt: Record<string, { anzahl: number; abdruck: string }>;
  identitaet: { staging: Abdruck; production: Abdruck };
  metadaten: { anzahl: number; abdruck: string; namen: readonly string[] };
};

/**
 * DAS URTEIL ÜBER ETAPPE E.
 *
 * `befunde` leer heißt: bestanden. Jeder Befund ist ein Abbruchgrund.
 */
export function beurteileEtappeE(m: Messung, e: Erwartung): {
  bestanden: boolean; befunde: string[]; hinweise: string[];
} {
  const befunde: string[] = []; const hinweise: string[] = [];

  /* 1 — WAS DER PUBLISH REGELT, MUSS GLEICH SEIN. Keine Toleranz. */
  if (m.geregelt.staging.zeilen !== m.geregelt.production.zeilen) {
    befunde.push(`der freigegebene Katalog hat verschieden viele Zeilen: `
      + `Staging ${m.geregelt.staging.zeilen}, Production ${m.geregelt.production.zeilen}`);
  } else if (m.geregelt.staging.abdruck !== m.geregelt.production.abdruck) {
    befunde.push(`die ${GEREGELT.length} geregelten Felder weichen ab: `
      + `Staging ${m.geregelt.staging.abdruck}, Production ${m.geregelt.production.abdruck}. `
      + `Das ist eine ECHTE Katalogabweichung — der Publish ist unvollstaendig.`);
  } else {
    hinweise.push(`die ${GEREGELT.length} geregelten Felder sind zeichengleich `
      + `(${m.geregelt.staging.zeilen}·${m.geregelt.staging.abdruck})`);
  }

  /* 2 — DIE IDENTITÄT DER CHARAKTERE MUSS GLEICH SEIN. */
  if (m.identitaet.staging.zeilen !== m.identitaet.production.zeilen
      || m.identitaet.staging.abdruck !== m.identitaet.production.abdruck) {
    befunde.push(`die Charakteridentitaet weicht ab: `
      + `Staging ${m.identitaet.staging.zeilen}·${m.identitaet.staging.abdruck}, `
      + `Production ${m.identitaet.production.zeilen}·${m.identitaet.production.abdruck}`);
  } else {
    hinweise.push(`die Charakteridentitaet ist zeichengleich `
      + `(${m.identitaet.staging.zeilen}·${m.identitaet.staging.abdruck})`);
  }

  /*
   * 3 — WAS ER NICHT REGELT, MUSS GENAU DIE ENTSCHIEDENE ABWEICHUNG SEIN.
   *
   * Nicht „darf abweichen", sondern „weicht in genau dieser Menge ab".
   * Anzahl UND Abdruck: eine andere Zeile bei gleicher Anzahl ist ebenso ein
   * Befund wie eine Zeile mehr.
   */
  for (const feld of e.felder) {
    const ist = m.ungeregelt[feld];
    const soll = (e as unknown as Record<string, Erwartung["name"]>)[feld];
    if (ist === undefined || soll === undefined) {
      befunde.push(`das ungeregelte Feld ${feld} ist nicht gemessen oder nicht erwartet`);
      continue;
    }
    if (ist.anzahl !== soll.abweichungen) {
      befunde.push(`${feld}: ${ist.anzahl} Abweichung(en), erwartet waren `
        + `${soll.abweichungen}. Eine mehr ist so verdaechtig wie eine weniger.`);
      continue;
    }
    if (soll.abdruck !== null && ist.abdruck !== soll.abdruck) {
      befunde.push(`${feld}: gleich viele Abweichungen (${ist.anzahl}), aber eine `
        + `andere Menge — Abdruck ${ist.abdruck}, erwartet ${soll.abdruck}`);
      continue;
    }
    hinweise.push(`${feld}: ${ist.anzahl} entschiedene Abweichung(en) (ADR-0030)`);
  }

  const cm = e.charakter_metadaten;
  if (m.metadaten.anzahl !== cm.abweichungen) {
    befunde.push(`Charaktermetadaten: ${m.metadaten.anzahl} Abweichung(en) `
      + `(${m.metadaten.namen.join(", ") || "keine"}), erwartet waren ${cm.abweichungen} `
      + `(${cm.namen.join(", ") || "keine"})`);
  } else if (cm.abdruck !== null && m.metadaten.abdruck !== cm.abdruck) {
    befunde.push(`Charaktermetadaten: gleich viele Abweichungen, aber eine andere `
      + `Menge — Abdruck ${m.metadaten.abdruck}, erwartet ${cm.abdruck}`);
  } else {
    hinweise.push(`Charaktermetadaten: ${m.metadaten.anzahl} entschiedene `
      + `Abweichung(en)${m.metadaten.namen.length ? ` (${m.metadaten.namen.join(", ")})` : ""} `
      + `— nicht synchronisiert, ADR-0034`);
  }

  return { bestanden: befunde.length === 0, befunde, hinweise };
}
