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
 *   1b. `pruefeTlsUmgebung()` und `pruefeCa()` — TLS mit vollstaendiger
 *      Zertifikats- UND Hostnamenpruefung gegen eine ausdruecklich benannte
 *      CA. Siehe den Abschnitt „TLS" weiter unten.
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
 * ==========================================================================
 * TLS — WARUM DIE VERBINDUNG AUS FELDERN GEBAUT WIRD UND NICHT AUS DER
 * ZEICHENKETTE
 * ==========================================================================
 *
 * DER POOLER PRAESENTIERT EINE PRIVATE KETTE. Gemessen am 2026-10-25 gegen
 * `aws-1-eu-west-1.pooler.supabase.com:5432`:
 *
 *     *.pooler.supabase.com  ←  Supabase Intermediate 2021 CA
 *                            ←  Supabase Root 2021 CA   (selbstsigniert)
 *
 * Diese Wurzel steht in keinem oeffentlichen Vertrauensspeicher und auch
 * nicht in dem, den Node mitbringt. Deshalb — und nur deshalb — endete der
 * Handschlag mit `SELF_SIGNED_CERT_IN_CHAIN`. Das ist kein Fehler der
 * Gegenseite und keiner von Node: es fehlt die CA.
 *
 * `sslmode=require` IST IN DIESER `pg`-FASSUNG SCHON VOLLPRUEFUNG.
 * `pg-connection-string` (in `pg` 8.23.1) behandelt `prefer`, `require` und
 * `verify-ca` als Aliasse fuer `verify-full` und warnt davor, dass sich das
 * in `pg` v9 aendert — dann bekommen sie libpq-Semantik, und `require`
 * pruefte das Zertifikat NICHT MEHR. Eine Einstellung, die beim naechsten
 * Hauptversionssprung leiser wird, ist keine Einstellung.
 *
 * EIN `ssl`-ARGUMENT NEBEN EINER `connectionString` WIRD VERWORFEN — und das
 * ist nachgemessen, nicht erinnert:
 *
 *     new Client({ host, user, …, ssl: { ca } })          → ssl = { ca: … }
 *     new Client({ connectionString, ssl: { ca } })       → ssl = {}
 *
 * Ursache: `connection-parameters.js` macht
 * `Object.assign({}, config, parse(config.connectionString))` — die geparste
 * Zeichenkette gewinnt, und weil sie ein `sslmode` enthaelt, setzt der Parser
 * `config.ssl = {}` darueber.
 *
 * ALSO: DIE FELDER GEWINNEN. Verbunden wird mit `user`, `password`, `host`,
 * `port`, `database` aus GENAU DER Zerlegung, die Riegel 1 geprueft hat, plus
 * einem ausdruecklichen `ssl: { ca }`. Das hat drei Folgen, die alle besser
 * sind als vorher:
 *
 *   1. Die TLS-Haltung haengt nicht mehr an der Auslegung von `sslmode` —
 *      auch nicht an der kuenftigen.
 *   2. Riegel 1 prueft dieselbe Zerlegung, mit der verbunden wird. Vorher
 *      pruefte `new URL`, verband aber `pg-connection-string`; zwei Leser,
 *      und im `#`-Fall zwei Ergebnisse.
 *   3. `ca` ERSETZT den Standardspeicher. Vertraut wird genau dieser einen
 *      Wurzel — nicht ~150 oeffentlichen CAs, und `NODE_EXTRA_CA_CERTS`
 *      greift dabei nicht, weil der Standardspeicher gar nicht benutzt wird.
 *
 * DIE HOSTNAMENPRUEFUNG IST NICHT ABSCHALTBAR. `pg/lib/connection.js` setzt
 * `options.servername = host` NACH `Object.assign(options, self.ssl)` — ein
 * `servername` im `ssl`-Objekt wird also ueberschrieben, und geprueft wird
 * immer gegen den Host, zu dem wirklich verbunden wird. Nachgemessen: mit
 * `servername: "boeser.example.com"` lief der Handschlag trotzdem gegen den
 * echten Namen.
 *
 * WAS ES HIER NIE GEBEN WIRD: `rejectUnauthorized: false`,
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`, ein eigenes `checkServerIdentity`, eine
 * CA aus der Kette, die der Server selbst praesentiert hat (das waere
 * zirkulaer — ein Angreifer liefert seine eigene Wurzel mit).
 *
 * WARUM DIE PRODUCTION-KENNUNG EIN LITERAL IST
 *
 * `staging-guard.mts` leitet „was ist Production" aus `.env.local` ab. Das war
 * richtig, solange diese Datei existierte — sie verschwindet jetzt aus der
 * Arbeitsumgebung, und eine Verweigerung, die vom Vorhandensein einer Datei
 * abhaengt, ist keine. Deshalb steht die Kennung hier im Code.
 */
import { X509Certificate } from "node:crypto";
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
   * TLS: `sslmode=verify-full`, AUSGESCHRIEBEN UND NICHTS ANDERES.
   *
   * Verbunden wird mit diskreten Feldern und einem ausdruecklichen
   * `ssl: { ca }` (siehe Kopf), also entscheidet dieser Parameter die
   * TLS-Haltung nicht mehr — er ERKLAERT sie. Verlangt wird er trotzdem, und
   * zwar in der strengsten Form, aus drei Gruenden:
   *
   *   1. Er ist der Stolperdraht gegen eine Zeichenkette, die irgendwann auf
   *      etwas ohne TLS zeigt.
   *   2. Er haelt Datei und Verhalten deckungsgleich. Stuende dort `require`
   *      und liefe hier Vollpruefung, waere die Datei irrefuehrend — und in
   *      `pg` v9 bedeutet `require` libpq-Semantik, also KEINE
   *      Zertifikatspruefung.
   *   3. Faellt die Feldzerlegung je zurueck auf eine `connectionString`,
   *      ist die Haltung dieselbe statt stillschweigend schwaecher.
   */
  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
    return {
      ok: false,
      grund: `sslmode ist "${sslmode}". Verlangt wird ausgeschrieben `
        + "`?sslmode=verify-full`. In dieser `pg`-Fassung ist "
        + `"${sslmode}" noch ein Alias dafuer — ab pg v9 bekommt es `
        + "libpq-Semantik und pruefte das Zertifikat nicht mehr. Ein Wort "
        + "in der Zugangsdatei aendern:  sslmode=verify-full",
    };
  }
  if (sslmode !== "verify-full") {
    return {
      ok: false,
      grund: `sslmode fehlt oder ist "${sslmode}". An die Verbindung gehoert `
        + "`?sslmode=verify-full` — ohne `sslmode` verbindet der Treiber "
        + "unverschluesselt.",
    };
  }
  /*
   * `uselibpqcompat=true` ist genau der Schalter, der `require` und
   * `verify-ca` auf `rejectUnauthorized: false` zurueckdreht. Er hat hier
   * keinen Nutzen und ein Missbrauchspotenzial, also: nein.
   */
  if (url.searchParams.has("uselibpqcompat")) {
    return {
      ok: false,
      grund: "die Verbindung setzt `uselibpqcompat`. Dieser Schalter schwaecht "
        + "`require` und `verify-ca` zu „verschluesselt, aber ungeprueft\u201c. "
        + "Parameter entfernen.",
    };
  }
  /*
   * Ein `sslrootcert` in der Zeichenkette wuerde NICHT gelesen — verbunden
   * wird mit Feldern. Lieber verweigern als eine Einstellung dulden, die
   * nichts tut (dieselbe Regel wie beim verworfenen `ssl`-Argument).
   */
  if (url.searchParams.has("sslrootcert") || url.searchParams.has("sslcert")
      || url.searchParams.has("sslkey")) {
    return {
      ok: false,
      grund: "die Verbindung nennt `sslrootcert`/`sslcert`/`sslkey`. Diese "
        + "Parameter werden hier NICHT gelesen — die CA kommt aus "
        + `${CA_VARIABLE} bzw. ~/${CA_STANDARD}. Parameter entfernen, damit `
        + "die Datei nicht eine Einstellung behauptet, die nicht gilt.",
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
 * Riegel 1b: TLS — die CA und die Umgebung
 * ---------------------------------------------------------------------- */

/** Wo die CA liegt, wenn nichts anderes gesagt wird — AUSSERHALB des Repositorys. */
export const CA_VARIABLE = "SKYISLES_STAGING_DB_CA";
export const CA_STANDARD = ".skyisles/supabase-ca.crt";

/** Der tatsaechlich benutzte Pfad: ausdruecklich gesetzt, sonst der Standard. */
export function caPfad(umgebung: Record<string, string | undefined> = process.env): string {
  const gesetzt = (umgebung[CA_VARIABLE] ?? "").trim();
  if (gesetzt !== "") return gesetzt;
  return `${umgebung.HOME ?? ""}/${CA_STANDARD}`;
}

/**
 * Die einmalige Einrichtung, als Text — damit JEDE Verweigerung sie zeigt.
 *
 * Eine Fehlermeldung, die nur sagt was fehlt, laesst den Bediener suchen. Die
 * hier sagt, was zu tun ist.
 */
export function caAnleitung(pfad: string): string {
  return [
    "EINMALIGE EINRICHTUNG — die CA von Supabase holen:",
    "",
    "  1. Dashboard → Project Settings → Database → SSL Configuration",
    `     (Projekt ${STAGING_REF}) → \u201eDownload certificate\u201c`,
    "     Die Datei heisst `prod-ca-2021.crt`.",
    `  2. Ablegen als:  ${pfad}`,
    "     mkdir -p \"$(dirname \"<pfad>\")\" && chmod 600 <datei>",
    "  3. Gegenprobe: der Fingerabdruck der Wurzel muss lauten",
    `     ${ERWARTETE_WURZEL.fingerabdruck}`,
    `     (${ERWARTETE_WURZEL.subjekt})`,
    "",
    "WARUM AUS DEM DASHBOARD UND NICHT AUS DER VERBINDUNG. Die Kette, die der",
    "Server praesentiert, ist KEINE Vertrauensquelle: wer die Verbindung",
    "umlenkt, liefert seine eigene Wurzel mit. Der Download ist der",
    "unabhaengige Weg; der Fingerabdruck oben ist nur die Gegenprobe, dass",
    "beide dasselbe meinen.",
  ].join("\n");
}

/**
 * Die Wurzel, die dort erwartet wird — gemessen am 2026-10-25 aus der Kette
 * des Poolers.
 *
 * KEIN TRUST ANCHOR, SONDERN EINE GEGENPROBE. Vertraut wird der Datei, die
 * der Bediener aus dem Dashboard geholt hat; dieser Abdruck sagt ihm nur, ob
 * er dieselbe Wurzel vor sich hat. Deshalb blockiert eine Abweichung auch
 * nicht — sie wird gemeldet. Dreht Supabase die Wurzel, soll das ein Hinweis
 * sein und kein Stillstand.
 */
export const ERWARTETE_WURZEL = {
  subjekt: "CN=Supabase Root 2021 CA, O=Supabase Inc",
  /*
   * DREIFACH UNABHAENGIG GEMESSEN, und das war noetig.
   *
   * `openssl x509 -noout -subject -issuer -fingerprint -sha256 -dates -ext
   * basicConstraints` druckte fuer DIESE Datei einen ANDEREN 32-Byte-Wert als
   * derselbe Aufruf ohne `-dates -ext` (openssl 4.0.3). Der falsche Wert
   * stand hier schon einmal. Verlassen wird sich deshalb auf drei Wege, die
   * uebereinstimmen:
   *
   *   openssl x509 -outform der | shasum -a 256
   *   node: new X509Certificate(pem).fingerprint256
   *   openssl x509 -noout -fingerprint -sha256
   *
   * Nachrechnen geht am schnellsten so:
   *   openssl x509 -in <datei> -outform der | shasum -a 256
   */
  fingerabdruck:
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
} as const;

export type CaUrteil =
  | {
      ok: true;
      pfad: string;
      pem: string;
      subjekt: string;
      fingerabdruck: string;
      gueltigBis: string;
      anzahl: number;
      /** Passt die Wurzel zu `ERWARTETE_WURZEL`? Nur Auskunft, kein Riegel. */
      erwartet: boolean;
    }
  | { ok: false; grund: string };

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/**
 * Taugt diese Datei als Vertrauensanker?
 *
 * Geprueft wird die EIGNUNG, nicht die Identitaet: lesbar, PEM, parsbar,
 * mindestens ein Zertifikat mit `CA:TRUE`, und nicht abgelaufen. Ein
 * abgelaufener Anker erzeugt sonst einen Handschlagfehler, der nach einem
 * Problem der Gegenseite aussieht.
 *
 * `lese` ist einsetzbar, damit jede Verweigerung ohne Datei pruefbar ist.
 */
export function pruefeCa(
  pfad: string,
  lese: (p: string) => string = (x) => readFileSync(x, "utf8"),
  jetzt: Date = new Date(),
): CaUrteil {
  if (pfad.trim() === "" || pfad.startsWith("/") === false) {
    return {
      ok: false,
      grund: `der CA-Pfad ${JSON.stringify(pfad)} ist nicht absolut. `
        + `Entweder ${CA_VARIABLE} absolut setzen oder HOME setzen.\n\n${caAnleitung(pfad)}`,
    };
  }
  let text: string;
  try {
    text = lese(pfad);
  } catch {
    return {
      ok: false,
      grund: `die CA-Datei ${pfad} ist nicht lesbar.\n\n${caAnleitung(pfad)}`,
    };
  }
  const bloecke = text.match(PEM) ?? [];
  if (bloecke.length === 0) {
    return {
      ok: false,
      grund: `${pfad} enthaelt kein PEM-Zertifikat (\`-----BEGIN CERTIFICATE-----\`). `
        + "Eine DER-Datei muss erst umgewandelt werden:\n"
        + `  openssl x509 -inform der -in <datei> -out ${pfad}\n\n${caAnleitung(pfad)}`,
    };
  }

  let wurzel: X509Certificate | null = null;
  for (const block of bloecke) {
    let zert: X509Certificate;
    try {
      zert = new X509Certificate(block);
    } catch (e) {
      return {
        ok: false,
        grund: `${pfad} enthaelt einen PEM-Block, der kein Zertifikat ist: `
          + `${e instanceof Error ? e.message : String(e)}`,
      };
    }
    /* Die erste CA gewinnt. Eine Bundle-Datei darf auch Zwischenzertifikate
       enthalten — gebraucht wird mindestens ein Anker. */
    if (zert.ca && wurzel === null) wurzel = zert;
  }
  if (wurzel === null) {
    return {
      ok: false,
      grund: `${pfad} enthaelt ${bloecke.length} Zertifikat(e), aber keines mit `
        + "`CA:TRUE`. Das sieht nach einem Server- statt einem CA-Zertifikat aus.\n\n"
        + caAnleitung(pfad),
    };
  }
  const bis = new Date(wurzel.validTo);
  if (!Number.isNaN(bis.getTime()) && bis.getTime() < jetzt.getTime()) {
    return {
      ok: false,
      grund: `die CA in ${pfad} ist am ${wurzel.validTo} abgelaufen. `
        + "Eine abgelaufene Wurzel laesst den Handschlag scheitern, als waere die "
        + `Gegenseite das Problem.\n\n${caAnleitung(pfad)}`,
    };
  }

  return {
    ok: true,
    pfad,
    pem: text,
    subjekt: wurzel.subject.split("\n").reverse().join(", "),
    fingerabdruck: wurzel.fingerprint256,
    gueltigBis: wurzel.validTo,
    anzahl: bloecke.length,
    erwartet: wurzel.fingerprint256 === ERWARTETE_WURZEL.fingerabdruck,
  };
}

