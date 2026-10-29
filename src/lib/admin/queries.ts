/**
 * What the administration area reads.
 *
 * Separate from `lib/catalog/queries.ts` on purpose: the public catalog shows
 * what is active and visible, this one shows **everything**, including what
 * an administrator has hidden. Two different questions, two functions — a
 * shared one with a flag would be one `if` away from leaking hidden rows into
 * the public catalog.
 *
 * Nothing here is protected by being in this file. Every caller sits below
 * `(admin)/layout.tsx`, and the rows themselves are readable by anyone —
 * `skylanders` is a public table. What is *not* public is the editorial
 * columns' write path (migration 0004) and `admin_note`, which no public
 * projection selects.
 */
import { asCardType, type CardType } from "@/lib/catalog/card-type";
import { isCollectibleCategory } from "@/lib/catalog/collectible";
import { articleClass, type ArticleClass } from "@/lib/catalog/article-class";
import { isCatalogGroup, type CatalogGroup } from "@/lib/catalog/group";
import { createClient } from "@/lib/supabase/server";
import { statusFromVisibility, type CatalogStatus } from "@/lib/catalog/catalog-status";
import { fetchCatalogStatuses } from "@/lib/catalog/queries";

export type AdminFigure = {
  skyId: string;
  /** The imported name. Read-only everywhere in the admin area. */
  canonicalName: string;
  /** What the public sees: the override, or the imported name. */
  publicName: string;
  displayNameOverride: string | null;
  slug: string;
  seriesCode: string;
  seriesLabel: string;
  categoryId: number;
  categoryName: string;
  catalogGroup: CatalogGroup | null;
  imageFile: string | null;
  /** An administrator's uploaded picture, or null (ADR-0046). */
  imageOverridePath: string | null;
  isActive: boolean;
  catalogVisible: boolean;
  /**
   * Which base artwork the figure is printed on (V3.5) — die KARTENKUNST.
   *
   * Seit CAT-10 heisst sie in der Oberflaeche auch so. Sie ist NICHT die
   * Typmenge darunter: eine Ableitung der einen aus der anderen haette eine
   * Kartenkunst veraendert (gemessen, `cat10_projection_proof.sql`).
   */
  cardType: CardType;
  /** Die vollstaendige Typmenge (CAT-10, `0163`). Leer heisst „Standard". */
  types: readonly string[];
  /** Der EINE Type, der als Banner erscheint — oder `null` (`0163`). */
  visibleType: string | null;
  /** Hat ein Mensch ueber das Banner entschieden? (`0163`) */
  visibleTypeDecided: boolean;
  /**
   * Die Figurenfamilie, oder `null` (CAT-06).
   *
   * `skylanders.character_id` ist das einzige verbindliche Familienmodell
   * (`0002`). Die Detailseite zeigt sie und lässt sie korrigieren; sie ist
   * unabhängig von Name, Serie, Kategorie, Edition und SKY-ID.
   */
  characterId: number | null;
  /**
   * Die Basisfigur, deren Variante diese Figur ist — oder `null` (CAT-07).
   *
   * Eine andere Frage als `characterId`: die Familie verbindet denselben
   * Charakter serienübergreifend, die Basisfigur ist eine konkrete Zeile
   * DERSELBEN Serie.
   */
  baseSkyId: string | null;
};

type Row = {
  sky_id: string;
  name: string;
  slug: string;
  character_id?: number | null;
  base_sky_id?: string | null;
  series_code: string;
  category_id: number;
  image_file: string | null;
  image_override_path: string | null;
  is_active: boolean;
  catalog_visible: boolean;
  display_name_override: string | null;
  card_type: string;
  types?: string[] | null;
  visible_type?: string | null;
  visible_type_decided?: boolean | null;
};

/**
 * No `admin_note` here, and that is the point.
 *
 * The note lives in `catalog_editorial`, a table of its own, because
 * `skylanders` is world-readable and a table grant covers every column it
 * will ever have (ADR-0039). Selecting it from here would be selecting it
 * from a public row.
 */
const ADMIN_COLUMNS =
  "sky_id, name, slug, series_code, category_id, image_file, image_override_path, is_active, catalog_visible, display_name_override, card_type, character_id, base_sky_id, types, visible_type, visible_type_decided";

