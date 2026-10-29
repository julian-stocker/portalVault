"""CAT-03 — aus den CAT-01-Kandidaten werden Katalogentwuerfe. Nur lesend.

AUFRUF: ueber `tools/cat03-drafts.mts` (`npm run cat03:drafts:staging`), nie direkt —
die Momentaufnahme holt das .mts, und nur es kennt den Waechter.

WAS DIESE DATEI TUT

  1. sie rechnet den CAT-01B-Abgleich NEU, aber gegen den VOLLSTAENDIGEN
     Katalog statt gegen die oeffentlich sichtbaren Zeilen
  2. sie nennt die Kandidaten, die dadurch von "fehlend" zu "vorhanden"
     wechseln — das ist der eigentliche Zweck des Laufs
  3. sie baut fuer jeden verbleibenden Kandidaten einen Entwurfsdatensatz
  4. sie validiert ihn gegen die echten CHECKs des Schemas
  5. sie haelt zurueck, was das Datenmodell nicht ausdruecken kann

WAS SIE NICHT TUT: keine Datenbankaenderung, keine SKY-ID, kein Bild
extrahieren, kein Schreiben nach `data/`, `public/` oder `supabase/`.

DER MASSSTAB FUER EINE IDENTITAET IST NICHT DER NAME. Eine Namensgleichheit
ist ein Suchhilfsmittel; die 28 wiederholten Namen im Katalog sind
Wiederveroeffentlichungen derselben Figur in einer anderen Serie (CAT-01A).
Deshalb traegt jeder Entwurf seinen Verifikationsstatus, und was nicht
eindeutig ist, wird NICHT vorbereitet.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ANALYSE = Path("resources/analysis")
VOLL = ANALYSE / "cat-03-katalog-vollstaendig.json"
KATEGORIEN = ANALYSE / "cat-03-kategorien.json"
CAT01_CSV = ANALYSE / "cat-01-differenz.csv"
CHARAKTERE = Path("data/characters/characters.json")


def _lade_cat01():
    """Den CAT-01B-Abgleich als Modul laden — der Bindestrich verbietet `import`."""
    pfad = Path("tools/lib/cat01-diff.py")
    spec = importlib.util.spec_from_file_location("cat01_diff", pfad)
    modul = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modul)
    return modul


D = _lade_cat01()

# ---------------------------------------------------------------- Die Edition
#
# GEMESSEN AM BESTEHENDEN KATALOG, NICHT GERATEN. Jede Zeile dieser Tabelle
# ist an den 594 oeffentlichen Zeilen nachgezaehlt (Stand 2026-10-27):
#
#   legendary        25 von 25 tragen card_type 'legendary'
#   elite            14 von 14 tragen 'elite'
#   lightcore        16 von 17 tragen 'special'   (eine ist 'legendary')
#   Kristallfarben   13 von 13 tragen 'chase'
#   clear/pearl      10 von 10 tragen 'chase'
#   metallic, glow,   7 von  7 tragen 'chase'
#   jade
#   mini, sidekick   28 von 28 tragen 'standard'
#
# UND WAS NICHT EINDEUTIG IST, STEHT HIER NICHT: `gold`/`golden` verteilt
# sich auf FUENF card_types (chase 4, standard 3, prestige 1, special 1,
# dark 1). Daraus eine Regel zu machen waere eine Erfindung. Solche Entwuerfe
# bekommen 'standard' und die Marke `edition_unsicher` — der Admin entscheidet
# im bestehenden Formular, und das ist dort eine Sekunde Arbeit.
EDITION = {
    "legendary": "legendary",
    "elite": "elite",
    "dark": "dark",
    "lightcore": "special",
    "light core": "special",
    "red crystal": "chase", "green crystal": "chase", "blue crystal": "chase",
    "purple crystal": "chase", "clear crystal": "chase", "crystal clear": "chase",
    "clear": "chase", "pearl": "chase", "metallic": "chase",
    "metallic purple": "chase", "metallic green": "chase",
    "glow": "chase", "jade": "chase",
    "mini": "standard", "sidekick": "standard",
}

#: Merkmale, bei denen die Messung KEINE Regel hergibt.
EDITION_UNSICHER = {"gold", "golden", "silver", "chrome", "granite", "molten",
                    "polar", "flocked", "white flocked", "patina", "steel plated",
                    "springtime", "volcanic", "eggsellent", "jingle bell",
                    "frito lay", "easter", "glitter", "royale", "nitro",
                    "rock candy", "green", "red", "blue", "purple", "pink",
                    "orange", "bronze"}

#: Die fuenf erlaubten `item_type`-Werte (0135, CHECK in Zeile 219).
ITEM_TYPES = ("figure", "game", "portal", "bundle", "other")

#: Die sieben erlaubten `card_type`-Werte (0032, CHECK in Zeile 64).
CARD_TYPES = ("standard", "special", "elite", "dark", "legendary", "chase", "prestige")

# ------------------------------------------------------------- Die Kategorie
#
# `item_type` kennt fuenf Werte und ist absichtlich grob: eine Falle, ein
# Fahrzeug und ein Kreationskristall sind alle `figure`. Was sie
# unterscheidet, ist die KATEGORIE je Serie — und die existiert schon
# (`data/catalog/category-groups.json`, ADR-0041). Eine Kategorie wird NICHT
# erfunden, und wo keine passt, wird der Kandidat zurueckgehalten.
#
# ZWEI WEGE, UND DER ERSTE IST DER STARKE
#
#   1. DIE GRUNDFIGUR ENTSCHEIDET. 86 der 105 Kandidaten sind Varianten —
#      "Chase Variants", "In-Game Variants", "Variant Creation Crystals".
#      Eine Variante gehoert dorthin, wo ihre Grundfigur steht: "Chrome
#      Spyro" zu Spyro. Das ist gemessen und nicht geraten, und es faengt
#      genau den Fehler ab, der beim ersten Lauf entstand — eine gewoehnliche
#      Giants-Figur landete in "Giants grosse Figuren", weil die Auswahl
#      einfach die erste Kategorie mit "figuren" im Namen nahm. Eine grosse
#      Figur ist aber etwas anderes als eine neue.
#
#   2. NUR WENN ES KEINE GRUNDFIGUR GIBT, entscheidet der Abschnitt der
#      Quelle — und zwar ueber diese ausdrueckliche Tabelle, Serie fuer
#      Serie. Jeder Eintrag ist an den tatsaechlichen Abschnittsnamen der
#      Quelle und den tatsaechlichen Kategorienamen des Katalogs belegt.
#
# Und wenn beides nichts hergibt, wird NICHT eingeordnet.

#: (Serie, Abschnitt) -> Kategoriename. Fuer Variantenabschnitte, die KEINE
#: Grundfigur in ihrer Serie haben.
#:
#: GEMESSEN AM KATALOG, Zeile fuer Zeile — jede Zuordnung ist an bestehenden
#: Zeilen derselben Art belegt:
#:
#:   SF  "Varianten & LightCore" fuehrt 27 Zeilen, und zwar genau solche:
#:       SKY-0272 "Springtime Trigger Happy", SKY-0275 "Fire Bone Hot Dog
#:       (Clear Crystal Red)". Es IST die Variantenkategorie der Serie.
#:   SC  hat keine Variantenkategorie, und die Varianten liegen dort bei den
#:       Figuren bzw. Fahrzeugen: SKY-0483 "Steel Plated Smash Hit" →
#:       "Figuren", SKY-0509 "Power Blue Gold Rusher" → "Fahrzeuge".
#:   I   hat ebenfalls keine, und die Senseis fuehren 46 der 87 Zeilen;
#:       eine Sensei-Variante gehoert dorthin.
#:
#: SA, G und T stehen hier NICHT: dort hat praktisch jede Variante ihre
#: Grundfigur im Katalog, und Weg 1 greift. Einen Eintrag auf Verdacht
#: anzulegen waere eine Regel ohne Beleg.
SERIE_ABSCHNITT_KATEGORIE = {
    ("SF", "Chase Variants"):          "Varianten & LightCore",
    ("SF", "In-Game Variants"):        "Varianten & LightCore",
    ("SF", "LightCore Skylanders"):    "Varianten & LightCore",
    ("SC", "Chase Variant"):           "Figuren",
    ("SC", "In-Game Variant"):         "Figuren",
    ("SC", "Chase Variant Vehicles"):  "Fahrzeuge",
    ("SC", "In-Game Variant Vehicles"): "Fahrzeuge",
    ("I",  "Chase Variant"):           "Senseis",
    ("I",  "In-Game Variant"):         "Senseis",
}

#: Abschnitt der Quelle -> Kategoriename im Katalog, serienuebergreifend.
#:
#: Die Serien fuehren verschiedene Namen fuer dieselbe Sache: Magische
#: Gegenstaende heissen in SA/G/SF "Magic Items", in T "Trap Items" und in I
#: "Locations & Truhen"; in SC gibt es sie als "Trophies". Deshalb steht hier
#: eine Liste je Abschnitt und nicht ein Name.
ABSCHNITT_KATEGORIE = {
    "Magic Items":                   ("Magic Items", "Trap Items", "Locations & Truhen", "Trophies"),
    "Magic Items and Level Pieces":  ("Magic Items", "Locations & Truhen"),
    "Creation Crystals":             ("Kreationskristalle",),
    "Variant Creation Crystals":     ("Kreationskristalle",),
    "Traptanium Crystal Traps":      ("Traps",),
    "Traptanium Crystal Trap Variants": ("Traps",),
    "Trappable Villain Variants":    ("Traps",),
    "Traps":                         ("Traps",),
    "Vehicles":                      ("Fahrzeuge",),
    "Chase Variant Vehicles":        ("Fahrzeuge",),
    "In-Game Variant Vehicles":      ("Fahrzeuge",),
    "LightCore Skylanders":          ("Varianten & LightCore",),
    "Chase Variant Villain Sensei":  ("Senseis",),
    "SuperCharger Skylanders":       ("Figuren",),
    "Senseis":                       ("Senseis",),
}


def kategorie_fuer(e: dict, basis: list[dict], kat_nach_serie: dict,
                   kat_nach_id: dict) -> tuple[int | None, str, str]:
    """(category_id, name, begruendung) — oder (None, '', Grund) zum Zurueckhalten."""
    serie = e["serie"]
    vorhanden = kat_nach_serie.get(serie, {})
    if not vorhanden:
        return None, "", f"Serie {serie or '?'} hat im Katalog keine Kategorien"

    # ---- WEG 1: die Grundfigur, und nur wenn sie EINDEUTIG ist.
    gleiche_serie = [r for r in basis if r["series_code"] == serie and r.get("category_id")]
    ids = {r["category_id"] for r in gleiche_serie}
    if len(ids) == 1:
        kid = next(iter(ids))
        name = kat_nach_id.get(kid, "")
        if name:
            return kid, name, (f"wie die Grundfigur: {len(gleiche_serie)} Zeile(n) "
                               f"({', '.join(sorted(r['sky_id'] for r in gleiche_serie)[:4])}) "
                               f"stehen alle in {name!r}")
    if len(ids) > 1:
        namen = sorted(filter(None, (kat_nach_id.get(i, "") for i in ids)))
        # MEHRERE KATEGORIEN HEISST NICHT EINDEUTIG, nicht "nimm die erste".
        return None, "", (f"die Grundfigur steht in {len(ids)} verschiedenen Kategorien "
                          f"({namen}) — die Variante ist nicht zweifelsfrei einzuordnen")

    # ---- WEG 2a: die Variantenkategorie der Serie, wo es eine gibt.
    name = SERIE_ABSCHNITT_KATEGORIE.get((serie, e["abschnitt"]))
    if name and name in vorhanden:
        return vorhanden[name], name, (f"keine Grundfigur in Serie {serie}; "
                                       f"Abschnitt {e['abschnitt']!r} gehoert dort "
                                       f"nach {name!r} (am Katalog belegt)")

    # ---- WEG 2b: der Abschnitt der Quelle, ueber die ausdrueckliche Tabelle.
    for name in ABSCHNITT_KATEGORIE.get(e["abschnitt"], ()):
        if name in vorhanden:
            return vorhanden[name], name, (f"keine Grundfigur im Katalog; Abschnitt "
                                           f"{e['abschnitt']!r} → vorhandene Kategorie {name!r}")

    return None, "", (f"keine Grundfigur im Katalog, und der Abschnitt "
                      f"{e['abschnitt']!r} hat in Serie {serie} keine zugeordnete "
                      f"Kategorie (vorhanden: {sorted(vorhanden)})")


def edition_fuer(merkmale: set[str]) -> tuple[str, bool, str]:
    """(card_type, unsicher, begruendung)."""
    treffer = sorted({EDITION[m] for m in merkmale if m in EDITION})
    unsicher = sorted(m for m in merkmale if m in EDITION_UNSICHER)
    if len(treffer) == 1:
        return treffer[0], bool(unsicher), (
            f"gemessen am Katalog: {sorted(m for m in merkmale if m in EDITION)} → {treffer[0]}"
            + (f"; zusaetzlich unklares Merkmal {unsicher}" if unsicher else ""))
    if len(treffer) > 1:
        return "standard", True, (f"mehrere Editionen gleichzeitig moeglich ({treffer}) — "
                                  f"der Admin entscheidet")
    if unsicher:
        return "standard", True, (f"Merkmal {unsicher} verteilt sich im Katalog auf "
                                  f"mehrere card_types — keine Regel, der Admin entscheidet")
    if not merkmale:
        return "standard", False, "kein Variantenmerkmal — Standardausfuehrung"
    return "standard", True, f"Merkmal {sorted(merkmale)} im Katalog nicht belegt"


def main() -> int:
    if not VOLL.exists() or not KATEGORIEN.exists():
        print(f"CAT-03 ABBRUCH: {VOLL} oder {KATEGORIEN} fehlt.", file=sys.stderr)
        return 1
    xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    if not xlsx or not Path(xlsx).exists():
        print("CAT-03 ABBRUCH: Quelldatei fehlt.", file=sys.stderr)
        return 1

    befund = D.sicherheitstor(xlsx)
    quelle = D.lies_quelle(xlsx)
    katalog = json.loads(VOLL.read_text())
    kategorien = json.loads(KATEGORIEN.read_text())

    kat_nach_serie: dict[str, dict[str, int]] = defaultdict(dict)
    kat_nach_id: dict[int, str] = {}
    for c in kategorien:
        kat_nach_serie[c["series_code"]][c["name"]] = c["id"]
        kat_nach_id[c["id"]] = c["name"]

    print(f"  Quelle         : {len(quelle)} Eintraege")
    print(f"  Katalog        : {len(katalog)} Zeilen, davon "
          f"{sum(1 for r in katalog if not r.get('catalog_visible'))} nicht oeffentlich")
    print(f"  Kategorien     : {len(kategorien)} in {len(kat_nach_serie)} Serien")

    # ------------------------------------------------- 1. Abgleich, neu gerechnet
    zeilen, rest = D.vergleiche(quelle, katalog)

    # ------------------------- 2. Was sich gegen den vollen Katalog aendert
    alt = {}
    if CAT01_CSV.exists():
        with CAT01_CSV.open(encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter=";"):
                alt[(r["quellname"], r["quellserie"], r["abschnitt"])] = r
    FEHLT = ("Fehlende Figur", "Fehlende Variante", "Fehlendes Zubehör/Sammelobjekt")
    gewandert = []
    for z in zeilen:
        a = alt.get((z["quellname"], z["quellserie"], z["abschnitt"]))
        if a and a["einordnung"] in FEHLT and z["einordnung"] not in FEHLT:
            versteckt = next((r for r in katalog if r["sky_id"] == z["sky_id"]), None)
            gewandert.append({**z, "vorher": a["einordnung"],
                              "war_versteckt": bool(versteckt and not versteckt.get("catalog_visible"))})

    print(f"  Berichtigt     : {len(gewandert)} Kandidat(en) existieren doch — "
          f"{sum(1 for g in gewandert if g['war_versteckt'])} davon als versteckte Zeile")

    # ------------------------------------------------- 3. Entwuerfe bauen
    nach_quelle = {(e["name"], e["serie"], e["abschnitt"]): e for e in quelle}
    entwuerfe, zurueckgehalten, unklar = [], [], []

    for z in zeilen:
        if z["einordnung"] in ("Nicht eindeutig", "Mögliche Dublette"):
            unklar.append(z)
            continue
        if z["einordnung"] not in FEHLT:
            continue
        e = nach_quelle[(z["quellname"], z["quellserie"], z["abschnitt"])]
        merkmale = set(filter(None, z["merkmale"].split(",")))

        basis = [r for r in katalog if r.get("_kern") == z["kern"]]
        kat_id, kat_name, kat_grund = kategorie_fuer(e, basis, kat_nach_serie, kat_nach_id)
        if kat_id is None:
            zurueckgehalten.append({**z, "grund": kat_grund})
            continue

        card_type, unsicher, ed_grund = edition_fuer(merkmale)

        entwuerfe.append({
            # DER NAME KOMMT ROH AUS DER QUELLE (CLAUDE.md, Regel 4): kein
            # strip(), keine Normalisierung, keine stille Korrektur.
            "katalogname": z["quellname"],
            "series_code": e["serie"],
            "item_type": "figure",
            "category_id": kat_id,
            "category_name": kat_name,
            "category_begruendung": kat_grund,
            "card_type": card_type,
            "card_type_unsicher": unsicher,
            "card_type_begruendung": ed_grund,
            "objekttyp_quelle": e["typ"],
            "abschnitt_quelle": e["abschnitt"],
            "grundfigur": z["kern"],
            "variantenfamilie": ",".join(sorted(merkmale)) or "(Standardausfuehrung)",
            "referenz_sky_id": ",".join(sorted(r["sky_id"] for r in basis)) or "",
            # ELEMENT: die Quelle fuehrt KEINE Elementangabe (CAT-01A,
            # Abschnitt B). Es wird deshalb nicht gesetzt und nicht geraten.
            "element": None,
            "element_grund": "die Quelle fuehrt keine Elementangabe (CAT-01A)",
            # CHARACTER_ID: nur wenn der Kern GENAU EINE bestehende
            # Charakteridentitaet trifft. Alles andere ist Kuratierung und
            # gehoert nach `data/characters/characters.json` (ADR-0034).
            "character_id": None,
            "catalog_status": "draft",
            # SOURCE IST 'admin' UND NICHT 'cat01' — der CHECK aus `0033`
            # kennt genau zwei Werte, und das ist kein Hindernis, sondern
            # richtig: `source` sagt dem Katalogimport, welche Zeilen NICHT
            # ihm gehoeren. Eine Zeile mit `source = 'import'` erschiene
            # sonst dauerhaft in seiner Warnung „in der Datenbank, aber nicht
            # im Export" (0033, Abschnitt 1). Die Herkunft `cat01` steht
            # deshalb in der internen Notiz, wo interne Angaben hingehoeren
            # (ADR-0039) — und nie auf `skylanders`, die weltlesbar ist.
            "source": "admin",
            "herkunft": "cat01",
            # DIE NOTIZ SAGT, WAS IST — nicht, was vermutet wird. „Kein Bild
            # uebernommen" gehoert dazu: eine Zeile ohne Bild und mit dem
            # Hinweis „Bildrechte ungeklaert" liesse sonst offen, ob doch
            # eines kopiert wurde.
            "admin_note": f"CAT-01 Kandidat, Quelle {e['zelle']} der externen "
                          f"Checkliste ({e['abschnitt']}). Kein Bild uebernommen; "
                          f"externe Bildrechte ungeklaert.",
            # KEIN SLUG IM VORAUS. Er entsteht in der Datenbank aus
            # `next_figure_slug(name, serie, sky_id)` und braucht die SKY-ID,
            # die es hier nicht gibt. Ein vorab gesetzter Slug waere eine
            # zweite Wahrheit, die beim ersten Namenskonflikt auseinanderfaellt.
            "slug_basis_informativ": D.falte(z["quellname"]).replace(" ", "-"),
            # KEIN PREIS. `market_price` NULL heisst „kein bekannter Marktpreis"
            # (ADR-0010); 0 ist ausdruecklich verboten. Preise sind der
            # Legacy-Weg (ADR-0007) und nicht Sache dieses Laufs.
            "market_price": None,
            # ---- BILDER. Drei Angaben, und keine davon uebernimmt etwas.
            #
            # 1. EIN VORHANDENES PROJEKTBILD, falls die Grundfigur genau
            #    eines fuehrt. Das ist kein Notbehelf, sondern die ERPROBTE
            #    PRAXIS dieses Katalogs: SKY-0274 "Fire Bone Hot Dog" und
            #    seine drei Clear-Crystal-Varianten teilen
            #    `d194a0598ade80a0.webp`, und 44 Bilder werden so von
            #    mehreren Zeilen benutzt. Die Herkunft ist geklaert (es liegt
            #    schon im Projekt), die Nutzung ebenfalls.
            #
            #    ES BLEIBT EIN VORSCHLAG. Ob eine Variante wirklich so
            #    aussieht, entscheidet der Admin am Bild — "Chrome Spyro" tut
            #    es sicher nicht. Deshalb wird nichts gesetzt.
            #
            # 2. DIE EXTERNE BILDREFERENZ, nur als Pfad INNERHALB der .xlsx.
            #    Kein Download, keine Extraktion, keine Uebernahme nach
            #    `public/`. Die Rechte sind ungeklaert und bleiben es, bis
            #    jemand sie klaert.
            #
            # 3. EIN PLATZHALTER, wenn es keinen Vorschlag gibt — die
            #    Adminansicht zeigt dann, dass ein Bild FEHLT, und nicht ein
            #    falsches.
            "bildvorschlag": "",
            "bildvorschlag_von": "",
            "bildquelle_extern": e["bild"] or "",
            "bildrechte_extern": "unverified" if e["bild"] else "kein_bild",
            "bildstatus": "missing",
            "platzhalter": True,
            "quelle_url": e["url"],
            "quelle_zelle": e["zelle"],
            "verifikation": "name_und_abschnitt_der_quelle",
            "konfidenz": z["konfidenz"],
            "einordnung": z["einordnung"],
            "begruendung": z["begruendung"],
        })

    # ---------------------------------- 3b. Bildvorschlag aus dem Projekt
    #
    # NUR BEI GENAU EINEM BILD. Fuehrt die Grundfigur zwei verschiedene, ist
    # keines "eindeutig passend" — dann bleibt es beim Platzhalter. Eine
    # Mehrheitsentscheidung unter Bildern waere geraten.
    bilder_je_kern: dict[tuple[str, str], set[str]] = defaultdict(set)
    quelle_je_kern: dict[tuple[str, str], set[str]] = defaultdict(set)
    for r in katalog:
        if r.get("image_file") and r.get("_kern"):
            bilder_je_kern[(r["_kern"], r["series_code"])].add(r["image_file"])
            quelle_je_kern[(r["_kern"], r["series_code"])].add(r["sky_id"])
    for d in entwuerfe:
        schluessel = (d["grundfigur"], d["series_code"])
        bilder = bilder_je_kern.get(schluessel, set())
        if len(bilder) == 1:
            d["bildvorschlag"] = next(iter(bilder))
            d["bildvorschlag_von"] = ",".join(sorted(quelle_je_kern[schluessel])[:4])
            d["bildstatus"] = "projektbild_vorschlag"
            d["platzhalter"] = False

    # -------------------------- 4. Charakteridentitaet, nur wenn eindeutig
    if CHARAKTERE.exists():
        roh = json.loads(CHARAKTERE.read_text())
        liste = roh.get("characters", roh) if isinstance(roh, dict) else roh
        nach_name: dict[str, list[dict]] = defaultdict(list)
        for c in liste:
            if isinstance(c, dict) and c.get("name"):
                nach_name[D.falte(c["name"])].append(c)
        for d in entwuerfe:
            treffer = nach_name.get(d["grundfigur"], [])
            if len(treffer) == 1:
                d["character_id"] = treffer[0].get("character_id") or treffer[0].get("id")
                d["verifikation"] += "+charakter_eindeutig"

    # ----------------------------------------------- 5. Validierung
    fehler = []
    gesehen: dict[tuple, str] = {}
    for d in entwuerfe:
        wo = f"{d['katalogname']} ({d['series_code']})"
        if not d["katalogname"]:          fehler.append(f"{wo}: kein Name")
        if not d["series_code"]:          fehler.append(f"{wo}: keine Serie")
        if d["item_type"] not in ITEM_TYPES:  fehler.append(f"{wo}: item_type ungueltig")
        if d["card_type"] not in CARD_TYPES:  fehler.append(f"{wo}: card_type ungueltig")
        if not isinstance(d["category_id"], int): fehler.append(f"{wo}: keine category_id")
        if d["catalog_status"] != "draft":  fehler.append(f"{wo}: Status ist nicht draft")
        if d["source"] not in ("import", "admin"):
            fehler.append(f"{wo}: source {d['source']!r} verletzt den CHECK aus 0033")
        # DER NAME MUSS EINEN SLUG ERGEBEN. `next_figure_slug` bricht sonst
        # mit `check_violation` ab — besser hier als im Lauf.
        if not d["slug_basis_informativ"]:
            fehler.append(f"{wo}: der Name ergibt einen leeren Slug")
        if d["market_price"] is not None and d["market_price"] <= 0:
            fehler.append(f"{wo}: market_price muss NULL oder > 0 sein (0001)")
        # DUBLETTENPRUEFUNG UNTER DEN ENTWUERFEN SELBST. Die SKY-ID-Sequenz
        # verhindert ID-Kollisionen, aber keine fachlichen Dubletten — das
        # sind zwei getrennte Risiken (CAT-02B).
        schluessel = (D.falte(d["katalogname"]), d["series_code"])
        if schluessel in gesehen:
            fehler.append(f"{wo}: Dublette zu {gesehen[schluessel]} innerhalb der Entwuerfe")
        else:
            gesehen[schluessel] = wo
        # UND GEGEN DEN KATALOG, ein zweites Mal und leerzeichenblind.
        eng = D.falte(d["katalogname"]).replace(" ", "")
        for r in katalog:
            kn = D.falte(r.get("display_name_override") or r["name"]).replace(" ", "")
            if kn == eng and r["series_code"] == d["series_code"]:
                fehler.append(f"{wo}: Name trifft {r['sky_id']} in derselben Serie")

    # ----------------------------------------------------- 6. Ausgaben
    ANALYSE.mkdir(parents=True, exist_ok=True)
    (ANALYSE / "cat-03-entwuerfe.json").write_text(
        json.dumps({
            "erzeugt_aus": {"quelle": xlsx, "katalog": str(VOLL),
                            "katalogzeilen": len(katalog),
                            "nicht_oeffentlich": sum(1 for r in katalog
                                                     if not r.get("catalog_visible"))},
            "sicherheitsbefund": befund,
            "entwuerfe": entwuerfe,
            "zurueckgehalten": zurueckgehalten,
            "unklar": unklar,
            "berichtigt_gegen_cat01": gewandert,
            "validierungsfehler": fehler,
        }, ensure_ascii=False, indent=1), encoding="utf-8")

    spalten = ["katalogname", "series_code", "item_type", "category_name", "card_type",
               "card_type_unsicher", "grundfigur", "variantenfamilie", "referenz_sky_id",
               "element", "character_id", "catalog_status", "source", "herkunft",
               "bildstatus", "bildvorschlag", "bildvorschlag_von", "bildquelle_extern",
               "bildrechte_extern", "platzhalter", "quelle_url", "konfidenz", "einordnung"]
    with (ANALYSE / "cat-03-entwuerfe.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=spalten, delimiter=";", extrasaction="ignore")
        w.writeheader()
        for d in entwuerfe:
            w.writerow(d)

    # ------------------------------------------------- 7. Der Bericht
    #
    # ER GEHOERT INS WERKZEUG UND NICHT IN EINE HANDGESCHRIEBENE DATEI: eine
    # Zahl, die jemand abgetippt hat, ist beim naechsten Lauf falsch.
    fam = Counter(d["variantenfamilie"] for d in entwuerfe)
    ser = Counter(d["series_code"] for d in entwuerfe)
    kat = Counter(f"{d['series_code']}/{d['category_name']}" for d in entwuerfe)
    zeilen_md = [
        "# CAT-03 — vorbereitete Katalogentwuerfe",
        "",
        "**Erzeugt von `npm run cat03:drafts:staging`.** Nicht von Hand geschrieben;",
        "jede Zahl hier ist beim letzten Lauf gemessen worden.",
        "",
        "**Nichts davon ist importiert.** Es gibt keinen Schreibzugriff, keine neue",
        "SKY-ID und kein uebernommenes Bild.",
        "",
        "## Die Zahlen",
        "",
        "| | |",
        "|---|---:|",
        f"| vollstaendig vorbereitete Entwuerfe | **{len(entwuerfe)}** |",
        f"| davon mit Projektbild-Vorschlag | {sum(1 for d in entwuerfe if d['bildstatus'] == 'projektbild_vorschlag')} |",
        f"| davon mit Platzhalter (Bild fehlt) | {sum(1 for d in entwuerfe if d['platzhalter'])} |",
        f"| externe Bildrechte ungeklaert | {sum(1 for d in entwuerfe if d['bildrechte_extern'] == 'unverified')} |",
        f"| Edition unsicher (Admin entscheidet) | {sum(1 for d in entwuerfe if d['card_type_unsicher'])} |",
        f"| bereits vorhanden — gegen CAT-01B berichtigt | **{len(gewandert)}** |",
        f"| davon als VERSTECKTE Zeile gefunden | {sum(1 for g in gewandert if g['war_versteckt'])} |",
        f"| unklare Zuordnungen (nicht vorbereitet) | **{len(unklar)}** |",
        f"| zurueckgehalten (nicht einordenbar) | **{len(zurueckgehalten)}** |",
        f"| Katalogzeilen ohne Quellbezug | {len(rest)} |",
        f"| Validierungsfehler | {len(fehler)} |",
        "",
        "## Aufteilung nach Spielserie",
        "",
        "| Serie | Entwuerfe |",
        "|---|---:|",
    ]
    zeilen_md += [f"| {k} | {v} |" for k, v in sorted(ser.items())]
    zeilen_md += ["", "## Aufteilung nach Kategorie", "",
                  "| Serie / Kategorie | Entwuerfe |", "|---|---:|"]
    zeilen_md += [f"| {k} | {v} |" for k, v in sorted(kat.items())]
    zeilen_md += ["", "## Aufteilung nach Variantenfamilie", "",
                  "| Familie | Entwuerfe |", "|---|---:|"]
    zeilen_md += [f"| {k} | {v} |" for k, v in fam.most_common()]

    zeilen_md += ["", "## Konkrete Hindernisse fuer die Uebernahme", ""]
    if len(katalog) < 820:
        zeilen_md += [
            f"**1. Der Vergleich lief gegen Staging mit {len(katalog)} Zeilen, nicht gegen",
            "die vollen 820 SKY-IDs.** Staging ist eine unvollstaendige Kopie. Ein",
            "Kandidat, der hier fehlt, kann auf Production stehen — und dann waere ein",
            "Import eine fachliche Dublette mit einer neuen, dauerhaften SKY-ID.",
            "**Das ist das groesste Hindernis, und es ist loesbar:** derselbe Abgleich",
            "gegen Production, rein lesend, vor dem Import.",
            "",
        ]
    zeilen_md += [
        "**2. `0152` ist nirgends angewendet.** Ohne `catalog_status` kann ein Entwurf",
        "nicht als Entwurf entstehen. `supabase/checks/0152_staging_run.md` ist der Weg.",
        "",
        "**3. Die Bildrechte sind ungeklaert.** Die Quelle ist eine fremde Checkliste;",
        "ihre Bilder sind hier nur als PFAD INNERHALB der Datei vermerkt. Es wurde",
        "nichts extrahiert, nichts geladen, nichts nach `public/` kopiert.",
        "",
        "**4. Kein Element.** Die Quelle fuehrt keine Elementangabe (CAT-01A). Sie",
        "wird nicht geraten; `character_id` bleibt leer, wo sie nicht eindeutig ist.",
        "",
        "**5. Die Editionen.** "
        f"{sum(1 for d in entwuerfe if d['card_type_unsicher'])} Entwuerfe tragen",
        "`standard` mit der Marke `card_type_unsicher`, weil sich ihr Merkmal im",
        "Katalog auf mehrere `card_type`-Werte verteilt. Das ist im Adminformular",
        "eine Sekunde Arbeit, aber es sind eben "
        f"{sum(1 for d in entwuerfe if d['card_type_unsicher'])} Sekunden.",
        "",
    ]
    if unklar:
        zeilen_md += ["## Die unklaren Zuordnungen — NICHT vorbereitet", "",
                      "Diese Eintraege waren **keine** Ergaenzungskandidaten. Sie werden",
                      "gegen den VOLLSTAENDIGEN Katalog mehrdeutig, weil er mehr",
                      "Elite-Zeilen fuehrt als die oeffentliche Momentaufnahme. Aus ihnen",
                      "entsteht kein Entwurf — eine Namensnormalisierung ist ein",
                      "Suchhilfsmittel, kein Identitaetsbeweis.", "",
                      "| Quellname | Serie | Grund |", "|---|---|---|"]
        zeilen_md += [f"| {u['quellname']} | {u['quellserie']} | {u['begruendung'][:150]} |"
                      for u in unklar]
        zeilen_md += [""]
    if zurueckgehalten:
        zeilen_md += ["## Zurueckgehalten — das Datenmodell traegt sie nicht", "",
                      "| Quellname | Serie | Grund |", "|---|---|---|"]
        zeilen_md += [f"| {z['quellname']} | {z['quellserie']} | {z['grund'][:150]} |"
                      for z in zurueckgehalten]
        zeilen_md += [""]
    if gewandert:
        zeilen_md += ["## Gegen CAT-01B berichtigt — sie existieren doch", "",
                      "Diese Kandidaten galten in CAT-01B als fehlend. Der Abgleich gegen",
                      "den VOLLSTAENDIGEN Katalog und der neue Vollnamengriff zeigen sie",
                      "als vorhanden. **Jeder einzelne waere ein Duplikat geworden.**", "",
                      "| Quellname | Serie | vorher | jetzt | SKY-ID | war versteckt |",
                      "|---|---|---|---|---|---|"]
        zeilen_md += [f"| {g['quellname']} | {g['quellserie']} | {g['vorher']} | "
                      f"{g['einordnung']} | {g['sky_id']} | "
                      f"{'ja' if g['war_versteckt'] else 'nein'} |" for g in gewandert]
        zeilen_md += [""]

    (ANALYSE / "CAT-03-entwuerfe-bericht.md").write_text(
        "\n".join(zeilen_md) + "\n", encoding="utf-8")

    print(f"  Entwuerfe      : {len(entwuerfe)}")
    print(f"  Zurueckgehalten: {len(zurueckgehalten)}")
    print(f"  Unklar         : {len(unklar)}")
    print(f"  Projektbild vorgeschlagen: "
          f"{sum(1 for d in entwuerfe if d['bildstatus'] == 'projektbild_vorschlag')}")
    print(f"  Bild fehlt (Platzhalter) : "
          f"{sum(1 for d in entwuerfe if d['platzhalter'])}")
    print(f"  externe Bildrechte offen : "
          f"{sum(1 for d in entwuerfe if d['bildrechte_extern'] == 'unverified')}")
    print(f"  Serien         : {dict(Counter(d['series_code'] for d in entwuerfe))}")
    if fehler:
        print(f"  VALIDIERUNG    : {len(fehler)} Fehler")
        for z in fehler[:10]:
            print(f"                   {z}")
    return 1 if fehler else 0


if __name__ == "__main__":
    raise SystemExit(main())
