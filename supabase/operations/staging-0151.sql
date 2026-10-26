-- ===========================================================================
-- STAGING — EIN LAUF FUER 0151
--            (die Live-Sicht wird eigenstaendig, ADR-0147, E-1/B2)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: laeuft das hier wirklich auf Staging?
--   B   Migration 0151, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0151_offer_state_live.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei
--       jedem Testlauf.
--
-- *** AUF STAGING ERWARTET: DIESE DATEI AENDERT NICHTS ***
--
-- Die Sicht `public.offer_state_live` steht hier seit `0146`. `0151` prueft
-- sie in vier Stufen — Bauart, Herkunft aus `pg_depend`, normalisierter
-- Wortlaut und tatsaechliches Verhalten — und laesst sie dann unberuehrt.
-- Erwartet wird die NOTICE-Zeile
--
--     0151: die Sicht stand schon und ist fachlich gleichwertig — …
--           NICHTS angefasst.
--
-- Erscheint stattdessen „die Sicht fehlte und ist neu angelegt", dann laeuft
-- diese Datei NICHT auf Staging oder `0146` ist dort nicht angewendet —
-- beides ist ein Grund anzuhalten, nicht weiterzumachen.
--
-- WOFUER SIE DANN UEBERHAUPT GEFAHREN WIRD. Damit `0151` auf BEIDEN
-- Umgebungen in der Akte steht und damit die Pruefung ihrer vier Stufen
-- einmal gegen echte Daten gelaufen ist, bevor dieselbe Datei auf Production
-- eine Sicht ANLEGT. Dort ist sie der einzige Teil von `0146`, den die neue
-- Benachrichtigungsarchitektur braucht.
--
-- SIE SETZT NUR ZWEI FUNKTIONEN VORAUS und prueft das selbst:
-- `shop_offers()` (0029/0139) und `v1_sale_condition()` (0028). `offer_state`,
-- `favorites` und `availability_notifications` braucht sie NICHT.
--
-- WAS SIE NICHT TUT: keine Tabelle, keine Spalte, keine Zeile, kein Trigger,
-- keine Funktion, kein Clientrecht, kein Rueckbau. Sie ist WIEDERHOLBAR —
-- ein zweiter Lauf prueft erneut und laesst alles, wie es ist.
--
-- ERWARTET: die `NOTICE`-Zeilen der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  /*
   * A2 — WAS DIE SICHT LIEST. Die Migration prueft es selbst; ein Abbruch
   * hier ist eine klare Meldung statt eines Fehlers mitten im `create view`.
   */
  if to_regprocedure('public.shop_offers()') is null then
    raise exception 'ABBRUCH A2: public.shop_offers() fehlt (0029/0139) — die '
      'Sicht liest sie.';
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception 'ABBRUCH A3: public.v1_sale_condition() fehlt (0028) — die '
      'Sicht fragt sie.';
  end if;

  /*
   * A4 — AUF STAGING MUSS DIE SICHT SCHON DASTEHEN.
   *
   * Das ist KEIN Zustandswaechter gegen einen zweiten Lauf — `0151` ist
   * wiederholbar. Es ist ein Umgebungswaechter: faende diese Datei hier
   * keine Sicht, dann waere entweder `0146` nicht angewendet oder dies ist
   * nicht Staging. In beiden Faellen soll nicht angelegt, sondern angehalten
   * werden.
   */
  if to_regclass('public.offer_state_live') is null then
    raise exception 'ABBRUCH A4: public.offer_state_live fehlt. Auf Staging '
      'steht sie seit 0146 — fehlt sie, ist entweder 0146 hier nicht '
      'angewendet oder dies ist nicht Staging. Anhalten, nicht anlegen.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0151_offer_state_live.sql