type Lookups = {
  series: Map<string, string>;
  categories: Map<number, { name: string; group: CatalogGroup | null }>;
};

async function lookups(): Promise<Lookups> {
  const supabase = await createClient();
  const [series, categories] = await Promise.all([
    supabase.from("series").select("code, label"),
    supabase.from("categories").select("id, name, catalog_group"),
  ]);
  if (series.error) throw new Error(`series: ${series.error.message}`);
  if (categories.error) throw new Error(`categories: ${categories.error.message}`);

  return {
    series: new Map((series.data ?? []).map((row) => [row.code as string, row.label as string])),
    categories: new Map(
      (categories.data ?? []).map((row) => [
        row.id as number,
        {
          name: row.name as string,
          group: isCatalogGroup(row.catalog_group) ? row.catalog_group : null,
        },
      ]),
    ),
  };
}

function toAdminFigure(row: Row, index: Lookups): AdminFigure {
  const category = index.categories.get(row.category_id);
  return {
    skyId: row.sky_id,
    canonicalName: row.name,
    publicName: row.display_name_override ?? row.name,
    displayNameOverride: row.display_name_override,
    slug: row.slug,
    seriesCode: row.series_code,
    seriesLabel: index.series.get(row.series_code) ?? row.series_code,
    categoryId: row.category_id,
    categoryName: category?.name ?? "",
    catalogGroup: category?.group ?? null,
    imageFile: row.image_file,
    imageOverridePath: row.image_override_path,
    isActive: row.is_active,
    catalogVisible: row.catalog_visible,
    cardType: asCardType(row.card_type),
    types: row.types ?? [],
    visibleType: row.visible_type ?? null,
    visibleTypeDecided: row.visible_type_decided ?? false,
    characterId: row.character_id === null || row.character_id === undefined
      ? null : Number(row.character_id),
    baseSkyId: row.base_sky_id ?? null,
  };
}

/**
 * The internal note for one figure, or null.
 *
 * A separate read from a separate table. It succeeds only for an
 * administrator: `catalog_editorial` holds no privilege for `anon` and its
 * policy asks `is_shop_admin()` for everyone else. A non-admin gets an empty
 * result rather than an error, which is the right shape for a page that
 * nobody but an admin can open anyway.
 */
export async function fetchAdminNote(skyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_editorial")
    .select("admin_note")
    .eq("sky_id", skyId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.admin_note as string | null) ?? null;
}

/**
 * Wer zeigt noch auf diesen Entwurf? (CAT-05)
 *
 * Ruft `admin_merge_references()` aus `0154`. Die Funktion leitet die
 * verweisenden Tabellen aus `pg_catalog` her — eine getippte Liste wäre beim
 * fünfzehnten Fremdschlüssel still falsch.
 *
 * **Ein Fehler ist hier nicht „keine Referenzen".** Käme bei einem
 * Verbindungsfehler eine leere Liste zurück, böte die Oberfläche eine
 * Zusammenführung an, die die Datenbank gleich darauf verweigert — oder
 * schlimmer, der Bediener hielte den Entwurf für unbenutzt. `null` heißt
 * deshalb „nicht feststellbar", und die Oberfläche sagt das.
 */
export type MergeReferenz = { tabelle: string; spalte: string; zeilen: number };

/**
 * DREI ANTWORTEN, NICHT ZWEI.
 *
 * `nicht_freigeschaltet` ist der Zustand, solange `0154` nirgends angewendet
 * ist: PostgREST kennt die Funktion dann nicht (`PGRST202`). Das ist etwas
 * anderes als ein Fehler und etwas ganz anderes als „keine Referenzen" — und
 * die Oberfläche muss es anders sagen, sonst täuscht sie eine funktionierende
 * Zusammenführung vor.
 */
export type MergeReferenzstand =
  | { art: "ok"; referenzen: MergeReferenz[] }
  | { art: "nicht_freigeschaltet" }
  | { art: "fehler" };

/** Kennt die Datenbank diese Funktion überhaupt? */
export function istUnbekannteFunktion(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202"
    || (error.message ?? "").includes("Could not find the function");
}

