import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CA_STANDARD, CA_VARIABLE, ERWARTETE_WURZEL, caAnleitung, caPfad,
  erklaereVerbindungsfehler, pruefeCa, pruefeTlsUmgebung, pruefeVerbindung,
  verbindungsFelder,
  VERSUCHS_AKTE, VERSUCHS_AKTE_KOPF, anmeldeAuskunft, darfErneutVersuchen,
  herkunftDerAblehnung, versuchsNotiz,
} from "@/../tools/lib/staging-db.mts";

/**
 * TLS AUF DEM STAGING-PRUEFZUGANG.
 *
 * DER ANLASS. Am 2026-10-25 scheiterte `npm run db:migrate:staging -- 0146
 * --resume` mit `self-signed certificate in certificate chain`. Gemessen
 * gegen `aws-1-eu-west-1.pooler.supabase.com:5432`: der Pooler praesentiert
 *
 *     *.pooler.supabase.com  ←  Supabase Intermediate 2021 CA
 *                            ←  Supabase Root 2021 CA   (selbstsigniert)
 *
 * Diese Wurzel steht in keinem oeffentlichen Vertrauensspeicher. Es fehlte
 * also die CA — nicht die Verschluesselung, und nichts war „kaputt".
 *
 * WAS DIESE DATEI PRUEFT. Die Entscheidungen davor und danach: welche
 * Zeichenkette zugelassen wird, welche Datei als Vertrauensanker taugt, was
 * eine Verweigerung sagt. Und zwei Zusagen UEBER DIE BIBLIOTHEK, weil sie
 * nachgemessen und nicht erinnert sein sollen.
 *
 * WAS SIE NICHT PRUEFEN KANN: einen Handschlag. Dass die Verbindung mit
 * echter CA zustande kommt, ist am 2026-10-25 gegen Staging gemessen worden
 * (Ergebnis: `28P01` — also TLS gelungen, Anmeldung abgelehnt) und steht in
 * `docs/SECURITY.md`.
 *
 * DIE FIXTURES unten sind einmal mit `openssl` erzeugte Wegwerf-Zertifikate.
 * Sie sind oeffentliche Zertifikate ohne Bedeutung; die privaten Schluessel
 * dazu sind verworfen und waren nie im Repository.
 */

const CA_TEST =
  ""
  + "-----BEGIN CERTIFICATE-----\n"
  + "MIIBlzCCATygAwIBAgIUCuR3Ew4mGK20GLBcxQm2vb3sN48wCgYIKoZIzj0EAwIw\n"
  + "MTEZMBcGA1UEAwwQU2t5SXNsZXMgVGVzdCBDQTEUMBIGA1UECgwLVGVzdGZpeHR1\n"
  + "cmUwHhcNMjYxMDI1MjAwMTUxWhcNMzYxMDIyMjAwMTUxWjAxMRkwFwYDVQQDDBBT\n"
  + "a3lJc2xlcyBUZXN0IENBMRQwEgYDVQQKDAtUZXN0Zml4dHVyZTBZMBMGByqGSM49\n"
  + "AgEGCCqGSM49AwEHA0IABPmtA01NuD3VxayItm9vlNE6cKDgjgL2eUxuwlGKGYVW\n"
  + "02rUU4nYmRgZT4kV10sH05FLuSt2zRDwlTw3EHKNh7ijMjAwMB0GA1UdDgQWBBRZ\n"
  + "JVemauojtrdRngxZscZ8aisbNDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMC\n"
  + "A0kAMEYCIQDdeQE6ltAtNe/xaHgpAtFu76DvuG4V+beUR4z3HHy9+gIhANZRTU2X\n"
  + "MFwiJb3P5GIx7X6sIsTkiV7g+tKacRRiW0oP\n"
  + "-----END CERTIFICATE-----\n";

