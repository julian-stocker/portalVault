/**
 * Editorial writes.
 *
 * Every one of them is a thin wrapper around a database function. That is the
 * point: the function asks `public.is_shop_admin()` itself (migration 0004),
 * so the check that decides is in the database, not in this file. If someone
 * called these actions without the admin area, or spoke to PostgREST
 * directly, the answer is the same — `insufficient_privilege`.
 *
 * The action still asks its capability first. Not as the boundary: as the way to
 * return a German sentence instead of a Postgres error, and to keep the
 * pointless round trip out.
 *
 * `revalidatePath` is what puts the change on screen everywhere at once: the
 * admin list, the figure page, and the public catalog whose contents just
 * changed.
 */
"use server";

import { isCardType } from "@/lib/catalog/card-type";
import { revalidatePath } from "next/cache";

import { looksLikeEmail, normaliseContact } from "@/lib/admin/seller";
import {
  isCommerceMode,
  MIN_ACCOUNT_QUERY,
  readAccountMatches,
  type AccountMatch,
} from "@/lib/admin/commerce-model";
import { canOperateSeller, isPlatformAdmin } from "@/lib/auth/capabilities";
import {
  isCondition,
  isMovementReason,
  isValidPercentage,
} from "@/lib/admin/inventory-model";
import { USK_RATINGS, isDeliveryScope } from "@/lib/shop/delivery-scope";
import { CATALOG_BUCKET, isOverridePath } from "@/lib/catalog/image";
import { MERGE_FELDER, type MergeAuswahl } from "@/lib/admin/merge-candidates";
import { createClient } from "@/lib/supabase/server";
import { isCatalogStatus, type CatalogStatus } from "@/lib/catalog/catalog-status";
import { asCatalogTypes, isCatalogType } from "@/lib/catalog/catalog-type";
import { istUnbekannteFunktion } from "@/lib/admin/queries";
import { de } from "@/lib/i18n/de";

export type AdminResult = { ok: true } | { ok: false; message: string };

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Everything the editorial writes have in common. */
/**
 * Which capability an action needs (ADR-0077).
 *
 * It must match the predicate the function asks in the database, or the two
 * disagree — and the disagreement has only one shape: the screen offers
 * something the database then refuses. `"platform"` is not a stronger
 * `"seller"`; they are different authorities and neither contains the other.
 */
type Capability = "platform" | "seller";

async function allowed(capability: Capability): Promise<boolean> {
  return capability === "platform" ? isPlatformAdmin() : canOperateSeller();
}

/**
 * Was PostgREST an einem Fehler mitliefert.
 *
 * Alle vier Felder sind für die Ursache nötig: `code` ist der SQLSTATE
 * beziehungsweise der `PGRST…`-Code, `message` der Satz aus `raise
 * exception`, `details` und `hint` die Zusätze, die PostgREST bei einer
 * nicht gefundenen Funktion schreibt.
 */
type RpcFehler = { code?: string; message?: string; details?: string; hint?: string };

/**
 * Den Fehler ins SERVERPROTOKOLL schreiben — und nur dorthin.
 *
 * WARUM ES DIESE FUNKTION GIBT. Bis CAT-05H hat `call()` den Fehler
 * ERSATZLOS verworfen: `const { error } = await supabase.rpc(...)`, und wenn
 * kein Zuordner ihn kannte, blieb „Das hat nicht geklappt." Beim ersten
 * echten Merge-Versuch war das die einzige Information, die es gab — weder
 * SQLSTATE noch Meldung, und damit kein Weg zur Ursache ausser Raten.
 * Einen Fehler zu verschlucken ist schlimmer, als ihn hässlich anzuzeigen.
 *
 * WAS NICHT HINEINKOMMT: die WERTE der Argumente. `call()` bedient auch
 * Handelsvorgänge, deren Argumente Kundendaten tragen; die Schlüssel sagen,
 * welcher Aufruf es war, und mehr braucht die Ursachensuche nicht. Die
 * Meldung der Datenbank wird vollständig protokolliert — das Protokoll ist
 * serverseitig und nicht öffentlich —, aber sie erreicht die Oberfläche
 * NIE unverändert.
 */
function protokolliere(fn: string, args: Record<string, unknown>, error: RpcFehler): void {
  console.error("[admin-rpc] Abweisung", JSON.stringify({
    fn,
    argumentschluessel: Object.keys(args).sort(),
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  }));
}

async function call(
  fn: string,
  args: Record<string, unknown>,
  paths: readonly string[],
  capability: Capability,
  /**
   * Turns one specific database refusal into a sentence worth reading.
   *
   * Everything a mapper does not claim falls back — aber nicht mehr
   * sprachlos: der Auffangtext nennt den SQLSTATE, damit der Betreiber
   * etwas in der Hand hat, was im Protokoll wiederzufinden ist. Die rohe
   * Meldung der Datenbank erreicht die Oberfläche nicht; sie kann Namen,
   * Spaltennamen und Teile von Anweisungen enthalten.
   */
  domainError?: (error: RpcFehler) => string | null,
): Promise<AdminResult> {
  if (!(await allowed(capability))) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    protokolliere(fn, args, error);
    const specific = domainError?.(error) ?? null;
    if (specific !== null) return { ok: false, message: specific };
    /* Kein Zuordner kannte ihn. Der Code hilft beim Nachsehen; die Meldung
       bleibt im Protokoll. */
    const code = typeof error.code === "string" && /^[A-Z0-9]{5,8}$/.test(error.code)
      ? error.code : null;
    return { ok: false,
             message: code === null ? de.admin.writeFailed
                                    : de.admin.writeFailedCode(code) };
  }

  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

/**
 * Der redaktionelle Status eines Katalogeintrags (CAT-02B).
 *
 * Eine RPC, ein UPDATE, beide Spalten — `admin_set_catalog_status` schreibt
 * Status und Sichtbarkeit zusammen, damit der CHECK aus `0152` nicht einmal
 * zwischenzeitlich verletzt ist. Journalisiert wird vom Trigger, nicht von
 * hier; es gibt keinen Freigabeschritt und keinen zweiten Akteur.
 *
 * Dieselben Revalidierungspfade wie bei der Sichtbarkeit: ein Statuswechsel
 * ändert, was auf `/` und in der Sammlung zu sehen ist.
 */
export async function setCatalogStatus(skyId: string, status: CatalogStatus): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCatalogStatus(status)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_set_catalog_status",
    { p_sky_id: skyId, p_status: status },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

/**
 * Einen importierten Entwurf in einer bestehenden Figur aufgehen lassen
 * (CAT-05, vereinfacht in CAT-05D, feldweise auswählbar in CAT-05F).
 *
 * DIE AUSWAHL IST ECHT. Der Dialog zeigt jede anstehende Änderung als eigene
 * Tabellenzeile mit Kästchen; `auswahl` ist genau das, was angekreuzt
 * blieb — und zwar samt den Werten, die dabei auf dem Bildschirm standen.
 * `0156` vergleicht sie mit dem, was es selbst rechnet, und bricht bei jeder
 * Abweichung ab. Ein Kästchen, das nur die Anzeige ändert, wäre eine
 * Behauptung.
 *
 * DIE ALLOWLIST STEHT IM SERVER. Die Prüfung hier ist Höflichkeit — eine
 * frühe, verständliche Meldung statt einer SQL-Ausnahme. Verbindlich ist
 * `c_allow` in `0156`, denn ein Aufruf muss nicht aus diesem Formular kommen.
 */