export async function fetchMergeReferences(skyId: string): Promise<MergeReferenzstand> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_merge_references", { p_sky_id: skyId });
  if (error) {
    return istUnbekannteFunktion(error) ? { art: "nicht_freigeschaltet" } : { art: "fehler" };
  }
  if (!Array.isArray(data)) return { art: "fehler" };
  return {
    art: "ok",
    referenzen: (data as Record<string, unknown>[]).map((r) => ({
      tabelle: String(r.tabelle), spalte: String(r.spalte), zeilen: Number(r.zeilen),
    })),
  };
}

/**
 * Der Bestand, so schmal wie der Dublettenvorschlag ihn braucht.
 *
 * Entwürfe bleiben draußen: ein Entwurf kann nicht das Ziel einer
 * Zusammenführung sein (`0154` weist das ab), und er wäre als Vorschlag nur
 * verwirrend.
 */
export type MergeBestandszeile = {
  skyId: string;
  /**
   * Der ANZEIGENAME — `display_name_override ?? name`. Danach wird gesucht
   * und verglichen, denn das ist der Name, den der Bediener kennt.
   */
  name: string;
  /**
   * Die Spalte `name`, ROH.
   *
   * WARUM BEIDES. Die Zusammenführung vergleicht Spalte gegen Spalte: `0156`
   * rechnet mit `skylanders.name`, und eine Vorschau, die stattdessen den
   * Anzeigenamen zeigt, nennt bei jeder Figur mit Anzeigenamen einen anderen
   * Ausgangswert als der Server. Seit CAT-05F ist das kein Schönheitsfehler
   * mehr, sondern ein Abbruch: der Server bricht ab, wenn die angezeigten
   * Werte nicht die seinen sind — richtigerweise.
   */
  nameRaw: string;
  seriesCode: string; categoryName: string;
  cardType: string; catalogStatus: string; imageOverridePath: string | null;
  imageFile: string | null; categoryId: number; itemType: string;
  displayNameOverride: string | null; characterId: number | null;
};

export async function fetchMergeBestand(): Promise<MergeBestandszeile[]> {
  const supabase = await createClient();
  const [figuren, kategorien, status] = await Promise.all([
    supabase.from("skylanders")
      /* EIN LITERAL, nicht zusammengesetzt: supabase-js leitet den Zeilentyp
         aus der Zeichenkette ab, und eine gerechnete degradiert zu
         `GenericStringError` (derselbe Stolperstein wie in CAT-02B). */
      .select("sky_id, name, display_name_override, series_code, category_id, card_type, item_type, character_id, image_file, image_override_path, catalog_visible")
      .order("sky_id").limit(5000),
    supabase.from("categories").select("id, name"),
    fetchCatalogStatuses(),
  ]);
  if (figuren.error || !figuren.data) return [];
  const katName = new Map<number, string>();
  for (const c of (kategorien.data ?? []) as Record<string, unknown>[]) {
    katName.set(Number(c.id), String(c.name));
  }
  return (figuren.data as Record<string, unknown>[]).map((r) => ({
    skyId: String(r.sky_id),
    name: String(r.display_name_override ?? r.name),
    nameRaw: String(r.name),
    displayNameOverride: (r.display_name_override as string | null) ?? null,
    seriesCode: String(r.series_code),
    categoryId: Number(r.category_id),
    categoryName: katName.get(Number(r.category_id)) ?? "",
    cardType: String(r.card_type),
    itemType: String(r.item_type ?? "figure"),
    characterId: r.character_id === null ? null : Number(r.character_id),
    imageFile: (r.image_file as string | null) ?? null,
    imageOverridePath: (r.image_override_path as string | null) ?? null,
    catalogStatus: status.get(String(r.sky_id))
      ?? statusFromVisibility(Boolean(r.catalog_visible)),
  }));
}

/**
 * Alle internen Notizen, als Zuordnung.
 *
 * WARUM ALLE UND NICHT EINE JE ZEILE: die Gegenüberstellung muss den
 * BESTEHENDEN Wert zeigen, auch wenn der Bediener das Ziel über die Suche
 * wählt. Eine Notiz nachzuladen wäre ein zweiter Weg; eine fehlende als „—"
 * anzuzeigen wäre falsch. Die Tabelle ist klein — sie trägt nur Zeilen, die
 * wirklich eine Notiz haben.
 *
 * Sie bleibt intern: `catalog_editorial` ist nicht weltlesbar, und diese
 * Abfrage läuft im Adminbereich (ADR-0039).
 */