const BLATT =
  ""
  + "-----BEGIN CERTIFICATE-----\n"
  + "MIIBWjCCAQGgAwIBAgIUCRPT4Xb7HtTywegBdTfJhZR1nQgwCgYIKoZIzj0EAwIw\n"
  + "MTEZMBcGA1UEAwwQU2t5SXNsZXMgVGVzdCBDQTEUMBIGA1UECgwLVGVzdGZpeHR1\n"
  + "cmUwHhcNMjYxMDI1MjAwMTUxWhcNMzYxMDIyMjAwMTUxWjAYMRYwFAYDVQQDDA1i\n"
  + "bGF0dC5leGFtcGxlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE15f3vDshxz2f\n"
  + "z8S7WT1dfnnNH8d7LIagPdx25jXYuZ97BadbDcDSSflJlEQ8ZGOJujvH2dyrkm1C\n"
  + "lu8umcqaJ6MQMA4wDAYDVR0TAQH/BAIwADAKBggqhkjOPQQDAgNHADBEAiBHEjw/\n"
  + "KSBlt2idVG3igd1dHmfepSNpeghMHWpl9bl5vgIgD2jbeITSGc354D9Ee2z7yfZ4\n"
  + "zXqz6VY0vVZh8xOqL08=\n"
  + "-----END CERTIFICATE-----\n";

const CA_ABGELAUFEN =
  ""
  + "-----BEGIN CERTIFICATE-----\n"
  + "MIIBnTCCAUKgAwIBAgIUEjfyhnDgL6THahsBNLM1FdbefD4wCgYIKoZIzj0EAwIw\n"
  + "NDEcMBoGA1UEAwwTU2t5SXNsZXMgRXhwaXJlZCBDQTEUMBIGA1UECgwLVGVzdGZp\n"
  + "eHR1cmUwHhcNMjAwMTAxMDAwMDAwWhcNMjEwMTAxMDAwMDAwWjA0MRwwGgYDVQQD\n"
  + "DBNTa3lJc2xlcyBFeHBpcmVkIENBMRQwEgYDVQQKDAtUZXN0Zml4dHVyZTBZMBMG\n"
  + "ByqGSM49AgEGCCqGSM49AwEHA0IABPmtA01NuD3VxayItm9vlNE6cKDgjgL2eUxu\n"
  + "wlGKGYVW02rUU4nYmRgZT4kV10sH05FLuSt2zRDwlTw3EHKNh7ijMjAwMB0GA1Ud\n"
  + "DgQWBBRZJVemauojtrdRngxZscZ8aisbNDAPBgNVHRMBAf8EBTADAQH/MAoGCCqG\n"
  + "SM49BAMCA0kAMEYCIQDkRQpQ7tvFSHlK/33GBCmGdNOQmcniXaNh1YBu/X5ZTQIh\n"
  + "AIUjMepvsSAO3pl4kZfLC87jJav7UVH0AAYgbu/Oci+q\n"
  + "-----END CERTIFICATE-----\n";

const ECHT = "postgresql://skyisles_agent.qqxcpesbwfxzgytkdsac:geheim"
  + "@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

/** Eine Datei vortaeuschen, damit keine Verweigerung eine echte Datei braucht. */
const datei = (inhalt: string | Error) => (): string => {
  if (inhalt instanceof Error) throw inhalt;
  return inhalt;
};
const grundVon = (u: { ok: boolean } & Record<string, unknown>): string =>
  u.ok ? "(kein Grund — durchgelassen)" : String(u.grund);


describe("die Zeichenkette muss verify-full ausschreiben", () => {
  it("nimmt verify-full", () => {
    const u = pruefeVerbindung(ECHT);
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.sslmode).toBe("verify-full");
  });

  for (const schwach of ["require", "prefer", "verify-ca"]) {
    it(`weist "${schwach}" ab und sagt, warum es nicht genuegt`, () => {
      /*
       * In `pg` 8.23.1 sind das noch Aliasse fuer `verify-full`. Ab `pg` v9
       * bekommen sie libpq-Semantik — dann pruefte `require` das Zertifikat
       * NICHT mehr. Eine Einstellung, die beim Versionssprung leiser wird,
       * ist keine.
       */
      const u = pruefeVerbindung(ECHT.replace("verify-full", schwach));
      expect(u.ok).toBe(false);
      expect(grundVon(u)).toContain("verify-full");
      expect(grundVon(u)).toContain("pg v9");
    });
  }

  for (const weg of ["disable", "no-verify", "allow"]) {
    it(`weist "${weg}" ab`, () => {
      expect(pruefeVerbindung(ECHT.replace("verify-full", weg)).ok).toBe(false);
    });
  }

  it("weist eine Zeichenkette ohne sslmode ab", () => {
    const u = pruefeVerbindung(ECHT.replace("?sslmode=verify-full", ""));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("unverschluesselt");
  });

  it("weist `uselibpqcompat` ab — das ist der Schalter, der abschwaecht", () => {
    const u = pruefeVerbindung(`${ECHT}&uselibpqcompat=true`);
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("uselibpqcompat");
  });

  for (const p of ["sslrootcert=/x/y.crt", "sslcert=/x/c.pem", "sslkey=/x/k.pem"]) {
    it(`weist \`${p.split("=")[0]}\` in der URL ab — es wuerde nicht gelesen`, () => {
      /*
       * Verbunden wird mit Feldern, nicht mit der Zeichenkette. Diese
       * Parameter haetten also keine Wirkung, und eine Einstellung, die
       * nichts tut, ist schlimmer als keine: sie behauptet etwas.
       */
      const u = pruefeVerbindung(`${ECHT}&${p}`);
      expect(u.ok).toBe(false);
      expect(grundVon(u)).toContain(CA_VARIABLE);
    });
  }
});


