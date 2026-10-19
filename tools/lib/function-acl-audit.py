"""
Was darf `skyisles_agent` AUSFUEHREN — ueber PUBLIC, nicht ueber eigene Rechte?

    python3 tools/lib/function-acl-audit.py            # Bericht
    python3 tools/lib/function-acl-audit.py --nur-befunde

WARUM DIESE DATEI EXISTIERT

Der lesende Pruefzugang bekommt EXECUTE auf genau drei Funktionen. Das heisst
NICHT, dass er nur drei ausfuehren kann: PostgreSQL vergibt EXECUTE auf eine
Funktion standardmaessig an PUBLIC, und jede Rolle ist in PUBLIC enthalten.
Materialisiert wird der ACL erst durch ein `revoke` — und ein `grant` an eine
andere Rolle entfernt den PUBLIC-Eintrag NICHT.

Dieses Werkzeug faltet die Migrationshistorie und beantwortet fuer jede
lebende Funktion drei Fragen:

  1. Hat irgendeine Migration PUBLIC das EXECUTE ausdruecklich entzogen?
     Wenn nein, kann `skyisles_agent` sie aufrufen.
  2. SCHREIBT sie? (`insert`, `update`, `delete`, `truncate` auf `public.`,
     oder ein Aufruf einer anderen schreibenden Funktion.)
  3. Steht ein Berechtigungstor VOR dem ersten Schreibvorgang — nicht
     irgendwo im Rumpf, sondern davor?

Punkt 3 ist der Grund, warum dieses Werkzeug nicht nach dem Vorkommen von
`can_operate_active_seller()` sucht und gut ist. Ein Tor hinter dem ersten
`insert` ist kein Tor. Und `security definer` wird getrennt ausgewiesen: eine
solche Funktion laeuft mit den Rechten ihres Eigentuemers und kann damit
Tabellen lesen oder schreiben, auf die die aufrufende Rolle kein Recht hat.

WAS ES NICHT KANN. Es liest Dateien, keine Datenbank. Ein `grant`/`revoke`,
der von Hand im SQL-Editor gelaufen ist, steht in keiner Migration — fuer die
zwei Belegfunktionen gibt es genau das (`operations/lock-receipt-issuance.sql`),
und diese Datei zieht es ausdruecklich mit ein. Der verbindliche Nachweis
bleibt die Abfrage in der Datenbank: `supabase/checks/agent_function_acl.sql`.
"""
import pathlib, re, sys

MIG = pathlib.Path("supabase/migrations")
OPS = pathlib.Path("supabase/operations")

GATES = ("can_operate_active_seller", "is_shop_admin", "is_shop_admin_for",
         "is_privileged_account", "is_collector_account", "can_read_order")
SCHREIBT = re.compile(r"\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b", re.I)


def dateien():
    return sorted(MIG.glob("*.sql"))


def gesamt_text():
    t = "\n".join(p.read_text() for p in dateien())
    for p in sorted(OPS.glob("*.sql")):
        t += "\n" + p.read_text()
    return t


def faltung():
    """
    Letzte Definition je Funktion; `drop function` nimmt sie heraus.

    IN DER REIHENFOLGE DES TEXTES, UND DAS IST DER PUNKT. Die erste Fassung
    dieser Datei sammelte je Datei erst alle `create`, dann alle `drop` — und
    `0063` tut beides in dieser Reihenfolge:

        drop function if exists public.seller_create_sale(text, date, …);
        create or replace function public.seller_create_sale( … 7 Argumente …)

    Zwei Durchgaenge liessen den `drop` den gerade erfassten `create` wieder
    entfernen: `seller_create_sale`, `seller_set_sale_date` und
    `seller_set_sale_payout` galten damit als nicht mehr vorhanden — drei
    SCHREIBENDE Funktionen, die der Bericht einfach nicht erwaehnte. Ein
    Audit, das seinen Gegenstand verliert, meldet „kein Befund".
    """
    fold = {}
    muster = re.compile(
        r"(?P<create>create\s+(?:or\s+replace\s+)?function\s+public\.(?P<cname>[a-z_0-9]+)\s*\()"
        r"|(?P<drop>drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(?P<dname>[a-z_0-9]+)\s*\()",
        re.I)
    for f in dateien():
        txt = f.read_text()
        for m in muster.finditer(txt):
            if m.group("create"):
                name = m.group("cname")
                try:
                    o = txt.index("$$", m.start()) + 2
                    c = txt.index("$$", o)
                except ValueError:
                    continue
                fold[name] = {"datei": f.name, "kopf": txt[m.start():o], "rumpf": txt[o:c]}
            else:
                fold.pop(m.group("dname"), None)
    return fold