export async function fetchAdminNotes(): Promise<Record<string, string | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_editorial")
    .select("sky_id, admin_note")
    .limit(5000);
  if (error || !data) return {};
  const aus: Record<string, string | null> = {};
  for (const r of data as Record<string, unknown>[]) {
    aus[String(r.sky_id)] = (r.admin_note as string | null) ?? null;
  }
  return aus;
}

export type AdminCatalogPage = {
  figures: AdminFigure[];
  /** Rows matching the filter, not rows on this page. */
  total: number;
};

export const ADMIN_PAGE_SIZE = 50;

/**
 * One page of the catalog, unfiltered by visibility.
 *
 * Paginated on the server. The public catalog ships all 561 figures to the
 * browser because it filters and searches there (ADR-0026); an editing table
 * has no such need, and 561 rows of form controls would be a slow page for
 * no gain.
 */
export async function fetchAdminCatalog(options: {
  page?: number;
  series?: string;
  query?: string;
  hiddenOnly?: boolean;
  /**
   * Der Statusfilter der Adminliste (CAT-02B).
   *
   * SERVERSEITIG, und das ist keine Stilfrage: die Liste ist seitenweise
   * geladen, und ein Filter, der erst nach dem Blättern greift, filtert einen
   * Ausschnitt statt den Bestand. `öffentlich` braucht die neue Spalte nicht
   * — `catalog_visible` sagt es bereits —, `versteckt` und `entwurf`
   * brauchen sie, und vor Migration `0152` gibt es keine Entwürfe, nach
   * denen man filtern könnte.
   */
  status?: CatalogStatus;
}): Promise<AdminCatalogPage> {
  const supabase = await createClient();
  const index = await lookups();
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * ADMIN_PAGE_SIZE;

  let query = supabase
    .from("skylanders")
    .select(ADMIN_COLUMNS, { count: "exact" })
    .order("sky_id")
    .range(from, from + ADMIN_PAGE_SIZE - 1);

  if (options.series) query = query.eq("series_code", options.series);
  if (options.hiddenOnly) query = query.eq("catalog_visible", false);
  if (options.status === "public") {
    query = query.eq("catalog_visible", true);
  } else if (options.status === "hidden" || options.status === "draft") {
    /* Beides ist nicht öffentlich; die Spalte unterscheidet die Absicht. */
    query = query.eq("catalog_visible", false).eq("catalog_status", options.status);
  }
  if (options.query && options.query.trim() !== "") {
    const term = options.query.trim();
    // Name or SKY-ID. `%` and `,` would break the filter syntax, so they go.
    const safe = term.replace(/[%,()]/g, "");
    if (safe !== "") {
      query = query.or(
        `name.ilike.%${safe}%,sky_id.ilike.%${safe}%,display_name_override.ilike.%${safe}%`,
      );
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`admin catalog: ${error.message}`);

  return {
    figures: ((data ?? []) as unknown as Row[]).map((row) => toAdminFigure(row, index)),
    total: count ?? 0,
  };
}

/** One figure, whatever its visibility. Null when the SKY-ID is unknown. */
export async function fetchAdminFigure(skyId: string): Promise<AdminFigure | null> {
  const supabase = await createClient();
  const [index, result] = await Promise.all([
    lookups(),
    supabase.from("skylanders").select(ADMIN_COLUMNS).eq("sky_id", skyId).maybeSingle(),
  ]);
  if (result.error) throw new Error(`admin figure: ${result.error.message}`);
  if (!result.data) return null;
  return toAdminFigure(result.data as unknown as Row, index);
}

export type AdminCategory = {
  id: number;
  seriesCode: string;
  seriesLabel: string;
  name: string;
  catalogGroup: CatalogGroup | null;
  /** Active collectibles in this category — the size of the decision. */
  figures: number;
};

/** The twenty categories, with how much each one classifies. */
export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const index = await lookups();
  const [categories, figures] = await Promise.all([
    supabase.from("categories").select("id, series_code, name, position").order("series_code"),
    supabase.from("skylanders").select("category_id").eq("is_active", true),
  ]);
  if (categories.error) throw new Error(`categories: ${categories.error.message}`);
  if (figures.error) throw new Error(`category counts: ${figures.error.message}`);

  const counts = new Map<number, number>();
  for (const row of figures.data ?? []) {
    const id = row.category_id as number;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (categories.data ?? [])
    // Software has no product group and never will (ADR-0029). Listing the
    // six 'Spiele' rows as "not classified yet" would ask for a decision
    // that has already been made.
    .filter((row) => isCollectibleCategory(row.name as string))
    .map((row) => ({
    id: row.id as number,
    seriesCode: row.series_code as string,
    seriesLabel: index.series.get(row.series_code as string) ?? (row.series_code as string),
    name: row.name as string,
    catalogGroup: index.categories.get(row.id as number)?.group ?? null,
    figures: counts.get(row.id as number) ?? 0,
  }));
}

/**
 * The two controlled lists the create dialog offers (V3.9).
 *
 * WHY NOT `fetchAdminCategories()`
 *
 * That one answers a different question — "which categories still need a
 * product group" — and drops the software categories on the way, because
 * software has no group and never will (ADR-0029). A create dialog must be
 * able to offer every category that exists, including `Spiele`: refusing to
 * let an administrator file a game would be a rule nobody decided.
 *
 * Both lists come ordered the way the catalogue orders them, so the dropdowns
 * read like the catalogue rather than like the database.
 */
export type FigureFormOptions = {
  series: { code: string; label: string }[];
  categories: { id: number; seriesCode: string; name: string; catalogGroup: CatalogGroup | null }[];
};

export async function fetchFigureFormOptions(): Promise<FigureFormOptions> {
  const supabase = await createClient();
  const [series, categories] = await Promise.all([
    supabase.from("series").select("code, label, position").order("position"),
    supabase
      .from("categories")
      .select("id, series_code, name, position, catalog_group")
      .order("series_code")
      .order("position"),
  ]);
  if (series.error) throw new Error(`series: ${series.error.message}`);
  if (categories.error) throw new Error(`categories: ${categories.error.message}`);

  return {
    series: (series.data ?? []).map((row) => ({
      code: row.code as string,
      label: row.label as string,
    })),
    categories: (categories.data ?? []).map((row) => ({
      id: row.id as number,
      seriesCode: row.series_code as string,
      name: row.name as string,
      catalogGroup: isCatalogGroup(row.catalog_group) ? row.catalog_group : null,
    })),
  };
}

export type CatalogChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

/** The editorial history of one figure, newest first. */
export async function fetchCatalogChanges(skyId: string): Promise<CatalogChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_catalog_changes", {
    p_entity: "skylander",
    p_entity_id: skyId,
    p_limit: 20,
  });
  // The journal is a convenience on a detail page, not the page's purpose.
  // A failure here must not take the editor down with it.
  if (error) return [];
  return ((data ?? []) as { field: string; old_value: string | null; new_value: string | null; changed_at: string }[]).map(
    (row) => ({
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedAt: row.changed_at,
    }),
  );
}


