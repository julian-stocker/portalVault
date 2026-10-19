"""
Welche Rechte braucht der lesende Staging-Pruefzugang — ausgezaehlt, nicht geraten.

    python3 tools/lib/grant-plan.py            # Bericht
    python3 tools/lib/grant-plan.py --sql      # nur die GRANT-Anweisungen

WARUM AUSZAEHLEN STATT `pg_read_all_data`

Ein Zugang, der alles lesen darf, ist einfach einzurichten und schwer zu
begruenden. Der Betreiber hat „ausschliesslich die notwendigen Leserechte und
gezielt erforderliche EXECUTE-Rechte" verlangt. Notwendig ist, was die
Pruefdateien wirklich anfassen — und das steht in den Dateien. Dieses Werkzeug
liest sie mit einem echten PostgreSQL-Parser (`pglast`) und zaehlt zusammen:

  * jede Tabelle und jede View in `public`, die in einer FROM- oder
    JOIN-Klausel steht — ohne die CTE-Namen derselben Abfrage, die wie
    Tabellen aussehen und keine sind,
  * jede Funktion, die mit `public.`-Praefix AUFGERUFEN wird — Namen, die nur
    als Zeichenkette in `to_regprocedure('…')` stehen, sind keine Aufrufe und
    brauchen kein Recht.

`pg_catalog` und `information_schema` kommen nicht in die Liste: sie sind
ohnehin fuer PUBLIC lesbar. Genau darauf ruht der groesste Teil dieser
Pruefungen — Funktionsruempfe, Trigger, Rechte, Constraints.

AUSGESCHLOSSEN. `0124_fingerprint_failure_isolated.sql` ist die eine
schreibende Pruefdatei (sie stellt absichtlich einen Eigenbeleg aus und rollt
zurueck). Sie gehoert nicht zu Phase A, und ihr Funktionsaufruf darf die
Rechteliste nicht aufblaehen — sonst traege der Pruefzugang EXECUTE auf
`seller_issue_purchase_receipt`, und das waere das Gegenteil der Belegsperre.
"""
import pathlib, sys

try:
    from pglast import parse_sql
    from pglast.visitors import Visitor
except ImportError:
    print("ABBRUCH: pglast fehlt — python3 -m pip install -r requirements.txt",
          file=sys.stderr)
    sys.exit(3)

import json

CHECKS = pathlib.Path("supabase/checks")
SUITE = CHECKS / "staging-suite.json"
ROLLE = "skyisles_agent"

# Die eine Datei, die schreibt. Niemals Teil einer Rechteliste.
AUSGENOMMEN = {"0124_fingerprint_failure_isolated.sql"}


def suite_dateien():
    """Genau die Dateien, die `npm run db:check:staging` faehrt."""
    d = json.loads(SUITE.read_text())
    return [x["datei"] for x in d["dateien"]]


def namen_von(obj):
    return [n.sval for n in (obj or ())]


def sammle(nur=None):
    tabellen = {}
    funktionen = {}

    for f in sorted(CHECKS.glob("*.sql")):
        if f.name in AUSGENOMMEN:
            continue
        if nur is not None and f.name not in nur:
            continue
        try:
            stmts = parse_sql(f.read_text())
        except Exception as e:                       # darf nicht passieren
            print(f"PARSE-FEHLER {f.name}: {e}", file=sys.stderr)
            continue

        for raw in stmts:
            # 1. Alle CTE-Namen der Anweisung — sie sehen wie Tabellen aus.
            ctes = set()

            class CteVisitor(Visitor):
                def visit_CommonTableExpr(self, anc, node):
                    if node.ctename:
                        ctes.add(node.ctename)

            CteVisitor()(raw)

            class V(Visitor):
                def visit_RangeVar(self, anc, node):
                    if node.schemaname not in (None, "public"):
                        return
                    name = node.relname
                    if name in ctes:
                        return
                    if name.startswith("pg_"):
                        return
                    tabellen.setdefault(name, set()).add(f.name)

                def visit_FuncCall(self, anc, node):
                    teile = namen_von(node.funcname)
                    if len(teile) == 2 and teile[0] == "public":
                        funktionen.setdefault(teile[1], set()).add(f.name)

            V()(raw)

    return tabellen, funktionen


def main():
    alle = "--alle" in sys.argv
    nur = None if alle else set(suite_dateien())
    tabellen, funktionen = sammle(nur)
    nur_sql = "--sql" in sys.argv

    if nur_sql:
        for t in sorted(tabellen):
            print(f"grant select on table public.{t} to {ROLLE};")
        return

    umfang = "ALLE Pruefdateien" if alle else f"die {len(nur)} Dateien der Staging-Suite"
    print(f"RECHTEPLAN fuer {ROLLE} — Umfang: {umfang}\n")
    print(f"TABELLEN UND VIEWS ({len(tabellen)}) — je SELECT")
    for t in sorted(tabellen):
        print(f"  {t:34s} in {len(tabellen[t])} Pruefdatei(en)")
    print(f"\nFUNKTIONEN ({len(funktionen)}) — je EXECUTE")
    for fn in sorted(funktionen):
        print(f"  {fn:34s} in {len(funktionen[fn])} Pruefdatei(en)")
    print("\nNICHT IN DER LISTE, mit Absicht:")
    print("  pg_catalog, information_schema  — fuer PUBLIC ohnehin lesbar")
    print("  seller_issue_purchase_receipt   — nur in der einen schreibenden")
    print("                                    Pruefdatei, die nicht zu Phase A gehoert")
    print("\nWAECHST DIE SUITE, waechst die Liste: dieses Werkzeug neu fahren,")
    print("die Differenz als GRANT-Anweisungen im Staging-Editor anwenden, und")
    print("`supabase/operations/staging-agent-setup.sql` nachziehen.")


if __name__ == "__main__":
    main()