export async function mergeDraftIntoFigure(
  draftId: string,
  targetId: string,
  /** Die angekreuzten Felder mit den angezeigten Werten. */
  auswahl: MergeAuswahl,
  /** Der Bildpfad des Entwurfs — nur nötig, wenn das Bild ausgewählt ist. */
  draftImagePath: string | null = null,
): Promise<AdminResult> {
  if (!SKY_ID.test(draftId) || !SKY_ID.test(targetId)) {
    return { ok: false, message: de.admin.unknownFigure };
  }
  if (draftId === targetId) return { ok: false, message: de.admin.mergeSameRow };

  const felder = Object.keys(auswahl);
  if (felder.length === 0) return { ok: false, message: de.admin.mergeNoFields };
  if (felder.some((f) => !(MERGE_FELDER as readonly string[]).includes(f))) {
    return { ok: false, message: de.admin.mergeFieldRejected };
  }
  /* SERIE UND KATEGORIE SIND EIN FELD — halb ausgewählt weist `0156` ab. */
  if (("series_code" in auswahl) !== ("category_id" in auswahl)) {
    return { ok: false, message: de.admin.mergeLinkedHalf };
  }
  if (!(await allowed("platform"))) return { ok: false, message: de.admin.notAllowed };

  /*
   * DAS BILD ZUERST, DIE DATENBANK DANACH — UND NUR, WENN ES AUSGEWÄHLT IST.
   *
   * Beide Systeme teilen keine Transaktion. Diese Reihenfolge lässt nur zwei
   * Ausgänge zu: alles fertig, oder eine Kopie im Speicher ohne
   * Datenbankänderung — ein verwaistes Objekt von ein paar Kilobyte.
   * Umgekehrt könnte die Karte auf ein Objekt zeigen, das es nicht gibt, und
   * das wäre ein fehlendes Bild.
   *
   * Ist das Kästchen leer, wird NICHT kopiert: kein Speichervorgang, kein
   * neuer Pfad, das bisherige Bild bleibt. `0156` weist einen Pfad ohne
   * ausgewähltes Bild ausdrücklich ab, damit beide Seiten dasselbe meinen.
   *
   * Die Kopie ist inhaltsadressiert: derselbe Hash, neuer Ordner. Ein
   * zweiter Versuch legt dieselben Bytes an dieselbe Stelle — ein `409` ist
   * deshalb kein Fehler, sondern der Beweis der Wiederholbarkeit.
   *
   * DAS ALTE OBJEKT BLEIBT. Weder das des Entwurfs noch das bisherige der
   * Zielfigur wird gelöscht: ein verwaistes Objekt ist billiger als ein
   * verlorenes Bild (dieselbe Regel wie in `image-actions.ts`).
   */
  let zielPfad: string | null = null;
  if ("image_override_path" in auswahl) {
    if (draftImagePath === null || draftImagePath.trim() === "") {
      return { ok: false, message: de.admin.mergeImageMissing };
    }
    const datei = draftImagePath.slice(draftImagePath.indexOf("/") + 1);
    if (!/^[0-9a-f]{16}\.(webp|png|jpg)$/.test(datei)) {
      return { ok: false, message: de.admin.imageFailed };
    }
    zielPfad = `${targetId}/${datei}`;
    /* Was der Server prüft, muss die Vorschau versprochen haben. */
    if (auswahl.image_override_path?.new !== zielPfad) {
      return { ok: false, message: de.admin.mergeStale };
    }
    const supabase = await createClient();
    const { error } = await supabase.storage.from(CATALOG_BUCKET)
      .copy(draftImagePath, zielPfad);
    /* `Duplicate`/409: die Kopie liegt schon — genau das Richtige. */
    if (error && !/duplicate|exists|409/i.test(error.message ?? "")) {
      return { ok: false, message: de.admin.mergeImageFailed };
    }
  }

  return call(
    "admin_merge_draft",
    {
      p_draft: draftId, p_target: targetId, p_image_path: zielPfad,
      p_selection: auswahl,
    },
    ["/admin/catalog", `/admin/catalog/${targetId}`, `/admin/catalog/${draftId}`, "/"],
    "platform",
    (error) => {
      /*
       * JEDE ABWEISUNG VON `0156` HAT HIER EINEN SATZ (CAT-05H).
       *
       * Vorher hatten sechs von dreizehn keinen, und die fielen in den
       * Auffangtext „Das hat nicht geklappt." — genau das hat den ersten
       * echten Merge-Versuch unerklärbar gemacht. Eine Abweisung, die eine
       * REGEL ist, muss der Oberfläche sagen, was zu tun ist; nur ein
       * echter Fehler darf den Code zeigen.
       *
       * Die Reihenfolge ist nicht beliebig: `nicht ausgewaehlt` steckt auch
       * in der Bildpfadmeldung, deshalb wird die spezifischere zuerst
       * gefragt.
       */
      /* `0156` fehlt — dann gibt es die Vierparameterfassung nicht. */
      if (istUnbekannteFunktion(error)) return de.admin.mergeNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      /* Die Abweisungen, die eine Anweisung sind und kein Fehler. */
      if (text.includes("zeigen noch Daten")) return de.admin.mergeBlocked;
      if (text.includes("veraltet") || text.includes("seit der Vorschau")) {
        return de.admin.mergeStale;
      }
      if (text.includes("kein uebernehmbares Feld")) return de.admin.mergeFieldRejected;
      if (text.includes("zusammengesetzter Fremdschluessel")) return de.admin.mergeLinkedHalf;
      if (text.includes("kein Feld zur Übernahme")) return de.admin.mergeNoFields;
      if (text.includes("gehoert nicht zu")) return de.admin.mergeImagePathForeign;
      if (text.includes("kein Bildpfad mit")) return de.admin.mergeImageMissing;
      if (text.includes("nicht ausgewaehlt")) return de.admin.mergeImagePathUnselected;
      if (text.includes("gibt es nicht") || text.includes("dieselbe Zeile")) {
        return de.admin.mergeRowGone;
      }
      if (text.includes("ist kein Entwurf") || text.includes("ist selbst ein Entwurf")) {
        return de.admin.mergeNotADraft;
      }
      if (text.includes("muss ein Objekt sein")) return de.admin.mergeSelectionShape;
      if (text.includes("mehrspaltigen Fremdschluessel")) {
        return de.admin.mergeReferencesUnsupported;
      }
      /*
       * „unbekanntes Planfeld" bleibt BEWUSST ohne eigenen Satz. Es ist kein
       * Eingabefehler, sondern ein Fehler in `0156` selbst — ein zehntes
       * Planfeld ohne Zweig in der Übernahme. Dafür ist der Auffangtext mit
       * Code und das Serverprotokoll genau das Richtige: der Betreiber kann
       * damit nichts anfangen, ich schon.
       */
      return null;
    },
  );
}