/* =========================================================================
 * CAT-06 — die Figurenfamilien, wie der Adminbereich sie braucht
 * ====================================================================== */

export type Familienzeile = {
  id: number;
  name: string;
  /** Wie viele Katalogzeilen auf sie zeigen. */
  mitglieder: number;
  /** Bis zu drei Mitgliedernamen, zur Wiedererkennung. */
  beispiele: string[];
  /** Die Serien, in denen Mitglieder liegen — eine Familie darf mehrere haben. */
  serien: string[];
};

/**
 * Alle Familien mit Mitgliederzahl, Beispielnamen und Serien.
 *
 * ZWEI ABFRAGEN UND NICHT EINE JE FAMILIE: `characters` hat zwanzig Zeilen
 * und `skylanders` siebenhundert — beides vollständig zu lesen ist billiger
 * als ein Join mit Aggregat über PostgREST, und die Zuordnung hier im
 * Speicher ist nachlesbar.
 *
 * `characters` ist weltlesbar (`0002`), `skylanders` ebenso. Es werden
 * ausschliesslich öffentliche Produktangaben gelesen — kein `admin_note`,
 * keine Preise, keine Bestände.
 */
export async function fetchFamilies(): Promise<Familienzeile[]> {
  const supabase = await createClient();
  const [familien, figuren] = await Promise.all([
    supabase.from("characters").select("id, canonical_name").limit(5000),
    supabase.from("skylanders")
      .select("sky_id, name, series_code, character_id, card_type")
      .not("character_id", "is", null).limit(5000),
  ]);
  if (familien.error || !familien.data) return [];

  const mitglieder = new Map<number, { namen: string[]; serien: Set<string> }>();
  for (const r of (figuren.data ?? []) as Record<string, unknown>[]) {
    const id = Number(r.character_id);
    const eintrag = mitglieder.get(id) ?? { namen: [], serien: new Set<string>() };
    eintrag.namen.push(String(r.name));
    eintrag.serien.add(String(r.series_code));
    mitglieder.set(id, eintrag);
  }

  return (familien.data as Record<string, unknown>[]).map((c) => {
    const id = Number(c.id);
    const m = mitglieder.get(id);
    return {
      id,
      name: String(c.canonical_name),
      mitglieder: m?.namen.length ?? 0,
      /* Alphabetisch, damit die Beispiele nicht bei jedem Aufruf andere sind. */
      beispiele: [...(m?.namen ?? [])].sort((a, b) => a.localeCompare(b, "de")).slice(0, 3),
      serien: [...(m?.serien ?? [])].sort(),
    };
  });
}


