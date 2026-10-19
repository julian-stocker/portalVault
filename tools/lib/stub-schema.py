"""
Baut ein Stub-Schema aus den Migrationen: Tabellen mit echten Spaltentypen,
Views im Original, Funktionen als Huelle mit echter Signatur. Ohne
Constraints, ohne Daten, ohne Trigger — gerade genug, damit PostgreSQL jede
Pruefdatei VOLLSTAENDIG aufloesen und typisieren kann.
"""
import pathlib, sys

try:
    from pglast import parse_sql
    from pglast.stream import RawStream
except ImportError:
    print("ABBRUCH: pglast fehlt — ohne SQL-Parser kein Stub-Schema.",
          file=sys.stderr)
    print("  python3 -m pip install -r requirements.txt", file=sys.stderr)
    sys.exit(3)

MIG_DIR = sys.argv[2] if len(sys.argv) > 2 else "supabase/migrations"
MIG = sorted(pathlib.Path(MIG_DIR).glob("*.sql"))
tabellen = {}
views = {}
funktionen = {}
sequenzen = set()
fehler = []    # nicht unterstuetzte Anweisungen; fuehren zum Abbruch

def name_von(rv):
    return rv.relname

for f in MIG:
    try:
        stmts = parse_sql(f.read_text())
    except Exception as e:                      # darf nicht passieren
        print(f"PARSE-FEHLER {f.name}: {e}", file=sys.stderr); continue
    for raw in stmts:
        n = raw.stmt
        t = type(n).__name__
        if t == "CreateStmt" and n.relation.schemaname in (None, "public"):
            # TEMPORAERE TABELLEN GEHOEREN NICHT INS STUB-SCHEMA.
            #
            # `0135` und `0136` legen ihre Abdruecke in einer Temporaertabelle
            # ab (`on commit drop`). Die hat `schemaname = None` wie eine
            # ungequalifizierte Tabelle — ohne diese Zeile stuende sie als
            # `public.<name>` im Stub, und eine Pruefdatei, die sie ausserhalb
            # ihrer Sitzung abfragt, wuerde gruen planen statt mit 42P01 zu
            # scheitern. Ein falscher Erfolg ist die eine Richtung, die dieses
            # Werkzeug niemals nehmen darf.
            if getattr(n.relation, "relpersistence", "p") != "p":
                continue
            cols = []
            for el in (n.tableElts or ()):
                if type(el).__name__ == "ColumnDef" and el.typeName is not None:
                    cols.append((el.colname, RawStream()(el.typeName)))
            tabellen[name_von(n.relation)] = cols
        elif t == "AlterTableStmt" and n.relation.schemaname in (None, "public"):
            rel = name_von(n.relation)
            for cmd in (n.cmds or ()):
                sub = cmd.subtype
                art = getattr(sub, "name", str(sub))
                if "AddColumn" in art and cmd.def_ is not None and type(cmd.def_).__name__ == "ColumnDef":
                    cd = cmd.def_
                    if cd.typeName is not None:
                        vorhanden = {c for c, _ in tabellen.setdefault(rel, [])}
                        if cd.colname not in vorhanden:
                            tabellen[rel].append((cd.colname, RawStream()(cd.typeName)))
                elif "DropColumn" in art and cmd.name:
                    tabellen[rel] = [(c, ty) for c, ty in tabellen.get(rel, []) if c != cmd.name]
                elif "AlterColumnType" in art:
                    # NICHT UNTERSTUETZT — und deshalb ein Abbruch, kein Achselzucken.
                    #
                    # Dieser Generator faltet Spalten aus `create table` und
                    # `add column`. Eine spaetere TYPAENDERUNG wuerde er
                    # uebersehen: das Stub-Schema truege den alten Typ, die
                    # Planpruefung wuerde gegen ein Schema planen, das es
                    # nicht gibt — und sie wuerde GRUEN melden. Ein stilles
                    # falsches Schema ist schlimmer als keines.
                    spalte = cmd.name or "(unbekannt)"
                    fehler.append(
                        f"{f.name}: alter table public.{rel} alter column {spalte} type …")
                elif "RenameColumn" in art:
                    fehler.append(f"{f.name}: alter table public.{rel} rename column …")
        elif t == "DropStmt" and getattr(n.removeType, "name", "") == "OBJECT_TABLE":
            # `drop table` faltet mit: eine geloeschte Tabelle, die im Stub
            # stehen bleibt, laesst eine Pruefdatei gruen planen, die auf
            # Production mit 42P01 abbricht.
            for obj in (n.objects or ()):
                teile = [x.sval for x in obj] if not isinstance(obj, str) else [obj]
                if teile and teile[0] in (None, "public") and len(teile) > 1:
                    tabellen.pop(teile[1], None)
                elif teile:
                    tabellen.pop(teile[-1], None)
        elif t == "RenameStmt" and getattr(n.renameType, "name", "") == "OBJECT_TABLE":
            # `alter table … rename to` — EINMAL in der Historie (`0026`:
            # `business_settings` wird `platform_settings`), und bis zum
            # 2026-10-19 uebersehen. Die Folge war ein Stub-Schema, in dem
            # `platform_settings` nur die NACH der Umbenennung ergaenzten
            # Spalten trug und `business_settings` als Geisttabelle weiterlebte:
            # eine Pruefdatei auf `platform_settings.contact_email` haette
            # falschen Alarm gegeben, eine auf `business_settings` falschen
            # Erfolg. Gefunden hat es der Definitionslauf — `platform_settings_public()`
            # liess sich nicht erzeugen.
            alt_name = n.relation.relname if n.relation is not None else None
            if alt_name is not None and n.newname:
                tabellen[n.newname] = tabellen.pop(alt_name, tabellen.get(n.newname, []))
        elif t == "RenameStmt" and getattr(n.renameType, "name", "") in (
                "OBJECT_VIEW", "OBJECT_SEQUENCE", "OBJECT_MATVIEW"):
            fehler.append(f"{f.name}: rename von "
                          f"{getattr(n.renameType, 'name', '?')} — nicht unterstuetzt")
        elif t == "CreateSeqStmt":
            sequenzen.add(n.sequence.relname)
        elif t == "RenameStmt" and getattr(n.renameType, "name", "") == "OBJECT_COLUMN":
            rel = n.relation.relname if n.relation is not None else "(unbekannt)"
            fehler.append(f"{f.name}: alter table public.{rel} rename column "
                          f"{n.subname or '?'} to {n.newname or '?'}")
        elif t == "ViewStmt" and n.view.schemaname in (None, "public"):
            views[name_von(n.view)] = RawStream()(raw) + ";"
        elif t == "CreateFunctionStmt":
            fn = n.funcname[-1].sval
            args = []
            for p in (n.parameters or ()):
                mode = getattr(p.mode, "name", "")
                if "TABLE" in mode:              # OUT-Spalten von returns table
                    continue
                args.append(RawStream()(p.argType))
            ret = RawStream()(n.returnType) if n.returnType is not None else "void"
            setof = bool(getattr(n.returnType, "setof", False))
            tabellenrueckgabe = [
                (p.name, RawStream()(p.argType)) for p in (n.parameters or ())
                if "TABLE" in getattr(p.mode, "name", "")
            ]
            sig = f"public.{fn}({', '.join(args)})"
            if tabellenrueckgabe:
                spalten = ", ".join(f"{c} {ty}" for c, ty in tabellenrueckgabe)
                koerper = (f"create or replace function {sig} returns table ({spalten})\n"
                           f"language plpgsql as $stub$ begin return; end $stub$;")
            elif ret == "trigger":
                continue
            elif setof:
                koerper = (f"create or replace function {sig} returns setof {ret}\n"
                           f"language plpgsql as $stub$ begin return; end $stub$;")
            else:
                koerper = (f"create or replace function {sig} returns {ret}\n"
                           f"language plpgsql as $stub$ begin return null::{ret}; end $stub$;")
            funktionen[sig] = koerper