/**
 * Hat jemand die Pruefung global abgeschaltet?
 *
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` wirkt prozessweit und schlaegt jede
 * Einstellung in diesem Modul. Dagegen hilft kein sorgfaeltiges `ssl`-Objekt,
 * nur eine Verweigerung.
 */
export function pruefeTlsUmgebung(
  umgebung: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; grund: string } {
  const wert = (umgebung.NODE_TLS_REJECT_UNAUTHORIZED ?? "").trim();
  if (wert === "0" || wert.toLowerCase() === "false") {
    return {
      ok: false,
      grund: "NODE_TLS_REJECT_UNAUTHORIZED ist auf "
        + `${JSON.stringify(wert)} gesetzt. Das schaltet die `
        + "Zertifikatspruefung fuer den GANZEN Prozess ab und schlaegt jede "
        + "Einstellung hier. Variable entfernen, nicht umgehen.",
    };
  }
  return { ok: true };
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
  /** Eine Zeile ueber die benutzte TLS-Haltung — fuer die Ausgabe des Aufrufers. */
  tls: string;
};

/**
 * Die Verbindungsfelder aus der GEPRUEFTEN Zeichenkette.
 *
 * WARUM DAS PASSWORT NICHT IM URTEIL STEHT. `pruefeVerbindung()` gibt
 * Benutzer, Host, Port und `sslmode` zurueck, damit ein Aufrufer sie
 * ausgeben kann — das Passwort gehoert in keine Rueckgabe, die irgendwo
 * gedruckt oder protokolliert werden koennte. Es wird hier geholt, direkt
 * vor dem Verbinden, und nirgends sonst.
 *
 * Diese Funktion setzt voraus, dass `pruefeVerbindung()` schon `ok` gesagt
 * hat; sie prueft nichts nach.
 */
