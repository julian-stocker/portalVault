-- ===========================================================================
-- STAGING — DER ZUSTAND RUND UM DEN FUNKTIONSTEST DES VERKAUFSABGLEICHS,
-- REIN LESEND (ADR-0174, ADR-0176)
--
-- ZWEIMAL FAHREN, ALS `postgres` IM SQL-EDITOR VON qqxcpesbwfxzgytkdsac:
--   1. VOR  `npm run verify:sales-reconciliation:staging -- --apply`
--   2. NACH dem Lauf.
--
-- Der Funktionstest selbst hat KEINEN privilegierten Zugang mehr (kein
-- Service-Role-Schluessel): er arbeitet als das vorhandene Betriebskonto und
-- sieht nur, was dessen Funktionen zeigen. Was der Lauf NICHT anfassen darf,
-- misst deshalb diese Datei — vorher und nachher, und der Vergleich ist die
-- Abnahme.
--
--   101-108  UNVERAENDERT: Lager, Bewegungen, Legacy-Ereignisse, jeder echte
--            Verkauf, seine Positionen, Erstattungen, Auditzeilen und Holds.
--            Vorher und nachher ZEICHENGLEICH, sonst ist der Test gescheitert.
--   201-206  DER TESTLAUF: Testverkaeufe mit der Notiz des Verifiers,
--            Abgleichssitzungen nach Zustand, Entscheidungen, Anwendungen.
--            Erwartete Zunahme je vollstaendigem Lauf: 12 Testverkaeufe,
--            1 geschlossene und 1 verworfene Sitzung. Eine OFFENE Sitzung aus
--            einer Verifier-Datei (206) heisst: ein Lauf brach ab und konnte
--            sie nicht verwerfen.
--
-- GESCHUETZTE TABELLEN stehen hinter `has_table_privilege` + `query_to_xml`:
-- fuer den lesenden Pruefzugang `KEIN-RECHT` (9998 zaehlt sie), als
-- `postgres` gemessen. Diese Datei gibt KEINE Kaeufer-, Adress- oder
-- Kontodaten aus — nur Zahlen und Abdruecke.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund) as (values
  -- ------------------------------------------------ Was sich nicht bewegen darf
  (101, 'Unveraendert', 'Lager: Zeilen|Abdruck (Menge, reserviert, freigegeben)',
      case when has_table_privilege('public.shop_inventory', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(i.id::text || '':'' || i.quantity::text || '':'' || i.reserved::text || '':'' || i.sale_released::text, '','' order by i.id)), ''(leer)'') as c from public.shop_inventory i', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (102, 'Unveraendert', 'Lagerbewegungen',
      case when has_table_privilege('public.inventory_movements', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.inventory_movements', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (103, 'Unveraendert', 'Legacy-Lagerereignisse',
      case when has_table_privilege('public.legacy_stock_events', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.legacy_stock_events', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (104, 'Unveraendert', 'echte Verkaeufe: Anzahl|Abdruck (jede Spalte)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(s)::text, chr(10) order by s.id)), ''(leer)'') as c from public.sales s where not s.is_test', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (105, 'Unveraendert', 'Positionen echter Verkaeufe: Anzahl|Abdruck',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(to_jsonb(i)::text, chr(10) order by i.id)), ''(leer)'') as c from public.sale_items i join public.sales s on s.id = i.sale_id where not s.is_test', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (106, 'Unveraendert', 'Erstattungen echter Verkaeufe: Anzahl|Summe',
      case when has_table_privilege('public.sale_refunds', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(r.amount), 0)::text as c from public.sale_refunds r join public.sales s on s.id = r.sale_id where not s.is_test', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (107, 'Unveraendert', 'Auditzeilen echter Verkaeufe: Anzahl|Abdruck',
      case when has_table_privilege('public.orderbook_audit', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(md5(string_agg(a.id::text || '':'' || coalesce(a.field, ''-'') || '':'' || coalesce(a.new_value, ''-''), chr(10) order by a.id)), ''(leer)'') as c from public.orderbook_audit a left join public.sales s on s.id = a.sale_id where s.id is null or not s.is_test', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (108, 'Unveraendert', 'aktive Holds: Anzahl|Menge',
      case when has_table_privilege('public.order_reservations', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text || ''|'' || coalesce(sum(quantity), 0)::text as c from public.order_reservations where state = ''active''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),

  -- ----------------------------------------------------------- Der Testlauf
  (201, 'Testlauf', 'Testverkaeufe des Verifiers (Notiz verify:sales-reconciliation)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.sales s where s.is_test and s.note like ''verify:sales-reconciliation %''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (202, 'Testlauf', 'davon NICHT als Test markiert (muss 0 sein)',
      case when has_table_privilege('public.sales', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.sales s where not s.is_test and s.note like ''verify:sales-reconciliation %''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (203, 'Testlauf', 'Abgleichssitzungen: offen|geschlossen|verworfen',
      case when has_table_privilege('public.sales_recon_sessions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*) filter (where state = ''open'')::text || ''|'' || count(*) filter (where state = ''closed'')::text || ''|'' || count(*) filter (where state = ''discarded'')::text as c from public.sales_recon_sessions', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (204, 'Testlauf', 'Entscheidungen',
      case when has_table_privilege('public.sales_recon_decisions', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*)::text as c from public.sales_recon_decisions', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (205, 'Testlauf', 'Anwendungen: angewendet|dokumentiert',
      case when has_table_privilege('public.sales_recon_applications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*) filter (where outcome = ''applied'')::text || ''|'' || count(*) filter (where outcome = ''documented'')::text as c from public.sales_recon_applications', false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (206, 'Testlauf', 'OFFENE Sitzungen aus einer Verifier-Datei (Rest eines abgebrochenen Laufs)',
      case when has_table_privilege('public.sales_recon_files', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(distinct s.id)::text as c from public.sales_recon_sessions s join public.sales_recon_files f on f.session_id = s.id where s.state = ''open'' and f.file_name like ''verify-recon-%''', false, true, '')))[1]::text
           else 'KEIN-RECHT' end)
)
select nr, bereich, pruefung, befund from pruef
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig gemessen)',
       (select count(*) from pruef where befund = 'KEIN-RECHT')::text
 order by nr;
