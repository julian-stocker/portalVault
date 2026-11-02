/**
 * Die Variantenbeziehung im Publish — zwei Riegel (CAT-11).
 *
 * `base_sky_id` geht seit ADR-0164 mit nach Production, als Klasse-B-Schritt
 * ueber `admin_set_variant_base` (0159). Zwei Faelle hat der Publish bis
 * hierher nicht abgefangen, und beide brechen MITTEN im Lauf ab, statt vorher:
 *
 *   1. EIN VERWAISTER VERWEIS. Staging fuehrt eine veroeffentlichte Variante,
 *      deren Basisfigur dort ein ENTWURF ist. Entwuerfe traegt der Publish
 *      nicht — die Basisfigur fehlt auf Production, und der zusammengesetzte
 *      Fremdschluessel aus 0159 weist die Zuordnung ab, nachdem die
 *      Variante schon angelegt ist. `pruefeBasisziele()` findet das im PLAN,
 *      bevor irgendetwas geschrieben wird.
 *
 *   2. DIE FALSCHE REIHENFOLGE. Die Schritte sind nach Schrittart sortiert —
 *      Felder neuer Figuren vor Feldern bestehender. Wird auf Staging eine
 *      bisherige Variante X zur Basisfigur und eine neue Figur Y zur Variante
 *      von X, liefe Y→X VOR X→NULL, und 0159 lehnte ab: „X ist selbst eine
 *      Variante". Dasselbe, wenn eine Figur Variante wird, auf die auf
 *      Production noch Varianten zeigen, die erst spaeter im Lauf umgehaengt
 *      werden. `ordneVariantenschritte()` loest das, indem sie die
 *      `base_sky_id`-Schritte nach ihren Abhaengigkeiten ordnet.
 *
 * REIN. Beide Funktionen lesen nur, was ihnen gegeben wird — keine
 * Datenbank, kein Netz. Der Planer und der Apply-Pfad rufen sie; die Tests
 * rufen sie ohne beides.
 */

/** Was beide Funktionen von einem Schritt brauchen. `~` heisst NULL. */
export type VariantenSchritt = {
  art: string;
  sky_id: string;
  feld?: string;
  von?: string;
  nach?: string;
};

const LEER = "~";
const istBasis = (s: VariantenSchritt) => s.feld === "base_sky_id";

/**
 * RIEGEL 5 — jede Zuordnung zeigt auf eine Figur, die es auf dem Ziel geben
 * WIRD: dort schon vorhanden, oder in diesem Lauf angelegt.
 */
export function pruefeBasisziele(
  plan: readonly VariantenSchritt[],
  aufZiel: ReadonlySet<string>,
): { ok: boolean; verwaist: VariantenSchritt[] } {
  const angelegt = new Set(plan.filter((s) => s.art === "figur-anlegen").map((s) => s.sky_id));
  const verwaist = plan.filter((s) =>
    istBasis(s) && s.nach !== undefined && s.nach !== LEER
    && !aufZiel.has(s.nach) && !angelegt.has(s.nach));
  return { ok: verwaist.length === 0, verwaist };
}

/**
 * Ordnet die `base_sky_id`-Schritte nach ihren Abhaengigkeiten und laesst
 * jeden anderen Schritt, wo er war.
 *
 * ZWEI ABHAENGIGKEITEN, beide aus den Riegeln von 0159:
 *
 *   * „Y wird Variante von T" wartet auf jeden Schritt, der T selbst
 *     zuordnet — T muss Basisfigur sein, wenn Y auf sie zeigt.
 *   * „F wird Variante" wartet auf jeden Schritt einer Figur, die auf dem
 *     Ziel HEUTE auf F zeigt (`von === F`) — auf F darf nichts mehr zeigen.
 *
 * WOHIN DIE GEORDNETEN SCHRITTE KOMMEN: als ein Block an die Stelle des
 * ERSTEN `base_sky_id`-Schritts. Das ist der fruehestmoegliche Punkt, an dem
 * alle Figuren schon angelegt sind (Rang `figur-anlegen` liegt davor), und
 * er haelt die bestehende Zusage „Varianten vor Familien": jeder
 * `familie`-Schritt lag schon vorher hinter dem ersten `base_sky_id`.
 *
 * Ein Zyklus kann aus einem gueltigen Staging nicht entstehen (dort gelten
 * dieselben Riegel). Steht trotzdem einer im Plan, wird abgebrochen — VOR
 * dem ersten Schreibzugriff.
 */
