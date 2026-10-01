/**
 * Was die Route zum Dokument der Datenbank hinzufügt — und sonst nichts.
 *
 * `seller_business_backup()` (0104) liefert das ganze Backup in einem
 * Statement. Zwei Metadaten kann sie nicht liefern, und das Manifest hält
 * das in `BACKUP_METADATA_SOURCE` fest:
 *
 *   source_project   Ein Postgres kennt seine Supabase-Projektreferenz
 *                    nicht. Ein erfundenes `current_setting` hätte immer
 *                    `null` geliefert und dabei so ausgesehen, als wüsste
 *                    es die Datenbank.
 *   counts           Die Zeilenzahl je Bereich. Aus dem fertigen Dokument
 *                    gezählt, NIEMALS durch erneutes Fragen der Tabellen:
 *                    eine zweite Abfrage wäre eine zweite
 *                    MVCC-Momentaufnahme, und dann zählte die Prüfgröße
 *                    einen anderen Augenblick als die Daten, die sie prüfen
 *                    soll.
 *
 * KEINE ZWEITE EXPORTLOGIK. Diese Datei transformiert nicht, filtert nicht
 * und ergänzt keine Bereiche. Die 25 Bereiche kommen unverändert durch, so
 * wie sie auf Staging validiert wurden — `format`, `format_version` und
 * `restore_supported` werden nicht angefasst.
 *
 * Rein und ohne Abhängigkeiten, damit die Route selbst nichts entscheidet.
 */

/** Das Dokument, wie es die Datenbank liefert. */
export type BackupDocument = Record<string, unknown> & {
  data?: Record<string, unknown>;
};

/**
 * Zählt je Bereich die Datensätze des fertigen Dokuments.
 *
 * Ein Bereich, der keine Liste ist, zählt 0 statt zu werfen — die Prüfgröße
 * darf den Export nicht scheitern lassen.
 */
export function sectionCounts(document: BackupDocument): Record<string, number> {
  const data = document.data;
  if (typeof data !== "object" || data === null) return {};
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(data)) {
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

/**
 * Die Projektreferenz aus der einen Adresse, die dieses Deployment ohnehin
 * benutzt.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` ist die kanonische Quelle: dieselbe Variable,
 * aus der `supabase/{client,server,middleware}.ts` ihre Verbindung bauen und
 * `catalog/image.ts` seine Bild-URLs. Es ist damit buchstäblich das Projekt,
 * das gerade geantwortet hat — nicht geraten und nicht aus dem Hostnamen der
 * eingehenden Anfrage gelesen, den ein Aufrufer bestimmen könnte.
 *
 * `null`, wenn die Adresse fehlt oder nicht die erwartete Form hat. Ein
 * erfundener Wert wäre schlimmer als ein fehlender: bei drei Dateien auf der
 * Platte entscheidet genau dieses Feld, welche aus Production stammt.
 */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const ref = host.split(".")[0];
  // Supabase-Projektreferenzen sind zwanzig Kleinbuchstaben. Alles andere —
  // ein lokaler Host, ein Proxy — ist keine Referenz und wird nicht als eine
  // ausgegeben.
  return /^[a-z]{20}$/.test(ref) ? ref : null;
}

/**
 * Das auslieferungsfertige Dokument.
 *
 * Die Felder der Datenbank gewinnen: `...document` steht zuletzt nicht, aber
 * die beiden ergänzten Schlüssel gibt es dort nicht, und ein Test hält fest,
 * dass die Route keines der vorhandenen überschreibt.
 */
export function withRouteMetadata(
  document: BackupDocument,
  projectRef: string | null,
): BackupDocument {
  return {
    ...document,
    source_project: projectRef,
    counts: sectionCounts(document),
  };
}

/**
 * Der Dateiname: sortierbar und ohne Zeichen, die ein Dateisystem oder ein
 * `Content-Disposition`-Header anders lesen könnten.
 *
 * `2026-09-30T143012Z` — ISO ohne Doppelpunkte, weil Windows die nicht im
 * Dateinamen erlaubt. Keine Projektreferenz und kein Verkäufername darin:
 * ein Dateiname wandert durch Downloadordner und Chatfenster.
 */
export function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const iso = `${stamp.slice(0, 8)}T${stamp.slice(9)}`;
  return `skyisles-business-backup-${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}.json`;
}