describe("der CA-Pfad", () => {
  it("nimmt den ausdruecklich gesetzten", () => {
    expect(caPfad({ [CA_VARIABLE]: "/pfad/zur/ca.crt", HOME: "/h" }))
      .toBe("/pfad/zur/ca.crt");
  });

  it("sonst die Standardstelle unter HOME — ausserhalb des Repositorys", () => {
    expect(caPfad({ HOME: "/Users/jemand" }))
      .toBe(`/Users/jemand/${CA_STANDARD}`);
    expect(CA_STANDARD).not.toContain("..");
    expect(CA_STANDARD.startsWith("/")).toBe(false);
  });

  it("und ein leerer Wert gilt als nicht gesetzt", () => {
    expect(caPfad({ [CA_VARIABLE]: "   ", HOME: "/h" })).toBe(`/h/${CA_STANDARD}`);
  });
});


describe("taugt diese Datei als Vertrauensanker?", () => {
  it("ja: ein Zertifikat mit CA:TRUE", () => {
    const u = pruefeCa("/ca.crt", datei(CA_TEST));
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.subjekt).toContain("SkyIsles Test CA");
    expect(u.anzahl).toBe(1);
    expect(u.fingerabdruck).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    expect(u.pem).toBe(CA_TEST);
  });

  it("ja: ein Bundle — die erste CA darin gewinnt", () => {
    const u = pruefeCa("/ca.crt", datei(BLATT + CA_TEST));
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.anzahl).toBe(2);
    expect(u.subjekt).toContain("Test CA");
    /* Das ganze Bundle wird weitergegeben, nicht nur die Wurzel: `pg`
       braucht die Kette, und ein Zwischenzertifikat darf dabei sein. */
    expect(u.pem).toBe(BLATT + CA_TEST);
    expect(u.pem.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
  });

  it("nein: ein Blattzertifikat ohne CA:TRUE", () => {
    const u = pruefeCa("/ca.crt", datei(BLATT));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("CA:TRUE");
    expect(grundVon(u)).toContain("Server- statt einem CA-Zertifikat");
  });

  it("nein: eine abgelaufene CA — mit der richtigen Erklaerung", () => {
    /*
     * Ein abgelaufener Anker erzeugt sonst einen Handschlagfehler, der nach
     * einem Problem der Gegenseite aussieht.
     */
    const u = pruefeCa("/ca.crt", datei(CA_ABGELAUFEN));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("abgelaufen");
  });

  it("aber dieselbe CA vor ihrem Ablauf ist in Ordnung", () => {
    const u = pruefeCa("/ca.crt", datei(CA_ABGELAUFEN), new Date("2020-06-01T00:00:00Z"));
    expect(u.ok).toBe(true);
  });

  it("nein: die Datei ist nicht lesbar", () => {
    const u = pruefeCa("/ca.crt", datei(new Error("ENOENT")));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("nicht lesbar");
  });

  it("nein: kein PEM darin — und der Hinweis auf DER steht dabei", () => {
    const u = pruefeCa("/ca.crt", datei("\u0000\u0001binaer"));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("kein PEM");
    expect(grundVon(u)).toContain("-inform der");
  });

  it("nein: ein PEM-Block, der kein Zertifikat ist", () => {
    const kaputt = "-----BEGIN CERTIFICATE-----\nZGFzIGlzdCBrZWlu\n-----END CERTIFICATE-----\n";
    expect(pruefeCa("/ca.crt", datei(kaputt)).ok).toBe(false);
  });

  it("nein: ein relativer Pfad", () => {
    const u = pruefeCa("ca.crt", datei(CA_TEST));
    expect(u.ok).toBe(false);
    expect(grundVon(u)).toContain("nicht absolut");
  });

  it("jede Verweigerung bringt die Einrichtungsanleitung mit", () => {
    /* Eine Meldung, die nur sagt was fehlt, laesst den Bediener suchen. */
    for (const fall of [
      pruefeCa("/ca.crt", datei(new Error("ENOENT"))),
      pruefeCa("/ca.crt", datei("nichts")),
      pruefeCa("/ca.crt", datei(BLATT)),
      pruefeCa("/ca.crt", datei(CA_ABGELAUFEN)),
    ]) {
      expect(grundVon(fall)).toContain("Download certificate");
      expect(grundVon(fall)).toContain("prod-ca-2021.crt");
    }
  });
});


