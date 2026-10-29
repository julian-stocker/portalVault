/**
 * CAT-08 — welche Basisfigur zuerst angeboten wird.
 *
 * DAS PROBLEM, DAS SIE LÖST. Beim Entwurf „White Flocked LightCore Prism
 * Break" bleiben nach den fachlichen Filtern über hundert Figuren der Serie
 * `SA` übrig, und alphabetisch sortiert steht die richtige irgendwo bei `L`.
 * Der Bediener sucht dann nach einem Namen, den er schon kennt — das ist
 * Arbeit, die eine Sortierung erledigen kann.
 *
 * DIE REGEL: eine Figur ist wahrscheinlich die Basisfigur, wenn ihr Name am
 * ENDE des Entwurfsnamens steht, an einer WORTGRENZE. Je länger das
 * gemeinsame Ende, desto wahrscheinlicher:
 *
 *   Entwurf  „White Flocked LightCore Prism Break"
 *     21  „LightCore Prism Break"   ← die richtige, und sie steht oben
 *     11  „Prism Break"
 *      0  „Spyro"
 *
 * SIE SORTIERT, SIE WÄHLT NICHT. Das ist der ganze Unterschied zu CAT-08
 * Stufe 2, und er ist ausdrücklich: eine Reihenfolge ist ein Vorschlag, den
 * ein Mensch übergeht, indem er etwas anderes anklickt. Eine Zuordnung wäre
 * eine Entscheidung. Hier wird nichts ausgewählt, nichts vorbelegt und nichts
 * veröffentlicht — `ADR-0034` bleibt unberührt, weil keine Identität aus
 * einem Namen geschlossen wird.
 *
 * SIE ENTSCHEIDET AUCH NICHT, WER ANGEBOTEN WIRD. Das tun die fachlichen
 * Filter in `fetchBaseFigures` — dieselbe Serie, sammelbar, ein Charakter,
 * keine Variante, kein Entwurf, nicht sie selbst. Eine Figur mit Rang 0 ist
 * eine gültige Basisfigur; sie steht nur weiter unten.
 *
 * VERGLICHEN WIRD MIT `endsWith`, NICHT MIT EINEM MUSTER. Ein Artikelname
 * darf `%`, `_` oder eine Klammer enthalten (CLAUDE.md Regel 4: Namen werden
 * roh übernommen), und in einem Muster wären das Platzhalter. Dieselbe
 * Entscheidung wie im Rumpf von `0161`, der `right()` statt `like` benutzt.
 */

/** Kleinschreiben und Mehrfachleerzeichen falten — sonst nichts. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Wie gut `kandidat` als Basisfigur zu `entwurf` passt.
 *
 * Der Rang ist die LÄNGE des gemeinsamen Endes, oder `0`. Gleicher Name
 * zählt nicht: eine Figur kann nicht ihre eigene Variante sein, und zwei
 * gleichnamige Zeilen DERSELBEN Serie gibt es nicht (`skylanders_id_series_uniq`).
 */
export function baseRank(entwurf: string, kandidat: string): number {
  const e = norm(entwurf);
  const k = norm(kandidat);
  if (k === "" || e === "" || k === e) return 0;
  /* An der Wortgrenze: „Shot Dog" endet nicht auf „ Hot Dog". */
  return e.endsWith(` ${k}`) ? k.length : 0;
}

/**
 * Die Vorsilbe, die übrig bleibt — für die Anzeige, nicht für eine Regel.
 *
 * Bei „White Flocked LightCore Prism Break" gegen „LightCore Prism Break"
 * ist das „White Flocked". Der Dialog kann damit sagen, WARUM eine Figur
 * oben steht, statt den Bediener raten zu lassen.
 */
export function basePrefix(entwurf: string, kandidat: string): string {
  if (baseRank(entwurf, kandidat) === 0) return "";
  const e = entwurf.trim().replace(/\s+/g, " ");
  return e.slice(0, e.length - kandidat.trim().replace(/\s+/g, " ").length - 1);
}