/* =========================================================================
 * CAT-06 — die drei Importwege
 *
 * Weg A ist `mergeDraftIntoFigure` oben: eine bestehende Figur aktualisieren.
 * Weg B und C stehen hier. Alle drei bedienen dieselbe Frage — was soll aus
 * diesem Entwurf werden —, und keine erfindet einen zweiten Mechanismus:
 *
 *   A  aktualisieren   `admin_merge_draft`        (0154/0156/0157)
 *   B  als Variante    `admin_publish_as_variant` (0158) = C + Familie, atomar
 *   C  eigenständig    `admin_set_catalog_status` (0152), unverändert
 *
 * WEG C BRAUCHTE KEINE NEUE FUNKTION. Ein Entwurf hat seine SKY-ID und
 * seinen Slug schon; veröffentlichen heißt, den Status zu setzen. Das kann
 * `setCatalogStatus` seit CAT-02B, und `publishDraftStandalone` ist nur der
 * Name, unter dem der Dialog es aufruft — damit der Bestätigungstext die
 * Handlung benennt und nicht ein Auswahlfeld.
 * ====================================================================== */

/**
 * Weg C — den Entwurf als eigenständige Figur veröffentlichen.
 *
 * Keine Zielsuche, keine Familie, keine Änderungstabelle. Die Figur behält
 * alles, was sie hat, und erscheint ab sofort in Katalog, Sammlung und Shop.
 */
export async function publishDraftStandalone(skyId: string): Promise<AdminResult> {
  return setCatalogStatus(skyId, "public");
}

/**
 * Weg B — den Entwurf als Variante einer Figurenfamilie veröffentlichen.
 *
 * ZUORDNEN UND VERÖFFENTLICHEN IN EINER TRANSAKTION. `0158` tut beides in
 * einem Funktionsrumpf: eine veröffentlichte Figur ohne Familie stünde
 * sichtbar an der falschen Stelle im Katalog, eine zugeordnete
 * unveröffentlichte wäre ein halber Vorgang.
 *
 * DIE GRUNDFIGUR WIRD NICHT ABGESCHRIEBEN. Die Familie ist eine Zuordnung,
 * kein Datensatz, aus dem Felder kopiert werden — der Entwurf behält Namen,
 * Bild, Edition, SKY-ID und Slug. „Chrome Spyro" bleibt „Chrome Spyro".
 */
export async function publishDraftAsVariant(
  skyId: string,
  characterId: number,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return { ok: false, message: de.admin.familyUnknown };
  }
  return call(
    "admin_publish_as_variant",
    { p_sky_id: skyId, p_character_id: characterId },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.familyNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("braucht eine Familie")) return de.admin.familyRequired;
      if (text.includes("Familie mit der id")) return de.admin.familyUnknown;
      if (text.includes("gibt es nicht")) return de.admin.mergeRowGone;
      if (text.includes("ist kein Entwurf")) return de.admin.publishNotADraft;
      return null;
    },
  );
}

/* =========================================================================
 * CAT-07 — die Basisfigur
 *
 * ZWEI EBENEN, NICHT EINE. `setFigureCharacter` unten ordnet eine FAMILIE
 * zu — denselben Charakter serienübergreifend. Die beiden hier ordnen eine
 * BASISFIGUR zu: eine konkrete Katalogzeile derselben Serie, deren Variante
 * die Figur ist. `Elite Boomer` und `Boomer` sind derselbe Charakter und
 * keine Variante voneinander; nur zwei Ebenen können das unterscheiden.
 * ====================================================================== */

/**
 * Die Basisfigur einer Figur setzen, ändern — oder mit `null` lösen.
 *
 * SIE GILT FÜR JEDE FIGUR, nicht nur für Entwürfe (CAT-07): eine Zuordnung
 * wird falsch, wird nachgeholt, wird zurückgenommen, und das muss an einer
 * längst veröffentlichten Figur genauso gehen.
 *
 * DIE FAMILIE KOMMT MIT, ABER NIE GEGEN EINE VORHANDENE. `0159` übernimmt
 * sie aus der Basisfigur, wenn die Variante keine hat; widersprechen sich
 * beide, bricht es ab und nennt beide. `erzeugeFamilie` legt nur dann eine
 * neue an, wenn WEDER Variante NOCH Basisfigur eine haben — und nur, wenn
 * der Bediener es ausdrücklich bestätigt hat.
 */
export async function setVariantBase(
  skyId: string,
  baseSkyId: string | null,
  erzeugeFamilie = false,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (baseSkyId !== null && !SKY_ID.test(baseSkyId)) {
    return { ok: false, message: de.admin.baseUnknown };
  }
  if (baseSkyId === skyId) return { ok: false, message: de.admin.baseSelf };
  return call(
    "admin_set_variant_base",
    { p_sky_id: skyId, p_base_sky_id: baseSkyId, p_create_family: erzeugeFamilie },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
    baseFehler,
  );
}

/**
 * Weg B — den Entwurf als Variante einer Basisfigur veröffentlichen.
 *
 * ZUORDNEN UND VERÖFFENTLICHEN IN EINER TRANSAKTION (`0159`). Eine
 * veröffentlichte Variante ohne Basisfigur stünde sichtbar an der falschen
 * Stelle im Katalog; eine zugeordnete unveröffentlichte wäre ein halber
 * Vorgang. Von der Basisfigur wird **kein Feld** abgeschrieben — der
 * Entwurf behält Namen, Bild, Edition, SKY-ID und Slug.
 */
export async function publishDraftWithBase(
  skyId: string,
  baseSkyId: string,
  erzeugeFamilie = false,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!SKY_ID.test(baseSkyId)) return { ok: false, message: de.admin.baseUnknown };
  if (baseSkyId === skyId) return { ok: false, message: de.admin.baseSelf };
  return call(
    "admin_publish_with_base",
    { p_sky_id: skyId, p_base_sky_id: baseSkyId, p_create_family: erzeugeFamilie },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
    baseFehler,
  );
}

/**
 * Weg B ohne Frage an den Bediener (`0161`, CAT-08 Stufe 1).
 *
 * DER UNTERSCHIED ZU `publishDraftWithBase`: es gibt kein Kennzeichen mehr.
 * „Soll eine Familie angelegt werden?" ist keine fachliche Frage, sondern
 * eine Folge daraus, dass der Bediener eine Basisfigur gewählt hat — und die
 * Datenbank kann sie besser beantworten als ein Formular:
 *
 *   Basisfigur hat eine Familie  → sie wird übernommen
 *   nur die Variante hat eine    → sie bleibt, die Basisfigur unberührt
 *   keine von beiden             → die Familie mit dem NAMEN der Basisfigur
 *                                  wird gesucht, bestätigt und benutzt —
 *                                  oder angelegt
 *   verschiedene                 → Abbruch, nichts wird überschrieben
 *
 * `publishDraftWithBase` BLEIBT: `0159` ist unverändert gültig, und eine
 * Oberfläche, die beides kann, ist nicht das Problem — eine Datenbank mit
 * zwei Schreibwegen wäre es.
 */
