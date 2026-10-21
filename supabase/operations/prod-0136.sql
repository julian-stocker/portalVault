-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0136
--              (die Betriebssicherung kennt den Artikeltyp)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des PRODUCTION-Projekts einfuegen, ausfuehren. Nichts in Teilen:
-- jede Zeile gehoert zur selben Klammer, und ein Fehler irgendwo rollt ALLES
-- zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert — `0132` und `0133` landeten unbeabsichtigt auf
-- Production (`docs/history/2026-10-18-production-0132-0133.md`). Diese
-- Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: bin ich wirklich auf Production?
--   B   Migration 0136, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0136_business_backup_item_type.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE NICHT TUT
--
--   * Sie fasst KEINE Tabellenzeile an. Sie schreibt eine Funktion neu, und
--     die Funktion liest nur.
--   * Keine Rechteaenderung, keine personenbezogene Spalte kommt dazu.
--
-- SIE SETZT `0135` VORAUS.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck.
--
-- RUECKNAHME: `supabase/rollback/R0136_back_to_0131.sql`.
-- REIHENFOLGE UND STOPP-KRITERIEN: `supabase/checks/production_release_0135_0141.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- ZWEI BEDINGUNGEN, UND BEIDE MUESSEN GELTEN. Eine negative allein waere
-- schwach: „kein Staging" stimmt auch fuer eine leere Datenbank.
--
--   A1  Der STAGING-Stempel fehlt. `SKY-0821` und `SKY-0822` gibt es auf
--       Staging und auf Production bewusst NICHT
--       (`supabase/checks/staging_pending_migrations.sql`, Zeile 101).
--   A2  `0133` ist angewendet. Sie liegt seit dem 2026-10-18 auf Production
--       und fehlt auf Staging — dieselbe Akte, dieselbe Zeile 211. Das ist
--       der POSITIVE Teil: er unterscheidet Production von einer beliebigen
--       anderen Datenbank, die nur den Staging-Stempel nicht hat.
--   A3  Und es ist kein leeres Projekt: der Katalog traegt Zeilen.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 0 then
    raise exception 'ABBRUCH A1: der STAGING-Stempel ist da. Diese Datei ist fuer '
      'Production (zmiwxswrpkmizvqsgype) — auf Staging gehoert die Datei '
      'supabase/operations/staging-0136.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;


-- ---------------------------------------------------------------------------
-- B. Die Migration, unveraendert
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0136_business_backup_item_type.sql
-- ===========================================================================
-- 0136 — DER ARTIKELTYP STEHT IN DER SICHERUNG
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Entwurf. Braucht eine eigene Freigabe.                               ##
-- ##                                                                       ##
-- ##  SIE SETZT `0135` VORAUS. Der Rumpf liest `t.item_type`, und ein      ##
-- ##  `language sql`-Rumpf wird bei der Erzeugung aufgeloest: ohne die      ##
-- ##  Spalte scheitert schon `create or replace function` mit 42703.       ##
-- ##  Reihenfolge: `0135`, dann `0136`. Nicht umgekehrt, nicht zugleich.   ##
-- ###########################################################################
--
-- DIE ENTSCHEIDUNG, UND WER SIE GETROFFEN HAT
--
-- Der Betreiber hat am 2026-10-19 entschieden, `item_type` ausdruecklich in
-- die Betriebssicherung aufzunehmen. Begruendung, wortgleich: „Der Artikeltyp
-- ist langfristig eine eigenstaendige fachliche Eigenschaft und soll bei
-- einer Wiederherstellung nicht aus Kategorien rekonstruiert werden muessen."
--
-- Der Entwurf zu `0135` hatte das Gegenteil vorgeschlagen — ableitbar aus der
-- exportierten `category_id`, also verzichtbar. Das Argument war richtig und
-- ist jetzt gegenstandslos: ableitbar heisst, die Regel muss bei jeder
-- Wiederherstellung erneut angewendet werden, und eine Regel, die nirgends
-- ausgefuehrt wird, verfaellt. Der Wert steht jetzt in der Datei.
--
-- WARUM EINE EIGENE MIGRATION UND NICHT EIN ABSCHNITT IN `0135`
--
--   1. `0135` beweist sich selbst dadurch, dass sich NICHTS aendert — die
--      Angebotsliste, der Fortschrittsnenner, die Overrides. Ein zweiter,
--      600 Zeilen langer Funktionsrumpf in derselben Datei macht diesen
--      Beweis unlesbar, ohne ihn zu verbessern.
--   2. Die Sicherungsfunktion hat eine EIGENE Abdruckkette: `0129` → `0130`
--      → `0131`, jede Fassung mit md5 von Rumpf und Kommentar, jede mit einer
--      Ruecknahme (`R0130`, `R0131`). `0136` ist das naechste Glied dieser
--      Kette. In einer Spaltenmigration verschwunden, waere es keines.
--   3. Die Ruecknahmen bleiben unabhaengig: `R0136` stellt den Rumpf aus
--      `0131` wieder her, `R0135` nimmt die Spalte zurueck. In EINER Migration
--      waere nur noch beides zusammen ruecknehmbar.
--
-- WAS SIE TUT: sie ersetzt `seller_business_backup()` durch denselben Rumpf
-- wie `0131`, mit GENAU EINER zusaetzlichen Zeile im Bereich `figures`:
--
--      'item_type', t.item_type,
--
-- Sie steht unmittelbar nach `'card_type', t.card_type,` — die beiden
-- Typspalten nebeneinander — und ist deshalb eine reine EINFUEGUNG: der
-- restliche Rumpf ist Zeichen fuer Zeichen der aus `0131`. Dass das so ist,
-- rechnet `src/lib/backup/backup-item-type.test.ts` bei jedem Testlauf nach.
--
-- ABDRUECKE
--   vorher  md5(prosrc) = 24c3810288bb20929fe995554a267adf  (21458 Zeichen)
--   nachher md5(prosrc) = f6d08440707ba72a8040a8d1e666c092  (21494 Zeichen)
--   Kommentar nachher   = c12618f312b413571eeabe912ca03651  (890 Zeichen)
--   Form                = 28 Bereiche, 353 Feldzeilen (vorher 352),
--                         Bereich figures 10 Felder (vorher 9)
--
-- WAS SIE NICHT TUT
--
--   * Sie aendert KEINE bereits angewendete Migration. `0131` bleibt, wie sie
--     ist; ihr Abdruck bleibt gueltig fuer jede Umgebung, die noch auf `0131`
--     steht. `0131_function_body_check.sql` kennt ab jetzt BEIDE Staende.
--   * Sie aendert `BACKUP_FORMAT_VERSION` nicht. Die Version steigt, wenn
--     sich die BEDEUTUNG eines Feldes aendert oder ein Bereich verschwindet —
--     nicht, wenn ein Feld dazukommt (`src/lib/backup/manifest.ts`). Eine
--     aeltere Sicherung bleibt damit lesbar; ihr fehlt im Bereich `figures`
--     ein Schluessel, und genau das sagt die Formatversion nicht.
--   * Sie fasst KEIN Recht an. `create or replace function` behaelt den
--     bestehenden ACL; weder `revoke` noch `grant` steht in dieser Datei. Die
--     Nachbedingung prueft, dass PUBLIC und `anon` weiterhin draussen sind.
--   * Sie liest und schreibt KEINE Geschaeftszeile. Die Funktion bleibt
--     `stable`, `security definer`, mit leerem `search_path`.
--   * Sie beruehrt die Belegtabellen nicht, und die neun personenbezogenen
--     Einkaufsfelder bleiben ausgeschlossen — die Nachbedingung prueft beides
--     ein zweites Mal, bereichsgenau.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher und nachher `0131_function_body_check.sql` (vorher: STAND_0131,
-- nachher: STAND_0136). Ruecknahme: `supabase/rollback/R0136_back_to_0131.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Der Abdruck VOR der Aenderung
--
-- Er liegt in einer temporaeren Tabelle mit `on commit drop`: sie lebt genau
-- bis zum Ende dieser Transaktion — ob sie mit `commit` oder mit `rollback`
-- endet — und kann keine Geschaeftszeile beruehren.
-- ---------------------------------------------------------------------------
create temporary table abdruck_0136 (
  schluessel text primary key,
  wert       text not null
) on commit drop;


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_md5   text;
  v_def   text;
  v_code  text;