describe("die Gegenprobe auf die erwartete Wurzel", () => {
  it("ist Auskunft, kein Riegel — eine fremde CA wird NICHT abgelehnt", () => {
    /*
     * Vertraut wird der Datei, die der Bediener aus dem Dashboard geholt
     * hat. Der Abdruck sagt ihm nur, ob er dieselbe Wurzel vor sich hat.
     * Dreht Supabase die Wurzel, soll das ein Hinweis sein, kein Stillstand.
     */
    const u = pruefeCa("/ca.crt", datei(CA_TEST));
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.erwartet).toBe(false);
  });

  it("der erwartete Abdruck hat die Form, die Node liefert", () => {
    expect(ERWARTETE_WURZEL.fingerabdruck).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });

  it("die Anleitung nennt Abdruck, Pfad und WARUM nicht aus der Kette", () => {
    const t = caAnleitung("/Users/x/.skyisles/supabase-ca.crt");
    expect(t).toContain(ERWARTETE_WURZEL.fingerabdruck);
    expect(t).toContain("/Users/x/.skyisles/supabase-ca.crt");
    /* Der wichtigste Satz: die Kette ist keine Vertrauensquelle. */
    expect(t).toContain("KEINE Vertrauensquelle");
  });
});


describe("die globale Abschaltung wird verweigert", () => {
  for (const wert of ["0", "false", "False"]) {
    it(`NODE_TLS_REJECT_UNAUTHORIZED=${wert} → Abbruch`, () => {
      const u = pruefeTlsUmgebung({ NODE_TLS_REJECT_UNAUTHORIZED: wert });
      expect(u.ok).toBe(false);
      expect(grundVon(u)).toContain("GANZEN Prozess");
    });
  }

  for (const wert of [undefined, "", "1"]) {
    it(`NODE_TLS_REJECT_UNAUTHORIZED=${JSON.stringify(wert)} → in Ordnung`, () => {
      expect(pruefeTlsUmgebung({ NODE_TLS_REJECT_UNAUTHORIZED: wert }).ok).toBe(true);
    });
  }
});


describe("die Verbindungsfelder", () => {
  it("kommen aus derselben Zerlegung, die der Riegel geprueft hat", () => {
    const f = verbindungsFelder(ECHT);
    expect(f).toEqual({
      user: "skyisles_agent.qqxcpesbwfxzgytkdsac",
      password: "geheim",
      host: "aws-1-eu-west-1.pooler.supabase.com",
      port: 5432,
      database: "postgres",
    });
  });

  it("entkodieren das Passwort", () => {
    const f = verbindungsFelder(ECHT.replace(":geheim@", ":ge%40h%3Aeim@"));
    expect(f.password).toBe("ge@h:eim");
  });

  it("und setzen 5432, wenn kein Port dasteht", () => {
    expect(verbindungsFelder(ECHT.replace(":5432", "")).port).toBe(5432);
  });
});


