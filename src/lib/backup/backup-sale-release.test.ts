/**
 * `0140` — Freigabe, Lieferumfang und USK in der Betriebssicherung, und die
 * Probe auf die Abdrücke, die die Prüfdateien verlangen.
 *
 * WARUM DIESE DATEI NÖTIG IST. `supabase/checks/0140_postflight.sql` verlangt
 * `md5(prosrc) = a32b148c…`, 21 622 Zeichen und einen Kommentarabdruck. Diese
 * drei Zahlen sind **gerechnet** — aus der Migrationsdatei, nicht von einer
 * laufenden Datenbank abgelesen. Eine gerechnete Konstante, die niemand
 * nachrechnet, verrottet beim ersten Zeichen, das sich in der Migration
 * ändert: der Postflight würde dann eine Abweichung melden, die keine ist.
 *
 * Hier wird sie deshalb bei jedem Testlauf neu gerechnet und verglichen. Dass
 * die METHODE stimmt, zeigt dieselbe Rechnung an `0136`: dort liefert sie
 * `f6d08440…` und 21 494 Zeichen — genau die Werte, die der
 * `0136`-Postflight seit dem 2026-10-19 gegen die echte Datenbank hält.
 *
 * WAS SIE NICHT KANN: sie liest Dateien, keine Datenbank. Dass der Rumpf in
 * PostgreSQL mit genau diesem Abdruck ENTSTEHT, fährt Probelauf **P46** nach.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const datei = (p: string) => readFileSync(p, "utf8");

const M0136 = datei("supabase/migrations/0136_business_backup_item_type.sql");
const M0140 = datei("supabase/migrations/0140_business_backup_sale_release.sql");
const PRE = datei("supabase/checks/0140_preflight.sql");
const POST = datei("supabase/checks/0140_postflight.sql");

/** Der Rumpf, wie `pg_proc.prosrc` ihn speichert: alles zwischen `$$`. */
function rumpf(sql: string): string {
  const m = sql.match(
    /create or replace function public\.seller_business_backup\(\)[\s\S]*?\nas \$\$([\s\S]*?)\$\$;/);
  if (m === null) throw new Error("kein Funktionsrumpf gefunden");
  return m[1];
}

/** Der Kommentar, wie `obj_description` ihn liefert: die Literale verkettet. */
function kommentar(sql: string): string {
  const m = sql.match(
    /comment on function public\.seller_business_backup\(\) is\s*\n?\s*((?:'(?:[^']|'')*'\s*\n?\s*)+);/);
  if (m === null) throw new Error("kein Kommentar gefunden");
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)]
    .map((t) => t[1].replaceAll("''", "'")).join("");
}