begin
  /*
   * DER KLAMMERGRIFF, UND WARUM ER FUNKTIONIERT.
   *
   * Die Tabelle oben traegt `on commit drop`. Laeuft diese Datei NICHT in
   * einer Klammer, ist jede Anweisung ihre eigene Transaktion — dann ist die
   * Tabelle nach ihrer Erzeugung sofort wieder weg, und dieser Block bricht
   * ab, BEVOR die Funktion ersetzt wird. Laeuft die Datei als Ganzes (ein
   * Mehranweisungs-Lauf ist eine implizite Transaktion) oder in einem
   * ausdruecklichen `begin` / `commit`, steht sie.
   */
  if to_regclass('pg_temp.abdruck_0136') is null then
    raise exception '0136 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0136 setzt 0104 voraus: seller_business_backup fehlt';
  end if;

  /*
   * `0135` IST DIE HARTE VORBEDINGUNG. Der Rumpf unten liest `t.item_type`.
   * Ein `language sql`-Rumpf wird bei der Erzeugung vollstaendig aufgeloest,
   * die Migration scheiterte also ohnehin — aber mit `42703 column
   * t.item_type does not exist` statt mit einem Satz, der sagt, was fehlt.
   */
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception '0136 setzt 0135 voraus: skylanders.item_type fehlt';
  end if;

  select md5(p.prosrc) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()');

  if v_md5 = 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception '0136 Abbruch: schon angewendet — der lebende Rumpf IST der aus 0136';
  end if;
  if v_md5 <> '24c3810288bb20929fe995554a267adf' then
    raise exception '0136 Abbruch: der lebende Rumpf ist nicht der aus 0131 (md5 %) — '
      'erst 0131_function_body_check.sql lesen', v_md5;
  end if;

  -- Der Rumpf ohne Kommentare, wie in 0130 und 0131.
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '0136 Abbruch: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter';
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  /*
   * DER ABDRUCK: ALLE BEREICH-FELD-PAARE AUSSER DENEN DES BEREICHS `figures`.
   *
   * Das ist der Beweis, den diese Migration ueber sich selbst fuehrt. Sie
   * aendert genau einen Bereich; die 27 anderen muessen danach Zeichen fuer
   * Zeichen dieselben Paare in derselben Reihenfolge tragen. Zeilenweise
   * bestimmt, ohne jeden mehrzeiligen Ausdruck — dieselbe Lehre wie in `0130`
   * und `0131` (Handbuch 9.7.3.5).
   */
  insert into abdruck_0136 (schluessel, wert)
  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  select * from (values
    ('bereiche', (select count(*)::text from anfang)),
    ('felder',   (select count(*)::text from paar)),
    ('ohne_figures_md5',
       (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
          from paar p where p.bereich <> 'figures')),
    ('ohne_figures_anzahl',
       (select count(*)::text from paar p where p.bereich <> 'figures')),
    ('figures',
       (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
          from paar p where p.bereich = 'figures'))
  ) v(schluessel, wert);

  if (select wert from abdruck_0136 where schluessel = 'bereiche') <> '28' then
    raise exception '0136 Abbruch: der Bereichsparser erkennt % Bereiche statt 28 — '
      'Abbruch vor jeder Feldaussage',
      (select wert from abdruck_0136 where schluessel = 'bereiche');
  end if;
  if (select wert from abdruck_0136 where schluessel = 'felder') <> '352' then
    raise exception '0136 Abbruch: % Feldzeilen statt 352 — der lebende Rumpf ist nicht der aus 0131',
      (select wert from abdruck_0136 where schluessel = 'felder');
  end if;
  if (select wert from abdruck_0136 where schluessel = 'figures')
     <> '''sky_id'', t.sky_id;''name'', t.name;''slug'', t.slug;'
      || '''series_code'', t.series_code;''card_type'', t.card_type;'
      || '''market_price'', t.market_price::text;''category_id'', t.category_id;'
      || '''is_active'', t.is_active;''source'', t.source' then
    raise exception '0136 Abbruch: der Bereich figures ist nicht der aus 0131 (%)',
      (select wert from abdruck_0136 where schluessel = 'figures');
  end if;

  raise notice '0136: Vorbedingungen erfuellt — 28 Bereiche, 352 Feldzeilen, '
    'figures mit 9 Feldern, 27 andere Bereiche als Abdruck %',
    (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5');
end
$$;


-- ---------------------------------------------------------------------------
-- 2. Die Sicherung, um GENAU EINE Feldzeile ergaenzt
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_backup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with used_figures as (
    /*
     * Die SKY-IDs, die im Backup überhaupt vorkommen. Der
     * Stammdatenschnappschuss beschränkt sich darauf — 605 Katalogzeilen
     * mitzuschicken, von denen die Hälfte nie gehandelt wurde, machte die
     * Datei größer und nicht verständlicher.
     */
    select sky_id from public.shop_inventory
    union select sky_id from public.purchase_items
    union select sky_id from public.sale_items
    union select sky_id from public.order_lines
  )
  select case when not public.can_operate_active_seller() then null else jsonb_build_object(

    /* ---- Metadaten -------------------------------------------------- */
    'format',          'skyisles-business-backup',
    'format_version',  1,
    'created_at',      now(),
    'commerce_mode',   (select s.mode from public.commerce_settings s limit 1),
    'seller_legal_name', (select s.legal_name from public.sellers s limit 1),
    'snapshot_txid',   pg_current_snapshot()::text,
    'inventory_units', (select coalesce(sum(i.quantity), 0) from public.shop_inventory i),
    'buy_in_factor',   public.orderbook_global_factor()::text,
    'contains_personal_data', true,
    'restore_supported',      false,

    /* ---- Die Bereiche ----------------------------------------------- */
    'data', jsonb_build_object(
      'shop_inventory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'reserved', t.reserved,
          'available_quantity', t.available_quantity,
          'sale_price', t.sale_price::text,
          'is_listed', t.is_listed,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_inventory t
      ), '[]'::jsonb),
  
      'inventory_movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'inventory_id', t.inventory_id,
          'delta', t.delta,
          'reason', t.reason,
          'unit_cost', t.unit_cost::text,
          'currency', t.currency,
          'note', t.note,
          'created_at', t.created_at,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'purchases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchased_at', t.purchased_at,
          'total_cost', t.total_cost::text,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'platform', t.platform,
          'seller_name', t.seller_name,
          'source', t.source,
          'external_ref', t.external_ref,
          'note', t.note,
          'is_test', t.is_test,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchases t
      ), '[]'::jsonb),
  
      'purchase_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'raw_name', t.raw_name,
          'state', t.state,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'market_price_source', t.market_price_source,
          'movement_id', t.movement_id,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchase_items t
      ), '[]'::jsonb),
  
      /* ---------------------------------------------- Eigenbelege (0129) */
      /*
       * DIE DREI BELEGTABELLEN. Sie fehlten bis `0129` ganz — eine
       * Wiederherstellung aus dieser Datei haette jeden Eigenbeleg verloren,
       * samt Nummernkreis und Abrufnachweis.
       *
       * `lines` kommt als ganzes `jsonb` mit: es IST der eingefrorene
       * Snapshot und wird nicht neu aus `purchase_items` gebildet. Genau
       * darin liegt sein Zweck.
       */
      'purchase_receipts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'receipt_number', t.receipt_number,
          'issued_at', t.issued_at,
          'revision', t.revision,
          'supersedes_id', t.supersedes_id,
          'supersedes_number', t.supersedes_number,
          'supersedes_issued_at', t.supersedes_issued_at,
          'format_version', t.format_version,
          'content_fingerprint', t.content_fingerprint,
          'buyer_legal_name', t.buyer_legal_name,
          'buyer_trade_name', t.buyer_trade_name,
          'buyer_street', t.buyer_street,
          'buyer_postal_code', t.buyer_postal_code,
          'buyer_city', t.buyer_city,
          'buyer_country', t.buyer_country,
          'buyer_email', t.buyer_email,
          'buyer_vat_id', t.buyer_vat_id,
          'seller_platform', t.seller_platform,
          'seller_handle', t.seller_handle,
          'sender_name', t.sender_name,
          'sender_street', t.sender_street,
          'sender_postal_code', t.sender_postal_code,
          'sender_city', t.sender_city,
          'sender_country', t.sender_country,
          'listing_ref', t.listing_ref,
          'listing_title', t.listing_title,
          'listing_url', t.listing_url,
          'listing_details', t.listing_details,
          'purchased_at', t.purchased_at,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'total_cost', t.total_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'agreement_note', t.agreement_note,
          'lines', t.lines
        ) order by t.id)
          from public.purchase_receipts t
      ), '[]'::jsonb),
  
      /*
       * DER ABRUFNACHWEIS. Ohne ihn waere nach einer Wiederherstellung nicht
       * mehr belegbar, dass ein Beleg je vollstaendig ausgeliefert wurde —
       * und der gruene Haken in der Oberflaeche haengt daran.
       */
      'purchase_receipt_downloads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'receipt_id', t.receipt_id,
          'delivered_at', t.delivered_at,
          'byte_count', t.byte_count
        ) order by t.id)
          from public.purchase_receipt_downloads t
      ), '[]'::jsonb),
  
      /*
       * DER NUMMERNZAEHLER. Er ist der Grund, warum der Nummernkreis
       * lueckenlos bleibt. Ohne ihn vergaebe eine wiederhergestellte Datenbank
       * Nummern, die es schon gibt — und `receipts_number_unique` schluege
       * beim naechsten Ausstellen zu.
       */
      'purchase_receipt_counters', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', t.year,
          'next_number', t.next_number
        ) order by t.year)
          from public.purchase_receipt_counters t
      ), '[]'::jsonb),
  
      'sales', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'channel', t.channel,
          'order_id', t.order_id,
          'sold_at', t.sold_at,
          'shipped_at', t.shipped_at,
          'destination_country_code', t.destination_country_code,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_charged', t.shipping_charged::text,
          'discount_amount', t.discount_amount::text,
          'reported_payout_amount', t.reported_payout_amount::text,
          'reported_payout_ref', t.reported_payout_ref,
          'reported_payout_at', t.reported_payout_at,
          'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
          'external_order_ref', t.external_order_ref,
          'buyer_ref', t.buyer_ref,
          'note', t.note,
          'source', t.source,
          'is_test', t.is_test,
          'cancelled_at', t.cancelled_at,
          'stock_released_at', t.stock_released_at,
          'sale_day', t.sale_day,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sales t
      ), '[]'::jsonb),
  
      'sale_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'raw_name', t.raw_name,
          'condition', t.condition,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'movement_id', t.movement_id,
          'returned_at', t.returned_at,
          'return_movement_id', t.return_movement_id,
          'settled_at', t.settled_at,
          'not_shipped_at', t.not_shipped_at,
          'return_announced_at', t.return_announced_at,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sale_items t
      ), '[]'::jsonb),
  
      'sale_fees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'kind', t.kind,
          'label', t.label,
          'amount', t.amount::text,
          'settled_by', t.settled_by,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_fees t
      ), '[]'::jsonb),
  
      'sale_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'amount', t.amount::text,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_refunds t
      ), '[]'::jsonb),
  
      'settlement_adjustments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'channel', t.channel,
          'amount', t.amount::text,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'occurred_at', t.occurred_at,
          'source', t.source,
          'created_at', t.created_at
        ) order by t.id)
          from public.settlement_adjustments t
      ), '[]'::jsonb),
  
      'name_mappings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'normalised_name', t.normalised_name,
          'sky_id', t.sky_id,
          'not_a_figure', t.not_a_figure,
          'sample_raw_name', t.sample_raw_name,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.orderbook_name_mappings t
      ), '[]'::jsonb),
  
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_number', t.order_number,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'payment_status', t.payment_status,
          'fulfillment_status', t.fulfillment_status,
          'needs_resolution', t.needs_resolution,
          'placed_at', t.placed_at,
          'paid_at', t.paid_at,
          'shipped_at', t.shipped_at,
          'completed_at', t.completed_at,
          'cancelled_at', t.cancelled_at,
          'updated_at', t.updated_at,
          'tax_regime', t.tax_regime,
          'shipping_method_code', t.shipping_method_code,
          'shipping_method_name', t.shipping_method_name,
          'tracking_number', t.tracking_number,
          'commerce_mode', t.commerce_mode
        ) order by t.id)
          from public.orders t
      ), '[]'::jsonb),
  
      'order_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'name_snapshot', t.name_snapshot,
          'series_snapshot', t.series_snapshot,
          'unit_price', t.unit_price::text,
          'discount_amount', t.discount_amount::text,
          'line_total', t.line_total::text,
          'inventory_id', t.inventory_id,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_lines t
      ), '[]'::jsonb),
  
      'order_line_events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'order_line_id', t.order_line_id,
          'kind', t.kind,
          'quantity', t.quantity,
          'stock_outcome', t.stock_outcome,
          'movement_id', t.movement_id,
          'correction_movement_id', t.correction_movement_id,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'reason_code', t.reason_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_line_events t
      ), '[]'::jsonb),
  
      'order_reservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'inventory_id', t.inventory_id,
          'quantity', t.quantity,
          'state', t.state,
          'reserved_at', t.reserved_at,
          'expires_at', t.expires_at,
          'released_at', t.released_at,
          'converted_at', t.converted_at,
          'movement_id', t.movement_id,
          'reverted_movement_id', t.reverted_movement_id,
          'sale_item_id', t.sale_item_id,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'order_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'amount', t.amount::text,
          'currency', t.currency,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'withdrawal_request_id', t.withdrawal_request_id,
          'requested_at', t.requested_at,
          'settled_at', t.settled_at,
          'provider_status', t.provider_status,
          'failure_code', t.failure_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_refunds t
      ), '[]'::jsonb),
  
      'order_refund_allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'refund_id', t.refund_id,
          'order_line_id', t.order_line_id,
          'quantity', t.quantity,
          'amount', t.amount::text,
          'allocation_type', t.allocation_type
        ) order by t.id)
          from public.order_refund_allocations t
      ), '[]'::jsonb),
  
      'order_legal_snapshots', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_id', t.order_id,
          'agb_version', t.agb_version,
          'widerruf_version', t.widerruf_version,
          'seller_name', t.seller_name,
          'seller_legal_name', t.seller_legal_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country_code', t.seller_country_code,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'created_at', t.created_at
        ) order by t.order_id)
          from public.order_legal_snapshots t
      ), '[]'::jsonb),
  
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'invoice_number', t.invoice_number,
          'issued_at', t.issued_at,
          'seller_legal_name', t.seller_legal_name,
          'seller_trade_name', t.seller_trade_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country', t.seller_country,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'customer_name', t.customer_name,
          'customer_company', t.customer_company,
          'customer_street', t.customer_street,
          'customer_postal_code', t.customer_postal_code,
          'customer_city', t.customer_city,
          'customer_country', t.customer_country,
          'customer_email', t.customer_email,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'currency', t.currency,
          'tax_regime', t.tax_regime,
          'lines', t.lines
        ) order by t.id)
          from public.invoices t
      ), '[]'::jsonb),
  
      'monthly_reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'period_year', t.period_year,
          'period_month', t.period_month,
          'commerce_mode', t.commerce_mode,
          'finalized_at', t.finalized_at,
          'order_count', t.order_count,
          'order_value', t.order_value::text,
          'merchandise_amount', t.merchandise_amount::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'currency', t.currency,
          'paid_count', t.paid_count,
          'unpaid_count', t.unpaid_count,
          'tax_regime', t.tax_regime,
          'included_orders', t.included_orders
        ) order by t.id)
          from public.seller_monthly_reports t
      ), '[]'::jsonb),
  
      'figures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sky_id', t.sky_id,
          'name', t.name,
          'slug', t.slug,
          'series_code', t.series_code,
          'card_type', t.card_type,
          'item_type', t.item_type,
          'market_price', t.market_price::text,
          'category_id', t.category_id,
          'is_active', t.is_active,
          'source', t.source
        ) order by t.sky_id)
          from public.skylanders t
         where t.sky_id in (select sky_id from used_figures)
      ), '[]'::jsonb),
  
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'label', t.label,
          'release_year', t.release_year,
          'position', t.position
        ) order by t.code)
          from public.series t
      ), '[]'::jsonb),
  
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'series_code', t.series_code,
          'name', t.name,
          'catalog_group', t.catalog_group,
          'position', t.position
        ) order by t.id)
          from public.categories t
      ), '[]'::jsonb),
  
      'seller', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'display_name', t.display_name,
          'legal_name', t.legal_name,
          'trading_name', t.trading_name,
          'legal_form', t.legal_form,
          'street', t.street,
          'postal_code', t.postal_code,
          'city', t.city,
          'country_code', t.country_code,
          'phone', t.phone,
          'direct_contact', t.direct_contact,
          'register_court', t.register_court,
          'register_number', t.register_number,
          'vat_id', t.vat_id,
          'w_id', t.w_id,
          'small_business_19', t.small_business_19,
          'contact_email', t.contact_email,
          'transactional_reply_to', t.transactional_reply_to,
          'withdrawal_contact_email', t.withdrawal_contact_email,
          'complaints_contact_email', t.complaints_contact_email,
          'dispute_participation', t.dispute_participation,
          'dispute_body', t.dispute_body,
          'dispatch_statement', t.dispatch_statement,
          'return_postage_borne_by', t.return_postage_borne_by,
          'is_active', t.is_active,
          'free_shipping_threshold', t.free_shipping_threshold::text
        ) order by t.id)
          from public.sellers t
      ), '[]'::jsonb),
  
      'shop_settings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'price_percentage', t.price_percentage::text,
          'free_shipping_threshold', t.free_shipping_threshold::text,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_settings t
      ), '[]'::jsonb),
  
      'shipping_methods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'name', t.name,
          'base_price', t.base_price::text,
          'is_enabled', t.is_enabled,
          'sort_order', t.sort_order
        ) order by t.code)
          from public.shipping_methods t
      ), '[]'::jsonb)
    )
  ) end;