describe("was eine Fehlermeldung sagt", () => {
  it("bei der gemeldeten Lage: es fehlt die CA, nicht die Verschluesselung", () => {
    const t = erklaereVerbindungsfehler(
      Object.assign(new Error("self-signed certificate in certificate chain"),
        { code: "SELF_SIGNED_CERT_IN_CHAIN" }),
      "/Users/x/.skyisles/supabase-ca.crt");
    expect(t).toContain("PRIVATEN CA");
    expect(t).toContain("nicht die Verschluesselung");
    expect(t).toContain("Download certificate");
    expect(t).toContain("/Users/x/.skyisles/supabase-ca.crt");
  });

  it("bei falschem Hostnamen: der Riegel hat GEGRIFFEN", () => {
    const t = erklaereVerbindungsfehler(
      Object.assign(new Error("Hostname/IP does not match"),
        { code: "ERR_TLS_CERT_ALTNAME_INVALID" }), "/ca.crt");
    expect(t).toContain("hat gegriffen");
    expect(t).toContain("NICHT abgeschaltet");
  });

  it("bei 28P01: TLS STEHT — sonst sucht man weiter im Zertifikat", () => {
    /*
     * Genau dieser Fall trat nach der Behebung ein. Ohne die
     * Unterscheidung haette man den Fehler weiter in der CA gesucht.
     */
    const t = erklaereVerbindungsfehler(
      Object.assign(new Error('password authentication failed for user "skyisles_agent"'),
        { code: "28P01" }), "/ca.crt");
    expect(t).toContain("TLS steht");
    expect(t).toContain("Passwort");
    expect(t).not.toContain("Download certificate");
  });

  it("bei einem unbekannten Code bleibt die Meldung erhalten", () => {
    const t = erklaereVerbindungsfehler(
      Object.assign(new Error("irgendwas"), { code: "XX999" }), "/ca.crt");
    expect(t).toContain("XX999");
    expect(t).toContain("irgendwas");
  });

  it("und JEDE Meldung ist redigiert", () => {
    const t = erklaereVerbindungsfehler(
      new Error("could not connect: postgresql://u:nicht-echt-nur-die-form@h:5432/x"),
      "/ca.crt");
    expect(t).not.toContain("nicht-echt-nur-die-form");
    expect(t).toContain("***");
  });
});


describe("zwei Zusagen ueber die Bibliothek — nachgemessen, nicht erinnert", () => {
  it("`pg` bindet die Hostnamenpruefung an den echten Host", () => {
    /*
     * `connection.js` setzt `options.servername = host` NACH
     * `Object.assign(options, self.ssl)`. Ein `servername` im `ssl`-Objekt
     * wird also ueberschrieben — die Hostnamenpruefung ist von aussen nicht
     * abschaltbar. Gemessen: mit `servername: "boeser.example.com"` lief der
     * Handschlag trotzdem gegen den echten Namen.
     *
     * Aendert `pg` das, soll dieser Test es sagen.
     */
    const quelle = readFileSync("node_modules/pg/lib/connection.js", "utf8");
    const zuweisung = quelle.indexOf("options.servername = host");
    const uebernahme = quelle.indexOf("Object.assign(options, self.ssl)");
    expect(uebernahme, "`pg` uebernimmt das ssl-Objekt nicht mehr").toBeGreaterThan(-1);
    expect(zuweisung, "`pg` setzt servername nicht mehr").toBeGreaterThan(-1);
    expect(zuweisung, "servername wird VOR dem ssl-Objekt gesetzt — es koennte es "
      + "jetzt ueberschreiben").toBeGreaterThan(uebernahme);
  });

  it("eine `connectionString` wuerde unser `ssl` verwerfen", () => {
    /*
     * `connection-parameters.js` macht
     * `Object.assign({}, config, parse(config.connectionString))` — die
     * geparste Zeichenkette gewinnt, und weil sie `sslmode` enthaelt, setzt
     * der Parser `config.ssl = {}` darueber. Nachgemessen:
     *
     *   new Client({ host, user, …, ssl: { ca } })      → ssl = { ca: … }
     *   new Client({ connectionString, ssl: { ca } })   → ssl = {}
     *
     * GENAU DESHALB wird mit Feldern verbunden. Verschwindet diese Zeile,
     * ist die Begruendung zu pruefen — nicht der Code zu aendern.
     */
    const quelle = readFileSync("node_modules/pg/lib/connection-parameters.js", "utf8");
    expect(quelle).toContain("Object.assign({}, config, parse(config.connectionString))");
  });

  it("und `sslmode=require` ist dort heute ein Alias fuer verify-full", () => {
    /* Die Warnung, die der Bediener gesehen hat. Faellt sie weg, hat `pg`
       die Semantik geaendert — dann ist der Riegel neu zu bewerten. */
    const quelle = readFileSync("node_modules/pg-connection-string/index.js", "utf8");
    expect(quelle).toContain("are treated as aliases for 'verify-full'");
    expect(quelle).toContain("uselibpqcompat");
  });
});


