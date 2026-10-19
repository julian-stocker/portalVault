/**
 * Der Staging-Datenbankzugang — und die Riegel davor.
 *
 * PHASE A: AUSSCHLIESSLICH LESEND. Dieses Modul kennt keinen schreibenden
 * Modus, keine DDL, keinen Production-Pfad. Was es nicht kann, kann es nicht
 * aus Versehen.
 *
 * DIE RIEGEL, IN DER REIHENFOLGE, IN DER SIE GREIFEN
 *
 *   1. `pruefeVerbindung()` — bevor ein Treiber geladen wird: die
 *      Zeichenkette muss die Staging-Kennung tragen, die Production-Kennung
 *      darf NIRGENDS darin vorkommen, der Benutzer muss der lesende
 *      Pruefzugang sein, der Port der Session-Pooler.
 *   2. `STEMPEL_ABFRAGE` — die erste Anweisung der Sitzung. Antwortet die
 *      Datenbank nicht mit dem Staging-Stempel, wird die Verbindung
 *      geschlossen, bevor eine zweite Anweisung laeuft.
 *   3. `default_transaction_read_only` — an der ROLLE gesetzt (siehe
 *      `supabase/operations/staging-agent-setup.sql`). Ein Schreibversuch
 *      endet mit `25006 read-only transaction`, unabhaengig von Rechten und
 *      unabhaengig davon, welches Werkzeug ihn schickt. Prueft Riegel 4 nach.
 *   4. `pruefeSitzung()` — liest zurueck, dass die Sitzung wirklich
 *      schreibgeschuetzt ist und mit welcher Rolle sie laeuft.
 *
 * WARUM DIE PRODUCTION-KENNUNG EIN LITERAL IST
 *
 * `staging-guard.mts` leitet „was ist Production" aus `.env.local` ab. Das war
 * richtig, solange diese Datei existierte — sie verschwindet jetzt aus der
 * Arbeitsumgebung, und eine Verweigerung, die vom Vorhandensein einer Datei
 * abhaengt, ist keine. Deshalb steht die Kennung hier im Code.
 */
import { readFileSync } from "node:fs";

/** Die beiden Projekte, als Literal. Nicht aus einer Datei, nicht ableitbar. */
export const STAGING_REF = "qqxcpesbwfxzgytkdsac";
export const PRODUCTION_REF = "zmiwxswrpkmizvqsgype";

/** Die Rolle, mit der Phase A arbeitet. Mehr darf sie nicht sein. */
export const LESE_ROLLE = "skyisles_agent";

/** Der Stempel, den `staging-agent-setup.sql` auf die Datenbank schreibt. */
export const ERWARTETER_STEMPEL = `skyisles-staging ${STAGING_REF}`;

/** Die erste Anweisung jeder Sitzung. */
export const STEMPEL_ABFRAGE =
  "select shobj_description(d.oid, 'pg_database') as stempel, " +
  "current_user as rolle, " +
  "current_setting('transaction_read_only') as nur_lesend " +
  "from pg_database d where d.datname = current_database()";

/** Die Umgebungsvariable mit der Verbindung — gesetzt aus einer Datei AUSSERHALB des Repositorys. */
export const URL_VARIABLE = "SKYISLES_STAGING_DB_URL";

/* -------------------------------------------------------------------------
 * Riegel 1: die Verbindungszeichenkette
 * ---------------------------------------------------------------------- */

export type VerbindungsUrteil =
  | { ok: true; benutzer: string; host: string; port: string; sslmode: string }
  | { ok: false; grund: string };

/**
 * Darf diese Zeichenkette benutzt werden? Reine Funktion, damit jede
 * Verweigerung ohne Datenbank und ohne Prozessende pruefbar ist.
 *
 * ALLOWLIST, NICHT FILTER: was nicht nachweislich Staging ist, wird
 * abgelehnt — nicht erlaubt, weil nichts dagegen sprach.
 */