/* =========================================================================
 * CAT-07 — die Basisfiguren, aus denen eine Variante wählen darf
 * ====================================================================== */

export type Basiszeile = {
  skyId: string;
  name: string;
  /**
   * Der Name, wie er in der Datenbank steht — ohne `display_name_override`.
   *
   * ZWEI GRÜNDE, UND BEIDE ZÄHLEN. Erstens rangiert
   * `src/lib/admin/base-figure-rank.ts` damit: der Entwurf heisst „White
   * Flocked LightCore Prism Break", und die Verwandtschaft steht im ROHEN
   * Namen, nicht im redaktionellen Anzeigenamen. Zweitens benennt `0161`
   * eine neue Familie nach `skylanders.name` der Basisfigur — der Dialog
   * muss ankündigen, was wirklich entsteht.
   */
  nameRaw: string;
  seriesCode: string;
  categoryName: string;
  cardType: string;
  catalogStatus: string;
  /** Wie viele Varianten schon auf sie zeigen — nur zur Anzeige. */
  varianten: number;
  /** Ihre Familie, falls kuratiert — sie würde übernommen. */
  characterId: number | null;
};

/**
 * Die möglichen Basisfiguren für eine Figur, plus ihre Serie.
 *
 * DIE VIER FILTER STEHEN HIER UND NICHT IM BROWSER: dieselbe Serie, keine
 * Varianten, keine Entwürfe, nicht sie selbst. `0159` erzwingt die ersten
 * beiden ohnehin in der Datenbank — hier werden sie erst gar nicht
 * angeboten, damit der Bediener keine Auswahl trifft, die danach abgewiesen
 * wird.
 *
 * `serie === null` heisst: die Figur selbst gibt es nicht.
 */
