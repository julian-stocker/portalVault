/**
 * ETAPPE A DES ABSCHLUSSLAUFS — übertragen oder verifizieren?
 *
 * Rein, ohne Netz, ohne Datenbank, ohne Storage. Die Bytes kommen als
 * Parameter herein; das Werkzeug `tools/storage-transfer.mts` lädt sie und
 * fragt hier nach dem Urteil. Geprüft wird das in `storage-verify.test.ts`
 * ohne jeden Zugang.
 *
 * ===========================================================================
 * WARUM ES DIESES MODUL GIBT
 * ===========================================================================
 *
 * Am 2026-10-31 brach der Abschlusslauf in Etappe A ab:
 *
 *     RIEGEL 2 — Abbruch: der Dry-Run nennt keinen Bildschritt.
 *
 * Die Aussage war falsch — der Dry-Run nannte 17, alle Richtung Production.
 * Richtung Staging war nach Etappe C nichts mehr zu übertragen, und der
 * Runner erzwang dort trotzdem einen Apply. Ein Apply ohne Objekt ist kein
 * sinnvoller Apply, der Abbruch war also richtig; falsch war der Aufruf.
 *
 * Ein erledigter Transfer ist aber auch nicht nichts. Er gehört verifiziert:
 * die Objekte müssen liegen, ihre Prüfsummen stimmen, und wo beide Seiten
 * dasselbe Objekt führen, müssen die Bytes gleich sein.
 */

import { createHash } from "node:crypto";

export type Umgebung = "staging" | "production";

/** Woher ein benötigtes Objekt kommt. */
export type Herkunft =
  /** beide Umgebungen referenzieren den Pfad — dieser Abgleich hat ihn übertragen */
  | "uebertragen"
  /** der Plan will ihn noch in diese Richtung schreiben */
  | "geplant";

export type Bedarf = { pfad: string; sky_id: string; herkunft: Herkunft };

/** Ein Objekt, wie der Lader es zurückgibt. `null` heißt: liegt dort nicht. */
export type Objekt = { bytes: Uint8Array } | null;

export type Urteil = {
  pfad: string;
  sky_id: string;
  herkunft: Herkunft;
  zustand: string;
  /** `true` heißt: der Lauf muss abbrechen. */
  befund: boolean;
  groesse: number | null;
  sha_ziel: string | null;
  bytegleich: boolean | null;
  hinweis: string;
};

const sha256 = (b: Uint8Array) =>
  createHash("sha256").update(Buffer.from(b)).digest("hex");

/** Die 16 Hexstellen im Dateinamen — der Pfad ist inhaltsadressiert. */
export const nameAusPfad = (pfad: string): string =>
  (pfad.split("/")[1] ?? "").replace(/\.[a-z0-9]+$/i, "");

/**
 * WELCHEN MODUS ETAPPE A FÜR EINE RICHTUNG BRAUCHT.
 *
 * Nicht der Ablauf entscheidet das, sondern der Plan. Genau hier lag der
 * Fehler: der Runner rief den Apply unbedingt auf.
 */
export function etappeAModus(
  bildschritteDorthin: number,
): "apply" | "pruefen" {
  return bildschritteDorthin > 0 ? "apply" : "pruefen";
}

/**
 * DIE BENÖTIGTE MENGE JE RICHTUNG — bewusst eng gefasst.
 *
 * Drin ist, was dieser Abgleich schon übertragen hat (beidseitig
 * referenziert) und was er noch schreiben will. Draußen bleibt, was NUR die
 * Gegenseite führt und der Plan nicht anfasst — etwa die 37 Entwürfe auf
 * Staging, die nach ADR-0163 nie veröffentlicht werden. Die gehören nicht zu
 * Etappe A, und eine Etappe, die daran scheitert, hält den Publish aus einem
 * Grund auf, der ihn nichts angeht.
 */
export function noetigeMenge(
  beidseitig: readonly { pfad: string; sky_id: string }[],
  geplant: readonly { pfad: string; sky_id: string }[],
): Bedarf[] {
  const m = new Map<string, Bedarf>();
  for (const b of beidseitig) {
    m.set(b.pfad, { pfad: b.pfad, sky_id: b.sky_id, herkunft: "uebertragen" });
  }
  for (const g of geplant) {
    if (!m.has(g.pfad)) {
      m.set(g.pfad, { pfad: g.pfad, sky_id: g.sky_id, herkunft: "geplant" });
    }
  }
  return [...m.values()].sort((a, b) => (a.pfad < b.pfad ? -1 : a.pfad > b.pfad ? 1 : 0));
}