export function pruefeVerbindung(roh: string | undefined): VerbindungsUrteil {
  if (typeof roh !== "string" || roh.trim() === "") {
    return { ok: false, grund: `${URL_VARIABLE} ist nicht gesetzt.` };
  }
  const text = roh.trim();

  /* Die Production-Kennung zuerst, und ueber die GANZE Zeichenkette — egal
     ob sie im Host, im Benutzernamen, in einem Parameter oder in einem
     Kommentar steht. */
  if (text.toLowerCase().includes(PRODUCTION_REF)) {
    return {
      ok: false,
      grund: `die Verbindung nennt die Production-Kennung ${PRODUCTION_REF}. ` +
        "Dieses Werkzeug hat keinen Production-Modus.",
    };
  }

  /*
   * EIN `#` IM PASSWORT IST DIE GEFAEHRLICHSTE FORM — und sie wuerde den
   * Riegel sonst UNBEMERKT passieren.
   *
   * `new URL` behandelt alles ab dem `#` als Fragment: aus
   * `…:ge#heim@host:5432/postgres?sslmode=require` wird ein Passwort `ge`,
   * ein leerer Host und ein Fragment. Der Treiber dagegen (`pg`, ueber
   * `pg-connection-string`) scheitert mit `Invalid URL`. Zwei Leser, zwei
   * Ergebnisse — also wird der ROHTEXT geprueft, bevor irgendein Parser ihn
   * anfasst.
   */
  if (text.includes("#")) {
    return {
      ok: false,
      grund: "die Verbindung enthaelt ein `#`. Im Passwort muss es "
        + "prozentkodiert werden (# → %23), sonst lesen URL-Parser und "
        + "Treiber zwei verschiedene Zeichenketten.",
    };
  }
  if (/\s/.test(text)) {
    return { ok: false, grund: `${URL_VARIABLE} enthaelt Leerraum.` };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, grund: `${URL_VARIABLE} ist keine gueltige URL.` };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { ok: false, grund: `${url.protocol} ist kein PostgreSQL-Schema.` };
  }

  const benutzer = decodeURIComponent(url.username);
  const host = url.hostname.toLowerCase();
  const port = url.port === "" ? "5432" : url.port;
  const datenbank = url.pathname.replace(/^\//, "");

  /*
   * ZWEI ZUGELASSENE FORMEN, EXAKT — keine Teilstringsuche.
   *
   * Supabase bietet zwei Wege, und beide binden die Projektkennung IN den
   * Zugang. Genau das ist der Riegel; deshalb wird hier die ganze Form
   * geprueft und nicht, ob die Kennung irgendwo vorkommt:
   *
   *   Session-Pooler (empfohlen)
   *     Benutzer  skyisles_agent.<ref>        ← Supavisor liest `rolle.tenant`
   *     Host      aws-0-<region>.pooler.supabase.com
   *     Port      5432
   *
   *   direkte Verbindung
   *     Benutzer  skyisles_agent
   *     Host      db.<ref>.supabase.co
   *     Port      5432
   */
  const poolerBenutzer = `${LESE_ROLLE}.${STAGING_REF}`;
  const direktHost = `db.${STAGING_REF}.supabase.co`;
  const istPooler = host.endsWith(".pooler.supabase.com");
  const istDirekt = host === direktHost;

  if (!istPooler && !istDirekt) {
    return {
      ok: false,
      grund: `der Host "${host}" ist keiner der zwei zugelassenen: ` +
        `*.pooler.supabase.com (Session-Pooler) oder ${direktHost} (direkt).`,
    };
  }
  if (istPooler && benutzer.toLowerCase() !== poolerBenutzer) {
    return {
      ok: false,
      grund: `am Pooler muss der Benutzer "${poolerBenutzer}" lauten (Rolle, Punkt, ` +
        `Projektkennung) — da steht "${benutzer}". Ein Benutzer ohne die Kennung ` +
        "waehlt kein Projekt, und ein anderer Rollenname ist nicht Phase A.",
    };
  }
  if (istDirekt && benutzer.toLowerCase() !== LESE_ROLLE) {
    return {
      ok: false,
      grund: `bei direkter Verbindung muss der Benutzer "${LESE_ROLLE}" lauten — ` +
        `da steht "${benutzer}".`,
    };
  }

  /* Der Transaktions-Pooler (6543) gibt jeder Transaktion eine andere
     Serververbindung — der Stempel waere dann fuer die erste geprueft und
     fuer die naechste nicht mehr. */
  if (port !== "5432") {
    return {
      ok: false,
      grund: `Port ${port}: Phase A braucht den Session-Pooler auf 5432, ` +
        "nicht den Transaktions-Pooler auf 6543.",
    };
  }

  if (datenbank !== "postgres") {
    return {
      ok: false,
      grund: `die Datenbank ist "${datenbank}", erwartet wird "postgres".`,
    };
  }

  /*
   * TLS IST PFLICHT, UND SIE MUSS IN DER ZEICHENKETTE STEHEN.
   *
   * `pg` verbindet sich ohne `sslmode` UNVERSCHLUESSELT. Das Passwort dieser
   * Rolle ginge dann im Klartext ueber das Netz. Verlangt wird deshalb
   * `sslmode=require` (verschluesselt) oder `sslmode=verify-full`
   * (verschluesselt und Zertifikat geprueft).
   */
  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (sslmode !== "require" && sslmode !== "verify-full") {
    return {
      ok: false,
      grund: `sslmode fehlt oder ist "${sslmode}". An die Verbindung gehoert ` +
        "`?sslmode=require` — ohne ihn verbindet der Treiber unverschluesselt.",
    };
  }

  /*
   * UND DAS PASSWORT MUSS IN EINER URL STEHEN KOENNEN.
   *
   * Ein rohes `@`, `#`, `?`, `/` oder `:` im Passwort zerlegt die Zeichenkette
   * falsch: `new URL` schneidet am letzten `@`, und am Ende scheitert die
   * Anmeldung mit einer Meldung, die nichts davon sagt. Zugelassen sind
   * deshalb nur Zeichen, die in einer URL nichts bedeuten — oder eine
   * prozentkodierte Form.
   */
  if (url.password === "") {
    return { ok: false, grund: "in der Verbindung steht kein Passwort." };
  }
  if (!/^[A-Za-z0-9._~%-]+$/.test(url.password)) {
    return {
      ok: false,
      grund: "das Passwort enthaelt ein Zeichen, das in einer URL etwas bedeutet. " +
        "Entweder ein Passwort aus Buchstaben und Ziffern erzeugen oder die " +
        "Sonderzeichen prozentkodieren (@ → %40, : → %3A, / → %2F, # → %23).",
    };
  }

  return { ok: true, benutzer, host, port, sslmode };
}

