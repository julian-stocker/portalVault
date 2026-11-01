/**
 * Eine neue Figur im Publish — in EINEM Lauf vollständig (CAT-11).
 *
 * DER BEFUND. `system_sync_create_figure` (`0165`) legt eine Zeile mit elf
 * Werten an. Der Planer fuehrte danach nur vier Folgefelder (`types`,
 * `visible_type`, `familie`, `base_sky_id`) und den Bildverweis. Zwei
 * geregelte Felder fehlten:
 *
 *   * `display_name_override` — eine neue Figur mit Anzeigename kam ohne ihn
 *     an;
 *   * `visible_type_decided` — ein ausdrueckliches „kein Banner" (NULL,
 *     entschieden) kam als „unentschieden" an.
 *
 * Beides fiel erst der Nachkontrolle auf, und erst ein ZWEITER Publish
 * machte die Figur vollstaendig. Ein Publish, der „erfolgreich" meldet und
 * eine halbe Figur hinterlaesst, ist keiner.
 *
 * DIE ANTWORT IST GENERISCH. Statt eine weitere Liste zu pflegen, steht hier,
 * was eine Zeile NACH der Anlage traegt (`NACH_ANLAGE`). Jedes geregelte
 * Feld, dessen Staging-Wert davon abweicht, bekommt einen Schritt — auch ein
 * Feld, das spaeter dazukommt, faellt damit nicht still heraus.
 *
 * `visible_type_decided` IST DER EINE ZUSAMMENHANG. `admin_set_visible_type`
 * setzt es IMMER auf `true`. Nach einem Bannerschritt steht also `true`, ohne
 * ihn `false`; nur wenn Staging etwas anderes traegt, braucht es einen
 * eigenen Schritt — und dessen erwarteter alter Wert ist genau dieser.
 *
 * REIN: keine Datenbank. Der Planer ruft `folgeschritte()`, die Tests rufen
 * zusaetzlich `zustandNachLauf()` und pruefen, dass der naechste Plan leer
 * waere.
 */

/** Was `system_sync_create_figure` aus der Quelle uebernimmt. */
export const VON_DER_ANLAGE = [
  "series_code", "kategorie", "name", "slug", "card_type", "item_type",
  "catalog_status", "catalog_visible", "source", "image_file", "usk_rating",
] as const;

/**
 * Was eine frisch angelegte Zeile in den uebrigen geregelten Feldern traegt —
 * die Spaltenvorgaben aus `0001`/`0033`/`0158`/`0159`/`0163`, in der
 * Schreibweise des Plans (`~` fuer NULL).
 */
export const NACH_ANLAGE: Readonly<Record<string, string>> = {
  display_name_override: "~",
  is_active: "true",
  base_sky_id: "~",
  familie: "~",
  types: "~",
  visible_type: "~",
  visible_type_decided: "false",
  image_override_path: "~",
};

/**
 * Die Reihenfolge der Folgeschritte im Plan. Der Apply-Pfad sortiert ohnehin
 * nach `FELDRANG`; hier steht sie, damit der Plan lesbar ist.
 */
const FOLGE = ["types", "visible_type", "familie", "base_sky_id",
               "display_name_override", "is_active", "visible_type_decided",
               "image_override_path"] as const;

export type Folgeschritt = { feld: string; von: string; nach: string };

/**
 * Die Folgeschritte einer neuen Zeile. `quelle` ist die Staging-Zeile in der
 * Schreibweise des Plans (`t()` im Planer), `geregelt` die geregelten Felder.
 */
export function folgeschritte(
  quelle: Readonly<Record<string, string>>,
  geregelt: readonly string[],
): Folgeschritt[] {
  const schritte: Folgeschritt[] = [];
  const bannerGesetzt = (quelle.visible_type ?? "~") !== "~";
  for (const feld of FOLGE) {
    if (!geregelt.includes(feld)) continue;
    const nach = quelle[feld] ?? "~";
    const von = feld === "visible_type_decided" && bannerGesetzt ? "true" : NACH_ANLAGE[feld];
    if (nach !== von) schritte.push({ feld, von, nach });
  }
  return schritte;
}

/**
 * Was nach Anlage und Folgeschritten auf dem Ziel steht — die Semantik der
 * Schreibwege nachgebildet, damit ein Test den naechsten Plan vorhersagen
 * kann. Nur die Felder, die dieses Modul verantwortet.
 */
export function zustandNachLauf(
  quelle: Readonly<Record<string, string>>,
  schritte: readonly Folgeschritt[],
): Record<string, string> {
  const ziel: Record<string, string> = { ...NACH_ANLAGE };
  for (const feld of VON_DER_ANLAGE) ziel[feld] = quelle[feld] ?? "~";
  for (const s of schritte) {
    ziel[s.feld] = s.nach;
    /* `admin_set_visible_type` (0163) setzt das Kennzeichen immer mit. Ein
       eigener Schritt fuer `visible_type_decided` laeuft danach (FELDRANG). */
    if (s.feld === "visible_type" && !schritte.some((x) => x.feld === "visible_type_decided")) {
      ziel.visible_type_decided = "true";
    }
  }
  return ziel;
}