export function verbindungsFelder(roh: string): {
  user: string; password: string; host: string; port: number; database: string;
} {
  const url = new URL(roh.trim());
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database: url.pathname.replace(/^\//, ""),
  };
}

/**
 * Einen Verbindungsfehler in eine Auskunft verwandeln, die weiterhilft.
 *
 * Die Treibermeldung allein nennt die Ursache nicht: „self-signed
 * certificate in certificate chain" klingt nach einem Fehler der Gegenseite
 * und ist in Wahrheit eine fehlende CA auf DIESEM Rechner. Genau daran hat
 * der erste Lauf des Migrations-Runners am 2026-10-25 gescheitert.
 */
export function erklaereVerbindungsfehler(e: unknown, ca: string): string {
  const fehler = e as { code?: unknown; message?: unknown };
  const code = typeof fehler.code === "string" ? fehler.code : "";
  const text = redigiere(
    typeof fehler.message === "string" ? fehler.message : String(e),
  );

  const tls: Record<string, string> = {
    SELF_SIGNED_CERT_IN_CHAIN:
      "Die Kette des Poolers wurzelt in einer PRIVATEN CA von Supabase, und "
      + "die steht in keinem oeffentlichen Vertrauensspeicher. Es fehlt also "
      + "die CA-Datei — nicht die Verschluesselung.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      "Die CA-Datei passt nicht zur Kette: wahrscheinlich nur das "
      + "Zwischenzertifikat statt der Wurzel, oder die Wurzel eines anderen "
      + "Anbieters.",
    DEPTH_ZERO_SELF_SIGNED_CERT:
      "Der Server praesentiert ein einzelnes selbstsigniertes Zertifikat. "
      + "Pruefe, ob die Verbindung wirklich auf den Supabase-Pooler zeigt.",
    CERT_HAS_EXPIRED:
      "Ein Zertifikat der Kette ist abgelaufen — pruefe zuerst das Datum "
      + "dieses Rechners, dann die CA-Datei.",
    ERR_TLS_CERT_ALTNAME_INVALID:
      "Das Zertifikat gilt nicht fuer diesen Hostnamen. Die Hostnamenpruefung "
      + "hat gegriffen — sie wird NICHT abgeschaltet. Pruefe den Host in der "
      + "Zugangsdatei.",
  };

  if (code in tls) {
    return `TLS: ${text}\n\n  ${tls[code]}\n\n  Benutzte CA-Datei: ${ca}\n\n`
      + caAnleitung(ca).split("\n").map((z) => `  ${z}`).join("\n");
  }

  /*
   * 28P01 ist KEIN TLS-Fehler, sondern der Beweis, dass TLS steht: ohne
   * Handschlag kommt es nie zur Anmeldung. Deshalb wird es ausdruecklich
   * unterschieden — sonst sucht man den Fehler weiter im Zertifikat.
   */
  if (code === "28P01") {
    return `ANMELDUNG abgelehnt (28P01): ${text}\n\n`
      + "  TLS steht — bis zur Anmeldung kommt es nur nach einem gelungenen\n"
      + "  Handschlag. Es ist das Passwort in der Zugangsdatei.\n"
      + `  Neu setzen: Dashboard → Database → Roles → ${LESE_ROLLE}, oder\n`
      + "  per SQL `alter role skyisles_agent with password '…'`, und dann in\n"
      + "  die Zugangsdatei eintragen (Sonderzeichen prozentkodieren).";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `NETZ: ${text}\n\n  Der Host ist nicht aufloesbar.`;
  }
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    return `NETZ: ${text}\n\n  Keine Verbindung zum Session-Pooler auf 5432.`;
  }
  return code === "" ? text : `${code}: ${text}`;
}