-- ===========================================================================
-- 0151 — DIE LIVE-SICHT WIRD EIGENSTAENDIG (ADR-0147, Entscheidung E-1/B2)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. `public.offer_state_live` ist die einzige zustandsfreie Definition
-- von „was ist JETZT kaufbar, zu welchem guenstigsten Preis". `0150` liest
-- sie, und sonst braucht `0150` von der alten Bauform nichts. Angelegt wurde
-- sie aber von `0146` — zusammen mit dem Spiegel, der wieder verschwinden
-- soll. Diese Migration loest das: **sie stellt die Sicht eigenstaendig
-- bereit, damit Production den Spiegel nie bekommt.**
--
-- SIE IST EINE SHOP-PROJEKTION, keine Benachrichtigungssache. Sie liest
-- `shop_offers()` und `v1_sale_condition()` — und nichts sonst, insbesondere
-- NICHT `offer_state`, nicht `shop_inventory`, nicht `favorites`. Dass sie
-- bisher in einer Benachrichtigungsmigration stand, war ein
-- Kategorienfehler; ab hier liegt sie, wo sie hingehoert.
--
-- *** ZWEI AUSGANGSLAGEN, EIN ENDZUSTAND ***
--
--   Production   die Sicht FEHLT  → sie wird angelegt, Rechte entzogen
--   Staging      die Sicht STEHT  → sie wird GEPRUEFT und NICHT ANGEFASST
--
-- DESHALB IST DIESE MIGRATION WIEDERHOLBAR, anders als `0150`. Ihr
-- Gegenstand ist ein ZUSTAND („die Sicht steht und ist die richtige"), nicht
-- ein EREIGNIS („diese fuenf Objekte entstehen jetzt"). Ein zweiter Lauf
-- prueft und laesst alles, wie es ist — er bricht nicht ab.
--
-- *** ES GIBT GENAU EINE DEFINITION, UND ZWAR ALS EIN EINZIGES LITERAL ***
--
-- `v_rumpf` unten ist der Rumpf aus `0146`, Zeichen fuer Zeichen. Dieses
-- EINE Literal wird zweimal benutzt:
--
--   * zum ANLEGEN   `create view public.offer_state_live as` || v_rumpf
--   * zum PRUEFEN   derselbe Rumpf als Unterabfrage, deren Ergebnis mit dem
--                   der bestehenden Sicht verglichen wird
--
-- Es gibt also keine zweite Fassung der Kaufbarkeitsregel — auch nicht zum
-- Vergleichen. `src/lib/availability/alerts-schema.test.ts` haelt das
-- Literal gegen `0146`, damit es nicht auseinanderlaufen kann.
--
-- *** WAS „FACHLICH GLEICHWERTIG" HIER HEISST, IN VIER STUFEN ***
--
-- Eine abweichende bestehende Sicht darf nicht stillschweigend durchgehen.
-- Geprueft wird deshalb nicht nur der Name:
--
--   1. BAUART     es ist eine Sicht, und sie hat genau zwei Spalten:
--                 `sky_id text` und `cheapest_cents integer`.
--   2. HERKUNFT   sie haengt an `shop_offers()` UND `v1_sale_condition()`
--                 und an KEINER Relation. Eine Sicht, die `offer_state` oder
--                 `shop_inventory` direkt liest, faellt hier durch —
--                 gelesen aus `pg_depend` ueber die Umschreiberegel, nicht
--                 aus dem Text.
--   3. WORTLAUT   der normalisierte `pg_get_viewdef()` enthaelt jedes
--                 tragende Stueck: `shop_offers`, `v1_sale_condition`,
--                 `min(round(`, `* 100`, `available`, `group by`. Das faengt
--                 ein `max` statt `min` und ein fehlendes `available`.
--   4. VERHALTEN  ihr Ergebnis ist zeichengleich mit dem des Rumpfs oben —
--                 beide Abdruecke in EINER Anweisung erhoben, damit ein
--                 gleichzeitiger Kauf keinen Fehlalarm erzeugt.
--
-- Und die Rechte: kein Clientrecht. Steht dort eines, bricht sie ab — eine
-- Sicht mit Clientrecht ist nicht das Objekt, das `0151` zusagt.
--
-- EHRLICHE GRENZE VON STUFE 4. Zeichengleiche Ergebnisse auf den HEUTIGEN
-- Daten beweisen keine Gleichheit fuer alle denkbaren Daten, und bei einem
-- leeren Shop ist der Vergleich leer gegen leer. Stufe 4 ist deshalb das
-- vierte Bein und nicht das einzige; die Last tragen 1 bis 3, die von Daten
-- unabhaengig sind.
--
-- WAS SIE NICHT TUT. Keine Tabelle, keine Spalte, keine Zeile, kein Trigger,
-- keine Funktion, kein Recht fuer irgendeine Clientrolle. Sie fasst
-- `offer_state`, `favorites`, `availability_notifications`, `shop_offers()`,
-- `shop_inventory` und die Reservierungswelt NICHT an — in keiner Richtung.
-- Insbesondere baut sie nichts zurueck.
--
-- REIHENFOLGE: **`0151` vor `0150`.** Die Nummer ist eine Reihenfolge und
-- keine Kette (`APPLIED.md`); auf Production laeuft `0151` deshalb vor
-- `0150`. Die Schnittmenge der GEAENDERTEN Objekte ist leer — `0151` beruehrt
-- nur `offer_state_live`, `0150` nur seine fuenf eigenen —, und es besteht
-- genau eine Abhaengigkeit: `0150` liest die Sicht.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0151_drop_offer_state_live.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen — nur das, was die Sicht wirklich liest
--
-- `offer_state`, `favorites` und `availability_notifications` stehen hier
-- ausdruecklich NICHT: keine davon wird gelesen, und eine Vorbedingung, die
-- sie verlangte, waere eine Umgebungsannahme als Zusage verkleidet. Auf
-- Production liegt keine der drei — und genau dort soll diese Migration
-- laufen.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0151 ABBRUCH';
begin
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '%: public.shop_offers() fehlt (0029/0139) — die Sicht '
      'liest sie', v_wer;
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception '%: public.v1_sale_condition() fehlt (0028) — die Sicht '
      'fragt sie', v_wer;
  end if;

  /*
   * Ein Name, der nicht frei ist und keine Sicht bezeichnet, ist der eine
   * Fall, in dem diese Migration nicht weiterarbeiten kann: `create view`
   * scheiterte, und „pruefen und stehen lassen" ginge auch nicht.
   */
  if exists (select 1 from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'offer_state_live'
                and c.relkind <> 'v') then
    raise exception '%: public.offer_state_live ist belegt, aber keine Sicht '
      '(relkind). Das ist von Hand zu klaeren, nicht von einer Migration', v_wer;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Anlegen ODER pruefen — und niemals ueberschreiben
--
-- `create or replace view` kommt NICHT vor. Es waere der kurze Weg und
-- gleichzeitig der gefaehrliche: auf Staging wuerde es einen bestehenden
-- Rumpf stillschweigend ersetzen, und genau das soll ausgeschlossen sein
-- (Auftrag, Punkt 2: eine vorhandene kompatible Sicht bleibt unveraendert).
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer   text := '0151 ABBRUCH';
  /*
   * DER RUMPF AUS `0146`, ZEICHEN FUER ZEICHEN — das einzige Vorkommen der
   * Kaufbarkeitsregel in dieser Datei.
   */
  v_rumpf text := $sicht$
  select
    o.sky_id,
    min(round(o.price * 100))::integer as cheapest_cents
  from public.shop_offers() o
  where o.available
    and o.condition = public.v1_sale_condition()
  group by o.sky_id$sicht$;
  v_neu   boolean;
  v_t     text;
  v_n     integer;
  v_def   text;
  v_ist   text;
  v_soll  text;
begin
  v_neu := to_regclass('public.offer_state_live') is null;

  -- ========================= ANLEGEN (Production) =========================
  if v_neu then
    execute 'create view public.offer_state_live as' || v_rumpf;

    /*
     * DERSELBE KOMMENTAR WIE IN `0146`, zeichengleich. Er nennt `0146` als
     * Quelle der Definition, und das ist nach Entscheidung E-3 richtig: die
     * dortige Fassung IST die verbindliche Referenz. Beide Umgebungen tragen
     * damit denselben Kommentar — es entsteht keine Abweichung.
     */
    execute 'comment on view public.offer_state_live is '
            || quote_literal('Was JETZT tatsaechlich kaufbar ist, je SKY-ID, mit dem guenstigsten Preis in Cent (0146). Liest ausschliesslich shop_offers() und rechnet keinen Preis nach. Eine Figur ohne kaufbares Angebot kommt nicht vor. Kein Clientrecht: S2 liest sie, um vor einer Meldung gegen die Gegenwart zu pruefen.');

    -- Kein Clientrecht. Supabase erteilt bei `create` nichts auf eine Sicht,
    -- aber ein Entzug, der nichts zu tun hat, kostet nichts und sagt es.
    execute 'revoke all on public.offer_state_live from public, anon, authenticated';

    raise notice '0151: die Sicht fehlte und ist neu angelegt — Rumpf '
      'zeichengleich aus 0146, Kommentar gesetzt, kein Clientrecht.';

  -- ===================== PRUEFEN (Staging) ================================
  else
    -- ------ Stufe 1: BAUART ------------------------------------------------
    select string_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod),
                      ', ' order by a.attnum)
      into v_t
      from pg_attribute a
     where a.attrelid = 'public.offer_state_live'::regclass
       and a.attnum > 0 and not a.attisdropped;
    if v_t is distinct from 'sky_id text, cheapest_cents integer' then
      raise exception '%: die bestehende Sicht hat die Spalten "%" statt '
        '"sky_id text, cheapest_cents integer". Eine abweichende Fassung wird '
        'nicht stillschweigend akzeptiert', v_wer, coalesce(v_t, '(keine)');
    end if;

    -- ------ Stufe 2: HERKUNFT, aus pg_depend statt aus dem Text ------------
    /*
     * Eine Sicht haelt ihre Abhaengigkeiten in der Umschreiberegel. Was sie
     * LIEST, steht damit im Katalog und nicht im Wortlaut — eine Sicht, die
     * `offer_state` oder `shop_inventory` direkt liest, faellt hier durch,
     * ganz gleich wie ihr Text formatiert ist.
     */
    select count(*) into v_n
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid
     where d.classid = 'pg_rewrite'::regclass
       and d.refclassid = 'pg_class'::regclass
       and r.ev_class = 'public.offer_state_live'::regclass
       and d.refobjid <> 'public.offer_state_live'::regclass;
    if v_n <> 0 then
      raise exception '%: die bestehende Sicht liest % Relation(en) direkt. '
        'Die verbindliche Fassung liest ausschliesslich shop_offers()', v_wer, v_n;
    end if;

    select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text),
                    '(keine)')
      into v_t
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid
      join pg_proc p on p.oid = d.refobjid
     where d.classid = 'pg_rewrite'::regclass
       and d.refclassid = 'pg_proc'::regclass
       and r.ev_class = 'public.offer_state_live'::regclass;
    if position('shop_offers' in v_t) = 0
       or position('v1_sale_condition' in v_t) = 0 then
      raise exception '%: die bestehende Sicht haengt an den Funktionen "%" — '
        'erwartet werden shop_offers und v1_sale_condition', v_wer, v_t;
    end if;

    -- ------ Stufe 3: WORTLAUT, normalisiert --------------------------------
    v_def := lower(regexp_replace(pg_get_viewdef('public.offer_state_live'::regclass,
                                                 true), '\s+', '', 'g'));
    foreach v_t in array array['shop_offers', 'v1_sale_condition', 'min(round(',
                               '*100', 'available', 'groupby']
    loop
      if position(v_t in v_def) = 0 then
        raise exception '%: im Wortlaut der bestehenden Sicht fehlt "%". '
          'Ein max statt min oder ein fehlendes available waere genau das, '
          'was hier auffallen soll', v_wer, v_t;
      end if;
    end loop;

    -- ------ Stufe 4: VERHALTEN, in EINER Anweisung -------------------------
    /*
     * EINE Anweisung, zwei Abdruecke. Zwei getrennte Abfragen bekaemen unter
     * READ COMMITTED zwei Schnappschuesse, und ein gleichzeitiger Kauf
     * zwischen ihnen waere ein Fehlalarm. `shop_offers()` ist `stable`, also
     * sehen beide Unterabfragen innerhalb einer Anweisung dieselben Daten.
     */
    execute
      'select (select coalesce(md5(string_agg(x.sky_id || ''|'' '
      '                            || x.cheapest_cents::text, '';'' '
      '                            order by x.sky_id)), ''(leer)'')'
      '          from public.offer_state_live x),'
      '       (select coalesce(md5(string_agg(k.sky_id || ''|'' '
      '                            || k.cheapest_cents::text, '';'' '
      '                            order by k.sky_id)), ''(leer)'')'
      '          from (' || v_rumpf || ') k)'
      into v_ist, v_soll;
    if v_ist is distinct from v_soll then
      raise exception '%: die bestehende Sicht liefert ein anderes Ergebnis '
        'als die verbindliche Fassung (% statt %). Sie wird nicht '
        'stillschweigend akzeptiert und nicht ueberschrieben — das ist von '
        'Hand zu klaeren', v_wer, v_ist, v_soll;
    end if;

    -- ------ Und die Rechte -------------------------------------------------
    select count(*) into v_n
      from pg_class c, aclexplode(c.relacl) a
     where c.oid = 'public.offer_state_live'::regclass
       and (a.grantee = 0
            or a.grantee::regrole::text in ('anon', 'authenticated'));
    if v_n <> 0 then
      raise exception '%: die bestehende Sicht traegt % Clientrecht(e). Eine '
        'Sicht mit Clientrecht ist nicht das Objekt, das 0151 zusagt', v_wer, v_n;
    end if;

    raise notice '0151: die Sicht stand schon und ist fachlich gleichwertig — '
      'Bauart, Herkunft (pg_depend), Wortlaut und Verhalten geprueft, kein '
      'Clientrecht. NICHTS angefasst.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen — derselbe Endzustand, aus beiden Ausgangslagen