/* -------------------------------------------------------------------------
 * Riegel 2 und 4: Stempel und Sitzung
 * ---------------------------------------------------------------------- */

export type StempelZeile = {
  stempel?: unknown;
  rolle?: unknown;
  nur_lesend?: unknown;
};

export type SitzungsUrteil =
  | { ok: true; rolle: string }
  | { ok: false; grund: string };

/**
 * Antwortet die Datenbank als Staging — und ist die Sitzung schreibgeschuetzt?
 *
 * Der fehlende Stempel ist der wichtige Fall: `null` heisst „diese Datenbank
 * wurde nie als Staging gestempelt", und das ist genau die Lage auf
 * Production.
 */
export function pruefeSitzung(zeile: StempelZeile | undefined): SitzungsUrteil {
  if (zeile === undefined) {
    return { ok: false, grund: "die Stempelabfrage hat keine Zeile geliefert." };
  }
  const stempel = typeof zeile.stempel === "string" ? zeile.stempel.trim() : null;
  if (stempel === null) {
    return {
      ok: false,
      grund: "diese Datenbank traegt keinen Umgebungsstempel. Production traegt " +
        "nie einen — Verbindung wird geschlossen.",
    };
  }
  if (stempel !== ERWARTETER_STEMPEL) {
    return {
      ok: false,
      grund: `der Umgebungsstempel lautet ${JSON.stringify(stempel)}, erwartet ` +
        `${JSON.stringify(ERWARTETER_STEMPEL)}.`,
    };
  }
  const rolle = typeof zeile.rolle === "string" ? zeile.rolle : "(unbekannt)";
  if (!rolle.startsWith(LESE_ROLLE)) {
    return {
      ok: false,
      grund: `die Sitzung laeuft als ${rolle}, erwartet ${LESE_ROLLE}.`,
    };
  }
  if (String(zeile.nur_lesend) !== "on") {
    return {
      ok: false,
      grund: "die Sitzung ist nicht schreibgeschuetzt (transaction_read_only " +
        `= ${JSON.stringify(String(zeile.nur_lesend))}). Erwartet wird die ` +
        "Rolleneinstellung default_transaction_read_only = on aus " +
        "staging-agent-setup.sql.",
    };
  }
  return { ok: true, rolle };
}