export async function publishDraftVariantAuto(
  skyId: string,
  baseSkyId: string,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!SKY_ID.test(baseSkyId)) return { ok: false, message: de.admin.baseUnknown };
  if (baseSkyId === skyId) return { ok: false, message: de.admin.baseSelf };
  return call(
    "admin_publish_variant_auto",
    { p_sky_id: skyId, p_base_sky_id: baseSkyId },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
    baseFehler,
  );
}

/**
 * Den Marktwert setzen oder auf „Preis offen" zurücknehmen (`0162`, CAT-09).
 *
 * DER GESPEICHERTE WERT, NICHT DER ANGEZEIGTE. Der Katalog druckt
 * `market_price × (1 + Zuschlag)` — gerechnet im letzten Moment, nie
 * gespeichert (`src/lib/catalog/market-boost.ts`). Wer den gedruckten Betrag
 * zurückschreibt, hat den Zuschlag beim nächsten Lesen zweimal drin, und
 * zwar jedes Mal wieder. Diese Aktion nimmt deshalb den gespeicherten Wert,
 * und das Eingabefeld der Kachel ist mit ihm vorbelegt.
 *
 * `null` HEISST „PREIS OFFEN" UND NICHT NULL EURO (ADR-0010). Ein leeres
 * Feld schreibt `null`; eine 0 weist die Datenbank mit einem Satz ab.
 */
export async function setMarketPrice(
  skyId: string,
  price: number | null,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    return { ok: false, message: de.admin.priceNotAPrice };
  }
  return call(
    "admin_set_market_price",
    /* Auf zwei Stellen gerundet, weil die Spalte `numeric(10,2)` ist — und
       in Zehntelcents, damit `4,565` nicht zu `4,56` abgeschnitten wird. */
    { p_sky_id: skyId, p_price: price === null ? null : Math.round(price * 100) / 100 },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection", "/shop"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.priceNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("kein Preis")) return de.admin.priceNotAPrice;
      if (text.includes("zu gross")) return de.admin.priceTooBig;
      if (text.includes("gibt es nicht")) return de.admin.unknownFigure;
      return null;
    },
  );
}

/**
 * Eine Katalogzeile löschen, auf die nichts zeigt (`0162`, CAT-09).
 *
 * DIE PRÜFUNG STEHT IN DER DATENBANK, nicht hier. `admin_delete_figure`
 * zählt jeden Fremdschlüssel aus `pg_constraint`, nennt die vier
 * `ON DELETE CASCADE`-Schlüssel einzeln, fragt `order_lines.sky_id` — die
 * einzige SKY-ID-Spalte ohne Schlüssel — und bricht bei jeder Abhängigkeit
 * vollständig ab. Diese Funktion reicht die Meldung durch, weil sie den
 * GRUND trägt; sie nennt Tabellennamen und Zeilenzahlen, keine Käuferdaten.
 */
/**
 * DIE TYPMENGE EINER FIGUR (CAT-10, `0163`).
 *
 * Sie ERSETZT die Menge — das ist, was das Formular meint, wenn es Kästchen
 * schickt. Jeder unbekannte Wert wird hier schon abgewiesen, damit die
 * Meldung den Wert nennt und nicht die Constraint.
 *
 * SIE SCHREIBT KEINE KARTENKUNST. `card_type` ist eine eigene Eigenschaft
 * und hat ihren eigenen Weg (`setCardType`); ein Type ändert sie nicht.
 */
export async function setFigureTypes(
  skyId: string,
  types: readonly string[],
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (types.some((t) => !isCatalogType(t))) {
    return { ok: false, message: de.admin.typeUnknown };
  }
  return call(
    "admin_set_figure_types",
    { p_sky_id: skyId, p_types: asCatalogTypes(types) },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection", "/shop"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.typeNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("ist kein Type")) return de.admin.typeUnknown;
      if (text.includes("gibt es nicht")) return de.admin.unknownFigure;
      return null;
    },
  );
}

/**
 * WELCHER TYPE ALS BANNER ERSCHEINT (CAT-10, `0163`).
 *
 * `null` heißt „–" und ist eine **Entscheidung**: die Datenbank merkt sie in
 * `visible_type_decided`, damit der Prioritätsvorschlag sie nicht
 * überschreibt und sie nach einem Neuladen noch dasteht.
 *
 * SIE ÄNDERT DIE MENGE NICHT. Ein Type, der der Figur nicht zugeordnet ist,
 * wird abgewiesen — zuordnen geht im Bearbeiten-Dialog, und das ist die
 * Trennung, die das Dropdown auf der Kachel erst ungefährlich macht.
 */
export async function setVisibleType(
  skyId: string,
  type: string | null,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (type !== null && !isCatalogType(type)) {
    return { ok: false, message: de.admin.typeUnknown };
  }
  return call(
    "admin_set_visible_type",
    { p_sky_id: skyId, p_type: type },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection", "/shop"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.typeNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("nicht zugeordnet")) return de.admin.typeNotAssigned;
      if (text.includes("gibt es nicht")) return de.admin.unknownFigure;
      return null;
    },
  );
}

export async function deleteFigure(skyId: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_delete_figure",
    { p_sky_id: skyId },
    ["/admin/catalog", "/", "/collection", "/shop", "/zubehoer"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.deleteNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("Variante(n) als Basisfigur")) return de.admin.deleteBlockedBase;
      if (text.includes("Bestellzeile")) return de.admin.deleteBlockedOrder;
      if (text.includes("zeigen noch Daten")) {
        /* Der Grund ist die Liste der Tabellen — sie steht im Serversatz,
           und sie ist das Einzige, was dem Bediener weiterhilft. */
        const m = /zeigen noch Daten: ([^.]*)/.exec(text);
        return de.admin.deleteBlocked(m === null ? "" : m[1].trim());
      }
      if (text.includes("gibt es nicht")) return de.admin.unknownFigure;
      /* Der Fremdschlüssel als letzte Schicht — wenn jemand zwischen
         Prüfung und `delete` eine Zeile angelegt hat. */
      if (error.code === "23503") return de.admin.deleteRaced;
      return null;
    },
  );
}

/**
 * Die Abweisungen von `0159`, als Sätze.
 *
 * Eine Stelle für beide Aktionen: sie rufen dieselben Prüfungen auf, und
 * zwei Zuordner wären zwei Orte, an denen ein neuer `raise` vergessen wird.
 */
