/**
 * Die Verweisliste aus einer Loeschsperre, lesbar (CAT-12).
 *
 * `admin_delete_figure` (`0162`) meldet
 *
 *     0162: auf SKY-0012 zeigen noch Daten: public.inventory_import_rows.sky_id=3.
 *
 * und haengt bei CASCADE-Schluesseln einen zweiten Satz an. Die Anzeige hat
 * den Teil hinter dem Doppelpunkt bis zum ERSTEN Punkt genommen — und der
 * erste Punkt steht im Schema-Praefix `public.`. Angezeigt wurde „public",
 * und der Bediener las das als Katalogstatus.
 *
 * Diese Funktion nimmt die Liste bis zum Satzende (ein Punkt, dem ein
 * Leerzeichen oder das Ende folgt) und macht aus jedem Eintrag
 * `tabelle (Anzahl)`. Sie entscheidet nichts: die Sperre steht in der
 * Datenbank und bleibt dort.
 *
 * REIN, ohne `"use server"` — damit sie ohne Anfrage pruefbar ist.
 */
export function verweisListe(meldung: string): string {
  const m = /zeigen noch Daten: (.*?)\.(?:\s|$)/.exec(meldung);
  if (m === null) return "";
  return m[1]
    .split(",")
    .map((teil) => teil.trim())
    .filter((teil) => teil !== "")
    .map((teil) => {
      const e = /^(?:[a-z_]+\.)?([a-z_]+)\.[a-z_]+=(\d+)$/.exec(teil);
      return e === null ? teil : `${e[1]} (${e[2]})`;
    })
    .join(", ");
}