def public_entzogen(txt):
    """Funktionsnamen, denen irgendwo PUBLIC das EXECUTE entzogen wurde."""
    weg = set()
    for m in re.finditer(
            r"revoke\s+(?:all|execute)[^;]*?on\s+function\s+(?:public\.)?([a-z_0-9]+)\s*\([^)]*\)"
            r"\s*from\s+([^;]+);", txt, re.I | re.S):
        if "public" in m.group(2).lower():
            weg.add(m.group(1))
    # Die dynamische Form aus `lock-receipt-issuance.sql`: format(..., %s) ueber
    # eine Signaturliste. Die Namen stehen in der Liste darueber.
    for m in re.finditer(r"'revoke execute on function %s from ([^']*public[^']*)'", txt, re.I):
        block = txt[max(0, m.start() - 1200):m.start()]
        for sig in re.finditer(r"'public\.([a-z_0-9]+)\(", block):
            weg.add(sig.group(1))
    return weg


def einordnen(name, eintrag, entzogen):
    kopf, rumpf = eintrag["kopf"], eintrag["rumpf"]
    ist_trigger = re.search(r"returns\s+trigger", kopf, re.I) is not None
    definer = re.search(r"security\s+definer", kopf, re.I) is not None
    schreibt = SCHREIBT.search(rumpf)

    # Wo steht das erste Tor, wo der erste Schreibvorgang?
    tor_pos = min([rumpf.lower().find(g) for g in GATES if g in rumpf.lower()] or [-1])
    schreib_pos = schreibt.start() if schreibt else -1

    if name in entzogen:
        return "PUBLIC_ENTZOGEN", definer, ist_trigger
    if ist_trigger:
        return "TRIGGER_NICHT_AUFRUFBAR", definer, ist_trigger
    if schreib_pos < 0:
        return "LESEND", definer, ist_trigger
    if tor_pos >= 0 and tor_pos < schreib_pos:
        return "SCHREIBT_MIT_TOR", definer, ist_trigger
    return "SCHREIBT_OHNE_TOR", definer, ist_trigger


def main():
    txt = gesamt_text()
    fold = faltung()
    entzogen = public_entzogen(txt)

    gruppen = {}
    for name, e in sorted(fold.items()):
        art, definer, trigger = einordnen(name, e, entzogen)
        gruppen.setdefault(art, []).append((name, e["datei"], definer))

    nur_befunde = "--nur-befunde" in sys.argv
    print(f"{len(fold)} lebende Funktionen, {len(entzogen)} mit PUBLIC-Entzug.\n")
    reihenfolge = ["SCHREIBT_OHNE_TOR", "SCHREIBT_MIT_TOR", "LESEND",
                   "TRIGGER_NICHT_AUFRUFBAR", "PUBLIC_ENTZOGEN"]
    for art in reihenfolge:
        liste = gruppen.get(art, [])
        if art == "PUBLIC_ENTZOGEN" and nur_befunde:
            print(f"{art}: {len(liste)} (nicht aufgezaehlt)")
            continue
        print(f"== {art}: {len(liste)} ==")
        if art in ("PUBLIC_ENTZOGEN",) and not nur_befunde:
            print("   (fuer skyisles_agent nicht aufrufbar)")
        else:
            for name, datei, definer in liste:
                print(f"   {name:44s} {'SECURITY DEFINER' if definer else 'invoker':16s} {datei}")
        print()

    ohne = gruppen.get("SCHREIBT_OHNE_TOR", [])
    if ohne:
        print("BEFUND: schreibende Funktion ohne Tor VOR dem Schreibvorgang, "
              "von PUBLIC aufrufbar:")
        for name, datei, definer in ohne:
            print(f"   {name} ({datei})")
        sys.exit(1)
    print("Kein Befund: keine von PUBLIC aufrufbare Funktion schreibt ohne "
          "vorangestelltes Berechtigungstor.")


if __name__ == "__main__":
    main()
