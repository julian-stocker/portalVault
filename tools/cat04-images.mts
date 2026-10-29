/**
 * CAT-04D — die eingebetteten Bilder der Checkliste den Entwuerfen zuordnen.
 *
 *   npm run cat04:images
 *
 * ES BRAUCHT KEINE DATENBANK, und deshalb hat es auch keinen Zugang.
 *
 * Die Zuordnung entsteht allein aus zwei lokalen Quellen: der .xlsx und den
 * bereits erhobenen CAT-03-Entwuerfen. Kein Schluessel wird gelesen, keine
 * Verbindung aufgebaut, nichts hochgeladen. Dieses Werkzeug traegt deshalb
 * auch KEINEN Umgebungsnamen — es gibt keine Umgebung, an der es sich irren
 * koennte.
 *
 * WAS ES SCHREIBT, und mehr nicht:
 *
 *   resources/analysis/cat-04-bildmanifest.{json,csv}   das Manifest
 *   resources/review/cat-04-bilder/                     lokale Pruefdateien
 *   resources/review/cat-04-bilder/galerie.html         der Kontaktbogen
 *
 * DIE BILDER BLEIBEN LOKAL. Sie stammen aus einer fremden Checkliste, ihre
 * Nutzungsrechte sind UNGEKLAERT, und `resources/review/.gitignore` haelt
 * sie aus dem Repository. Nichts davon geht nach `public/`, in einen Bucket
 * oder in die Datenbank.
 *
 * WARUM DER VERGLEICH IN PYTHON STEHT: eine .xlsx sicher zu lesen heisst ZIP
 * plus XML, und beides hat Python in der Standardbibliothek — dieselbe
 * Begruendung wie bei `cat01-diff.mts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const QUELLE = "resources/web/Complete Skylanders Checklist.xlsx";
const MANIFEST = "resources/analysis/cat-04-bildmanifest.json";
const PRUEFDIR = "resources/review/cat-04-bilder";

if (!existsSync(QUELLE)) {
  console.error(`CAT-04D ABBRUCH: Quelldatei fehlt (${QUELLE}).`);
  process.exit(1);
}

mkdirSync(PRUEFDIR, { recursive: true });

/*
 * DER RIEGEL GEGEN EINEN VERSEHENTLICHEN COMMIT, und er steht VOR dem
 * Auspacken. Die Bilder sind fremdes Material mit ungeklaerten Rechten; sie
 * duerfen nicht ins Repository geraten, auch nicht durch ein beherztes
 * `git add -A`.
 */
writeFileSync("resources/review/.gitignore",
  "# CAT-04D — lokale Pruefdateien aus einer fremden Checkliste.\n"
+ "# Die Nutzungsrechte sind UNGEKLAERT. Nichts davon gehoert ins\n"
+ "# Repository, nach public/ oder in einen Storage-Bucket.\n"
+ "#\n"
+ "# `*` schliesst auch das Unterverzeichnis aus, git steigt gar nicht erst\n"
+ "# hinein. Aus diesem Baum ist damit NICHTS ausser dieser Datei\n"
+ "# committierbar — auch HERKUNFT.md nicht. Das ist die staerkere Zusage;\n"
+ "# die Herkunft steht ohnehin in supabase/checks/cat04d_bildimport_plan.md\n"
+ "# und im Manifest.\n"
+ "*\n!.gitignore\n");

writeFileSync(`${PRUEFDIR}/HERKUNFT.md`,
  "# Herkunft und Rechtestand dieser Bilder\n\n"
+ "**Quelle:** `resources/web/Complete Skylanders Checklist.xlsx` — eine\n"
+ "fremde, vom Betreiber beschaffte Checkliste. Die Bilder sind dort als\n"
+ "Zeichnungsobjekte eingebettet (`xl/media/`).\n\n"
+ "**Rechtestand: vom Betreiber freigegeben (2026-10-27).** Er hat erklaert,\n"
+ "die Rechte selbst geprueft zu haben. Das ist SEINE Aussage, nicht meine\n"
+ "Pruefung — Einzelheiten in HERKUNFT.md. Es liegt keine Lizenzaussage bei,\n"
+ "weder in der Datei noch anderswo.\n\n"
+ "Diese Dateien bleiben trotzdem lokal:\n\n"
+ "* sie gehoeren nicht nach `public/images/skylanders/` — das ist der\n"
+ "  Importkanal und gehoert der Legacy-Quelle,\n"
+ "* sie gehoeren nicht ins Repository (`../.gitignore` haelt sie draussen),\n"
+ "* in den Bucket `catalog` kommen sie ueber den dafuer gebauten Lauf,\n"
+ "  nicht durch Kopieren.\n\n"
+ "**Zuordnung:** ueber die Zellanker der Tabelle, nicht ueber die\n"
+ "Reihenfolge der Mediendateien. Das Verfahren und sein Beweis stehen in\n"
+ "`tools/lib/cat04-images.py`; das Ergebnis in\n"
+ "`resources/analysis/cat-04-bildmanifest.json`.\n\n"
+ "**Erzeugt von** `npm run cat04:images`. Ein neuer Lauf schreibt sie neu.\n");