/* -------------------------------------------------------------------------
 * Riegel 5: nichts Geheimes in der Ausgabe
 * ---------------------------------------------------------------------- */

/**
 * Entfernt aus einem Text alles, was ein Geheimnis sein koennte.
 *
 * Gilt fuer JEDE Ausgabe: Bericht, Protokoll, Fehlermeldung. Treiberfehler
 * zitieren gern die Verbindungszeichenkette, und ein Protokoll, das einmal
 * ein Passwort enthielt, ist dauerhaft ein Geheimnis.
 */
export function redigiere(text: string): string {
  return text
    /* postgres://benutzer:passwort@host → Benutzer und Host bleiben lesbar,
       das Passwort verschwindet. */
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):[^@\s]*@/gi, "$1:***@")
    /* Eine ganze Verbindungszeichenkette ohne Passwortform. */
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***")
    /*
     * JSON Web Tokens — Anon- und Service-Role-Key haben diese Form.
     *
     * DIE SIGNATUR IST OPTIONAL, und das ist der Punkt. Ein echter
     * Supabase-Schluessel traegt 43 Zeichen Signatur — aber eine
     * Fehlermeldung kuerzt gern, und ein Token ohne (oder mit halber)
     * Signatur ist genauso ein Geheimnis: Kopf und Rumpf nennen Rolle und
     * Projekt. Die erste Fassung verlangte dreimal 10 Zeichen und liess
     * genau diesen Fall durch; aufgefallen ist es beim Entschaerfen des
     * Testwerts in `staging-access.test.ts`.
     *
     * Spezifisch bleibt es ueber die zwei ersten Segmente: `eyJ` plus zwei
     * Base64-Bloecke von je 10 Zeichen kommt in gewoehnlichem Text nicht vor.
     */
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*)?/g, "***JWT***")
    /* Supabase-Schluessel neuer Form. */
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, "***KEY***")
    /* Und was wie eine Passwortzuweisung aussieht. */
    .replace(/(password\s*[=:]\s*)('[^']*'|"[^"]*"|\S+)/gi, "$1***");
}

/* -------------------------------------------------------------------------
 * Der Zugang selbst
 * ---------------------------------------------------------------------- */

/** Eine Ergebniszeile, wie sie aus der Datenbank kommt. */
export type Zeile = Record<string, unknown>;

/**
 * Die kleinste Schnittstelle, die dieses Werkzeug braucht.
 *
 * Absichtlich klein: so kann der Test denselben Lauf gegen PGlite fahren wie
 * der Betrieb gegen Staging — ohne Zugangsdaten, ohne Netz, mit demselben
 * Code. Eine Automatisierung, deren Ablauf erst beim ersten echten Lauf
 * geprueft wird, ist keine.
 */
export type DbZugang = {
  /** Eine Anweisungsfolge als EINE Einreichung; je Ergebnismenge ein Array. */
  fuehre(sql: string): Promise<Zeile[][]>;
  schliesse(): Promise<void>;
};

