import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ==========================================================================
 * DER DRY-RUN SCHREIBT NICHT — am QUELLTEXT festgenagelt, nicht am Kommentar
 *
 * `tools/catalog-sync.mts` sagt von sich, es habe keinen schreibenden Pfad.
 * Eine Zusage im Kommentar ist keine Zusage: dieselbe Vorsicht, mit der
 * `src/lib/catalog/import-payload.test.ts` festhaelt, dass der Katalogimport
 * `source` nie nennt, und mit der `0162` seine Storage-Zusage am Rumpf misst
 * statt am Kommentar.
 * ========================================================================== */

const QUELLE = readFileSync("tools/catalog-sync.mts", "utf8");

/** Der Quelltext ohne Block- und Zeilenkommentare — dort darf alles stehen. */
const CODE = QUELLE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  /*
   * `createHash("md5").update(...)` ist der Pruefsummenaufbau aus `node:crypto`
   * und kein Datenbankschreibvorgang. Er wird hier benannt und entfernt, statt
   * das Muster unten aufzuweichen — ein Riegel, der viele Formen durchlaesst,
   * um eine erlaubte zu erlauben, ist kein Riegel.
   */
  .replace(/createHash\([^)]*\)\.update\(/g, "createHash(")
  .split("\n").filter((z) => !z.trimStart().startsWith("*") && !z.trimStart().startsWith("//"))
  .join("\n");

describe("catalog-sync.mts — der Dry-Run hat keinen schreibenden Pfad", () => {
  it.each([
    [".insert(", "PostgREST-Insert"],
    [".update(", "PostgREST-Update"],
    [".upsert(", "PostgREST-Upsert"],
    [".delete(", "PostgREST-Delete"],
    [".rpc(", "Funktionsaufruf — auch ein lesender waere hier nicht noetig"],
    [".upload(", "Storage-Upload"],
    [".remove(", "Storage-Loeschung"],
    ["signInWithPassword", "Adminanmeldung — die gehoert erst in den Apply-Pfad"],
  ])("nennt %s nicht (%s)", (muster) => {
    expect(CODE).not.toContain(muster);
  });

  it("liest ausschliesslich ueber .select() und .order()", () => {
    expect(CODE).toContain(".select(");
  });

  it("schreibt nur die zwei vorgesehenen lokalen Dateien", () => {
    const ziele = [...CODE.matchAll(/writeFileSync\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ziele.sort()).toEqual([
      "resources/analysis/SYNC-DRYRUN.md",
      "resources/analysis/sync-dryrun.json",
    ]);
  });

  it("nennt market_price nirgends — der Preis gehoert Production", () => {
    expect(CODE).not.toContain("market_price");
  });

  it("traegt die Feldreihenfolge aus S3/S4, nicht die der Journalklassen", () => {
    /*
     * Eine andere Reihenfolge ergibt bei identischen Daten einen anderen
     * Abdruck — daran ist die erste Fassung gescheitert (654 und 622 Zeilen
     * stimmten, die Pruefsummen nicht). Der Riegel steht hier, weil er sich
     * am Quelltext messen laesst.
     */
    const s3 = readFileSync("resources/analysis/s3-fingerprint-staging.sql", "utf8");
    const reihenfolge = ["series_code", "name", "slug", "display_name_override",
      "card_type", "item_type", "is_active", "catalog_visible", "catalog_status",
      "base_sky_id", "types", "visible_type", "visible_type_decided",
      "image_file", "image_override_path", "source", "usk_rating"];
    const felder = /const FELDER = \[([\s\S]*?)\] as const;/.exec(CODE)?.[1] ?? "";
    const imWerkzeug = [...felder.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
      .filter((f) => f !== "kategorie" && f !== "familie");
    expect(imWerkzeug).toEqual(reihenfolge);

    // Und dieselbe Folge steht im `concat_ws` von S3.
    const abdruck = s3.slice(s3.indexOf("concat_ws('|',"), s3.indexOf("as text"));
    let pos = -1;
    for (const f of reihenfolge) {
      const neu = abdruck.indexOf(`s.${f}`);
      expect(neu, `${f} fehlt im Abdruck von S3`).toBeGreaterThan(-1);
      expect(neu, `${f} steht in S3 an anderer Stelle`).toBeGreaterThan(pos);
      pos = neu;
    }
  });
});

describe("bootstrap-decisions.json — die Entscheidungen des Betreibers", () => {
  const D = JSON.parse(readFileSync("resources/sync/bootstrap-decisions.json", "utf8"));

  it("fuehrt genau 13 Anzeigenamen", () => {
    const ids = Object.keys(D.display_name_override).filter((k) => !k.startsWith("_"));
    expect(ids).toHaveLength(13);
    for (const id of ids) expect(id).toMatch(/^SKY-\d{4}$/);
  });

  it("haelt die vier Wortfolgefaelle und SKY-0284 ausdruecklich heraus", () => {
    for (const id of ["SKY-0585", "SKY-0587", "SKY-0130", "SKY-0154", "SKY-0284"]) {
      expect(D.kein_override[id], `${id} fehlt in kein_override`).toBeTruthy();
      expect(D.display_name_override[id]).toBeUndefined();
    }
  });

  it("nennt die Zweiparameterform fuer setval und kein Staging-setval", () => {
    expect(D.sky_id.setval.production).toBe(5000);
    expect(D.sky_id.setval.staging).toBeNull();
    expect(D.sky_id.baender.production_ab).toBe("SKY-5001");
    expect(D.sky_id.baender.staging_ab).toBe("SKY-0928");
  });

  it("haelt die am 2026-10-30 gemessenen Sequenzstaende fest", () => {
    expect(D.fingerprint_live.staging.sequenz_last_value).toBe(927);
    expect(D.fingerprint_live.production.sequenz_last_value).toBe(821);
  });
});