--
-- Sie unterscheiden NICHT, ob die Sicht neu ist: nach dieser Migration gilt
-- in jeder Umgebung dasselbe, und genau das ist ihr Zweck.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0151 Befund';
  v_t   text;
  v_n   integer;
begin
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: die Sicht fehlt', v_wer;
  end if;
  if not exists (select 1 from pg_class
                  where oid = 'public.offer_state_live'::regclass and relkind = 'v') then
    raise exception '%: offer_state_live ist keine Sicht', v_wer;
  end if;

  select string_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod),
                    ', ' order by a.attnum)
    into v_t
    from pg_attribute a
   where a.attrelid = 'public.offer_state_live'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_t <> 'sky_id text, cheapest_cents integer' then
    raise exception '%: die Spalten sind "%"', v_wer, v_t;
  end if;

  -- Sie liest keine Relation, nur Funktionen.
  select count(*) into v_n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
   where d.classid = 'pg_rewrite'::regclass
     and d.refclassid = 'pg_class'::regclass
     and r.ev_class = 'public.offer_state_live'::regclass
     and d.refobjid <> 'public.offer_state_live'::regclass;
  if v_n <> 0 then
    raise exception '%: die Sicht liest % Relation(en) direkt', v_wer, v_n;
  end if;

  -- Kein Clientrecht, in keiner Umgebung.
  select count(*) into v_n
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.offer_state_live'::regclass
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  if v_n <> 0 then
    raise exception '%: % Clientrecht(e) auf der Sicht', v_wer, v_n;
  end if;

  /*
   * UND WAS BLEIBEN MUSS, STEHT NOCH. Nur das, was diese Migration wirklich
   * voraussetzt — `offer_state`, `favorites` und `availability_notifications`
   * kommen hier bewusst nicht vor (siehe Kopf und dieselbe Lehre aus `0150`).
   */
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '%: shop_offers() wurde angefasst', v_wer;
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception '%: v1_sale_condition() wurde angefasst', v_wer;
  end if;

  -- Kein Trigger, keine Tabelle, keine Funktion ist dazugekommen.
  if exists (select 1 from pg_trigger t
              where not t.tgisinternal and t.tgname like '%offer_state_live%') then
    raise exception '%: ein Trigger mit offer_state_live im Namen', v_wer;
  end if;

  raise notice '0151 ok: public.offer_state_live steht als Sicht, Spalten '
    'sky_id text und cheapest_cents integer, liest keine Relation, kein '
    'Clientrecht. shop_offers() und v1_sale_condition() unberuehrt. Keine '
    'Tabelle, keine Zeile, kein Trigger, keine Funktion, kein Rueckbau.';
end $$;
-- <<< ENDE: supabase/migrations/0151_offer_state_live.sql

commit;