/**
 * Verbindet sich mit Staging — nach Riegel 1, 1b, 2 und 4.
 *
 * Der Treiber wird erst geladen, wenn Zeichenkette UND TLS-Lage geprueft
 * sind: fehlt `pg`, ist das ein Fehler mit Anleitung, kein stilles
 * Ueberspringen.
 */
export async function verbindeStaging(): Promise<DbZugang> {
  const urteil = pruefeVerbindung(process.env[URL_VARIABLE]);
  if (!urteil.ok) {
    throw new Error(`STAGING-RIEGEL: ${urteil.grund}`);
  }

  /* Riegel 1b: TLS. Beides VOR dem Laden des Treibers — ein Modul, das
     verbinden kann, wird erst geladen, wenn auch die TLS-Lage geklaert ist. */
  const umgebung = pruefeTlsUmgebung();
  if (!umgebung.ok) {
    throw new Error(`STAGING-RIEGEL: ${umgebung.grund}`);
  }
  const ca = pruefeCa(caPfad());
  if (!ca.ok) {
    throw new Error(`STAGING-RIEGEL (TLS): ${ca.grund}`);
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
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
    application_name: string;
    ssl: { ca: string };
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
   * DISKRETE FELDER UND EIN AUSDRUECKLICHES `ssl` — und das ist nachgemessen.
   *
   * Mit einer `connectionString` daneben wuerde dieses `ssl` VERWORFEN
   * (`connectionParameters.ssl` waere `{}`); ohne sie gilt es. Die
   * Begruendung in voller Laenge steht im Kopf dieser Datei, Abschnitt
   * „TLS". Die Felder kommen aus derselben Zerlegung, die Riegel 1 geprueft
   * hat — damit pruefen und verbinden nicht zwei verschiedene Leser.
   *
   * `ca` ersetzt den Standardspeicher: vertraut wird genau dieser Wurzel.
   * `rejectUnauthorized` bleibt bei seinem Standard `true`, und
   * `checkServerIdentity` bei Nodes eigener Pruefung — `pg` bindet sie an den
   * Host, zu dem wirklich verbunden wird.
   */
  const client = new Client({
    ...verbindungsFelder(process.env[URL_VARIABLE] as string),
    application_name: "skyisles-phase-a",
    ssl: { ca: ca.pem },
  });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`STAGING-ZUGANG: ${erklaereVerbindungsfehler(e, ca.pfad)}`);
  }

  const zugang: DbZugang = {
    /* Was tatsaechlich gilt, nicht was in der Datei steht. */
    tls: `verify-full gegen ${ca.subjekt}`
      + ` (${ca.fingerabdruck.slice(0, 17)}…${ca.erwartet ? "" : ", UNERWARTETE Wurzel"})`,
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
