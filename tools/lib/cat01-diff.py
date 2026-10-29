"""
CAT-01B — der Katalogabgleich, reproduzierbar und ausschliesslich lesend.

AUFRUF über `tools/cat01-diff.mts` (`npm run cat01:diff`). Dieses Skript
schreibt nur nach `resources/analysis/` und liest sonst nur.

WARUM PYTHON, in einem Repository aus .mts-Werkzeugen: dieselbe Begruendung
wie bei `stub-schema.py`. Eine .xlsx sicher zu lesen heisst ZIP plus XML, und
beides hat Python in der Standardbibliothek — Node hat kein Stdlib-ZIP, also
waere dort eine Fremdbibliothek noetig, die den Angriffsvorrat vergroessert.
Gelesen wird nur, was hier benannt ist: kein Makro, kein Link, kein Decoder.

DAS MODELL, und es ist der Kern dieses Werkzeugs
================================================

Eine Identitaet besteht aus DREI Teilen, nie aus einem Namen:

    kern        der Charakter bzw. das Objekt      "eruptor"
    varianten   die Ausfuehrungsmerkmale            {"crystal clear"}
    typ         Figur, Fahrzeug, Falle, Kristall …  "figur"

Ein Treffer verlangt Gleichheit in ALLEN dreien. Die Serie ist ein
Vertrauenssignal, keine Bedingung — eine Wiederveroeffentlichung wechselt die
Serie und bleibt dasselbe Objekt.

DIE VARIANTENTRENNUNG KOMMT AUS DER QUELLE SELBST, nicht aus einer Wortliste,
die ich mir ausdenke: die Tabelle hat eigene Abschnitte fuer Varianten
("Chase Variants", "In-Game Variants"). Nur fuer EINEN Eintrag aus einem
solchen Abschnitt wird ein Praefix abgespalten — und zwar genau dann, wenn der
Rest ein Name ist, den die Quelle in einem NICHT-Varianten-Abschnitt fuehrt.
Damit bleibt "Mega Ram Spyro" ein Produktname (Serie 3) und "Chrome Spyro"
eine Variante von Spyro, ohne dass jemand das entscheiden muesste.

NORMALISIERUNG IST EIN SUCHHILFSMITTEL, NIE EIN IDENTITAETSBEWEIS. Jede
Ausgabezeile traegt deshalb die Stufe, auf der sie gefunden wurde, und jede
Zeile ueber "mittel" verlangt eine menschliche Bestaetigung.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
XDR = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
DML = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
SPALTEN = "ABCDEFGH"

QUELLE = "resources/web/Complete Skylanders Checklist.xlsx"
AUSGABE = "resources/analysis"

# ---------------------------------------------------------------- Sicherheit

#: Archiveintraege, die aktive oder externe Inhalte tragen WUERDEN.
VERBOTEN = (
    "xl/vbaProject.bin", "xl/macrosheets/", "xl/externalLinks/", "xl/embeddings/",
    "xl/activeX/", "customUI/", "xl/connections.xml", "xl/queryTables/",
)
#: Muster, die in keinem XML-Teil stehen duerfen.
GIFT = (
    (rb"<!DOCTYPE", "XXE: DOCTYPE"), (rb"<!ENTITY", "XXE: ENTITY"),
    (rb"=\s*cmd\s*\|", "DDE"), (rb"MSEXCEL\s*\|", "DDE"), (rb"<ddeLink", "DDE"),
    (rb"WEBSERVICE\s*\(", "WEBSERVICE()"), (rb"FILTERXML\s*\(", "FILTERXML()"),
    (rb"\bRTD\s*\(", "RTD()"), (rb"\bREGISTER\s*\(", "REGISTER()"),
)
GRENZE_VERHAELTNIS = 100      # ab hier ist es eine ZIP-Bombe
GRENZE_ENTPACKT = 200 << 20   # 200 MiB


def sicherheitstor(pfad: str) -> dict:
    """Prueft vor dem Auslesen. Schlaegt FEHL statt zu warnen.

    Dieselben Pruefungen wie der CAT-01A-Bericht, hier als Tor: das Werkzeug
    soll eine ausgetauschte oder manipulierte Datei nicht stillschweigend
    auswerten.
    """
    befund = {"datei": pfad, "bytes": os.path.getsize(pfad)}
    with open(pfad, "rb") as fh:
        if fh.read(4) != b"PK\x03\x04":
            raise SystemExit("CAT-01 ABBRUCH: kein ZIP/OOXML (Magic Bytes).")
    with zipfile.ZipFile(pfad) as z:
        infos = z.infolist()
        entpackt = sum(i.file_size for i in infos)
        komprimiert = sum(i.compress_size for i in infos) or 1
        befund["eintraege"] = len(infos)
        befund["entpackt"] = entpackt
        befund["verhaeltnis"] = round(entpackt / komprimiert, 2)
        if befund["verhaeltnis"] > GRENZE_VERHAELTNIS or entpackt > GRENZE_ENTPACKT:
            raise SystemExit(f"CAT-01 ABBRUCH: ZIP-Bomben-Verdacht "
                             f"({befund['verhaeltnis']}x, {entpackt} B entpackt).")
        namen = z.namelist()
        for schlecht in VERBOTEN:
            if any(n == schlecht or n.startswith(schlecht) for n in namen):
                raise SystemExit(f"CAT-01 ABBRUCH: aktiver Inhalt im Archiv ({schlecht}).")
        for n in namen:
            if n.startswith("/") or ".." in n.split("/") or "\\" in n:
                raise SystemExit(f"CAT-01 ABBRUCH: Pfad-Traversal im Archiv ({n!r}).")
        if z.testzip() is not None:
            raise SystemExit("CAT-01 ABBRUCH: CRC-Fehler, Archiv beschaedigt.")
        for n in (x for x in namen if x.endswith((".xml", ".rels"))):
            roh = z.read(n)
            for muster, was in GIFT:
                if re.search(muster, roh, re.I):
                    raise SystemExit(f"CAT-01 ABBRUCH: {was} in {n}.")
        befund["medien"] = sum(1 for n in namen if n.startswith("xl/media/"))
    return befund


# ------------------------------------------------------------- Normalisierung

def falte(s: str) -> str:
    """Unicode falten, Apostrophe und Bindestriche tilgen, Rest zu Wortfolge."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("’", "").replace("'", "").replace("`", "")
    s = s.replace("-", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


#: Wortfolgen, die dasselbe Ausfuehrungsmerkmal verschieden schreiben.
#: Belegt aus BEIDEN Seiten, nicht geraten — jede Zeile ist im Bericht
#: CAT-01-bestandsanalyse.md mit einem Beispiel nachgewiesen.
SYNONYME = [
    ("crystal clear", "clear crystal"),
    ("glow in the dark", "glow"),
    ("light core", "lightcore"),
    ("eons elite", "elite"),
    ("eon s elite", "elite"),
]

#: Ausfuehrungsmerkmale. KEINE Produktnamenswoerter — die Trennung entscheidet
#: der Abschnitt der Quelle, nicht diese Liste (siehe Modulkopf).
VARIANTENWORTE = {
    "legendary", "dark", "elite", "lightcore", "chrome", "silver", "gold",
    "pearl", "jade", "granite", "molten", "polar", "glow", "flocked",
    "white flocked", "crystal clear", "clear", "metallic", "metallic purple",
    "metallic green", "power blue", "steel plated", "patina", "sidekick",
    "mini", "springtime", "volcanic", "eggsellent", "jingle bell", "frito lay",
    "green", "red", "blue", "purple", "bronze", "easter", "glitter",
    "light core", "golden", "royale", "nitro", "pink", "orange",
    "rock candy", "red crystal", "green crystal", "blue crystal",
    "purple crystal", "clear crystal",
}

#: Merkmalspaare, die WAHRSCHEINLICH dasselbe Merkmal verschieden schreiben.
#:
#: Sie fuehren NICHT zu einem Treffer, sondern zu einer "Namensabweichung" mit
#: Konfidenz "mittel" und ausdruecklicher Begruendung — jede dieser Zeilen
#: verlangt eine menschliche Bestaetigung. Jedes Paar ist an einem echten
#: Beispiel aus beiden Seiten belegt:
#:
#:   clear / clear crystal   "Clear Starcast"       ~ "Starcast (Clear Crystal)"
#:   golden / gold           dieselbe Farbe, zwei Wortformen
#:   power blue / blue       "Power Blue Splat"     ~ "Blue Splat"
#:   lightcore / light core  "Eruptor LightCore"    ~ "Eruptor Light Core"
AEHNLICHE_MERKMALE = [
    ("clear", "clear crystal"), ("golden", "gold"),
    ("power blue", "blue"), ("lightcore", "light core"),
    # Kristallfarben: die Quelle schreibt die Farbe als Praefix, SkyIsles die
    # Farbe UND das Material in Klammern.
    #   "Red Drill Sergeant"  ~ "Drill Sergeant (Red Crystal)"
    #   "Green Gill Grunt"    ~ "Gill Grunt (Green Crystal)"
    ("red", "red crystal"), ("green", "green crystal"),
    ("blue", "blue crystal"), ("purple", "purple crystal"),
    # Metallic: die Quelle nennt die Farbe mit, SkyIsles nicht.
    #   "Metallic Purple Gill Grunt" ~ "Metallic Gill Grunt"
    ("metallic purple", "metallic"), ("metallic green", "metallic"),
]


def aehnlich(a: frozenset, b: frozenset) -> bool:
    """Unterscheiden sich zwei Merkmalsmengen NUR durch ein bekanntes Paar?"""
    if a == b:
        return False
    nur_a, nur_b = a - b, b - a
    if len(nur_a) != 1 or len(nur_b) != 1 or (a & b) != (a - nur_a):
        return False
    x, y = next(iter(nur_a)), next(iter(nur_b))
    return (x, y) in AEHNLICHE_MERKMALE or (y, x) in AEHNLICHE_MERKMALE


#: Die Variantenfamilien, die der Betreiber ausdruecklich geprueft sehen will.
FAMILIEN = {
    "Legendary": ("legendary",),
    "Dark": ("dark",),
    "Eon's Elite": ("elite",),
    # Beide Seiten zusammen, sonst zaehlt die Tabelle an der Schreibweise
    # vorbei: die Quelle sagt "LightCore", SkyIsles "Light Core".
    "LightCore": ("lightcore", "light core"),
    "Crystal Clear": ("crystal clear", "clear crystal", "clear"),
    "Metallic": ("metallic", "metallic purple", "metallic green"),
    "Flocked": ("flocked", "white flocked"),
    "Glow-in-the-Dark": ("glow",),
    "Gold": ("gold", "golden"),
    "Silver": ("silver",),
    "Chrome": ("chrome",),
    "Mini / Sidekick": ("mini", "sidekick"),
}

#: Abschnitt -> Objekttyp. Die Quelle sagt es selbst; nichts wird aus Namen geraten.
def objekttyp(abschnitt: str) -> str:
    a = abschnitt.lower()
    if "trap" in a and "master" not in a:  return "falle"
    if "vehicle" in a:                      return "fahrzeug"
    if "creation crystal" in a:             return "kristall"
    if "magic item" in a or "level piece" in a: return "magic item"
    return "figur"


def ist_variantenabschnitt(abschnitt: str) -> bool:
    return "variant" in abschnitt.lower()


def syn(w: str) -> str:
    for a, b in SYNONYME:
        if w == a: return b
    return w


def zerlege(name: str, basisnamen: set[str], variante: bool) -> tuple[str, frozenset]:
    """Name -> (kern, variantenmerkmale).

    Ein Praefix wird NUR abgespalten, wenn der Eintrag aus einem
    Variantenabschnitt kommt UND der Rest ein Name ist, den die Quelle als
    eigenstaendiges Objekt fuehrt. Sonst bleibt der Name ganz — "Mega Ram
    Spyro" ist ein Produkt, "Chrome Spyro" eine Variante.
    """
    n = falte(name)
    if not variante:
        return n, frozenset()
    worte = n.split()
    for schnitt in range(1, len(worte)):
        rest = " ".join(worte[schnitt:])
        if rest in basisnamen:
            praefix = " ".join(worte[:schnitt])
            merkmale = {syn(praefix)} if syn(praefix) in VARIANTENWORTE or praefix in VARIANTENWORTE else set()
            if not merkmale:
                merkmale = {syn(w) for w in praefix.split() if syn(w) in VARIANTENWORTE}
                if len(merkmale) != len(praefix.split()):
                    merkmale = {syn(praefix)}   # unbekanntes Merkmal, als Ganzes fuehren
            return rest, frozenset(merkmale)
    return n, frozenset()


#: SkyIsles-Namen: Verkaeufersuffix und reine Serien-/Zustandsklammern weg,
#: echte Variantenklammern werden zu Merkmalen.
SERIENCODES = {"sa", "g", "sf", "tt", "t", "sc", "i"}
ZUSTAND = {"ohne ovp", "ovp", "neu", "gebraucht"}


def zerlege_katalog(name: str, basisnamen: set[str] = frozenset()) -> tuple[str, frozenset, list[str]]:
    """SkyIsles-Name -> (kern, merkmale, abgezogene Zusaetze).

    `basisnamen` ist die Liste der Objekte, die die QUELLE als eigenstaendig
    fuehrt, und sie ist hier die Bremse gegen den naheliegenden Fehler:
    "Golden Queen" und "Mini Jini" sind CHARAKTERNAMEN, in denen ein
    Variantenwort vorkommt. Wer dort "Golden" oder "Mini" abspaltet, zerstoert
    den Namen und meldet eine vorhandene Figur als fehlend — beides ist beim
    Bauen dieses Werkzeugs genau so passiert (SKY-0558, SKY-0377).

    Die Regel ist deshalb: **steht der ganze Name als eigenstaendiges Objekt in
    der Quelle, wird nichts abgespalten.**
    """
    gezogen: list[str] = []
    n = name
    if " - " in n:
        kopf, rest = n.split(" - ", 1)
        if falte(rest) in ZUSTAND:
            gezogen.append(rest); n = kopf
        else:
            n = n.replace(" - ", " ")
    merkmale: set[str] = set()
    def klammer(m):
        inner = falte(m.group(1))
        if inner in SERIENCODES or inner in ZUSTAND:
            gezogen.append(m.group(1)); return ""
        merkmale.add(syn(inner)); gezogen.append(m.group(1)); return ""
    n = re.sub(r"\s*\(([^)]*)\)", klammer, n)
    worte = falte(n).split()

    # DIE REGEL FUER BEIDE RICHTUNGEN, und sie ist dieselbe wie in `zerlege`:
    # ein Randwort wird nur dann als Merkmal abgespalten, wenn der REST ein
    # Objekt ist, das die Quelle eigenstaendig fuehrt.
    #
    # Daran haengen drei Faelle, die alle einmal falsch waren:
    #   "Bumble Blast Lightcore" → Rest "bumble blast" ist ein Objekt → spalten
    #   "Mini Jini"              → Rest "jini" ist keines     → NICHT spalten
    #   "Golden Queen"           → Rest "queen" ist keines    → NICHT spalten
    # Ein pauschaler Schutz "steht der ganze Name in der Quelle, lass ihn"
    # war der erste Versuch und griff zu weit: er schuetzte auch
    # "Bumble Blast LightCore", das die Quelle ebenfalls als Eintrag fuehrt.
    def spaltbar(rest: list[str]) -> bool:
        return bool(rest) and " ".join(rest) in basisnamen

    for laenge in (2, 1):
        if len(worte) > laenge:
            schwanz = syn(" ".join(worte[-laenge:]))
            if schwanz in VARIANTENWORTE and spaltbar(worte[:-laenge]):
                merkmale.add(schwanz)
                worte = worte[:-laenge]
                break
    while len(worte) > 1 and syn(worte[0]) in VARIANTENWORTE and spaltbar(worte[1:]):
        merkmale.add(syn(worte.pop(0)))
    return " ".join(worte), frozenset(merkmale), gezogen


# -------------------------------------------------------------- Quelle lesen

def lies_quelle(pfad: str) -> list[dict]:
    """Die 603 Eintraege der Checkliste, mit Abschnitt, Spiel, Slug und Bild."""
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(pfad) as z:
        sst = ["".join(t.text or "" for t in si.iter(NS + "t"))
               for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        blatt = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        srels = {r.get("Id"): r.get("Target")
                 for r in ET.fromstring(z.read("xl/worksheets/_rels/sheet1.xml.rels"))}
        zeich = ET.fromstring(z.read("xl/drawings/drawing1.xml"))
        drels = {r.get("Id"): r.get("Target")
                 for r in ET.fromstring(z.read("xl/drawings/_rels/drawing1.xml.rels"))}
        medien = {n: z.getinfo(n).file_size for n in z.namelist() if n.startswith("xl/media/")}

    def wert(c):
        t, v = c.get("t"), c.find(NS + "v")
        if t == "s" and v is not None: return sst[int(v.text)]
        if t == "b" and v is not None: return v.text == "1"
        return v.text if v is not None else None

    raster = {c.get("r"): wert(c) for row in blatt.iter(NS + "row") for c in row.iter(NS + "c")}
    links = {}
    for h in blatt.iter(NS + "hyperlink"):
        rid = h.get(REL + "id")
        if rid: links[h.get("ref")] = srels.get(rid, "")

    # Bild sitzt eine Zeile UEBER dem Namen: Namenszeile = Ankerzeile(0-basiert) + 2
    anker = {}
    for an in zeich.iter(XDR + "oneCellAnchor"):
        frm = an.find(XDR + "from")
        blip = an.find(f".//{DML}blip")
        if blip is None: continue
        anker[(int(frm.find(XDR + "col").text), int(frm.find(XDR + "row").text) + 2)] = \
            "xl/" + drels.get(blip.get(REL + "embed"), "").replace("../", "")

    kopf = [(r, raster[f"A{r}"]) for r in range(4, 400)
            if isinstance(raster.get(f"A{r}"), str) and raster.get(f"A{r}")
            and f"A{r}" not in links]
    kopfzeilen = {r for r, _ in kopf}
    spiel_von, abschnitt_von, spiel = {}, {}, None
    for i, (r, t) in enumerate(kopf):
        bis = kopf[i + 1][0] if i + 1 < len(kopf) else 400
        if re.search(r"Figures$|Eon", t): spiel = t
        for rr in range(r, bis):
            abschnitt_von[rr], spiel_von[rr] = t, spiel

    SPIEL2CODE = {"Spyro": "SA", "Giants": "G", "Swap Force": "SF", "Trap Team": "T",
                  "SuperChargers": "SC", "Imaginators": "I"}
    eintraege = []
    for r in range(4, 400):
        if r in kopfzeilen: continue
        for sp in SPALTEN:
            ref, name = f"{sp}{r}", raster.get(f"{sp}{r}")
            if not isinstance(name, str) or not name: continue
            spielname = spiel_von.get(r) or ""
            code = next((c for k, c in SPIEL2CODE.items() if k in spielname), "")
            bild = anker.get((SPALTEN.index(sp), r))
            eintraege.append({
                "zelle": ref, "name": name, "slug": links.get(ref, "").rstrip("/").rsplit("/", 1)[-1],
                "url": links.get(ref, ""), "zeile": r, "spiel": spielname, "serie": code,
                "abschnitt": abschnitt_von.get(r, ""), "typ": objekttyp(abschnitt_von.get(r, "")),
                "variantenabschnitt": ist_variantenabschnitt(abschnitt_von.get(r, "")),
                "bild": bild, "bild_bytes": medien.get(bild),
            })
    return eintraege


# ------------------------------------------------------------------ Abgleich

#: Die sieben Einordnungen, die der Betreiber vorgegeben hat.
EINORDNUNG = ("Bereits vorhanden", "Fehlende Figur", "Fehlende Variante",
              "Fehlendes Zubehör/Sammelobjekt", "Namensabweichung",
              "Mögliche Dublette", "Nicht eindeutig")


def fehlt_einordnung(typ: str, kern_bekannt: bool) -> str:
    if typ != "figur":
        return "Fehlendes Zubehör/Sammelobjekt"
    return "Fehlende Variante" if kern_bekannt else "Fehlende Figur"


def vergleiche(quelle: list[dict], katalog: list[dict]) -> tuple[list[dict], list[dict]]:
    basisnamen = {falte(e["name"]) for e in quelle if not e["variantenabschnitt"]}

    #: Kern OHNE Leerzeichen — der letzte Suchgriff.
    #:
    #: Zehn Quelleintraege weichen NUR in der Wortgrenze ab: die Quelle
    #: schreibt "Flarewolf" und "Eruptor LightCore", SkyIsles "Flare Wolf" und
    #: "Eruptor Light Core". Ohne diesen Durchgang meldet der Abgleich zwei
    #: vorhandene Figuren (SKY-0556, SKY-0557) als fehlend — genau so ist es
    #: beim Bauen passiert.
    #:
    #: ES IST EIN SUCHHILFSMITTEL, KEIN BEWEIS, und deshalb nie "hoch":
    #: Leerzeichen zu ignorieren kann zwei verschiedene Objekte
    #: zusammenziehen. Jede so gefundene Zeile ist "Namensabweichung" mit
    #: Konfidenz "mittel" und verlangt eine Bestaetigung.
    kat_eng = defaultdict(list)
    kat_voll, kat_kern, kat_zusatz = defaultdict(list), defaultdict(list), {}

    #: Der VOLLE Name, gefaltet — und zwar als ERSTER Griff, nicht als letzter.
    #:
    #: DER FEHLER, DEN DAS BEHEBT (gefunden in CAT-03 am 2026-10-27, an 16
    #: Zeilen). Der Abgleich zerlegte jeden Eintrag aus einem
    #: Variantenabschnitt in Kern und Merkmal und suchte nur noch danach.
    #: "Punch Pop Fizz" wurde zu (kern "pop fizz", merkmal {"punch"}); der
    #: Katalog fuehrt aber den GANZEN Namen "Punch Pop Fizz" als Kern
    #: (SKY-0144, oeffentlich sichtbar). Keine der Regeln verband die zwei,
    #: und das Ergebnis war "Fehlende Variante" — eine Figur als fehlend zu
    #: melden, die offen im Katalog steht.
    #:
    #: Ein zeichengleicher voller Name in DERSELBEN Serie ist das staerkste
    #: Argument, das dieses Werkzeug kennt: starker als Kern plus Merkmal,
    #: weil nichts zerlegt und nichts geraten wird. Deshalb steht er vorn.
    #: In einer ANDEREN Serie bleibt er "mittel" — die 28 wiederholten Namen
    #: sind Wiederveroeffentlichungen, und der Name ist nie die Identitaet.
    kat_vollname = defaultdict(list)
    for r in katalog:
        name = r.get("display_name_override") or r["name"]
        kern, merk, gezogen = zerlege_katalog(name, basisnamen)
        r["_kern"], r["_merk"], r["_gezogen"] = kern, merk, gezogen
        kat_voll[(kern, merk)].append(r)
        kat_kern[kern].append(r)
        kat_eng[(kern.replace(" ", ""), merk)].append(r)
        # DER VOLLE NAME, gefaltet — der staerkste Griff, und er fehlte.
        kat_vollname[falte(name)].append(r)
        kat_zusatz[r["sky_id"]] = gezogen

    zeilen, benutzt = [], set()
    for e in quelle:
        kern, merk = zerlege(e["name"], basisnamen, e["variantenabschnitt"])
        # Quelle schreibt Minis und Elite ohne Praefix; SkyIsles mit.
        # "Mini Bop" heisst in der Quelle nur "Bop" — SkyIsles stellt "Mini"
        # voran. Aber "Mini Jini" HEISST so; ein zweites "mini" waere falsch.
        if e["abschnitt"] == "Mini Skylanders" and not falte(e["name"]).startswith("mini "):
            merk = merk | {"mini"}
        if e["spiel"].startswith("Eon"):        merk = merk | {"elite"}
        if "LightCore" in e["abschnitt"] or e["name"].endswith(" LightCore"):
            merk = merk | {"lightcore"}
            kern = falte(e["name"]).replace(" lightcore", "").strip()
        if e["typ"] == "falle":
            kern = falte(re.sub(r"\s*\([^)]*\)", "", e["name"]))

        e["_kern"], e["_merk"] = kern, merk

        # ---- NULLTER GRIFF: steht der VOLLE Name zeichengleich im Katalog?
        #
        # ER GILT NUR, WENN JEDES MERKMAL IM NAMEN STEHT — und das ist keine
        # Feinheit, sondern der Unterschied zwischen zwei Figuren:
        #
        #   "Punch Pop Fizz"  Merkmal {punch}, und "punch" STECKT im Namen.
        #                     Der ganze Name zu vergleichen heisst dann, Kern
        #                     UND Merkmal zusammen zu vergleichen. SKY-0144
        #                     heisst genau so. Treffer, und zwar ein sicherer.
        #
        #   "Boomer"          Abschnitt "Eon's Elite", Merkmal {elite} — aber
        #                     "elite" steht NICHT im Namen; es kommt aus dem
        #                     Abschnitt. Der Name allein trifft SKY-0010, die
        #                     GEWOEHNLICHE Figur; gemeint ist SKY-0011. Hier
        #                     darf der Vollname nicht entscheiden.
        #
        # Steht ein Merkmal nicht im Namen, traegt der Name die Information
        # nicht, auf die es ankommt — dann bleibt es bei Kern und Merkmal.
        voll_name = falte(e["name"])
        merk_im_namen = all(m in voll_name for m in merk)
        voll = kat_vollname.get(voll_name, []) if merk_im_namen else []
        if len(voll) > 1 and e["serie"]:
            gleich = [t for t in voll if t["series_code"] == e["serie"]]
            if len(gleich) == 1:
                voll = gleich
        treffer = voll if len(voll) == 1 else kat_voll.get((kern, frozenset(merk)), [])
        stufe, grund = "", ""
        if len(treffer) > 1 and e["serie"]:
            # DIE SERIE IST DER UNTERSCHEIDER, den SkyIsles bei
            # Wiederveroeffentlichungen benutzt: "Bash" steht als SKY-0007 (SA)
            # und als SKY-0148 (G), gleicher Name, gleiche Merkmale, zwei
            # Produkte. Ohne diesen Schritt meldet der Abgleich 49 angebliche
            # Dubletten, die in Wahrheit Serie 1 gegen Serie 2 sind.
            gleich = [t for t in treffer if t["series_code"] == e["serie"]]
            if len(gleich) == 1:
                treffer = gleich
        if len(treffer) == 1:
            kand = treffer[0]
            gleiche_serie = kand["series_code"] == e["serie"]
            stufe = "hoch" if gleiche_serie else "mittel"
            gleich_geschrieben = falte(kand.get("display_name_override") or kand["name"]) == falte(e["name"])
            einordnung = "Bereits vorhanden" if gleich_geschrieben else "Namensabweichung"
            grund = (("der VOLLE Name stimmt gefaltet zeichengleich"
                      if len(voll) == 1 and voll[0] is kand
                      else "Kern und Merkmale identisch")
                     + ("" if gleiche_serie else f"; Serie weicht ab ({kand['series_code']} statt {e['serie'] or '?'})")
                     + ("" if gleich_geschrieben else f"; Schreibweise weicht ab"))
        elif len(treffer) > 1:
            kand, stufe, einordnung = treffer[0], "niedrig", "Mögliche Dublette"
            grund = f"{len(treffer)} Katalogzeilen mit gleichem Kern und gleichen Merkmalen"
        else:
            kern_bekannt = kern in kat_kern
            nahe = kat_kern.get(kern, [])
            if kern_bekannt and merk:
                # ZWEITDURCHGANG: schreibt SkyIsles dasselbe Merkmal nur anders?
                aehnl = [x for x in nahe if aehnlich(frozenset(merk), x["_merk"])]
                if len(aehnl) == 1:
                    kand, stufe, einordnung = aehnl[0], "mittel", "Namensabweichung"
                    grund = (f"Kern identisch; Merkmal {sorted(merk)} gegen "
                             f"{sorted(aehnl[0]['_merk'])} — wahrscheinlich dieselbe "
                             f"Ausfuehrung, anders geschrieben. MANUELL BESTAETIGEN")
                elif len(aehnl) > 1:
                    kand, stufe, einordnung = None, "niedrig", "Nicht eindeutig"
                    grund = (f"Kern identisch; {len(aehnl)} Kandidaten mit aehnlich "
                             f"geschriebenem Merkmal: {[x['sky_id'] for x in aehnl]}")
                else:
                    kand, stufe = (nahe[0] if len(nahe) == 1 else None), "mittel"
                    einordnung = "Fehlende Variante"
                    vorhandene = sorted({",".join(sorted(x["_merk"])) or "(ohne)" for x in nahe})
                    grund = (f"Kern vorhanden ({len(nahe)} Zeile(n)), Merkmale {sorted(merk)} nicht; "
                             f"vorhandene Merkmale: {vorhandene}")
            elif kern_bekannt and not merk:
                kand, stufe, einordnung = (nahe[0] if len(nahe) == 1 else None), "niedrig", "Nicht eindeutig"
                grund = f"Kern vorhanden, aber nur mit Merkmalen: {sorted({','.join(sorted(x['_merk'])) for x in nahe})}"
            else:
                # LETZTER SUCHGRIFF: weicht der Kern nur in der Wortgrenze ab?
                eng = kat_eng.get((kern.replace(" ", ""), frozenset(merk)), [])
                if len(eng) == 1:
                    kand, stufe, einordnung = eng[0], "mittel", "Namensabweichung"
                    grund = (f"Kern stimmt ohne Wortgrenzen ({kern!r} gegen "
                             f"{eng[0]['_kern']!r}) — wahrscheinlich dasselbe Objekt, "
                             f"anders getrennt. MANUELL BESTAETIGEN")
                elif len(eng) > 1:
                    kand, stufe, einordnung = None, "niedrig", "Nicht eindeutig"
                    grund = f"Kern ohne Wortgrenzen mehrfach: {[x['sky_id'] for x in eng]}"
                else:
                    # ALLERLETZTER GRIFF: steckt der Kern leerzeichenblind in
                    # genau EINEM Katalognamen? "Hard-Boiled Flarewolf" zerlegt
                    # die Quelle zu (flarewolf, {hard boiled}), SkyIsles fuehrt
                    # es als ganzen Namen "Hard Boiled Flare Wolf" (SKY-0557).
                    # Keine der Regeln davor verbindet die zwei — und "fehlt"
                    # waere die falsche Antwort. Also: Kandidat zeigen, nicht
                    # Abwesenheit behaupten. Nur bei GENAU einem Treffer, und
                    # nie hoeher als "niedrig": Enthaltensein ist das
                    # schwaechste Argument in diesem Werkzeug.
                    nadel = kern.replace(" ", "")
                    heu = [r for r in katalog
                           if nadel and nadel in r["_kern"].replace(" ", "")] if nadel else []
                    if len(heu) >= 1:
                        # MEHRERE KANDIDATEN HEISST MEHRDEUTIG, NICHT ABWESEND.
                        # "Hard-Boiled Flarewolf" steckt in "Flare Wolf"
                        # (SKY-0556) UND in "Hard Boiled Flare Wolf"
                        # (SKY-0557) — die zweite ist die richtige, aber das
                        # entscheidet kein Enthaltensein. Es waere der
                        # schlimmere Fehler, hier "fehlt" zu melden.
                        kand, stufe, einordnung = heu[0], "niedrig", "Nicht eindeutig"
                        kandidaten = ", ".join(f"{x['sky_id']} ({x['_kern']})" for x in heu[:4])
                        grund = (f"Kern {kern!r} steckt leerzeichenblind in "
                                 f"{len(heu)} Katalognamen: {kandidaten} — Kandidat(en), "
                                 f"kein Nachweis. MANUELL PRUEFEN")
                    else:
                        kand, stufe = None, "mittel"
                        einordnung = fehlt_einordnung(e["typ"], False)
                        grund = "Kern im Katalog nicht gefunden, auch nicht leerzeichenblind"
        # BUCHHALTUNG: verbraucht ist jede Katalogzeile, der ein Quelleintrag
        # zugeordnet wurde — auch die aus dem Synonym-Durchgang. Ohne das
        # zaehlte die Gegenrichtung Zeilen als "ohne Quellbezug", die sehr wohl
        # einen haben, nur unter anderer Schreibweise.
        if treffer:
            for t in treffer: benutzt.add(t["sky_id"])
        elif kand is not None:
            benutzt.add(kand["sky_id"])
        zeilen.append({
            "quellname": e["name"], "quell_slug": e["slug"], "quellserie": e["serie"],
            "objekttyp": e["typ"], "abschnitt": e["abschnitt"],
            "kern": kern, "merkmale": ",".join(sorted(merk)),
            "skyisles_name": (kand.get("display_name_override") or kand["name"]) if kand else "",
            "sky_id": kand["sky_id"] if kand else "",
            "einordnung": einordnung, "konfidenz": stufe, "begruendung": grund,
            "manuell_entscheiden": "nein" if (einordnung == "Bereits vorhanden" and stufe == "hoch") else "ja",
            "bild_bytes": e["bild_bytes"] or 0,
        })
    rest = [r for r in katalog if r["sky_id"] not in benutzt]
    return zeilen, rest


# ------------------------------------------------------------------- Ausgaben

CSV_FELDER = ["quellname", "quell_slug", "quellserie", "objekttyp", "abschnitt",
              "kern", "merkmale", "skyisles_name", "sky_id", "einordnung",
              "konfidenz", "begruendung", "manuell_entscheiden", "bild_bytes"]


def familienbericht(zeilen: list[dict], katalog: list[dict]) -> list[tuple]:
    """Je Variantenfamilie: wie viele die Quelle kennt, wie viele SkyIsles fuehrt."""
    aus = []
    for name, worte in FAMILIEN.items():
        q = [z for z in zeilen if any(w in z["merkmale"].split(",") for w in worte)]
        k = [r for r in katalog if any(w in r["_merk"] for w in worte)]
        vorhanden = sum(1 for z in q if z["einordnung"] in ("Bereits vorhanden", "Namensabweichung"))
        fehlt = sum(1 for z in q if z["einordnung"].startswith("Fehlend"))
        unklar = len(q) - vorhanden - fehlt
        aus.append((name, len(q), len(k), vorhanden, fehlt, unklar))
    return aus


def schreibe(zeilen, rest, katalog, befund, quelle):
    os.makedirs(AUSGABE, exist_ok=True)

    with open(f"{AUSGABE}/cat-01-differenz.csv", "w", newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FELDER, delimiter=";")
        w.writeheader()
        for z in sorted(zeilen, key=lambda z: (z["einordnung"], -z["bild_bytes"])):
            w.writerow({k: z.get(k, "") for k in CSV_FELDER})

    with open(f"{AUSGABE}/cat-01-skyisles-ohne-quelle.csv", "w", newline="", encoding="utf8") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["sky_id", "name", "serie", "card_type", "item_type", "kern",
                    "merkmale", "abgezogene_zusaetze"])
        for r in sorted(rest, key=lambda r: (r["item_type"], r["sky_id"])):
            w.writerow([r["sky_id"], r.get("display_name_override") or r["name"],
                        r["series_code"], r["card_type"], r["item_type"], r["_kern"],
                        ",".join(sorted(r["_merk"])), " | ".join(r["_gezogen"])])

    nach_einordnung = Counter(z["einordnung"] for z in zeilen)
    nach_konfidenz = Counter((z["einordnung"], z["konfidenz"]) for z in zeilen)
    fam = familienbericht(zeilen, katalog)
    md = [
        "# CAT-01B · Katalogabgleich — Ergebnis",
        "",
        f"Erzeugt von `npm run cat01:diff` (`tools/lib/cat01-diff.py`). "
        f"Ausschliesslich lesend; schreibt nur nach `resources/analysis/`.",
        "",
        f"**Quelle:** `{quelle}` — {befund['bytes']:,} B, {befund['eintraege']} Archiveintraege, "
        f"{befund['medien']} Medien, Kompressionsverhaeltnis {befund['verhaeltnis']}x. "
        f"Sicherheitstor passiert.",
        f"**Katalog:** {len(katalog)} Zeilen (Momentaufnahme `cat-01-katalog.json`).",
        f"**Quelleintraege:** {len(zeilen)}",
        "",
        "## Einordnung",
        "",
        "| Einordnung | Anzahl | hoch | mittel | niedrig |",
        "|---|---|---|---|---|",
    ]
    for e in EINORDNUNG:
        if not nach_einordnung.get(e): continue
        md.append(f"| {e} | {nach_einordnung[e]} | {nach_konfidenz.get((e,'hoch'),0)} | "
                  f"{nach_konfidenz.get((e,'mittel'),0)} | {nach_konfidenz.get((e,'niedrig'),0)} |")
    md += ["",
        "> **Konfidenz ist kein Beweis.** `hoch` heisst: Kern, Merkmale UND Serie stimmen. "
        "`mittel` heisst: Kern und Merkmale stimmen, die Serie nicht — oder der Kern fehlt ganz. "
        "`niedrig` heisst: mehrere Kandidaten oder keine eindeutige Lesart. "
        "Alles ausser `Bereits vorhanden` mit `hoch` traegt "
        "`manuell_entscheiden = ja`.",
        "",
        "## Variantenfamilien",
        "",
        "| Familie | Quelle | SkyIsles | vorhanden | fehlt | unklar |",
        "|---|---|---|---|---|---|",
    ]
    for name, nq, nk, v, f, u in fam:
        md.append(f"| {name} | {nq} | {nk} | {v} | {f} | {u} |")

    md += ["", "## Fehlende, nach Serie und Typ", "",
           "| Serie | Figur | Variante | Zubehör/Sammelobjekt |", "|---|---|---|---|"]
    for serie in ["SA", "G", "SF", "T", "SC", "I", ""]:
        teil = [z for z in zeilen if z["quellserie"] == serie]
        f1 = sum(1 for z in teil if z["einordnung"] == "Fehlende Figur")
        f2 = sum(1 for z in teil if z["einordnung"] == "Fehlende Variante")
        f3 = sum(1 for z in teil if z["einordnung"] == "Fehlendes Zubehör/Sammelobjekt")
        if f1 or f2 or f3:
            md.append(f"| {serie or '(ohne)'} | {f1} | {f2} | {f3} |")

    md += ["", "## Beispiele je Einordnung", ""]
    for e in EINORDNUNG:
        teil = [z for z in zeilen if z["einordnung"] == e]
        if not teil: continue
        md.append(f"### {e} ({len(teil)})")
        md.append("")
        for z in sorted(teil, key=lambda z: -z["bild_bytes"])[:8]:
            ziel = f" → {z['sky_id']} {z['skyisles_name']}" if z["sky_id"] else ""
            md.append(f"- `{z['konfidenz']}` **{z['quellname']}** "
                      f"({z['quellserie'] or '—'}, {z['objekttyp']}){ziel} — {z['begruendung']}")
        md.append("")

    # ----------------------------------------------- Priorisierung (Teil 5)
    md += ["## Priorisierung — die aussichtsreichsten Ergaenzungen", "",
           "Sortiert nach Risiko: je kleiner und je gleichartiger eine Gruppe, "
           "desto eher laesst sie sich in einem Zug pruefen und freigeben.", ""]
    fehlend = [z for z in zeilen if z["einordnung"].startswith("Fehlend")]
    gruppen = defaultdict(list)
    for z in fehlend:
        gruppen[(z["quellserie"] or "—", z["merkmale"] or "(Grundfigur)", z["objekttyp"])].append(z)
    md += ["| Serie | Merkmal | Typ | Anzahl | Beispiele |", "|---|---|---|---|---|"]
    for (serie, merk, typ), g in sorted(gruppen.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        bsp = ", ".join(z["quellname"] for z in g[:3])
        md += [f"| {serie} | {merk} | {typ} | {len(g)} | {bsp} |"]
    md += ["",
           "**Die kleinste risikoarme Gruppe zuerst:** eine Serie, ein Merkmal, "
           "ein Objekttyp — dann ist die Entscheidung je Zeile dieselbe und ein "
           "Fehler betrifft eine Gruppe, nicht den Katalog.", ""]

    md += ["## SkyIsles ohne Quellbezug", "",
           f"{len(rest)} Zeilen: " + ", ".join(f"{n}× {t}" for t, n in
           Counter(r['item_type'] for r in rest).most_common()), "",
           "Vollstaendig in `cat-01-skyisles-ohne-quelle.csv`. Die Quelle deckt "
           "Spiele und Portale gar nicht ab; alles darueber hinaus ist entweder "
           "eine Lücke der QUELLE oder eine Schreibweise, die dieses Werkzeug "
           "nicht aufloest.", ""]
    with open(f"{AUSGABE}/cat-01-differenz.md", "w", encoding="utf8") as fh:
        fh.write("\n".join(md) + "\n")
    return nach_einordnung, fam


def main() -> int:
    quelle_pfad = sys.argv[1] if len(sys.argv) > 1 else QUELLE
    kat_pfad = f"{AUSGABE}/cat-01-katalog.json"
    if not os.path.exists(kat_pfad):
        raise SystemExit(f"CAT-01 ABBRUCH: Katalog-Momentaufnahme fehlt ({kat_pfad}). "
                         f"`npm run cat01:diff` holt sie lesend.")
    befund = sicherheitstor(quelle_pfad)
    quelle = lies_quelle(quelle_pfad)
    katalog = json.load(open(kat_pfad))
    zeilen, rest = vergleiche(quelle, katalog)
    # Die Arbeitsfelder (`_kern`, `_merk`) sind Mengen und gehoeren nicht in den
    # Rohextrakt: er soll die QUELLE abbilden, nicht die Zwischenschritte.
    roh = [{k: v for k, v in e.items() if not k.startswith("_")} for e in quelle]
    json.dump(roh, open(f"{AUSGABE}/cat-01-quelle.json", "w"), ensure_ascii=False, indent=1)
    nach, fam = schreibe(zeilen, rest, katalog, befund, quelle_pfad)
    print(f"  Sicherheitstor : passiert ({befund['eintraege']} Eintraege, "
          f"{befund['verhaeltnis']}x, {befund['medien']} Medien)")
    print(f"  Quelleintraege : {len(zeilen)}")
    print(f"  Katalogzeilen  : {len(katalog)}")
    for e in EINORDNUNG:
        if nach.get(e): print(f"    {nach[e]:>4}  {e}")
    print(f"  SkyIsles ohne Quellbezug: {len(rest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