const zeilen = (r: string) => r.split("\n");
const bereiche = (r: string) =>
  zeilen(r).filter((l) => /^ {6}'[a-z_0-9]+', coalesce\(\($/.test(l));
const felder = (r: string) =>
  zeilen(r).filter((l) => /^ {10}'[a-z_0-9]+',/.test(l));

describe("die Methode stimmt — nachgewiesen an 0136", () => {
  /*
   * DAS IST DIE EIGENTLICHE PROBE. Die Werte für `0136` sind nicht von mir:
   * sie stehen seit dem 2026-10-19 im `0136`-Postflight und wurden dort
   * gegen die laufende Datenbank gehalten. Reproduziert dieselbe Rechnung
   * sie, ist sie für `0140` ebenso gültig.
   */
  it("liefert für 0136 genau die Werte, die der 0136-Postflight verlangt", () => {
    const r = rumpf(M0136);
    expect(md5(r)).toBe("f6d08440707ba72a8040a8d1e666c092");
    expect(r.length).toBe(21494);
    expect(md5(kommentar(M0136))).toBe("c12618f312b413571eeabe912ca03651");
    expect(bereiche(r)).toHaveLength(28);
    expect(felder(r)).toHaveLength(353);
  });

  it("und der 0136-Postflight verlangt sie wirklich", () => {
    const p = datei("supabase/checks/0136_postflight.sql");
    expect(p).toContain("f6d08440707ba72a8040a8d1e666c092");
    expect(p).toContain("21494");
  });
});

describe("0140 fügt drei Feldzeilen ein, und nur drei", () => {
  const vorher = rumpf(M0136);
  const nachher = rumpf(M0140);

  it("28 Bereiche bleiben 28, 353 Feldzeilen werden 356", () => {
    expect(bereiche(vorher)).toHaveLength(28);
    expect(bereiche(nachher)).toHaveLength(28);
    expect(felder(vorher)).toHaveLength(353);
    expect(felder(nachher)).toHaveLength(356);
  });

  it("die drei sind sale_released, delivery_scope und usk_rating", () => {
    const neu = felder(nachher).map((l) => l.trim())
      .filter((l) => !felder(vorher).map((v) => v.trim()).includes(l));
    expect(neu).toEqual([
      "'sale_released', t.sale_released,",
      "'delivery_scope', t.delivery_scope,",
      "'usk_rating', t.usk_rating,",
    ]);
  });

  it("und sonst ändert sich keine Zeile des Rumpfs", () => {
    /*
     * Der Beweis in einer Zeile: zieht man die drei Einfügungen wieder ab,
     * ist der Rumpf Zeichen für Zeichen der aus `0136`. Deshalb genügt in
     * der Datenbank EIN Abdruck, um die 26 unberührten Bereiche mitzuprüfen.
     */
    const ohneDieDrei = zeilen(nachher)
      .filter((l) => !/^ {10}'(sale_released|delivery_scope|usk_rating)',/.test(l))
      .join("\n");
    expect(md5(ohneDieDrei)).toBe(md5(vorher));
  });
});

describe("die Prüfdateien verlangen genau die gerechneten Abdrücke", () => {
  const r = rumpf(M0140);

  it("der Postflight: Rumpf, Länge, Kommentar, Feldzahl", () => {
    expect(POST).toContain(md5(r));
    expect(POST).toContain(String(r.length));
    expect(POST).toContain(md5(kommentar(M0140)));
    expect(POST).toContain("'356'");
  });

  it("der Preflight verlangt den Stand VORHER — sonst liefe 0140 zweimal", () => {
    expect(PRE).toContain(md5(rumpf(M0136)));
    expect(PRE).toContain("'353'");
    /* Und er sagt ausdrücklich, dass 0140 noch nicht angewendet ist. */
    expect(PRE).toContain("0140 ist NOCH NICHT angewendet");
  });

  it("beide kennen beide Umgebungen", () => {
    for (const p of [PRE, POST]) {
      expect(p).toContain("z0 (schluessel, staging, production)");
      expect(p).toContain("9b8341058bbfa0f7809eddc300ab0e9e");
      expect(p).toContain("v.modus in ('staging', 'production', 'keine')");
    }
  });

  it("und beide prüfen, dass nichts freigegeben ist", () => {
    for (const p of [PRE, POST]) {
      expect(p).toContain("freigegebene Lagerpositionen");
      expect(p).toContain("Zeilen mit erfasster USK-Kennzeichnung");
      expect(p).toContain("Zubehoerzeilen im oeffentlichen Angebot");
    }
  });

  it("und dass die Belegsperre hält", () => {
    for (const p of [PRE, POST]) {
      expect(p).toContain("platform_receipt_sequence");
      expect(p).toContain("keine API-Rolle darf ausstellen oder korrigieren");
    }
  });
});

describe("0140 liest nur, und setzt 0139 voraus", () => {
  it("auf Anweisungsebene kein insert, update, delete, truncate", () => {
    const anweisungen = M0140
      .replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
    for (const dml of [/^\s*insert into public\./m, /^\s*update public\./m,
      /^\s*delete from public\./m, /^\s*truncate/m]) {
      expect(anweisungen, String(dml)).not.toMatch(dml);
    }
  });

  it("und sie bricht ab, wenn eine der drei Spalten aus 0139 fehlt", () => {
    for (const spalte of ["sale_released", "usk_rating", "delivery_scope"]) {
      expect(M0140).toContain(`0140 setzt 0139 voraus: `);
      expect(M0140).toContain(spalte);
    }
  });

  it("der Rumpf selbst schreibt nichts", () => {
    const r = rumpf(M0140);
    expect(r).not.toMatch(/\binsert\s+into\b/i);
    expect(r).not.toMatch(/\bupdate\s+public\./i);
    expect(r).not.toMatch(/\bnextval\b/i);
  });
});