if fehler:
    print("ABBRUCH: der Stub-Schema-Generator unterstuetzt diese Anweisungen nicht.",
          file=sys.stderr)
    print("Er faltet Spalten aus `create table` und `add column`; eine Typaenderung oder",
          file=sys.stderr)
    print("Umbenennung wuerde er uebersehen und ein FALSCHES Schema erzeugen, gegen das die",
          file=sys.stderr)
    print("Planpruefung dann gruen meldet. Entweder den Generator erweitern oder die",
          file=sys.stderr)
    print("betroffene Tabelle ausdruecklich ausnehmen — aber nicht stillschweigend weiter.",
          file=sys.stderr)
    for z in fehler:
        print(f"  {z}", file=sys.stderr)
    sys.exit(2)

aus = []
aus.append("-- Stub-Schema, erzeugt aus supabase/migrations/ — NUR fuer die Validierung.")
aus.append("create schema if not exists public;")
aus.append("create schema if not exists auth;")
aus.append("create or replace function auth.uid() returns uuid language sql as $stub$ select null::uuid $stub$;")
aus.append("create or replace function auth.role() returns text language sql as $stub$ select null::text $stub$;")
for rolle in ("anon", "authenticated", "service_role"):
    aus.append(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{rolle}') "
               f"then create role {rolle}; end if; end $$;")
for s in sorted(sequenzen):
    # Ohne sie loest `nextval('public.order_number_seq')` nicht auf, und der
    # Definitionslauf koennte `next_order_number()` nicht erzeugen.
    aus.append(f"create sequence if not exists public.{s};")
for t, cols in sorted(tabellen.items()):
    if not cols: continue
    spalten = ",\n  ".join(f'"{c}" {ty}' for c, ty in cols)
    aus.append(f"create table if not exists public.{t} (\n  {spalten}\n);")
for sig, ddl in sorted(funktionen.items()):
    aus.append(ddl)
for v, ddl in views.items():
    aus.append(ddl)
pathlib.Path(sys.argv[1]).write_text("\n".join(aus) + "\n")
print(f"Stub-Schema: {len(tabellen)} Tabellen, {len(funktionen)} Funktionen, "
      f"{len(views)} Views, {len(sequenzen)} Sequenzen")