function baseFehler(error: { code?: string; message?: string }): string | null {
  if (istUnbekannteFunktion(error)) return de.admin.baseNotEnabled;
  if (error.code === "42501") return de.admin.mergeNotAdmin;
  const text = error.message ?? "";
  /*
   * DAS VETO AUS `0161` ZUERST. Es nennt im Meldungstext den Namen des
   * Mitglieds, das nicht passt — und diese Auskunft ist der ganze Zweck der
   * Meldung. Sie wird deshalb DURCHGEREICHT und nicht gegen einen allgemeinen
   * Satz getauscht; `0161` gibt dort nur Katalognamen aus, keine internen
   * Daten.
   */
  if (text.includes("nicht vereinbar")) {
    return de.admin.baseFamilyNotConfirmed(familienSatz(text));
  }
  if (text.includes("hat keinen Namen")) return de.admin.baseFamilyNoName;
  if (text.includes("DERSELBEN Serie") || text.includes("steht in Serie")) {
    return de.admin.baseWrongSeries;
  }
  if (text.includes("ist selbst eine Variante")) return de.admin.baseIsVariant;
  if (text.includes("zeigen schon Varianten") || text.includes("zeigen")) {
    return de.admin.baseHasVariants;
  }
  if (text.includes("Familie") && text.includes("klaeren")) return de.admin.baseFamilyConflict;
  if (text.includes("eigene Variante")) return de.admin.baseSelf;
  if (text.includes("braucht eine Basisfigur")) return de.admin.baseRequired;
  if (text.includes("ist kein Entwurf")) return de.admin.publishNotADraft;
  if (text.includes("gibt es nicht")) return de.admin.baseUnknown;
  return null;
}

/**
 * Aus der Servermeldung des Vetos den Teil holen, der dem Bediener hilft.
 *
 * `0161` schreibt: `es gibt schon eine Familie "Zook" (id 4), aber zu ihr
 * gehoert SKY-9133 "Cynder" — ein Name, der mit "Zook" nicht vereinbar ist.`
 * Gebraucht wird daraus die SKY-ID mit dem Namen; die interne `id` der
 * Familie gehört nicht in die Oberfläche.
 *
 * DIE REIHENFOLGE IST ABSICHT: `SKY-0149 Chop Chop`, nicht
 * `Chop Chop (SKY-0149)`. Die Klammerform ist im Projekt die Schreibweise
 * eines VARIANTENNAMENS und als Mechanismus abgeschafft (CAT-06); ein
 * Fehlertext, der sie nachbaut, wäre genau das Muster, das
 * `family-sort.test.ts` sucht — und ein Leser könnte ihn für einen
 * Figurennamen halten.
 */
function familienSatz(text: string): string {
  const m = /gehoert (SKY-\d{4}) "([^"]+)"/.exec(text);
  return m === null ? "" : `${m[1]} ${m[2]}`;
}

/**
 * Eine Figur einer Familie zuordnen — oder die Zuordnung entfernen (`null`).
 *
 * SIE GILT FÜR JEDE FIGUR, nicht nur für Entwürfe: eine Familienzuordnung
 * ist eine redaktionelle Korrektur und muss auch an einer längst
 * veröffentlichten Figur möglich sein (CAT-06 §7).
 *
 * `0158` schreibt dabei EINE Spalte. Angebote, Sammlungen, Lager, Favoriten
 * und Bestellungen hängen an der SKY-ID und bleiben unberührt; was sich
 * ändert, ist allein, womit die Figur zusammen angezeigt wird.
 */
export async function setFigureCharacter(
  skyId: string,
  characterId: number | null,
): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (characterId !== null
      && (!Number.isSafeInteger(characterId) || characterId <= 0)) {
    return { ok: false, message: de.admin.familyUnknown };
  }
  return call(
    "admin_set_character",
    { p_sky_id: skyId, p_character_id: characterId },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.familyNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("Familie mit der id")) return de.admin.familyUnknown;
      if (text.includes("gibt es nicht")) return de.admin.mergeRowGone;
      return null;
    },
  );
}

/**
 * Eine neue Figurenfamilie anlegen — nur der Name.
 *
 * Element, Spezies, Rolle und Beschreibung bleiben leer: das ist kuratierte
 * Arbeit und gehört in `data/characters/characters.json`, nicht in ein
 * Formular, das sie raten müsste. `0158` weist einen Namen ab, den es schon
 * gibt, und nennt die bestehende Familie — eine zweite „Spyro"-Familie wäre
 * genau die Art Fehler, nach der niemand sucht.
 */
export async function createCharacterFamily(name: string): Promise<AdminResult> {
  const sauber = name.trim();
  if (sauber === "") return { ok: false, message: de.admin.familyNameMissing };
  if (sauber.length > 120) return { ok: false, message: de.admin.familyNameLong };
  return call(
    "admin_create_character",
    { p_name: sauber },
    ["/admin/catalog"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.familyNotEnabled;
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      const text = error.message ?? "";
      if (text.includes("gibt es schon")) return de.admin.familyDuplicate;
      if (text.includes("braucht einen Namen")) return de.admin.familyNameMissing;
      if (text.includes("zu lang")) return de.admin.familyNameLong;
      return null;
    },
  );
}

/**
 * Einen importierten Entwurf verwerfen (CAT-05D).
 *
 * DIE EINZIGE STELLE IM PRODUKT, DIE EINEN KATALOGEINTRAG LÖSCHT. Der Import
 * deaktiviert sonst über `is_active` (`0001`), und das aus gutem Grund — an
 * einer SKY-ID hängen Sammlungen, Favoriten, Lager und Bestellungen.
 *
 * Die drei Riegel stehen in `0155` und nicht hier: Entwurf, `source = admin`,
 * keine Verweise. Diese Funktion macht daraus einen deutschen Satz.
 */
export async function discardDraft(skyId: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_discard_draft",
    { p_draft: skyId },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/"],
    "platform",
    (error) => {
      if (istUnbekannteFunktion(error)) return de.admin.mergeNotEnabled;
      const text = error.message ?? "";
      if (error.code === "42501") return de.admin.mergeNotAdmin;
      if (text.includes("zeigen noch Daten")) return de.admin.discardBlocked;
      if (text.includes("ist kein Entwurf")) return de.admin.discardNotDraft;
      if (text.includes("source=")) return de.admin.discardNotAdmin;
      /* CAT-05H — die beiden, die vorher in den Auffangtext fielen. */
      if (text.includes("stand schon einmal oeffentlich")) return de.admin.discardWasPublic;
      if (text.includes("gibt es nicht")) return de.admin.discardGone;
      if (text.includes("mehrspaltigen Fremdschluessel")) {
        return de.admin.mergeReferencesUnsupported;
      }
      return null;
    },
  );
}

/**
 * Der alte Zwei-Zustands-Weg, und er BLEIBT (CAT-02B).
 *
 * Nicht aus Nostalgie: Zubehör- und Betriebsflächen stellen weiterhin die
 * Frage „öffentlich oder nicht", und der Trigger aus `0152` setzt den Status
 * dabei mit. Eine Funktion zu entfernen, die noch aufgerufen wird, wäre eine
 * Änderung mit Reichweite.
 */
export async function setCatalogVisible(skyId: string, visible: boolean): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_set_catalog_visible",
    { p_sky_id: skyId, p_visible: visible },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

/**
 * Which base artwork a figure is printed on (V3.5).
 *
 * The value is validated in the database as well — `admin_set_card_type()`
 * refuses an unknown one before it reads the row, and the CHECK constraint
 * refuses it again. This guard is here so a typo comes back as a readable
 * refusal rather than as a generic write failure.
 *
 * Revalidates the catalogue and the collection, because the card is drawn on
 * both, and the figure's own admin page. Not the shop: a card type changes
 * no price, no offer and no availability.
 */
