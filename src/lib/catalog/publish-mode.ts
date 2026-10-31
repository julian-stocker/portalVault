/**
 * BOOTSTRAP ODER DAUERBETRIEB — die beiden Welten des Katalogabgleichs.
 *
 * Rein, ohne Datenbank. Geprüft in `publish-mode.test.ts`.
 *
 * ===========================================================================
 * WARUM DIESE TRENNUNG NÖTIG IST
 * ===========================================================================
 *
 * Der einmalige Abgleich (2026-10-30/31) musste in BEIDE Richtungen
 * schreiben: Production trug kuratierte Entscheidungen, die Staging nicht
 * hatte — 22 Sichtbarkeiten, eigene Anzeigenamen, eigene Bildverweise. Dafür
 * gab es Regeln, die genau einmal richtig waren.
 *
 * Seit ADR-0163 führt Staging. Production ist **nur noch Ziel**. Jede dieser
 * Regeln wäre im Dauerbetrieb ein Rückschritt: sie würde redaktionelle Arbeit
 * auf Staging mit einem älteren Production-Stand überschreiben.
 *
 * Sie sind deshalb nicht gelöscht — der Bootstrap muss nachvollziehbar
 * bleiben — sondern an den Modus gebunden. `bootstrap` ist die Geschichte,
 * `publish` der Alltag, und **der Modus wird verlangt, nicht geraten**: ein
 * Vorgabewert wäre genau die Art stiller Annahme, die hier teuer ist.
 */

export type Modus = "bootstrap" | "publish";

/**
 * Die Regeln, die NUR im Bootstrap gelten. Als Daten, damit der Test sie
 * aufzählen kann und nicht die Abwesenheit von etwas prüfen muss.
 */
export const BOOTSTRAP_REGELN = [
  {
    schluessel: "sichtbarkeit_production_gewinnt",
    was: "Die 22 abweichenden Sichtbarkeiten: Staging folgt Production.",
    warum_einmalig: "Production trug die redaktionelle Entscheidung, Staging nicht. "
      + "Im Dauerbetrieb entscheidet Staging — ADR-0163.",
    quelle: "bootstrap-decisions.json / sichtbarkeit.richtung",
  },
  {
    schluessel: "name_korrektur_staging",
    was: "Die Namenskorrektur auf Staging (SKY-0922).",
    warum_einmalig: "Ein Name, der nicht aus der Excel kommt (source = admin). "
      + "Einmal gesetzt, danach gilt ADR-0030.",
    quelle: "bootstrap-decisions.json / name_korrektur_staging",
  },
  {
    schluessel: "display_name_override_nach_staging",
    was: "Die 13 entschiedenen Anzeigenamen, auch Richtung Staging geschrieben.",
    warum_einmalig: "Die Entscheidung lag als Liste vor und musste auf beide "
      + "Umgebungen. Danach pflegt sie der Admin auf Staging.",
    quelle: "bootstrap-decisions.json / display_name_override",
  },
  {
    schluessel: "production_eigene_entscheidung",
    was: "Ein Production-eigener Anzeigename oder Bildverweis gewinnt gegen "
      + "ein leeres Staging-Feld.",
    warum_einmalig: "Production hatte Kuration, die Staging fehlte. Sie wurde "
      + "einmal übernommen; danach ginge sie in die falsche Richtung.",
    quelle: "tools/catalog-sync.mts, Abschnitt 5",
  },
  {
    schluessel: "figurenanlage_nach_staging",
    was: "Figuren, die Staging fehlen, dort anlegen.",
    warum_einmalig: "SKY-0821 und die Production-eigenen Zeilen. Im Dauerbetrieb "
      + "entstehen neue Figuren auf Staging, nie auf Production.",
    quelle: "tools/catalog-sync.mts, planeFigurenanlage(\"staging\")",
  },
] as const;

export const BOOTSTRAP_SCHLUESSEL = BOOTSTRAP_REGELN.map((r) => r.schluessel);

/** Liest den Modus aus der Befehlszeile. Kein Vorgabewert — Abbruch stattdessen. */
export function liesModus(argv: readonly string[]): Modus | { fehler: string } {
  const treffer = argv.filter((a) => a.startsWith("--modus="));
  if (treffer.length === 0) {
    return { fehler: "--modus=publish oder --modus=bootstrap fehlt. Es gibt keinen "
      + "Vorgabewert:\n  `publish` ist der Dauerbetrieb (einseitig nach Production), "
      + "`bootstrap`\n  der einmalige Abgleich vom 2026-10-30/31 (beide Richtungen)." };
  }
  if (treffer.length > 1) {
    return { fehler: `--modus steht ${treffer.length}-mal: ${treffer.join(" ")}` };
  }
  const w = treffer[0].slice("--modus=".length);
  if (w !== "bootstrap" && w !== "publish") {
    return { fehler: `--modus kennt "bootstrap" und "publish", nicht ${JSON.stringify(w)}` };
  }
  return w;
}

export type Schritt = { ziel: string; art: string; sky_id: string; feld?: string;
                        grund?: string };

/**
 * DIE EINWEGRICHTUNG — im Publish darf kein Schritt nach Staging zeigen.
 *
 * Das ist der Riegel, der die Trennung oben trägt. Die Regeln einzeln
 * abzuschalten genügt nicht: eine künftig hinzugefügte Regel könnte wieder
 * nach Staging planen, ohne dass es jemandem auffällt. Hier fällt es auf.
 */
export function pruefeEinwegrichtung(schritte: readonly Schritt[]): {
  ok: boolean; nachStaging: Schritt[];
} {
  const nachStaging = schritte.filter((s) => s.ziel === "staging");
  return { ok: nachStaging.length === 0, nachStaging };
}