/**
 * Das zweite, schwächere Signal: kommt JEDES Wort des Kandidaten im
 * Entwurfsnamen vor?
 *
 * WARUM ES NÖTIG IST, und es ist am echten Bestand aufgefallen: die
 * LightCore-Figur in `G` heißt **„Prism Break Light Core"** — die
 * SUFFIXform. Der Entwurf heißt „White Flocked LightCore Prism Break" — die
 * PRÄFIXform, und „LightCore" ohne Leerzeichen. Beide Schreibweisen stehen
 * so in der Arbeitsmappe (`variant.ts` beschreibt sie seit V3.6), und die
 * Suffixregel findet die richtige Figur deshalb NICHT: sie bekommt Rang 0
 * und stünde alphabetisch irgendwo bei `P`.
 *
 * DIE REGEL: verglichen wird gegen den Entwurfsnamen OHNE Leerzeichen, damit
 * „Light Core" auch in „LightCore" gefunden wird. Gezählt werden die Wörter
 * des Kandidaten, und nur wenn ALLE vorkommen:
 *
 *   „Prism Break Light Core"  -> prism, break, light, core  -> 4
 *   „Prism Break"             -> prism, break               -> 2
 *   „Chill Light Core"        -> chill fehlt                -> 0
 *
 * MINDESTENS ZWEI WÖRTER. Ein einzelnes Wort ist zu wenig: „Bash" käme sonst
 * bei „Bone Bash Roller Brawl" nach oben, und genau dieser Fall steht in
 * ADR-0034 als Gegenbeispiel. Zwei Wörter sind eine Aussage, eines ist ein
 * Zufall.
 *
 * ES BLEIBT EINE SORTIERUNG. Auch dieses Signal wählt nichts aus — es hebt
 * eine Zeile ein paar Plätze nach oben, und der Bediener klickt weiterhin
 * selbst.
 */
export function baseWordScore(entwurf: string, kandidat: string): number {
  const woerter = norm(kandidat).split(" ").filter((w) => w !== "");
  if (woerter.length < 2) return 0;
  /* Ohne Leerzeichen: „light core" steckt dann in „lightcore". */
  const heuhaufen = norm(entwurf).replace(/ /g, "");
  return woerter.every((w) => heuhaufen.includes(w)) ? woerter.length : 0;
}

export type MitNamen = { skyId: string; nameRaw: string; name: string };

/**
 * Nach Rang, dann nach Name — stabil und ohne Zufall.
 *
 * DIE ZWEITE STUFE IST DER ROHE NAME und nicht der Anzeigename: zwei Figuren
 * mit demselben redaktionellen Namen stünden sonst in wechselnder
 * Reihenfolge, je nachdem, was die Datenbank zuerst liefert. Bei gleichem
 * Rang und gleichem Namen entscheidet die SKY-ID, und die ist eindeutig.
 */
export function sortByBaseRank<T extends MitNamen>(
  entwurf: string, kandidaten: readonly T[],
): T[] {
  return [...kandidaten].sort((a, b) => {
    /* ERST DAS STARKE SIGNAL: das gemeinsame Ende an einer Wortgrenze. */
    const ra = baseRank(entwurf, a.nameRaw);
    const rb = baseRank(entwurf, b.nameRaw);
    if (ra !== rb) return rb - ra;
    /* DANN DAS SCHWACHE: wie viele Wörter des Kandidaten im Entwurf stehen.
       Es entscheidet nur, wo die Suffixregel schweigt. */
    const wa = baseWordScore(entwurf, a.nameRaw);
    const wb = baseWordScore(entwurf, b.nameRaw);
    if (wa !== wb) return wb - wa;
    return a.nameRaw.localeCompare(b.nameRaw, "de") || a.skyId.localeCompare(b.skyId);
  });
}