export async function setCardType(skyId: string, cardType: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCardType(cardType)) return { ok: false, message: de.admin.unknownCardType };
  return call(
    "admin_set_card_type",
    { p_sky_id: skyId, p_card_type: cardType },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

/** An empty string resets the override — the database turns it into NULL. */
export async function setDisplayNameOverride(skyId: string, value: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (value.length > 120) return { ok: false, message: de.admin.nameTooLong };
  return call(
    "admin_set_display_name_override",
    { p_sky_id: skyId, p_value: value },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

export async function setAdminNote(skyId: string, value: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (value.length > 2000) return { ok: false, message: de.admin.noteTooLong };
  // Internal only — no public path to revalidate.
  return call(
    "admin_set_admin_note",
    { p_sky_id: skyId, p_value: value },
    ["/admin/catalog", `/admin/catalog/${skyId}`],
    "platform",
  );
}

/**
 * The product group of a category (ADR-0041).
 *
 * An empty value clears the classification back to "not classified yet",
 * which is a real state: such a category stays visible under "Alle" and is
 * never filed under a group nobody chose.
 */
export async function setCatalogGroup(categoryId: number, group: string): Promise<AdminResult> {
  if (!Number.isInteger(categoryId)) return { ok: false, message: de.admin.unknownCategory };
  return call(
    "admin_set_catalog_group",
    { p_category_id: categoryId, p_group: group },
    ["/admin/catalog/categories", "/admin/catalog", "/", "/collection"],
    "platform",
  );
}

// --------------------------------------------------------------- inventory

/**
 * Books a stock movement.
 *
 * The only way stock changes. `quantity` is never assigned — the database
 * function updates it and writes the journal row in one transaction, and it
 * refuses a movement that would take a position below what is reserved
 * (ADR-0037). The position is created by the first movement, so nothing has
 * to be prepared for a figure that has never been stocked.
 *
 * `initial_import` is not among the reasons a browser may pick: that value
 * belonged to the legacy opening balance and is booked by server tooling
 * through a function no client role can execute.
 */
export async function bookMovement(input: {
  skyId: string;
  condition: string;
  delta: number;
  reason: string;
  unitCost?: number | null;
  note?: string | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  if (!isMovementReason(input.reason)) return { ok: false, message: de.inventory.unknownReason };
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    return { ok: false, message: de.inventory.deltaRequired };
  }
  if (input.unitCost !== undefined && input.unitCost !== null && !(input.unitCost > 0)) {
    return { ok: false, message: de.inventory.costPositive };
  }

  return call(
    "record_inventory_movement",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_delta: input.delta,
      p_reason: input.reason,
      p_unit_cost: input.unitCost ?? null,
      // Single currency by decision (ADR-0037, section 7). Stated where a
      // cost is stated, so a later second currency has a place to go.
      p_currency: input.unitCost === undefined || input.unitCost === null ? null : "EUR",
      p_note: input.note?.trim() ? input.note.trim() : null,
    },
    ["/business/inventory"],
    "seller",
  );
}

/**
 * Sets the manual price override and the listing together.
 *
 * `set_shop_listing` writes both plus the internal note in one upsert, so a
 * caller that means to change one has to pass the other two as they are.
 * That is why both editors read from the row they are editing rather than
 * from a form that only holds one field.
 *
 * `salePrice` is the **override** since ADR-0045: null means "no override,
 * use the automatic price", not "no price".
 *
 * `isListed` is the **release**, not "in stock" (ADR-0048). Releasing does
 * not require a price and never could sensibly: "sell this when possible" is
 * a decision somebody can make before a market price is known, and
 * `shop_offers()` simply leaves the position out until there is one. So this
 * function no longer refuses anything a price is missing for.
 *
 * It never touches quantity or reserved, and it never touches
 * `skylanders.market_price` — the reference price belongs to the catalog
 * (ADR-0033).
 */
export async function setListing(input: {
  skyId: string;
  condition: string;
  salePrice: number | null;
  isListed: boolean;
  note?: string | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  if (input.salePrice !== null && !(input.salePrice > 0)) {
    return { ok: false, message: de.inventory.pricePositive };
  }
  return call(
    "set_shop_listing",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_sale_price: input.salePrice,
      p_is_listed: input.isListed,
      p_note: input.note?.trim() ? input.note.trim() : null,
    },
    // The public catalog too: a release is what makes an offer appear on a
    // card, and the card is cached with the page.
    ["/business/inventory", "/", "/cart"],
    "seller",
  );
}

/**
 * Die Verkaufsfreigabe EINER Zubehörposition (`0139`, ADR-0129/0130).
 *
 * EIN EIGENER AUFRUF, nicht ein Feld in `setListing()`. Preis und Freigabe
 * zusammenzulegen hieße, irgendwann beim Preispflegen versehentlich
 * freizugeben — und eine Freigabe ist die Entscheidung, etwas öffentlich
 * zum Verkauf zu stellen.
 *
 * DIE BEDINGUNGEN PRÜFT DIE DATENBANK, nicht diese Funktion.
 * `seller_set_sale_release()` lehnt ab: eine Figur, eine unbekannte
 * Position, eine andere Beschaffenheit, ein Spiel ohne USK-Angabe, ein
 * Spiel mit USK 18, eine Position ohne Lieferumfang und eine ohne gültigen
 * Preis. Sie hier zu wiederholen hieße, dieselbe Regel zweimal zu pflegen;
 * die Oberfläche zeigt stattdessen den GRUND, den `seller_sale_state()`
 * liefert.
 *
 * Das Zurücknehmen geht immer — auch wenn Angaben fehlen.
 */
export async function setSaleRelease(input: {
  skyId: string;
  condition: string;
  released: boolean;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  return call(
    "seller_set_sale_release",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_released: input.released,
    },
    /* Dieselben Flächen wie bei `setListing()`: eine Freigabe lässt ein
       Angebot erscheinen oder verschwinden, und die Kacheln sind mit der
       Seite zwischengespeichert. Dazu der Zubehörkatalog. */
    ["/business/inventory", "/", "/zubehoer", "/shop", "/cart"],
    "seller",
  );
}

/**
 * Was bei einer Zubehörposition geliefert wird (`0139`, ADR-0130).
 *
 * `null` nimmt die Angabe zurück. Welcher Wert zu welcher Artikelart passt,
 * entscheidet die Datenbank — `disc_*` für Spiele, `portal_*` für Portale,
 * eine Figur wird abgelehnt. **Keine Kopplung an den Zustand:** ein Spiel
 * mit Originalhülle ist genauso verkäuflich wie eines ohne.
 */
export async function setDeliveryScope(input: {
  skyId: string;
  condition: string;
  scope: string | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  if (input.scope !== null && !isDeliveryScope(input.scope)) {
    return { ok: false, message: de.inventory.unknownDeliveryScope };
  }
  return call(
    "seller_set_delivery_scope",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_scope: input.scope,
    },
    ["/business/inventory", "/zubehoer", "/shop"],
    "seller",
  );
}

/**
 * Die USK-Alterskennzeichnung eines SPIELS (`0139`).
 *
 * PLATTFORMADMIN, nicht Betrieb: eine Altersfreigabe beschreibt das Produkt
 * und gilt für jedes Exemplar — sie ist Katalogdatum wie
 * `display_name_override` (ADR-0039, ADR-0077). `null` führt den Titel
 * wieder als „nicht erfasst".
 *
 * **Nie geraten.** Die Quelle ist die Hülle oder die USK-Titeldatenbank;
 * die Datenbank lehnt jeden Wert außer 0, 6, 12, 16, 18 ab und jede
 * Artikelart außer `game`.
 */
export async function setUskRating(input: {
  skyId: string;
  rating: number | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (input.rating !== null && !USK_RATINGS.includes(input.rating)) {
    return { ok: false, message: de.inventory.unknownUskRating };
  }
  return call(
    "admin_set_usk_rating",
    { p_sky_id: input.skyId, p_rating: input.rating },
    ["/business/inventory", "/zubehoer", "/shop"],
    "platform",
  );
}

/**
 * The shop-wide percentage of the market price (ADR-0045).
 *
 * One number, and changing it moves every automatic price at once — no batch
 * update, because no row stores an automatic price. Manual overrides are
 * untouched by construction: they are a different column.
 *
 * Revalidates the public surfaces as well as the admin ones, since every
 * automatic price on every card has just changed.
 */
export async function setShopPercentage(percentage: number): Promise<AdminResult> {
  if (!isValidPercentage(percentage)) {
    return { ok: false, message: de.admin.percentageRange };
  }
  return call(
    "admin_set_shop_percentage",
    { p_percentage: percentage },
    ["/admin", "/business/inventory", "/", "/cart"],
    "seller",
  );
}

/**
 * Points a figure at an uploaded image, or clears the override (ADR-0046).
 *
 * The upload itself happens in `lib/admin/images.ts`; this only records which
 * object the figure should use. `image_file` is never touched, so clearing
 * the override brings the imported picture back rather than leaving a gap.
 */
export async function setImageOverride(skyId: string, path: string | null): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (path !== null && !isOverridePath(path, skyId)) {
    return { ok: false, message: de.admin.imageFailed };
  }
  return call(
    "admin_set_image_override",
    { p_sky_id: skyId, p_path: path ?? "" },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/business/inventory", "/", "/collection"],
    "platform",
  );
}

/**
 * The operator's own facts (ADR-0059).
 *
 * A narrow writer for one group of facts, not a god-function that sets
 * everything: the legal block adds `setBusinessIdentity()` beside this one, so
 * each keeps its own validation instead of branching inside a shared body.
 *
 * `admin_set_seller_contact()` asks `is_shop_admin()` in the database. The
 * check here answers in German and saves a round trip; it is not the boundary.
 *
 * Takes no seller id and never will while SkyIsles has one seller: the
 * database addresses the ACTIVE seller, so no caller can name a second one
 * into existence (ADR-0064).
 */
/**
 * The seller's identity — who yulez.collectibles legally is (ADR-0075).
 *
 * Every field is optional and an empty string clears it, which is what the
 * database function means by NULL-leaves-alone. Nothing is validated beyond
 * being a string: a legal form, a register number and a Wirtschafts-ID have
 * no shape this code could check that would not eventually reject a real one.
 *
 * These values are **not** published anywhere yet. Legal V1 renders them; this
 * only records them, and a field left empty stays empty.
 */
export async function setSellerDetails(fields: {
  legalName?: string;
  tradingName?: string;
  legalForm?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  phone?: string;
  directContact?: string;
  registerCourt?: string;
  registerNumber?: string;
  vatId?: string;
  wId?: string;
}): Promise<AdminResult> {
  return call(
    "admin_set_seller_details",
    {
      p_legal_name: fields.legalName ?? null,
      p_trading_name: fields.tradingName ?? null,
      p_legal_form: fields.legalForm ?? null,
      p_street: fields.street ?? null,
      p_postal_code: fields.postalCode ?? null,
      p_city: fields.city ?? null,
      p_country_code: fields.countryCode ?? null,
      p_phone: fields.phone ?? null,
      p_direct_contact: fields.directContact ?? null,
      p_register_court: fields.registerCourt ?? null,
      p_register_number: fields.registerNumber ?? null,
      p_vat_id: fields.vatId ?? null,
      p_w_id: fields.wId ?? null,
    },
    ["/admin"],
    "seller",
  );
}

/**
 * The shop's contacts and policies, plus the PLATFORM support address.
 *
 * The PLATFORM's support address is deliberately absent. It used to ride along
 * because the two were edited on one screen — but a seller-guarded function
 * that writes `platform_settings` is a seller editing a platform setting, and
 * no amount of UI placement fixes that (ADR-0077). It has its own
 * administrator-guarded writer.
 *
 * Leaving the withdrawal or complaints address empty is meaningful: it means
 * "the seller's address", resolved with `coalesce` rather than copied, so it
 * keeps following that address when it changes.
 */
export async function setShopPolicies(fields: {
  contactEmail?: string;
  withdrawalContactEmail?: string;
  complaintsContactEmail?: string;
  smallBusiness19?: boolean;
  disputeParticipation?: boolean;
  disputeBody?: string;
  returnPostageBorneBy?: "customer" | "seller";
  dispatchStatement?: string;
  freeShippingThreshold?: number;
}): Promise<AdminResult> {
  for (const value of [fields.contactEmail, fields.withdrawalContactEmail,
                       fields.complaintsContactEmail]) {
    const trimmed = normaliseContact(value ?? "");
    if (trimmed !== null && !looksLikeEmail(trimmed)) {
      return { ok: false, message: de.admin.seller.invalidEmail };
    }
  }
  if (fields.freeShippingThreshold !== undefined &&
      (!Number.isFinite(fields.freeShippingThreshold) || fields.freeShippingThreshold < 0)) {
    return { ok: false, message: de.admin.writeFailed };
  }

  return call(
    "admin_set_shop_policies",
    {
      p_contact_email: fields.contactEmail ?? null,
      p_withdrawal_contact_email: fields.withdrawalContactEmail ?? null,
      p_complaints_contact_email: fields.complaintsContactEmail ?? null,
      p_small_business_19: fields.smallBusiness19 ?? null,
      p_dispute_participation: fields.disputeParticipation ?? null,
      p_dispute_body: fields.disputeBody ?? null,
      p_return_postage_borne_by: fields.returnPostageBorneBy ?? null,
      p_dispatch_statement: fields.dispatchStatement ?? null,
      p_free_shipping_threshold: fields.freeShippingThreshold ?? null,
    },
    // The threshold and the countries reach the checkout, so it re-reads too.
    ["/admin", "/checkout", "/cart"],
    "seller",
  );
}

/**
 * The SkyIsles support address — a PLATFORM setting (ADR-0077).
 *
 * Separate from `setShopPolicies()` because it is a different authority, not
 * merely a different field: `admin_set_platform_support()` asks
 * `is_platform_admin()`, so a seller operator is refused in the database
 * whatever screen the input happens to sit on.
 */
export async function setPlatformSupport(supportEmail: string): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };

  const trimmed = normaliseContact(supportEmail);
  if (trimmed !== null && !looksLikeEmail(trimmed)) {
    return { ok: false, message: de.admin.seller.invalidEmail };
  }
  return call("admin_set_platform_support", { p_support_email: supportEmail }, ["/admin"], "platform");
}