export function ordneVariantenschritte<T extends VariantenSchritt>(schritte: readonly T[]): T[] {
  const erste = schritte.findIndex(istBasis);
  if (erste < 0) return [...schritte];

  const basis = schritte.filter(istBasis);
  const rest = schritte.filter((s) => !istBasis(s));

  /* Kante a -> b: a muss vor b laufen. */
  const vorher = new Map<T, Set<T>>(basis.map((s) => [s, new Set<T>()]));
  for (const b of basis) {
    if (b.nach === undefined || b.nach === LEER) continue;      // Loesen hat keine Bedingung
    for (const a of basis) {
      if (a === b) continue;
      if (a.sky_id === b.nach) vorher.get(b)!.add(a);           // die Basis zuerst
      if (a.von === b.sky_id) vorher.get(b)!.add(a);            // wer auf mich zeigt, zuerst
    }
  }

  const geordnet: T[] = [];
  const offen = new Set(basis);
  while (offen.size > 0) {
    /* Stabil: unter den freien der, der vorher zuerst stand. */
    const frei = basis.find((s) => offen.has(s) && [...vorher.get(s)!].every((a) => !offen.has(a)));
    if (frei === undefined) {
      const namen = [...offen].map((s) => `${s.sky_id}→${s.nach ?? LEER}`).join(", ");
      throw new Error(`Variantenschritte bilden einen Zyklus: ${namen}. Nichts geschrieben.`);
    }
    geordnet.push(frei);
    offen.delete(frei);
  }

  /* Der Block an die Stelle des ersten Basisschritts. */
  const davor = schritte.slice(0, erste).filter((s) => !istBasis(s));
  const danach = rest.slice(davor.length);
  return [...davor, ...geordnet, ...danach];
}

/* ==========================================================================
 * CAT-19 — die Familie folgt der Basisfigur (`0168`, ADR-0171)
 * ======================================================================= */

const istFamilie = (s: VariantenSchritt) => s.feld === "familie";

/**
 * Die `familie`-Schritte der Basisfiguren VOR denen ihrer Varianten.
 *
 * WARUM. Mit `0168` weist das Ziel eine Familie an einer Variante ab, die
 * nicht die ihrer Basisfigur ist. Liefe „Variante → B" vor „Basisfigur → B",
 * stünde die Basisfigur noch auf A — abgelehnt. Andersherum hat die Kaskade
 * die Variante schon mitgenommen, und ihr eigener Schritt findet den Zielwert
 * vor (`tools/catalog-sync-apply.mts` schreibt ihn dann nicht).
 *
 * `basisVon` sagt, wessen Variante eine Figur NACH den `base_sky_id`-Schritten
 * ist — die laufen vorher (FELDRANG). Stabil: innerhalb beider Gruppen bleibt
 * die Reihenfolge. Ohne `0168` auf dem Ziel schadet sie nicht.
 */
export function ordneFamilienschritte<T extends VariantenSchritt>(
  schritte: readonly T[],
  basisVon: (skyId: string) => string | null,
): T[] {
  const erste = schritte.findIndex(istFamilie);
  if (erste < 0) return [...schritte];
  const familie = schritte.filter(istFamilie);
  const basen = familie.filter((s) => basisVon(s.sky_id) === null);
  const varianten = familie.filter((s) => basisVon(s.sky_id) !== null);
  const davor = schritte.slice(0, erste).filter((s) => !istFamilie(s));
  const danach = schritte.slice(erste).filter((s) => !istFamilie(s));
  return [...davor, ...basen, ...varianten, ...danach];
}

/** Eine Figur, wie der Planer sie sieht: Basisfigur und Familie (Name). */
export type FamilienZeile = { base_sky_id: string | null; familie: string | null };

export type FamilienWiderspruch = {
  sky_id: string; basis: string; familie: string | null; basisFamilie: string | null;
};

/**
 * RIEGEL 7 — keine Variante mit einer anderen Familie als ihre Basisfigur,
 * im Stand, der veröffentlicht würde.
 *
 * Mit `0168` auf dem Ziel liesse sich so ein Stand dort gar nicht schreiben
 * (Abbruch mitten im Lauf); ohne `0168` landete der Widerspruch auf
 * Production. Beides verhindert der Riegel — VOR dem ersten Schreibzugriff.
 * Auch `null` zählt: hat die Basisfigur keine Familie, hat die Variante keine.
 */
export function familienWidersprueche(
  zeilen: ReadonlyMap<string, FamilienZeile>,
  gilt: (skyId: string) => boolean = () => true,
): FamilienWiderspruch[] {
  const out: FamilienWiderspruch[] = [];
  for (const [sky_id, z] of [...zeilen].sort(([a], [b]) => a.localeCompare(b))) {
    if (z.base_sky_id === null || !gilt(sky_id)) continue;
    const basis = zeilen.get(z.base_sky_id);
    if (basis === undefined) continue;   // Riegel 5 beantwortet das
    if ((z.familie ?? null) !== (basis.familie ?? null)) {
      out.push({ sky_id, basis: z.base_sky_id, familie: z.familie ?? null,
                 basisFamilie: basis.familie ?? null });
    }
  }
  return out;
}

/**
 * Welche Familien Production ANLEGEN muss: nur die, die eine zu
 * veröffentlichende Figur trägt. Eine leere Staging-Familie — eine
 * verlassene Pseudofamilie etwa — entsteht auf Production nie.
 */
export function gebrauchteFamilien(
  zeilen: Iterable<FamilienZeile & { gilt: boolean }>,
): Set<string> {
  const out = new Set<string>();
  for (const z of zeilen) if (z.gilt && z.familie !== null) out.add(z.familie);
  return out;
}
