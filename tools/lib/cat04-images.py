"""CAT-04D — die eingebetteten Bilder der Checkliste den Entwuerfen zuordnen.

AUFRUF: ueber `tools/cat04-images.mts` (`npm run cat04:images`), nie direkt.

ES RUEHRT KEINE DATENBANK AN und braucht auch keine: die Zuordnung entsteht
allein aus der .xlsx und den bereits erhobenen CAT-03-Entwuerfen. Kein
Schluessel, kein Netz, kein Upload.

DIE ZUORDNUNG KOMMT AUS DEN ANKERN, NICHT AUS DER REIHENFOLGE

Eine .xlsx legt Bilder als Zeichnungsobjekte ab. `xl/drawings/drawing1.xml`
nennt fuer jedes einen ANKER (Spalte, Zeile) und eine Beziehungs-Id; die
Id loest `drawing1.xml.rels` zu `xl/media/imageNNN.png` auf. Die Reihenfolge
der Mediendateien sagt NICHTS ueber die Zuordnung — `image47.png` ist die
erste Figur der Liste, `image3.png` die zweite.

DIE ZEILENVERSCHIEBUNG IST GEMESSEN, NICHT ANGENOMMEN

Der Anker sitzt auf der BILDZEILE; der Name steht eine Zeile darunter. In
0-basierter Ankerzaehlung heisst das `+2`. Diese Datei beweist es bei jedem
Lauf vierfach, und zwar an allen 603 Ankern:

  1. die Ankerzeile ist eine Bildzeile (Zeilenhoehe > 100 statt 15)
  2. die Zeile darunter traegt einen NICHT-numerischen Namen
  3. sie traegt einen Hyperlink auf die Figurenseite (602 von 603)
  4. die Zeile darunter traegt eine ZAHL — die Mengenspalte

Punkt 4 ist der entscheidende: ein naiver Test „steht dort ein Name?"
bestaetigt auch `+3`, weil die Mengenspalte die Zeichenkette "0" enthaelt
und damit als Name durchgeht. Genau dieser Fehlschluss ist beim Bauen
passiert und wird hier dauerhaft ausgeschlossen.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import sys
import zipfile
import collections
from pathlib import Path
import xml.etree.ElementTree as ET

NS  = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
XDR = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
DML = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
SPALTEN = "ABCDEFGHIJ"

ANALYSE = Path("resources/analysis")
ENTWUERFE = ANALYSE / "cat-03-entwuerfe.json"
PRUEFDIR = Path("resources/review/cat-04-bilder")

#: Die Abnahmekriterien der SkyIsles-Bildpipeline, aus dem Code gelesen:
#: `MAX_IMAGE_BYTES` und `sniffImage()` in `src/lib/admin/image-file.ts`.
MAX_BYTES = 2 * 1024 * 1024
MAGIE = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
}


def kind_und_masse(rohdaten: bytes) -> tuple[str | None, int | None, int | None]:
    """(Format, Breite, Hoehe) — aus den Bytes, nicht aus dem Dateinamen.

    DIESELBE REGEL WIE DIE PIPELINE: `sniffImage()` entscheidet nach den
    Magic Bytes, weil ein `.png`, das in `.webp` umbenannt wurde, sonst
    durchginge. Die Masse kommen aus dem Kopf des Formats; eine
    Fremdbibliothek braucht es dafuer nicht.
    """
    if rohdaten.startswith(b"\x89PNG\r\n\x1a\n"):
        # IHDR steht immer als erster Chunk: Laenge(4) Typ(4) Breite(4) Hoehe(4)
        if len(rohdaten) >= 24 and rohdaten[12:16] == b"IHDR":
            b = int.from_bytes(rohdaten[16:20], "big")
            h = int.from_bytes(rohdaten[20:24], "big")
            return "png", b, h
        return "png", None, None
    if rohdaten.startswith(b"\xff\xd8\xff"):
        i = 2
        while i + 9 < len(rohdaten):
            if rohdaten[i] != 0xFF:
                i += 1
                continue
            marke = rohdaten[i + 1]
            # SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15 tragen die Masse.
            if marke in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                         0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h = int.from_bytes(rohdaten[i + 5:i + 7], "big")
                b = int.from_bytes(rohdaten[i + 7:i + 9], "big")
                return "jpg", b, h
            if marke in (0xD8, 0xD9) or 0xD0 <= marke <= 0xD7:
                i += 2
                continue
            laenge = int.from_bytes(rohdaten[i + 2:i + 4], "big")
            i += 2 + laenge
        return "jpg", None, None
    if rohdaten[:4] == b"RIFF" and rohdaten[8:12] == b"WEBP":
        return "webp", None, None
    return None, None, None


def anker_lesen(pfad: str) -> tuple[dict, dict]:
    """{(Spalte, Namenszeile): Medienpfad} plus der Strukturbeweis."""
    with zipfile.ZipFile(pfad) as z:
        sst = ["".join(t.text or "" for t in si.iter(NS + "t"))
               for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        blatt = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        zeich = ET.fromstring(z.read("xl/drawings/drawing1.xml"))
        drels = {r.get("Id"): r.get("Target")
                 for r in ET.fromstring(z.read("xl/drawings/_rels/drawing1.xml.rels"))}
        andere = [n for n in z.namelist()
                  if re.match(r"xl/(worksheets|drawings)/\w+\d+\.xml$", n)]

    def wert(c):
        t, v = c.get("t"), c.find(NS + "v")
        if t == "s" and v is not None:
            return sst[int(v.text)]
        return v.text if v is not None else None

    raster = {c.get("r"): wert(c) for row in blatt.iter(NS + "row") for c in row.iter(NS + "c")}
    hoehen = {int(r.get("r")): float(r.get("ht") or 15) for r in blatt.iter(NS + "row")}
    links = {h.get("ref") for h in blatt.iter(NS + "hyperlink") if h.get(REL + "id")}

    # NUR `oneCellAnchor` IST NICHT GERATEN: die Datei fuehrt ausschliesslich
    # diesen Typ. Ein `twoCellAnchor` wuerde hier auffallen, weil die Zahl der
    # gefundenen Anker dann nicht mehr zur Zahl der Anker-Elemente passt.
    alle_anker = [e for e in zeich if e.tag.endswith("Anchor")]
    zuordnung, beweis = {}, collections.Counter()
    for an in zeich.iter(XDR + "oneCellAnchor"):
        frm = an.find(XDR + "from")
        blip = an.find(f".//{DML}blip")
        if blip is None:
            beweis["ohne_bild"] += 1
            continue
        spalte = int(frm.find(XDR + "col").text)
        zeile0 = int(frm.find(XDR + "row").text)
        medium = "xl/" + drels.get(blip.get(REL + "embed"), "").replace("../", "")
        namenszeile = zeile0 + 2
        ref = f"{SPALTEN[spalte]}{namenszeile}"
        name = raster.get(ref)
        menge = raster.get(f"{SPALTEN[spalte]}{namenszeile + 1}")

        beweis["anker"] += 1
        if hoehen.get(zeile0 + 1, 15) > 100:                 beweis["bildzeile"] += 1
        if isinstance(name, str) and name and not re.fullmatch(r"\d+", name):
            beweis["name_darunter"] += 1
        if ref in links:                                     beweis["mit_hyperlink"] += 1
        if isinstance(menge, str) and re.fullmatch(r"\d+", menge):
            beweis["menge_darunter"] += 1
        zuordnung[ref] = medium
    beweis["blaetter_und_zeichnungen"] = len(andere)
    beweis["anker_elemente"] = len(alle_anker)
    return zuordnung, dict(beweis)


def main() -> int:
    xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    if not xlsx or not Path(xlsx).exists():
        print("CAT-04D ABBRUCH: Quelldatei fehlt.", file=sys.stderr)
        return 1
    if not ENTWUERFE.exists():
        print(f"CAT-04D ABBRUCH: {ENTWUERFE} fehlt — zuerst cat03:drafts:staging.", file=sys.stderr)
        return 1

    zuordnung, beweis = anker_lesen(xlsx)
    n = beweis["anker"]
    print(f"  Blatt/Zeichnung : {beweis['blaetter_und_zeichnungen']} Datei(en), "
          f"{beweis['anker_elemente']} Ankerelemente")
    print(f"  Anker mit Bild  : {n}")
    print(f"  Strukturbeweis  : Bildzeile {beweis['bildzeile']}/{n} · "
          f"Name darunter {beweis['name_darunter']}/{n} · "
          f"Hyperlink {beweis['mit_hyperlink']}/{n} · "
          f"Mengenspalte {beweis['menge_darunter']}/{n}")

    # DER BEWEIS IST EINE BEDINGUNG, KEINE AUSKUNFT. Faellt eine der drei
    # harten Zahlen unter die Ankerzahl, stimmt die Verschiebung nicht mehr
    # — dann wird NICHT zugeordnet.
    hart = ("bildzeile", "name_darunter", "menge_darunter")
    if any(beweis.get(k, 0) != n for k in hart):
        print("CAT-04D ABBRUCH: der Strukturbeweis traegt nicht. Die Zeilen"
              "verschiebung ist nicht mehr gesichert; es wird nichts zugeordnet.",
              file=sys.stderr)
        return 1
    if beweis["anker_elemente"] != n + beweis.get("ohne_bild", 0):
        print("CAT-04D ABBRUCH: es gibt Ankerelemente, die dieser Lauf nicht liest "
              "(z. B. twoCellAnchor).", file=sys.stderr)
        return 1

    entwuerfe = json.loads(ENTWUERFE.read_text())["entwuerfe"]
    mehrfach = collections.Counter(zuordnung.values())

    PRUEFDIR.mkdir(parents=True, exist_ok=True)
    zeilen, ausgepackt = [], 0
    with zipfile.ZipFile(xlsx) as z:
        groessen = {i.filename: i.file_size for i in z.infolist()}
        for d in entwuerfe:
            ref = d["quelle_zelle"]
            medium = zuordnung.get(ref)
            zeile = {
                "entwurf": f"{d['katalogname']} ({d['series_code']})",
                "katalogname": d["katalogname"],
                "series_code": d["series_code"],
                "edition": d["card_type"],
                "variantenfamilie": d["variantenfamilie"],
                "blatt": "All Skylanders",
                "zelle": ref,
                "zeile_xlsx": int(re.sub(r"\D", "", ref) or 0),
                "medium": medium or "",
                "format": "", "breite": "", "hoehe": "", "bytes": "",
                "sha256_16": "",
                "zuordnung": "fehlt",
                "zielpfad": "",
                "pipeline": "",
                "pruefdatei": "",
            }
            if not medium:
                zeilen.append(zeile)
                continue

            roh = z.read(medium)
            fmt, breite, hoehe = kind_und_masse(roh)
            sha16 = hashlib.sha256(roh).hexdigest()[:16]
            zeile.update({
                "format": fmt or "unbekannt",
                "breite": breite or "", "hoehe": hoehe or "",
                "bytes": groessen.get(medium, len(roh)),
                "sha256_16": sha16,
                # MEHRDEUTIG heisst: dasselbe Medium haengt an mehreren Zellen.
                # Dann ist nicht entscheidbar, welche Figur es zeigt.
                "zuordnung": "eindeutig" if mehrfach[medium] == 1 else "mehrdeutig",
                # DIE SKY-ID GIBT ES NOCH NICHT. Sie entsteht erst beim Anlegen
                # aus `sky_id_seq`; der Zielpfad ist deshalb eine Schablone.
                "zielpfad": f"catalog/<SKY-ID>/{sha16}.{fmt}" if fmt else "",
            })
            tauglich = []
            if fmt not in ("png", "jpg", "webp"): tauglich.append("Format wird nicht erkannt")
            if zeile["bytes"] and zeile["bytes"] > MAX_BYTES: tauglich.append("groesser als 2 MiB")
            zeile["pipeline"] = "geeignet" if not tauglich else "; ".join(tauglich)

            if zeile["zuordnung"] == "eindeutig" and zeile["pipeline"] == "geeignet":
                sicher = re.sub(r"[^A-Za-z0-9]+", "_", d["katalogname"]).strip("_")
                datei = PRUEFDIR / f"{d['series_code']}_{sicher}__{sha16}.{fmt}"
                with z.open(medium) as q, datei.open("wb") as f:
                    shutil.copyfileobj(q, f)
                zeile["pruefdatei"] = datei.name
                ausgepackt += 1
            zeilen.append(zeile)

    # ----------------------------------------------------------- Ausgaben
    eindeutig = [x for x in zeilen if x["zuordnung"] == "eindeutig"]
    fehlend   = [x for x in zeilen if x["zuordnung"] == "fehlt"]
    unklar    = [x for x in zeilen if x["zuordnung"] == "mehrdeutig"]
    formate   = collections.Counter(x["format"] for x in zeilen if x["format"])
    masse     = collections.Counter(f"{x['breite']}x{x['hoehe']}" for x in eindeutig if x["breite"])

    spalten = list(zeilen[0].keys()) if zeilen else []
    with (ANALYSE / "cat-04-bildmanifest.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=spalten, delimiter=";")
        w.writeheader()
        for x in zeilen: w.writerow(x)
    (ANALYSE / "cat-04-bildmanifest.json").write_text(json.dumps({
        "quelle": xlsx,
        "strukturbeweis": beweis,
        "pipeline": {"max_bytes": MAX_BYTES, "formate": ["png", "jpg", "webp"],
                     "zielpfad": "catalog/<SKY-ID>/<16 hex sha256>.<ext>"},
        "zahlen": {"entwuerfe": len(zeilen), "eindeutig": len(eindeutig),
                   "mehrdeutig": len(unklar), "fehlt": len(fehlend),
                   "ausgepackt": ausgepackt},
        "formate": dict(formate), "aufloesungen": dict(masse),
        "zuordnungen": zeilen,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"  Entwuerfe       : {len(zeilen)}")
    print(f"  eindeutig       : {len(eindeutig)}")
    print(f"  mehrdeutig      : {len(unklar)}")
    print(f"  ohne Bild       : {len(fehlend)}")
    print(f"  Formate         : {dict(formate)}")
    print(f"  Aufloesungen    : {dict(masse.most_common(6))}")
    print(f"  ausgepackt      : {ausgepackt} → {PRUEFDIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
