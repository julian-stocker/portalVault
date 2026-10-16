-- ===========================================================================
-- RUECKNAHME von 0128 — Korrekturbelege wieder entfernen
--
-- NICHT TEIL DER MIGRATIONSKETTE. Nur nach ausdruecklicher Entscheidung.
--
-- ===========================================================================
-- DIE WICHTIGSTE AUSSAGE DIESER DATEI: SIE IST MEISTENS UNZULAESSIG.
-- ===========================================================================
--
-- `0128` hat zwei Dinge getan: zwei Funktionen angelegt und `purchase_receipts`
-- um zwei Spalten erweitert (`supersedes_number`, `supersedes_issued_at`).
-- Die Funktionen lassen sich jederzeit folgenlos entfernen. Die SPALTEN nicht:
--
--   * Ein Eigenbeleg ist UNVERAENDERLICH. `purchase_receipts_immutable_trg`
--     verbietet `update` und `delete` auf jeder Zeile.
--   * Sobald ein Korrekturbeleg ausgestellt ist, tragen diese Spalten die
--     Nummer und das Datum des Vorgaengerbelegs — also den Nachweis, WELCHES
--     Dokument ersetzt wurde.
--   * `drop column` umgeht den Trigger (es ist DDL, kein DML) und waere damit
--     ein Datenverlust an einem unveraenderlichen Beleg: still, endgueltig,
--     und genau an der Stelle, an der ein Dokument seine Nachvollziehbarkeit
--     herholt.
--
-- Deshalb BRICHT diese Datei ab, sobald irgendein Beleg eine Revision > 1
-- hat, auf einen Vorgaenger zeigt oder einen der beiden Werte gesetzt hat.
-- Das ist keine Vorsichtsmassnahme, sondern die Regel: eine solche Ruecknahme
-- findet nicht statt.
--
-- Auf STAGING ist sie bereits unzulaessig — dort existiert SI-E-2026-000002
-- als Revision 2 mit Verweis auf Revision 1.
--
-- ---------------------------------------------------------------------------
-- WENN DIE SPALTEN BLEIBEN MUESSEN, ES ABER TROTZDEM ZURUECK SOLL
-- ---------------------------------------------------------------------------
-- Dann ist die zulaessige TEILRUECKNAHME: nur die beiden Funktionen entfernen,
-- die Spalten stehen lassen. Sie sind nullable, ohne Default, und niemand
-- liest sie dann noch. Genau diese zwei Anweisungen, von Hand und bewusst:
--
--   drop function if exists public.seller_issue_purchase_receipt_correction(bigint);
--   drop function if exists public.seller_purchase_receipt_history(bigint);
--
-- Die Oberflaeche verliert damit Korrektur und Historie; `0122`/`0123`
-- (Ausstellen, Abrufen, Unveraenderlichkeit) bleiben unberuehrt.
--
-- VORBEDINGUNG dieser Datei: beide Spalten und beide Funktionen existieren,
--   und es gibt KEINEN Korrekturbeleg.
-- NACHBEDINGUNG: beide Funktionen und beide Spalten sind weg, die Zeilenzahl
--   in `purchase_receipts` ist unveraendert.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert. Vorher `npm run verify:sums`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen — hier entscheidet sich, ob ueberhaupt etwas passiert
-- ---------------------------------------------------------------------------
do $$
declare
  v_spalten   integer;
  v_funktion  integer;
  v_revision  integer;
  v_kette     integer;
  v_werte     integer;
  v_belege    integer;
begin
  select count(*) into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'purchase_receipts'
     and column_name in ('supersedes_number', 'supersedes_issued_at');

  select count(*) into v_funktion
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_issue_purchase_receipt_correction',
                       'seller_purchase_receipt_history');

  if v_spalten <> 2 or v_funktion <> 2 then
    raise exception 'R0128 Abbruch: 0128 ist hier nicht (oder nicht vollstaendig) angewendet — % Spalten, % Funktionen',
      v_spalten, v_funktion;
  end if;

  /* ---------------------------------------------------------------------
   * DER SPERRRIEGEL. Drei unabhaengige Fragen, weil eine allein luegen
   * koennte: eine Revision ohne Vorgaengerverweis waere ein kaputter
   * Zustand, ein Vorgaengerverweis ohne Revision ebenso, und gesetzte
   * Werte ohne beides hiesse, dass jemand anders geschrieben hat.
   * --------------------------------------------------------------------- */
  select count(*) into v_revision from public.purchase_receipts where revision > 1;
  select count(*) into v_kette    from public.purchase_receipts where supersedes_id is not null;
  select count(*) into v_werte    from public.purchase_receipts
   where supersedes_number is not null or supersedes_issued_at is not null;

  if v_revision > 0 or v_kette > 0 or v_werte > 0 then
    raise exception 'R0128 UNZULAESSIG: % Belege mit Revision > 1, % mit Vorgaengerverweis, % mit gesetzten Vorgaengerwerten. '
                    'Ein Korrekturbeleg ist ein unveraenderliches Dokument; drop column waere Datenverlust. '
                    'Zulaessig ist nur die Teilruecknahme (nur die zwei Funktionen) — siehe Kopf dieser Datei.',
      v_revision, v_kette, v_werte;
  end if;

  select count(*) into v_belege from public.purchase_receipts;
  raise notice 'R0128: keine Korrekturbelege vorhanden, % Beleg(e) insgesamt — Ruecknahme zulaessig', v_belege;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktionen
-- ---------------------------------------------------------------------------
drop function if exists public.seller_issue_purchase_receipt_correction(bigint);
drop function if exists public.seller_purchase_receipt_history(bigint);


-- ---------------------------------------------------------------------------
-- 3. Die Spalten — nur erreichbar, weil die Vorbedingung oben gehalten hat
-- ---------------------------------------------------------------------------
alter table public.purchase_receipts
  drop column if exists supersedes_number,
  drop column if exists supersedes_issued_at;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_spalten  integer;
  v_funktion integer;
  v_trigger  integer;
begin
  select count(*) into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'purchase_receipts'
     and column_name in ('supersedes_number', 'supersedes_issued_at');
  if v_spalten <> 0 then
    raise exception 'R0128 Abbruch: % Spalte(n) stehen noch', v_spalten;
  end if;

  select count(*) into v_funktion
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_issue_purchase_receipt_correction',
                       'seller_purchase_receipt_history');
  if v_funktion <> 0 then
    raise exception 'R0128 Abbruch: % Funktion(en) stehen noch', v_funktion;
  end if;

  /* Was NICHT angefasst werden durfte: die Unveraenderlichkeit aus 0122. */
  select count(*) into v_trigger from pg_trigger
   where not tgisinternal
     and tgname in ('purchase_receipts_immutable_trg',
                    'purchase_receipt_downloads_immutable_trg');
  if v_trigger <> 2 then
    raise exception 'R0128 Abbruch: die Unveraenderlichkeits-Trigger aus 0122 fehlen (%)', v_trigger;
  end if;

  if to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is null then
    raise exception 'R0128 Abbruch: das Ausstellen aus 0122 ist verschwunden';
  end if;

  raise notice 'R0128: Korrekturbelege entfernt, 0122/0123 unberuehrt';
end $$;