/**
 * DAS URTEIL ÜBER EIN OBJEKT.
 *
 * `imZiel` ist das Objekt in der Zielumgebung, `aufDerGegenseite` dasselbe
 * dort — `null`, wenn es dort nicht liegt.
 */
export function beurteile(
  bedarf: Bedarf,
  imZiel: Objekt,
  aufDerGegenseite: Objekt,
): Urteil {
  const u: Urteil = {
    ...bedarf, zustand: "", befund: false,
    groesse: null, sha_ziel: null, bytegleich: null, hinweis: "",
  };

  /* Riegel 3, dieselbe Bedingung wie im Transferpfad. */
  if (bedarf.pfad.split("/")[0] !== bedarf.sky_id) {
    return { ...u, zustand: "PFAD GEHOERT NICHT ZU SEINER FIGUR", befund: true,
             hinweis: `${bedarf.sky_id} -> ${bedarf.pfad}` };
  }

  if (imZiel === null) {
    /*
     * EIN GEPLANTER PFAD DARF FEHLEN — das ist der Grund, warum er im Plan
     * steht, und dafür ist der Apply-Pfad da. Ein ÜBERTRAGENER darf es
     * nicht: er war da und ist weg.
     */
    if (bedarf.herkunft === "geplant") {
      return { ...u, zustand: "noch nicht uebertragen (Planschritt)",
               hinweis: "der Apply-Pfad traegt ihn; hier kein Befund" };
    }
    return { ...u, zustand: "FEHLT IM ZIEL, WAR ABER UEBERTRAGEN", befund: true,
             hinweis: "das Objekt wurde uebertragen und liegt nicht mehr dort" };
  }

  u.groesse = imZiel.bytes.byteLength;
  u.sha_ziel = sha256(imZiel.bytes);

  /* Prüfung 1: der Name IST die Prüfsumme. */
  const erwartet = nameAusPfad(bedarf.pfad);
  if (erwartet === "" || !u.sha_ziel.startsWith(erwartet)) {
    return { ...u, zustand: "NAME PASST NICHT ZUM INHALT", befund: true,
             hinweis: `Name ${erwartet || "(keiner)"}, SHA ${u.sha_ziel.slice(0, 16)}` };
  }

  /* Prüfung 2: wo beide Seiten dasselbe Objekt führen, Byte für Byte. */
  if (aufDerGegenseite === null) {
    return { ...u, zustand: "im Ziel in Ordnung (Gegenseite fuehrt den Pfad nicht)",
             hinweis: "nur einseitig — kein Byte-Vergleich moeglich" };
  }
  u.bytegleich = Buffer.from(imZiel.bytes).equals(Buffer.from(aufDerGegenseite.bytes));
  if (!u.bytegleich) {
    return { ...u, zustand: "NICHT BYTEGLEICH", befund: true,
             hinweis: `Ziel ${imZiel.bytes.byteLength} B / Gegenseite `
               + `${aufDerGegenseite.bytes.byteLength} B, SHA ${u.sha_ziel.slice(0, 16)}`
               + ` / ${sha256(aufDerGegenseite.bytes).slice(0, 16)}` };
  }
  return { ...u, zustand: "vorhanden, bytegleich, inhaltsadressiert" };
}

/** Was die Prüfung als Ganzes sagt. `befunde > 0` heißt Abbruch. */
export function zusammenfassung(urteile: readonly Urteil[]) {
  const befunde = urteile.filter((u) => u.befund);
  const offen = urteile.filter((u) => !u.befund && u.zustand.startsWith("noch nicht"));
  return {
    geprueft: urteile.length,
    in_ordnung: urteile.length - befunde.length - offen.length,
    noch_nicht_uebertragen: offen.length,
    befunde: befunde.length,
    bestanden: befunde.length === 0,
    /*
     * EINE STILLE NULL IST KEIN ERFOLG. Ein Lauf, der nichts geprüft hat und
     * "in Ordnung" meldet, ist die unangenehmste Rückmeldung von allen —
     * dasselbe Prinzip wie Riegel 2b im Transferpfad.
     */
    leer: urteile.length === 0,
  };
}