$$;

comment on function public.seller_business_backup() is
  'Eine Momentaufnahme der Betriebsdaten als JSON (0104; Eigenbelege in 0129, Kostenteile und Katalogordnung in 0130, Haendlerstammdaten in 0131, Artikeltyp in 0136) — 28 Bereiche in EINER Anweisung und damit aus EINER MVCC-Momentaufnahme. Liest nur. Der Bereich seller traegt seit 0131 die Rechtsangaben, die auf jeder Rechnung stehen, samt is_active: nach einer Wiederherstellung ist damit entscheidbar, welche Zeile der Betrieb ist. Der Bereich figures traegt seit 0136 item_type: der Artikeltyp ist eine eigenstaendige fachliche Eigenschaft und wird bei einer Wiederherstellung abgelesen, nicht aus der Kategorie rekonstruiert. Absender, Inserat und Kaufvereinbarung eines Einkaufs bleiben AUSDRUECKLICH draussen (personenbezogen, offene Aufbewahrungsfrage); Kontoidentitaeten, Zeitstempel der Stammdaten und Zahlungsdienstleister-Interna ebenso. Kein Restore: restore_supported ist false.';

-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Erstens der Abdruck: 27 Bereiche muessen Zeichen fuer Zeichen dieselben
-- Paare in derselben Reihenfolge tragen wie vorher. Zweitens der Bereich
-- `figures`: genau zehn Felder in genau dieser Reihenfolge. Drittens alles,
-- was `0131` schon geprueft hat — eine Sicherung, die ploetzlich schreibt,
-- Rechte verschenkt oder die Formatversion verschiebt, waere ein Befund, auch
-- wenn der Abdruck stimmt.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def          text;
  v_code         text;
  v_key          text;
  v_md5          text;
  v_laenge       integer;
  v_bereiche     integer;
  v_felder       integer;
  v_ohne_bereich integer;
  v_rest_md5     text;
  v_rest_anzahl  integer;
  v_figures      text;
  v_wer          text := '0136 Abbruch';