describe("die Quelle schaltet nichts ab", () => {
  const quelle = readFileSync("tools/lib/staging-db.mts", "utf8");
  const code = quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !z.trimStart().startsWith("*")
      && !z.trimStart().startsWith("//")).join("\n");

  it("kein rejectUnauthorized, kein eigenes checkServerIdentity", () => {
    expect(code).not.toContain("rejectUnauthorized");
    expect(code).not.toContain("checkServerIdentity");
    expect(code).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED = ");
    expect(code).not.toContain("secureProtocol");
  });

  it("und uebergibt dem Treiber KEINE connectionString", () => {
    /* Sonst wuerde das `ssl`-Objekt verworfen — siehe oben. */
    expect(code).not.toContain("connectionString:");
    expect(code).toContain("ssl: { ca: ca.pem }");
  });

  it("die CA wird vor dem Treiber geprueft", () => {
    const ca = code.indexOf("pruefeCa(caPfad())");
    const treiber = code.indexOf('await import("pg")');
    expect(ca).toBeGreaterThan(-1);
    expect(treiber, "der Treiber wird vor der CA-Pruefung geladen")
      .toBeGreaterThan(ca);
  });
});

/* =========================================================================
 * DIE ABGELEHNTE ANMELDUNG (28P01) — WER HAT ABGELEHNT?
 *
 * DER ANLASS. Bei 0147 und 0148 am 2026-10-26 trat `28P01` unmittelbar nach
 * einem gelungenen Preflight auf, mehrfach, und ein spaeterer Versuch gelang
 * ohne jede Passwortaenderung. Die alte Meldung behauptete trotzdem „es ist
 * das Passwort in der Zugangsdatei" — das ist durch den gelungenen Lauf
 * widerlegt, und es ist genau der Rat, der zu einem unnoetigen
 * Passwortwechsel gefuehrt haette.
 *
 * ZWEI BELEGBARE FEHLER, und nur die werden hier behoben:
 *   1. die Meldung behauptete eine Ursache, die sie nicht wissen kann;
 *   2. ein Verbindungsfehler hinterliess KEINE Spur — das Pruefprotokoll
 *      entsteht erst nach dem Verbinden, also existiert von den Faellen am
 *      2026-10-26 kein Beleg.
 *
 * Was NICHT behauptet wird: dass die Ursache am Pooler bewiesen sei. Dafuer
 * fehlt der Beleg, und deshalb raet die Meldung zuerst zu dem Test, der sie
 * entscheidet — und nicht zum Passwortwechsel.
 * ====================================================================== */

/** Was PostgreSQL bei einer verworfenen Anmeldung wirklich sendet. */
const AUS_DER_DATENBANK = Object.assign(
  new Error('password authentication failed for user "skyisles_agent"'),
  { code: "28P01", severity: "FATAL", file: "auth.c", line: "326", routine: "auth_failed" },
);

/** Dieselbe Lage, aber von einem Zwischenstueck geschrieben. */
const AUS_DEM_POOLER = Object.assign(
  new Error('password authentication failed for user "skyisles_agent"'),
  { code: "28P01", severity: "FATAL" },
);

describe("herkunftDerAblehnung", () => {
  it("erkennt PostgreSQLs eigenen Anmeldecode an `routine: auth_failed`", () => {
    expect(herkunftDerAblehnung(AUS_DER_DATENBANK)).toBe("datenbank");
  });

  it("erkennt an FEHLENDEM `routine` und `file`, dass die Datenbank nicht gefragt wurde", () => {
    expect(herkunftDerAblehnung(AUS_DEM_POOLER)).toBe("pooler");
  });

  it("schliesst NICHT umgekehrt: Herkunftsfelder ohne `auth_failed` bleiben unklar", () => {
    /* GEGENPROBE ZUR FOLGERUNG. Die Folgerung traegt nur in einer Richtung.
       Ein Zwischenstueck KOENNTE `file` mitschicken — dann wird nicht auf
       „Datenbank" geraten, sondern `unklar` gesagt. */
    const anders = Object.assign(new Error("..."), {
      code: "28P01", file: "proxy.ex", routine: "handle_auth",
    });
    expect(herkunftDerAblehnung(anders)).toBe("unklar");
  });

  it("wertet ein leeres `routine` nicht als Herkunftsfeld", () => {
    const leer = Object.assign(new Error("..."), { code: "28P01", routine: "", file: "" });
    expect(herkunftDerAblehnung(leer)).toBe("pooler");
  });
});