/**
 * Verbindet sich mit Staging — nach Riegel 1, 2 und 4.
 *
 * Der Treiber wird erst geladen, wenn die Zeichenkette geprueft ist: fehlt
 * `pg`, ist das ein Fehler mit Anleitung, kein stilles Ueberspringen.
 */
export async function verbindeStaging(): Promise<DbZugang> {
  const urteil = pruefeVerbindung(process.env[URL_VARIABLE]);
  if (!urteil.ok) {
    throw new Error(`STAGING-RIEGEL: ${urteil.grund}`);
  }

  /*
   * DER TREIBER WIRD ERST HIER GELADEN — nach Riegel 1.
   *
   * Kein Modul, das eine Verbindung aufbauen kann, ist geladen, solange die
   * Zeichenkette nicht geprueft ist. Fehlt `pg`, ist das ein Fehler mit
   * Anleitung und kein stilles Ueberspringen — dieselbe Regel wie bei PGlite
   * in `validate-check-sql.mts`.
   */
  let Client: new (c: {
    connectionString: string;
    application_name: string;
  }) => {
    connect(): Promise<void>;
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
  try {
    ({ Client } = (await import("pg")) as never);
  } catch (e) {
    throw new Error(
      "der PostgreSQL-Treiber `pg` fehlt — ohne ihn gibt es keinen " +
      "Staging-Zugang.\n  Beheben:  npm i -D pg\n  Ursache: " +
      redigiere(e instanceof Error ? e.message : String(e)),
    );
  }

  /*
   * KEIN `ssl`-ARGUMENT HIER — UND DAS IST NACHGEMESSEN.
   *
   * Ein erster Entwurf uebergab `ssl: { rejectUnauthorized: … }`. Nachgesehen
   * in der installierten `pg`-Fassung: enthaelt die Zeichenkette ein
   * `sslmode=`, wird ein ausdrueckliches `ssl` IGNORIERT —
   * `client.connectionParameters.ssl` ist dann `{}`, gleich was uebergeben
   * wurde. Ein Parameter, der nichts tut, ist schlimmer als keiner: er
   * behauptet eine Einstellung, die nicht gilt.
   *
   * Also entscheidet die Zeichenkette, und Riegel 1 verlangt dort
   * `sslmode=require` oder `sslmode=verify-full`. Ohne `sslmode` verbindet
   * `pg` UNVERSCHLUESSELT — genau deshalb ist er Pflicht.
   */
  const client = new Client({
    connectionString: process.env[URL_VARIABLE] as string,
    application_name: "skyisles-phase-a",
  });
  await client.connect();

  const zugang: DbZugang = {
    async fuehre(sql: string): Promise<Zeile[][]> {
      const r = (await client.query(sql)) as { rows?: Zeile[] } | { rows: Zeile[] }[];
      return Array.isArray(r) ? r.map((x) => x.rows ?? []) : [r.rows ?? []];
    },
    async schliesse(): Promise<void> {
      await client.end();
    },
  };

  const stempel = (await zugang.fuehre(STEMPEL_ABFRAGE))[0]?.[0] as StempelZeile;
  const sitzung = pruefeSitzung(stempel);
  if (!sitzung.ok) {
    await zugang.schliesse();
    throw new Error(`STAGING-RIEGEL: ${sitzung.grund}`);
  }
  return zugang;
}

/** Liest `KEY=value`-Zeilen — fuer die Datei ausserhalb des Repositorys. */
export function ladeUmgebung(pfad: string): void {
  let text: string;
  try {
    text = readFileSync(pfad, "utf8");
  } catch {
    return;
  }
  for (const zeile of text.split("\n")) {
    const t = zeile.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let wert = t.slice(eq + 1).trim();
    if ((wert.startsWith('"') && wert.endsWith('"'))
        || (wert.startsWith("'") && wert.endsWith("'"))) wert = wert.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = wert;
  }
}