/**
 * The temporary catalog market-value boost (0094).
 *
 * A PLATFORM setting, so it takes the platform capability — a Business
 * operator is refused here and refused again in the database. It writes one
 * number that only the public catalog's DISPLAY reads: no price is
 * recomputed, no snapshot moves, and `admin_set_shop_percentage()` — the
 * seller's own percentage — is a different function for a different thing.
 *
 * Revalidates the surfaces that print a market value, so the new percentage
 * is on screen at the next request rather than after a cache expires.
 */
export async function setCatalogMarketBoost(percent: number): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
    return { ok: false, message: de.admin.platform.boostRange };
  }
  return call(
    "admin_set_catalog_market_boost",
    { p_percent: percent },
    ["/admin", "/", "/shop"],
    "platform",
  );
}

/** Enables or disables one delivery country. The server decides, always. */
export async function setShippingCountry(
  countryCode: string,
  label: string,
  enabled: boolean,
): Promise<AdminResult> {
  if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_shipping_country",
    {
      p_country_code: countryCode.trim().toUpperCase(),
      p_label: label.trim(),
      p_enabled: enabled,
    },
    ["/admin", "/checkout"],
    "seller",
  );
}

export async function setSellerContact(
  displayName: string,
  contactEmail: string,
  replyTo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const name = normaliseContact(displayName);
  const contact = normaliseContact(contactEmail);
  const reply = normaliseContact(replyTo);

  for (const value of [contact, reply]) {
    if (value !== null && !looksLikeEmail(value)) {
      return { ok: false, message: de.admin.seller.invalidEmail };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_seller_contact", {
    p_display_name: name,
    p_contact_email: contact,
    p_reply_to: reply,
  });
  if (error) return { ok: false, message: de.admin.seller.saveFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * The platform's own contact address.
 *
 * Deliberately a separate action from `setSellerContact()`: two subjects, two
 * narrow writers (ADR-0059). Neither can touch the other's field, which is a
 * property the runtime proof checks in both directions.
 */
export async function setPlatformContact(
  contactEmail: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };

  const contact = normaliseContact(contactEmail);
  if (contact !== null && !looksLikeEmail(contact)) {
    return { ok: false, message: de.admin.platform.invalidEmail };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_platform_contact", {
    p_contact_email: contact,
  });
  if (error) return { ok: false, message: de.admin.platform.saveFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/* ------------------------------------------------------- the commerce mode */

/**
 * Switches commerce between closed, sandbox and live.
 *
 * `admin_set_commerce_mode()` checks the role itself and refuses an unknown
 * value; this wrapper exists to answer in German and to revalidate the pages
 * whose content the switch changes — the admin dashboard and the checkout,
 * which stops offering a form the moment the mode closes.
 */
export async function setCommerceMode(mode: string): Promise<AdminResult> {
  if (!isCommerceMode(mode)) return { ok: false, message: de.admin.commerce.modeFailed };
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_commerce_mode", { p_mode: mode });
  if (error) return { ok: false, message: de.admin.commerce.modeFailed };

  revalidatePath("/admin");
  revalidatePath("/checkout");
  revalidatePath("/cart");
  return { ok: true };
}

/**
 * Grants or withdraws sandbox checkout for one account.
 *
 * The argument is a `user_id` and nothing else. An address never reaches this
 * function, because an address never authorises anything (ADR-0032) — the
 * search below is how an operator turns a person they know into an id.
 */
export async function setCommerceTester(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_commerce_tester", {
    p_user_id: userId,
    p_enabled: enabled,
    p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
  });
  if (error) return { ok: false, message: de.admin.writeFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Adds or removes a tester account (ADR-0071).
 *
 * The argument is a `user_id` and nothing else, for the same reason
 * `setCommerceTester()` takes one: an address never authorises anything
 * (ADR-0032). Removing takes the account's permissions with it by cascade and
 * touches nothing else about the account.
 */
export async function setTester(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_tester",
    {
      p_user_id: userId,
      p_enabled: enabled,
      p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    },
    ["/admin"],
    "platform",
  );
}

/**
 * Grants or revokes one tester permission (ADR-0071).
 *
 * The permission is not validated here beyond being a non-empty string: the
 * registry in the database decides what exists, and inventing a second list to
 * check against would be the drift this design removes. An unknown key comes
 * back refused, by name.
 */
export async function setTesterPermission(
  userId: string,
  permission: string,
  enabled: boolean,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  if (typeof permission !== "string" || permission === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_tester_permission",
    { p_user_id: userId, p_permission: permission, p_enabled: enabled },
    ["/admin", "/checkout", "/cart"],
    "platform",
  );
}

/**
 * Finds accounts by the beginning of a username or address.
 *
 * Read-only, and deliberately narrow: three characters minimum, ten results,
 * prefix matching. It is a lookup box for an operator who already knows who
 * they are looking for, not a directory to browse.
 */
/**
 * Grants or withdraws permission to operate the shop (ADR-0077).
 *
 * A PLATFORM act: `admin_set_seller_operator()` asks `is_platform_admin()`, so
 * a seller operator cannot add a second operator to its own shop. Granting the
 * shop does not grant the catalog, and holding the catalog does not grant the
 * shop — there is no inheritance in either direction.
 *
 * The argument is a `user_id`. An address may FIND the account (`findAccounts`)
 * but never authorises one, for the same reason `setTester()` takes an id.
 */
export async function setSellerOperator(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_seller_operator",
    {
      p_user_id: userId,
      p_enabled: enabled,
      p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    },
    ["/admin"],
    "platform",
    /*
     * `0051` refuses to withdraw the last shop grant from an account whose
     * username still contains a dot. That is a rule, not a failure, and the
     * administrator can act on it — so it gets its own sentence instead of
     * "could not be saved".
     */
    (error) =>
      error.message?.includes("seller_operators_username_guard")
        ? de.businessAccounts.revokeBlockedByUsername
        : null,
  );
}

export async function findAccounts(
  query: string,
): Promise<{ ok: true; matches: AccountMatch[] } | { ok: false; message: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed.length < MIN_ACCOUNT_QUERY) {
    return { ok: false, message: de.admin.commerce.searchTooShort };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_find_accounts", { p_query: trimmed });
  if (error) return { ok: false, message: de.admin.writeFailed };

  return { ok: true, matches: readAccountMatches(data) };
}

/**
 * Books the return movements for a sandbox order's stock.
 *
 * The correction path this schema has always had (ADR-0037): nothing is
 * edited and nothing is deleted, a new movement says what happened. The
 * database refuses any order that was not placed in sandbox, so this button
 * can never put a real customer's goods back on the shelf.
 */
export async function revertSandboxStock(orderNumber: string): Promise<AdminResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revert_sandbox_stock", {
    p_order_number: orderNumber,
  });
  if (error) return { ok: false, message: de.admin.commerce.revertStockFailed };

  revalidatePath("/admin");
  revalidatePath("/business/inventory");
  revalidatePath(`/business/orders/${orderNumber}`);
  return { ok: true };
}