describe("darfErneutVersuchen", () => {
  it("wiederholt eine Ablehnung, die die Datenbank nie gesehen hat — genau einmal", () => {
    expect(darfErneutVersuchen(AUS_DEM_POOLER, 1)).toBe(true);
    expect(darfErneutVersuchen(AUS_DEM_POOLER, 2)).toBe(false);
    expect(darfErneutVersuchen(AUS_DEM_POOLER, 3)).toBe(false);
  });

  it("wiederholt ein von der Datenbank verworfenes Passwort NIEMALS", () => {
    /* DAS IST DIE WICHTIGE GEGENPROBE. Wiederholungen gegen eine echte
       Anmeldung sind das Muster, das Sperren ausloest — und ein falsches
       Passwort wird beim zweiten Mal nicht richtig. */
    expect(darfErneutVersuchen(AUS_DER_DATENBANK, 1)).toBe(false);
  });

  it("wiederholt bei unklarer Herkunft nicht", () => {
    const anders = Object.assign(new Error("..."), { code: "28P01", file: "proxy.ex" });
    expect(darfErneutVersuchen(anders, 1)).toBe(false);
  });

  it("wiederholt keinen anderen Fehler als 28P01", () => {
    for (const code of ["SELF_SIGNED_CERT_IN_CHAIN", "ETIMEDOUT", "53300", "08P01", ""]) {
      expect(darfErneutVersuchen(Object.assign(new Error("x"), { code }), 1)).toBe(false);
    }
  });
});

describe("anmeldeAuskunft", () => {
  it("raet bei Herkunft `datenbank` zum Passwortwechsel", () => {
    const t = anmeldeAuskunft("datenbank");
    expect(t).toContain("auth_failed");
    expect(t).toContain("alter role skyisles_agent with password");
  });

  it("nennt bei Herkunft `pooler` zuerst den direkten Weg — nicht das Passwort", () => {
    const t = anmeldeAuskunft("pooler");
    const direkt = t.indexOf("db.qqxcpesbwfxzgytkdsac.supabase.co");
    const passwort = t.indexOf("alter role");
    expect(direkt, "der direkte Weg wird genannt").toBeGreaterThan(-1);
    expect(passwort, "der Passwortwechsel steht DANACH").toBeGreaterThan(direkt);
  });

  it("macht den Passwortwechsel bei `pooler` ausdruecklich von dem Test abhaengig", () => {
    /* „Keine Passwortaenderung auf Verdacht" — das muss in der Meldung
       stehen, nicht nur in der Absicht. */
    expect(anmeldeAuskunft("pooler")).toContain("BEVOR irgendein Passwort angefasst wird");
    expect(anmeldeAuskunft("pooler")).toContain("NUR wenn der Test oben es zeigt");
  });

  it("behauptet bei `pooler` NICHT, es sei das Passwort", () => {
    /* Die alte Meldung sagte genau das. Sie darf nicht zurueckkommen. */
    const t = anmeldeAuskunft("pooler");
    expect(t).not.toContain("Es ist das Passwort");
    expect(t).toContain("sie wurde nicht gefragt");
  });

  it("sagt in jedem Fall, dass TLS stand", () => {
    for (const h of ["datenbank", "pooler", "unklar"] as const) {
      expect(anmeldeAuskunft(h)).toContain("TLS steht");
    }
  });
});

describe("erklaereVerbindungsfehler bei 28P01", () => {
  it("waehlt die Auskunft nach der gemessenen Herkunft", () => {
    expect(erklaereVerbindungsfehler(AUS_DEM_POOLER, "/ca.crt"))
      .toContain("sie wurde nicht gefragt");
    expect(erklaereVerbindungsfehler(AUS_DER_DATENBANK, "/ca.crt"))
      .toContain("auth_failed");
  });

  it("nennt 28P01 weiterhin nicht als TLS-Fehler", () => {
    const t = erklaereVerbindungsfehler(AUS_DEM_POOLER, "/ca.crt");
    expect(t.startsWith("ANMELDUNG abgelehnt (28P01)")).toBe(true);
    expect(t).not.toContain("Es fehlt also die CA");
  });
});