export async function fetchBaseFigures(
  skyId: string,
): Promise<{ serie: string | null; entwurfName: string | null;
             art: ArticleClass | null; kandidaten: Basiszeile[] }> {
  const supabase = await createClient();

  const eigene = await supabase.from("skylanders")
    .select("sky_id, name, series_code, category_id, item_type")
    .eq("sky_id", skyId).maybeSingle();
  if (eigene.error || !eigene.data) {
    return { serie: null, entwurfName: null, art: null, kandidaten: [] };
  }
  const ich = eigene.data as Record<string, unknown>;
  const serie = String(ich.series_code);
  /* ROH, nicht der Anzeigename: der Rang vergleicht Artikelnamen. */
  const entwurfName = String(ich.name);

  const [zeilen, kategorien, status] = await Promise.all([
    supabase.from("skylanders")
      /* EIN LITERAL, nicht zusammengesetzt — supabase-js leitet den Zeilentyp
         aus der Zeichenkette ab (derselbe Stolperstein wie in CAT-02B). */
      .select("sky_id, name, display_name_override, series_code, category_id, card_type, character_id, base_sky_id, catalog_visible, item_type")
      .eq("series_code", serie).eq("is_active", true).limit(5000),
    supabase.from("categories").select("id, name"),
    fetchCatalogStatuses(),
  ]);
  if (zeilen.error || !zeilen.data) {
    return { serie, entwurfName, art: null, kandidaten: [] };
  }

  const katName = new Map<number, string>();
  for (const c of (kategorien.data ?? []) as Record<string, unknown>[]) {
    katName.set(Number(c.id), String(c.name));
  }

  /*
   * DIE ART DES ENTWURFS. Sie steht erst hier fest, weil sie den
   * Kategorienamen braucht — und `null` ist ein Ergebnis: eine Zeile in
   * einer Kategorie, die `article-class.ts` nicht kennt, bekommt KEINE
   * Kandidaten. Lieber eine leere Liste mit einer Meldung als eine
   * willkürliche (Anforderung 7).
   */
  const eigeneArt = articleClass({
    categoryName: katName.get(Number(ich.category_id)) ?? "",
    itemType: ich.item_type === undefined || ich.item_type === null
      ? null : String(ich.item_type),
  });

  const alle = (zeilen.data as Record<string, unknown>[]);
  /* Wie viele Varianten je Basisfigur — aus derselben Abfrage, kein zweiter
     Weg. */
  const variantenZu = new Map<string, number>();
  for (const r of alle) {
    const b = r.base_sky_id === null ? null : String(r.base_sky_id);
    if (b !== null) variantenZu.set(b, (variantenZu.get(b) ?? 0) + 1);
  }

  const kandidaten = alle
    .filter((r) => {
      if (String(r.sky_id) === skyId) return false;              /* nicht sie selbst */
      if (r.base_sky_id !== null) return false;                  /* keine Varianten */
      /*
       * DIESELBE ARTIKELART — der Filter, der bis zum 2026-10-29 gefehlt
       * hat. Ohne ihn standen `Portale` ganz oben in der Liste einer Figur.
       *
       * UND ER IST NICHT „NUR CHARAKTERE". Das war mein erster Versuch, und
       * er war falsch: ein Trap, ein Fahrzeug, ein Kreationskristall kann
       * ebenfalls eine Variante haben — 30 der Entwürfe sind genau das. Ein
       * Charakterfilter hätte ihnen jede Basis genommen. Gefragt wird
       * deshalb: gehört der Kandidat zur SELBEN ART wie der Entwurf?
       *
       * Figur → Figur · Trap → Trap · Fahrzeug → Fahrzeug · Kristall →
       * Kristall. Die Entscheidung liegt in
       * `src/lib/catalog/article-class.ts`, und sie kommt aus `item_type`
       * und der Kategorie — nie aus dem Namen. „LightCore Prism Break",
       * „Legendary Spyro" und „Dark Cynder" sind eigenständige
       * Katalogzeilen und dürfen Basis sein; ihre Edition steht im
       * `card_type` und entscheidet hier nichts (Anforderung 6 und 10).
       */
      if (eigeneArt === null) return false;
      if (articleClass({
        categoryName: katName.get(Number(r.category_id)) ?? "",
        itemType: r.item_type === undefined || r.item_type === null
          ? null : String(r.item_type),
      }) !== eigeneArt) return false;
      const st = status.get(String(r.sky_id))
        ?? statusFromVisibility(Boolean(r.catalog_visible));
      return st !== "draft";                                     /* keine Entwürfe */
    })
    .map((r) => ({
      skyId: String(r.sky_id),
      name: String(r.display_name_override ?? r.name),
      nameRaw: String(r.name),
      seriesCode: String(r.series_code),
      categoryName: katName.get(Number(r.category_id)) ?? "",
      cardType: String(r.card_type),
      catalogStatus: status.get(String(r.sky_id))
        ?? statusFromVisibility(Boolean(r.catalog_visible)),
      varianten: variantenZu.get(String(r.sky_id)) ?? 0,
      characterId: r.character_id === null ? null : Number(r.character_id),
    }));

  return { serie, entwurfName, art: eigeneArt, kandidaten };
}
