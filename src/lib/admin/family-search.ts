/**
 * CAT-06 — die Suche nach einer Figurenfamilie.
 *
 * WAS EINE FAMILIE IST: eine Zeile in `characters`. Die Beziehung
 * `skylanders.character_id → characters.id` (`0002`) ist das einzige
 * verbindliche Familienmodell, und diese Datei liest es — sie legt keine
 * zweite Struktur daneben.
 *
 * WARUM MIT MITGLIEDERZAHL UND BEISPIELEN: „Spyro" allein sagt dem Bediener
 * nicht, ob er die richtige Familie vor sich hat. Zwei bis drei Mitglieder
 * mit Namen und die Serien, in denen sie liegen, sagen es — und zeigen
 * nebenbei, dass eine Familie Figuren in mehreren Serien haben darf (heute
 * 13 von 20).
 *
 * SIE LIEST NUR. Geschrieben wird erst, wenn der Bediener bestätigt, und
 * dann über `publishDraftAsVariant()` oder `setFigureCharacter()`.
 */
"use server";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { fetchFamilies, type Familienzeile } from "@/lib/admin/queries";

export type { Familienzeile };

/**
 * Familien zu einem Suchwort, oder die größten, wenn nichts gesucht wird.
 *
 * `null` heißt „nicht berechtigt" — dieselbe Form wie `searchMergeTargets`,
 * damit der Dialog beide Suchen gleich behandeln kann.
 */
export async function searchFamilies(query: string): Promise<Familienzeile[] | null> {
  if (!(await isPlatformAdmin())) return null;

  const alle = await fetchFamilies();
  const q = query.trim().toLowerCase();
  if (q === "") {
    /* Ohne Suchwort die mitgliederstärksten: das sind die, zu denen eine
       Variante am wahrscheinlichsten gehört. */
    return [...alle].sort((a, b) => b.mitglieder - a.mitglieder
                                 || a.name.localeCompare(b.name, "de")).slice(0, 8);
  }
  return alle
    .filter((f) => f.name.toLowerCase().includes(q)
                || f.beispiele.some((n) => n.toLowerCase().includes(q)))
    .sort((a, b) => {
      /* Ein Treffer im Familiennamen steht vor einem Treffer in einem
         Mitglied: wer „Spyro" sucht, meint die Familie Spyro und nicht die
         Familie, in der ein „Dark Spyro" liegt. */
      const aName = a.name.toLowerCase().includes(q) ? 0 : 1;
      const bName = b.name.toLowerCase().includes(q) ? 0 : 1;
      return aName - bName || a.name.localeCompare(b.name, "de");
    })
    .slice(0, 8);
}