describe("versuchsNotiz", () => {
  const JETZT = new Date("2026-10-26T10:38:00.000Z");

  it("haelt Zeitpunkt, Form, Versuch, Code, Herkunft und Dauer fest", () => {
    const z = versuchsNotiz(AUS_DEM_POOLER, "pooler", 412, 1, JETZT);
    expect(z).toContain("2026-10-26T10:38:00.000Z");
    expect(z).toContain("| pooler |");
    expect(z).toContain("| 1 |");
    expect(z).toContain("| 28P01 |");
    expect(z).toContain("| 412 |");
    expect(z.endsWith("\n")).toBe(true);
  });

  it("schreibt die gemessene Herkunft in die Akte", () => {
    expect(versuchsNotiz(AUS_DEM_POOLER, "pooler", 1, 1, JETZT)).toMatch(/\| pooler \| 1 \|/);
    expect(versuchsNotiz(AUS_DER_DATENBANK, "pooler", 1, 1, JETZT)).toContain("| datenbank |");
  });

  it("nennt bei einem anderen Code keine Herkunft", () => {
    const z = versuchsNotiz(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), "direkt", 9, 1, JETZT,
    );
    expect(z).toContain("| ETIMEDOUT | — |");
  });

  it("bleibt EINE Tabellenzeile, auch bei mehrzeiliger Treibermeldung", () => {
    const mehrzeilig = Object.assign(new Error("a\nb|c\nd"), { code: "28P01" });
    const z = versuchsNotiz(mehrzeilig, "pooler", 1, 1, JETZT);
    expect(z.split("\n").filter((x) => x !== "")).toHaveLength(1);
  });

  it("enthaelt keine Zugangsdaten — und redigiert die Treibermeldung", () => {
    /* Der Host, der Benutzername und das Passwort gehoeren in keine Akte.
       Festgehalten wird die FORM des Zugangs, nicht der Zugang. */
    const mitUrl = Object.assign(
      new Error("connect failed: postgres://skyisles_agent:s3cr3t@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"),
      { code: "28P01" },
    );
    const z = versuchsNotiz(mitUrl, "pooler", 1, 1, JETZT);
    expect(z).not.toContain("s3cr3t");
  });
});

describe("die Akte der abgelehnten Anmeldungen", () => {
  it("liegt im Protokollordner, der nicht ins Repository geht", () => {
    expect(VERSUCHS_AKTE).toBe("supabase/log/staging/anmeldeversuche.md");
    const ignore = readFileSync(".gitignore", "utf8")
      .split("\n").map((z) => z.trim()).filter((z) => z !== "" && !z.startsWith("#"));
    expect(
      ignore.some((z) => z === "supabase/log" || z === "supabase/log/" || z.startsWith("supabase/log")),
      "supabase/log muss ignoriert sein",
    ).toBe(true);
  });

  it("erklaert im Kopf, was `pooler` bedeutet, und sagt zu, keine Zugangsdaten zu fuehren", () => {
    expect(VERSUCHS_AKTE_KOPF).toContain("Keine Zugangsdaten");
    expect(VERSUCHS_AKTE_KOPF).toContain("Passwort nie gesehen");
    expect(VERSUCHS_AKTE_KOPF).toContain("| Zeitpunkt | Form | Versuch | Code | Herkunft | ms | Meldung |");
  });
});

describe("der Verbindungsaufbau selbst", () => {
  const quelle = readFileSync("tools/lib/staging-db.mts", "utf8");
  const code = quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !z.trim().startsWith("//")).join("\n");

  it("haelt JEDEN gescheiterten Versuch fest, bevor er entscheidet", () => {
    const notiz = code.indexOf("haltFest(versuchsNotiz(");
    const entscheidung = code.indexOf("darfErneutVersuchen(e, versuch)");
    expect(notiz, "die Notiz wird geschrieben").toBeGreaterThan(-1);
    expect(entscheidung, "danach wird entschieden").toBeGreaterThan(notiz);
  });

  it("nimmt fuer den zweiten Versuch einen frischen Client", () => {
    /* Ein `pg.Client`, dessen `connect()` geworfen hat, ist verbraucht —
       ein zweiter `connect()` darauf wirft unabhaengig vom Passwort. */
    expect(code).toContain("let client = neuerClient();");
    expect(code).toContain("      client = neuerClient();");
    /* Genau zwei Aufrufe der Fabrik: einer je moeglichem Versuch. */
    expect(code.match(/neuerClient\(\);/g)?.length ?? 0).toBe(2);
  });

  it("setzt `rejectUnauthorized` in keiner WIRKSAMEN Zeile", () => {
    /* Gegen den Code, nicht gegen die Prosa: das Verbot ist in dieser Datei
       ausfuehrlich kommentiert, und ein Kommentar darueber ist kein Verstoss
       dagegen. */
    expect(code.includes("rejectUnauthorized")).toBe(false);
    expect(code.includes("NODE_TLS_REJECT_UNAUTHORIZED = ")).toBe(false);
  });
});