execFileSync("python3", ["tools/lib/cat04-images.py", QUELLE], { stdio: "inherit" });

/* ------------------------------------------------------- Der Kontaktbogen */
type Zeile = {
  entwurf: string; katalogname: string; series_code: string; edition: string;
  variantenfamilie: string; zelle: string; medium: string; format: string;
  breite: number | string; hoehe: number | string; bytes: number | string;
  zuordnung: string; pipeline: string; pruefdatei: string; zielpfad: string;
};
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  zahlen: Record<string, number>; zuordnungen: Zeile[];
};

const htmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const karten = manifest.zuordnungen.map((z) => {
  const bild = z.pruefdatei
    ? `<img src="${htmlEscape(z.pruefdatei)}" alt="${htmlEscape(z.entwurf)}" loading="lazy">`
    : `<div class="leer">kein Bild</div>`;
  const masse = z.breite ? `${z.breite}×${z.hoehe}` : "—";
  return `<figure class="${z.zuordnung}">
  ${bild}
  <figcaption>
    <b>${htmlEscape(z.katalogname)}</b>
    <span class="serie">${htmlEscape(z.series_code)}</span>
    <span class="edition">${htmlEscape(z.edition)}</span>
    <span class="fam">${htmlEscape(z.variantenfamilie)}</span>
    <code>${htmlEscape(z.zelle)} · ${htmlEscape(z.medium.replace("xl/media/", ""))}</code>
    <code>${htmlEscape(z.format)} ${masse} · ${z.bytes} B</code>
    <span class="status">${htmlEscape(z.zuordnung)} · ${htmlEscape(z.pipeline)}</span>
  </figcaption>
</figure>`;
}).join("\n");

const z = manifest.zahlen;
writeFileSync(`${PRUEFDIR}/galerie.html`, `<!doctype html>
<html lang="de"><meta charset="utf-8">
<title>CAT-04D — Kontaktbogen</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 1.5rem; font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  .hinweis { background: #fde68a; color: #111; padding: .75rem 1rem;
             border-radius: .5rem; margin: 1rem 0; max-width: 60rem; }
  .zahlen { color: #6b7280; margin-bottom: 1rem; }
  .raster { display: grid; gap: 1rem;
            grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); }
  figure { margin: 0; border: 1px solid #d1d5db; border-radius: .5rem;
           padding: .5rem; background: #fff; }
  figure.mehrdeutig { border-color: #f59e0b; border-width: 2px; }
  figure.fehlt { border-style: dashed; }
  img { width: 100%; height: 160px; object-fit: contain; background: #f3f4f6;
        border-radius: .25rem; }
  .leer { height: 160px; display: grid; place-items: center; color: #9ca3af;
          background: #f3f4f6; border-radius: .25rem; }
  figcaption { display: grid; gap: .15rem; margin-top: .5rem; font-size: 12px; }
  .serie, .edition, .fam { color: #6b7280; }
  code { font-size: 11px; color: #374151; word-break: break-all; }
  .status { font-size: 11px; color: #065f46; }
  figure.mehrdeutig .status { color: #92400e; }
</style>
<h1>CAT-04D — Bilder der Checkliste, den 105 Entwürfen zugeordnet</h1>
<p class="zahlen">${z.eindeutig} eindeutig · ${z.mehrdeutig} mehrdeutig ·
${z.fehlt} ohne Bild · ${z.ausgepackt} lokal ausgepackt</p>
<div class="hinweis"><b>Nutzungsrechte ungeklärt.</b> Diese Bilder stammen aus
einer fremden Checkliste und sind <b>Prüfmaterial</b>. Sie gehören nicht nach
<code>public/</code>, nicht in den Bucket <code>catalog</code> und nicht ins
Repository. Siehe <code>HERKUNFT.md</code>.</div>
<div class="raster">
${karten}
</div>
</html>
`);
console.log(`  Kontaktbogen    : ${PRUEFDIR}/galerie.html`);
