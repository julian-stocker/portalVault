-- Die geschaeftskritischen Invarianten, nicht nur Zeilenzahlen.
--
-- Zeilenzahlen sagen WIE VIELE, Abdruecke sagen WELCHE — und beides sagt
-- nichts darueber, ob die Zusammenhaenge stimmen. Hier stehen die Groessen,
-- an denen ein Restore wirklich haengt: Belegketten, Lagerbilanz,
-- Bestellzusammenhang und die Nummernzaehler.
select 1 as nr, 'Belege insgesamt' as gegenstand,
       (select count(*)::text from public.purchase_receipts) as wert
union all
select 2, 'Belegrevisionen (Liste)',
       coalesce((select string_agg(distinct r.revision::text, ',' order by r.revision::text)
                   from public.purchase_receipts r), '(keine)')
union all
select 3, 'Belegkette (Abdruck ueber id>vorgaenger:nummer)',
       coalesce((select md5(string_agg(r.id::text || '>'
                                       || coalesce(r.supersedes_id::text, '-') || ':'
                                       || r.receipt_number, '|' order by r.id))
                   from public.purchase_receipts r), '(leer)')
union all
select 4, 'Fingerabdruecke der Belege (Abdruck)',
       coalesce((select md5(string_agg(r.content_fingerprint, '|' order by r.id))
                   from public.purchase_receipts r), '(leer)')
union all
select 5, 'eingefrorene Positionslisten (Abdruck)',
       coalesce((select md5(string_agg(r.lines::text, '|' order by r.id))
                   from public.purchase_receipts r), '(leer)')
union all
select 6, 'Kettenbruch: supersedes_id is null <> revision = 1 (muss 0 sein)',
       (select count(*)::text from public.purchase_receipts r
         where (r.supersedes_id is null) <> (r.revision = 1))
union all
select 7, 'ein Beleg zweimal ersetzt (muss 0 sein)',
       (select coalesce(count(*), 0)::text from (
          select r.supersedes_id from public.purchase_receipts r
           where r.supersedes_id is not null
           group by r.supersedes_id having count(*) > 1) d)
union all
select 8, 'Abrufe und ihre Bytes',
       (select count(*)::text || ' / '
               || coalesce(sum(d.byte_count)::text, '0')
          from public.purchase_receipt_downloads d)
union all
select 9, 'Nummernzaehler je Jahr',
       coalesce((select string_agg(c.year::text || '=' || c.next_number::text,
                                   ',' order by c.year)
                   from public.purchase_receipt_counters c), '(keine)')
union all
select 10, 'Zaehler kleiner als die hoechste vergebene Nummer (muss 0 sein)',
       (select count(*)::text from public.purchase_receipt_counters c
         where c.next_number <= coalesce((
                 select max(substring(r.receipt_number from '([0-9]{6})$')::integer)
                   from public.purchase_receipts r
                  where r.receipt_number like '%-' || c.year::text || '-%'), 0))
union all
-- KORRIGIERT. Die Differenz `quantity - sum(delta)` ist in diesen Datenbanken
-- kein Fehler, sondern der Eroeffnungsbestand: der Pre-Go-Live-Reset vom
-- 2026-09-21 hat `inventory_movements` geleert und `shop_inventory.quantity`
-- bewusst stehen lassen (docs/history/2026-09-21-pre-go-live-reset.md).
-- Geprueft wird deshalb die Richtung — negativ kann sie nicht werden — und
-- die Groesse selbst wandert als Abdruck in 11a, wo der Vergleich Quelle
-- gegen Wiederherstellung sie Zeichen fuer Zeichen erfasst.
select 11, 'Lagerbilanz: Positionen mit negativem Eroeffnungsbestand (muss 0 sein)',
       (select count(*)::text from public.shop_inventory i
         where i.quantity < coalesce((select sum(m.delta)
                                        from public.inventory_movements m
                                       where m.inventory_id = i.id), 0))
union all
select 12, 'Lagersumme (quantity / reserved / available)',
       (select coalesce(sum(i.quantity), 0)::text || ' / '
               || coalesce(sum(i.reserved), 0)::text || ' / '
               || coalesce(sum(i.available_quantity), 0)::text
          from public.shop_inventory i)
union all
select 13, 'Lagerbewegungen (Anzahl / Summe delta)',
       (select count(*)::text || ' / ' || coalesce(sum(m.delta), 0)::text
          from public.inventory_movements m)
union all
select 14, 'Bestellungen ohne Position (muss 0 sein)',
       (select count(*)::text from public.orders o
         where not exists (select 1 from public.order_lines l where l.order_id = o.id))
union all
select 15, 'Rechnungen ohne Bestellung (muss 0 sein)',
       (select count(*)::text from public.invoices v
         where not exists (select 1 from public.orders o where o.id = v.order_id))
union all
select 16, 'Rechnungsnummern (Anzahl / hoechste)',
       (select count(*)::text || ' / ' || coalesce(max(v.invoice_number), '(keine)')
          from public.invoices v)
union all
select 17, 'Bestellnummern (Anzahl / hoechste)',
       (select count(*)::text || ' / ' || coalesce(max(o.order_number), '(keine)')
          from public.orders o)
union all
select 18, 'Einkaufskosten: Teile <> Summe (muss 0 sein)',
       (select count(*)::text from public.purchases p
         where p.total_cost is not null
           and round(coalesce(p.items_cost, 0) + coalesce(p.shipping_cost, 0)
                     + coalesce(p.buyer_protection_cost, 0), 2) <> round(p.total_cost, 2))
union all
select 19, 'Einkaufssummen (Anzahl / Summe total_cost)',
       (select count(*)::text || ' / ' || coalesce(sum(p.total_cost), 0)::text
          from public.purchases p)
union all
select 20, 'Verkaufssummen (Anzahl / Positionen)',
       (select count(*)::text from public.sales) || ' / '
       || (select count(*)::text from public.sale_items)
union all
select 21, 'Ankaufsfaktor (abgeleitet, muss gleich bleiben)',
       coalesce(public.orderbook_global_factor()::text, '(null)')
union all
select 22, 'Eroeffnungsbestand aus dem Cutover (Positionen / Summe)',
       (select (count(*) filter (where d.diff <> 0))::text || ' / '
               || coalesce(sum(d.diff), 0)::text
          from (select i.quantity - coalesce((select sum(m.delta)
                                                from public.inventory_movements m
                                               where m.inventory_id = i.id), 0) as diff
                  from public.shop_inventory i) d)
 order by nr;