begin
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if v_def is null then
    raise exception '0136 unvollstaendig: seller_business_backup fehlt';
  end if;

  -- ---- der Abdruck der Funktion selbst --------------------------------
  select md5(p.prosrc), length(p.prosrc) into v_md5, v_laenge
    from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()');
  if v_md5 <> 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception '%: md5 des Rumpfs ist % statt f6d08440707ba72a8040a8d1e666c092',
      v_wer, v_md5;
  end if;
  if v_laenge <> 21494 then
    raise exception '%: der Rumpf hat % Zeichen statt 21494', v_wer, v_laenge;
  end if;
  if md5(obj_description(to_regprocedure('public.seller_business_backup()'), 'pg_proc'))
     is distinct from 'c12618f312b413571eeabe912ca03651' then
    raise exception '%: der Funktionskommentar ist nicht der aus 0136', v_wer;
  end if;

  -- ---- der Rumpf ohne Kommentare, wie in 0130 und 0131 ----------------
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '%: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter', v_wer;
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  -- ---- 27 Bereiche unveraendert, figures genau zehn Felder ------------
  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  select (select count(*) from anfang),
         (select count(*) from paar),
         (select count(*) from paar p where p.bereich = ''),
         (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
            from paar p where p.bereich <> 'figures'),
         (select count(*) from paar p where p.bereich <> 'figures'),
         (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
            from paar p where p.bereich = 'figures')
    into v_bereiche, v_felder, v_ohne_bereich, v_rest_md5, v_rest_anzahl, v_figures;

  if v_bereiche <> 28 then
    raise exception '%: % Bereiche statt 28 — Abbruch vor jeder Feldaussage',
      v_wer, v_bereiche;
  end if;
  if v_ohne_bereich <> 0 then
    raise exception '%: % Feldzeile(n) gehoeren zu keinem Bereich', v_wer, v_ohne_bereich;
  end if;
  if v_felder <> 353 then
    raise exception '%: % Feldzeilen statt 353 (352 aus 0131 plus item_type)',
      v_wer, v_felder;
  end if;
  if v_rest_anzahl::text
     <> (select wert from abdruck_0136 where schluessel = 'ohne_figures_anzahl') then
    raise exception '%: % Feldzeilen ausserhalb von figures, vorher %',
      v_wer, v_rest_anzahl,
      (select wert from abdruck_0136 where schluessel = 'ohne_figures_anzahl');
  end if;
  if v_rest_md5 <> (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5') then
    raise exception '%: die 27 anderen Bereiche haben sich geaendert (% statt %)',
      v_wer, v_rest_md5,
      (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5');
  end if;
  if v_figures <> '''sky_id'', t.sky_id;''name'', t.name;''slug'', t.slug;'
               || '''series_code'', t.series_code;''card_type'', t.card_type;'
               || '''item_type'', t.item_type;'
               || '''market_price'', t.market_price::text;''category_id'', t.category_id;'
               || '''is_active'', t.is_active;''source'', t.source' then
    raise exception '%: der Bereich figures ist nicht der erwartete (%)', v_wer, v_figures;
  end if;

  -- ---- und alles, was 0131 schon verlangt hat --------------------------
  foreach v_key in array array['insert into', 'update public.', 'delete from',
                               'create temp', 'truncate', 'nextval', 'setval',
                               'txid_current()'] loop
    if position(v_key in v_code) > 0 then
      raise exception '%: die Sicherung schreibt (%)', v_wer, v_key;
    end if;
  end loop;
  foreach v_key in array array['''updated_by''', '''issued_by''', '''delivered_by''',
                               '''client_salt''', '''idempotency_key'''] loop
    if position(v_key in v_code) > 0 then
      raise exception '%: der Export nennt % ', v_wer, v_key;
    end if;
  end loop;

  /*
   * DIE NEUN PERSONENBEZOGENEN FELDER — bereichsgenau, nicht rumpfweit.
   *
   * Dieselbe Lehre wie in `0130` und `0131`: im Belegsnapshot stehen sie
   * berechtigt, in jedem anderen Bereich waere es ein Befund. Rumpfweit
   * gesucht pruefte das nichts.
   */
  foreach v_key in array array[
    '''sender_name''', '''sender_street''', '''sender_postal_code''',
    '''sender_city''', '''sender_country''', '''listing_title''',
    '''listing_url''', '''listing_details''', '''agreement_note'''] loop
    if exists (
      with zeile as (
        select z.nr, z.txt
          from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
      ),
      anfang as (
        select z.nr,
               (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
          from zeile z
         where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
      )
      select 1 from zeile z
       where z.txt ~ ('^ {10}' || v_key || ',')
         and coalesce((select a.name from anfang a
                        where a.nr < z.nr order by a.nr desc limit 1), '')
             <> 'purchase_receipts') then
      raise exception '%: % steht in einem anderen Bereich als purchase_receipts — '
        'personenbezogen und nicht freigegeben', v_wer, v_key;
    end if;
  end loop;

  if (select p.provolatile from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) <> 's' then
    raise exception '%: seller_business_backup muss stable bleiben', v_wer;
  end if;
  if (select p.prosecdef from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) is not true then
    raise exception '%: security definer ist weg', v_wer;
  end if;
  if position('''format_version'',  1' in v_code) = 0 then
    raise exception '%: die Formatversion wurde veraendert', v_wer;
  end if;
  if position('''restore_supported'',      false' in v_code) = 0 then
    raise exception '%: restore_supported ist nicht mehr false', v_wer;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = to_regprocedure('public.seller_business_backup()')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '%: PUBLIC oder anon darf die Sicherung abrufen', v_wer;
  end if;
  if (select p.proacl is null from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) then
    raise exception '%: die Funktion hat keinen ACL — der Standard waere PUBLIC', v_wer;
  end if;

  raise notice '0136 ok: der Bereich figures traegt item_type, 28 Bereiche, '
    '353 Feldzeilen, die 27 anderen Bereiche unveraendert (Abdruck %).',
    v_rest_md5;
end
$$;
-- <<< ENDE: supabase/migrations/0136_business_backup_item_type.sql

commit;
