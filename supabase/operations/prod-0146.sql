-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0146
--               (der Angebotsspiegel, Phase 4 Schritt S1)
--
-- ###########################################################################
-- ##  NICHT AUSFUEHREN, bevor der Betreiber sie ausdruecklich freigibt —   ##
-- ##  und nicht, bevor 0144 auf Production liegt UND die Folgemigration    ##
-- ##  favorites UND offer_state in die Plattformsicherung aufgenommen hat. ##
-- ##  Ein Rollout ohne diesen Schritt liesse den GEMELDETEN Stand          ##
-- ##  ungesichert — und ein Archiv ohne ihn wuerde nach einer              ##
-- ##  Wiederherstellung jede Figur neu melden (ADR-0136, D-6).             ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert. Diese Datei traegt deshalb den UMGEKEHRTEN Stempel.
--
-- WAS SIE TUT: sie legt `public.offer_state` an (acht Spalten,
-- Primaerschluessel `sky_id`, fuenf CHECKs, RLS an und KEINE Richtlinie),
-- die Sicht `public.offer_state_live` und die Funktionen
-- `refresh_offer_state()` und `offer_state_window()`.
--
-- WAS SIE NICHT TUT: **keinen Trigger**, und das ist die zentrale Zusage.
-- Weder auf `shop_inventory` noch auf `skylanders` noch auf `shop_settings`
-- — die Nachbedingung der Migration misst es. Ein Fehler im
-- Benachrichtigungssystem kann damit strukturell keinen Kauf erreichen.
--
-- Und: **keine Benachrichtigung**, keine Oberflaeche, keine Einstellung,
-- keine Zeile fuer einen Nutzer. Sie liest den Shop und schreibt einen
-- Spiegel. Die Tabelle ist nach der Migration LEER; die Erstbefuellung
-- geschieht im ersten Aufruf von `refresh_offer_state()` und legt jede Zeile
-- BEREITS GEMELDET an, damit ein bestehendes Angebot keine Neuigkeit ist.
--
-- Sie fasst keine bestehende Tabelle, Spalte, Richtlinie, Funktion oder
-- Berechtigung an. Rein additiv.
--
-- DREI RIEGEL IN DER MIGRATION SELBST: `shop_offers()`, `v1_sale_condition()`
-- und `reservation_ttl()` muessen stehen, die Tabelle darf noch nicht da
-- sein, und ein zweiter Lauf prallt ab. Probelauf **P53** faehrt sechzehn
-- Szenarien an echtem PostgreSQL nach.
--
-- RUECKNAHME: `supabase/rollback/R0146_drop_offer_state.sql` — sie bricht ab,
-- solange eine Zeile einen GEMELDETEN Stand traegt.
--
-- VOR DEM LAUF `prod-s-preflight-0146.sql`, DANACH
-- `prod-s-postflight-0146.sql`.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeile der Migration, und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0146.sql.';
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

-- >>> EINGEBETTET: supabase/migrations/0146_offer_state.sql
-- ===========================================================================
-- 0146 — DER ANGEBOTSSPIEGEL (Phase 4, Schritt S1)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Spaeter soll ein Sammler erfahren, wenn eine vorgemerkte Figur
-- wieder kaufbar wird oder guenstiger. Dafuer muss irgendwo stehen, wie es
-- VORHER war — `shop_offers()` beantwortet nur die Gegenwart. Diese Migration
-- legt genau dieses Gedaechtnis an, und sonst nichts.
--
-- WAS SIE AUSDRUECKLICH NICHT TUT: sie erzeugt KEINE Benachrichtigung, keine
-- Zeile fuer einen Nutzer, keine Oberflaeche, keine Einstellung. Sie liest
-- den Shop und schreibt einen Spiegel. Schritt S2 macht daraus Meldungen;
-- bis dahin ist dieser Spiegel beobachtbar, ohne dass er etwas ausloest —
-- und genau dafuer kommt er zuerst (`docs/FAVORITE_NOTIFICATIONS.md`, S1).
--
-- KEIN TRIGGER, UND DAS IST DIE ZENTRALE ENTSCHEIDUNG.
--
-- Der erste Entwurf wollte einen Trigger auf `shop_inventory`. Drei Gruende
-- dagegen, alle am Code geprueft:
--
--   1. Er saehe zwei der DREI Preisquellen nicht. `shop_price()` nimmt
--      `shop_inventory.sale_price` (eine Position), `skylanders.market_price`
--      (Massenschreiben der Importwerkzeuge) und
--      `shop_settings.price_percentage` (eine Zahl fuer jede automatisch
--      bepreiste Position). Ein Trigger auf `shop_inventory` haette 2 und 3
--      lautlos uebersehen; einer auf `skylanders` haette bei einem
--      Katalogimport ueber den ganzen Katalog gefeuert.
--   2. Er koennte keine Karenzzeit. „Und es ist seit 30 Minuten so" braucht
--      eine spaetere Ausfuehrung, und einen Scheduler gibt es in diesem
--      Projekt nicht (`expire_stale_checkouts()` wartet seit `0012` darauf).
--   3. Er haengt im Kauf. Ein Trigger auf `shop_inventory` laeuft in
--      derselben Transaktion wie `reserve_order_stock()` und
--      `system_record_inventory_movement()` — ein Fehler darin liesse einen
--      KAUF scheitern. Mit einem Trigger ist das nicht abwendbar, nur
--      unwahrscheinlich.
--
-- Stattdessen ein VERGLEICH: `refresh_offer_state()` liest `shop_offers()`
-- und schreibt die Unterschiede. Sie laeuft ausserhalb jeder
-- Shoptransaktion, also kann ein Fehler darin strukturell keinen Kauf
-- beruehren.
--
-- EINE FACHLICHE WAHRHEIT, UND SIE IST NICHT HIER. Was kaufbar ist,
-- entscheidet `shop_offers()` (`0139`): `is_listed`, V1-Zustand,
-- `is_position_sellable()`, ein Preis ungleich NULL — und `available` aus
-- `available_quantity = quantity - reserved`. Diese Migration rechnet davon
-- NICHTS nach. Sie liest die Projektion und nimmt die Zeilen mit
-- `available`, genau wie `v1BuyableOffers()` in `src/lib/shop/offer.ts`.
--
-- WAS SIE NICHT ANFASST. Keine bestehende Tabelle, Spalte, Richtlinie,
-- Funktion oder Berechtigung. Kein Trigger. Keine Bestellung, kein Lager,
-- keine Reservierung, keine Belegsperre, keine Verkaufsfreigabe. Rein
-- additiv.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0146_drop_offer_state.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- Der Spiegel steht und faellt mit `shop_offers()`. Gefragt wird trotzdem
-- nach allen vier Stuecken, damit ein Lauf auf einer unfertigen Datenbank
-- laut scheitert und nicht halb.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0146 setzt 0001 voraus: public.skylanders fehlt';
  end if;
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '0146 setzt 0029/0139 voraus: shop_offers() fehlt';
  end if;
  if to_regprocedure('public.v1_sale_condition()') is null then
    raise exception '0146 setzt 0028 voraus: v1_sale_condition() fehlt';
  end if;
  if to_regprocedure('public.reservation_ttl()') is null then
    raise exception '0146 setzt 0010 voraus: reservation_ttl() fehlt — aus ihr '
      'leitet S2 die Karenzzeit ab';
  end if;
  if to_regclass('public.offer_state') is not null then
    raise exception '0146 Abbruch: public.offer_state steht schon';
  end if;
  if to_regprocedure('public.refresh_offer_state()') is not null then
    raise exception '0146 Abbruch: refresh_offer_state() steht schon';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Das Drosselfenster, als Funktion und nicht als Zahl im Rumpf
--
-- Dieselbe Bauform wie `reservation_ttl()` (`0010`): eine Betriebszahl, die
-- an EINER Stelle steht und gefragt wird, statt in jeder Abfrage zu
-- stehen. Sie zu aendern ist dann ein `create or replace` und kein Eingriff
-- in die Logik.
-- ---------------------------------------------------------------------------
create or replace function public.offer_state_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 minute';
$$;

comment on function public.offer_state_window() is
  'Wie oft der Angebotsspiegel hoechstens aufgefrischt wird (0146). Eine Minute: haeufiger brachte nichts, weil die Karenzzeit fuer Meldungen 30 Minuten ist. Serverseitig, kein Client waehlt sie.';


-- ---------------------------------------------------------------------------
-- 3. `offer_state_live` — die Gegenwart, aus der einen Projektion
--
-- EINE SICHT UND KEINE ZWEITE RECHNUNG. Hier steht nirgends ein Preis, eine
-- Prozentzahl oder eine Bestandsregel: `shop_offers()` beantwortet das, und
-- diese Sicht nimmt daraus die Zeilen, die V1 wirklich verkauft.
--
-- WARUM DER ZUSTANDSFILTER TROTZDEM DASTEHT, obwohl `shop_offers()` ihn seit
-- `0029` selbst setzt: der Spiegel soll „was V1 verkauft" bedeuten, auch
-- wenn die Projektion eines Tages breiter wird. Dieselbe Doppelung macht
-- `v1BuyableOffers()` in `src/lib/shop/offer.ts` — `available` UND
-- `condition`. Zwei Orte, dieselbe Regel, und keiner von beiden rechnet
-- einen Preis.
--
-- CENT ALS GANZE ZAHL. `shop_price()` rundet auf zwei Dezimalstellen
-- (`round(…, 2)`), also ist `price * 100` schon ganzzahlig; `round()` davor
-- ist der ausdrueckliche Rundungsvertrag und kein Zufall. Verglichen wird
-- spaeter in Cent, nie in Gleitkommazahlen.
--
-- `min()` UEBER DIE KAUFBAREN. Mehrere Angebote derselben SKY-ID sind damit
-- erledigt, und ein ausverkauftes zieht den Preis nicht herunter.
-- ---------------------------------------------------------------------------
create view public.offer_state_live as
  select
    o.sky_id,
    min(round(o.price * 100))::integer as cheapest_cents
  from public.shop_offers() o
  where o.available
    and o.condition = public.v1_sale_condition()
  group by o.sky_id;

comment on view public.offer_state_live is
  'Was JETZT tatsaechlich kaufbar ist, je SKY-ID, mit dem guenstigsten Preis in Cent (0146). Liest ausschliesslich shop_offers() und rechnet keinen Preis nach. Eine Figur ohne kaufbares Angebot kommt nicht vor. Kein Clientrecht: S2 liest sie, um vor einer Meldung gegen die Gegenwart zu pruefen.';

/*
 * KEIN CLIENTRECHT. Die Sicht laeuft als ihr Eigentuemer (PostgreSQL-Vorgabe
 * `security_invoker = false`), also koennen die `definer`-Funktionen unten
 * sie lesen, ohne dass irgendeine API-Rolle sie sehen muss. Oeffentlich
 * waere sie harmlos — die Preise stehen im Shop —, aber ein Recht, das
 * niemand braucht, gehoert entzogen.
 */
revoke all on public.offer_state_live from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. `offer_state` — das Gedaechtnis
--
-- EINE ZEILE JE FIGUR, nicht je Ereignis. Sie ist die Antwort auf „war das
-- schon so?", und ohne sie gibt es nur einen Zustand und keine Kante.
--
-- KEIN `seller_id`. Der Zustand gehoert der FIGUR, so wie `shop_offers()`
-- ihn fuer die Plattform beantwortet. Kaeme je ein zweiter Verkaeufer,
-- aendert sich die Projektion — und diese Tabelle bleibt unveraendert
-- richtig (ADR-0021 bleibt unberuehrt).
--
-- VIER ZEITSTEMPEL-FRAGEN, ZWEI SPALTEN:
--
--   `changed_at`  wann sich der FACHLICHE Zustand zuletzt wirklich geaendert
--                 hat. Die Karenzzeit in S2 rechnet hiergegen. Eine
--                 Auffrischung ohne Aenderung setzt sie NICHT zurueck.
--   `checked_at`  wann der Zustand zuletzt erfolgreich geprueft wurde. Sie
--                 beweist, WANN geprueft wurde — nicht, dass sich seitdem
--                 nichts geaendert hat. Siehe Abschnitt 6 und den Vertrag
--                 fuer S2 im Kommentar an `refresh_offer_state()`.
--
--   Dass die eine die andere nicht ueberschreibt, haelt
--   `offer_state_checked_after_changed` fest — als CHECK und nicht als
--   Absicht.
--
-- DIE DREI `announced_*`-SPALTEN sind der EINZIGE echte Zustand dieser
-- Tabelle: `buyable`, `cheapest_cents` und `changed_at` sind jederzeit aus
-- `shop_offers()` neu herstellbar, der gemeldete Stand nicht. Deshalb gehoert
-- die Tabelle in die Plattformsicherung (D-6) — ein Archiv ohne sie wuerde
-- nach einer Wiederherstellung JEDE Figur neu melden.
--
-- S1 SCHREIBT SIE NIE. Hier legt sie nur die Erstbefuellung, und zwar auf
-- den Ist-Zustand: ein bestehendes Angebot ist keine Neuigkeit. Fortgeschrieben
-- werden sie erst von S2.
-- ---------------------------------------------------------------------------
create table public.offer_state (
  sky_id text not null,

  -- Gibt es JETZT mindestens ein tatsaechlich kaufbares Angebot?
  buyable boolean not null,

  -- Der guenstigste kaufbare Preis in CENT, oder `null` wenn nicht kaufbar.
  cheapest_cents integer,

  -- Wann der fachliche Zustand sich zuletzt WIRKLICH geaendert hat.
  changed_at timestamptz not null default now(),

  -- Wann er zuletzt erfolgreich geprueft wurde.
  checked_at timestamptz not null default now(),

  -- Was zuletzt GEMELDET wurde. S1 setzt sie nur bei der Erstbefuellung.
  announced_buyable boolean,
  announced_cents   integer,
  announced_at      timestamptz,

  constraint offer_state_pk primary key (sky_id),

  -- Eine Katalogzeile darf nicht unter dem Spiegel wegbrechen; der Import
  -- deaktiviert ueber `is_active` statt zu loeschen. Dieselbe Regel wie bei
  -- `collection_items` (0001) und `favorites` (0145).
  constraint offer_state_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete restrict,

  -- Kaufbar heisst: es gibt einen Preis. Nicht kaufbar heisst: es gibt
  -- keinen. Alles andere waere ein Zustand, den `shop_offers()` nicht kennt.
  constraint offer_state_price_consistent
    check ((buyable and cheapest_cents is not null)
           or (not buyable and cheapest_cents is null)),

  /*
   * `>= 0` UND NICHT `> 0`, und das ist Absicht.
   *
   * `shop_price()` rundet `market_price * percentage / 100` auf zwei
   * Dezimalstellen. Bei einem sehr kleinen Marktwert kann daraus `0.00`
   * werden — ein Angebot zu null Euro ist fachlich Unsinn, aber es ist ein
   * Zustand, den der Shop herstellen KANN. Ein `> 0` haette den ganzen
   * Spiegellauf an einer solchen Zeile abbrechen lassen, und ein
   * Spiegel, der an echten Daten scheitert, ist schlechter als einer, der
   * eine Null abbildet.
   */
  constraint offer_state_price_sane
    check (cheapest_cents is null or cheapest_cents >= 0),
  constraint offer_state_announced_price_sane
    check (announced_cents is null or announced_cents >= 0),

  -- Entweder ist noch nie gemeldet worden, oder es steht, WAS gemeldet wurde.
  constraint offer_state_announced_consistent
    check ((announced_at is null and announced_buyable is null
            and announced_cents is null)
           or (announced_at is not null and announced_buyable is not null)),

  -- Eine Pruefung ohne Aenderung darf `changed_at` nicht zuruecksetzen.
  constraint offer_state_checked_after_changed
    check (checked_at >= changed_at)
);

comment on table public.offer_state is
  'Der Angebotsspiegel (0146, Phase 4 S1): je Figur, ob sie JETZT tatsaechlich kaufbar ist und zu welchem guenstigsten Preis in Cent. changed_at ist die letzte echte Aenderung, checked_at die letzte erfolgreiche Pruefung. Die announced_*-Spalten halten, was einem Nutzer zuletzt gemeldet wurde — der einzige nicht wiederherstellbare Teil, und der Grund, warum diese Tabelle in die Plattformsicherung gehoert. Kein seller_id: der Zustand gehoert der Figur, so wie shop_offers() ihn fuer die Plattform beantwortet.';

comment on column public.offer_state.checked_at is
  'Wann der Zustand zuletzt erfolgreich geprueft wurde. BEWEIST NICHT, dass sich seitdem nichts geaendert hat — wer darauf eine Meldung stuetzt, meldet moeglicherweise ein Angebot, das es nicht mehr gibt. S2 muss gegen offer_state_live gegenpruefen.';

comment on column public.offer_state.changed_at is
  'Die letzte ECHTE Aenderung von buyable oder cheapest_cents. Die Karenzzeit (reservation_ttl() + 10 min) rechnet hiergegen; eine Auffrischung ohne Aenderung setzt sie nicht zurueck.';


-- ---------------------------------------------------------------------------
-- 5. Rechte: keine. Alles laeuft ueber die Funktion.
--
-- Supabase setzt `ALTER DEFAULT PRIVILEGES` auf `public`: `anon`,
-- `authenticated` und `service_role` bekommen bei JEDEM `create table`
-- automatisch `ALL`. `grant` ist additiv und entzieht nichts
-- (`docs/SECURITY.md`, zweite Schicht) — alles Unerwuenschte muss
-- ausdruecklich entzogen werden.
--
-- RLS an, OHNE Richtlinie: das ist die Form der Handelstabellen seit `0010`.
-- Betriebszustand, den keine Oberflaeche braucht — Karten lesen
-- `shop_offers()`.
-- ---------------------------------------------------------------------------
alter table public.offer_state enable row level security;
revoke all on public.offer_state from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. `refresh_offer_state()` — der Vergleich, gedrosselt und idempotent
--
-- WAS SIE ZURUECKGIBT, UND WARUM DAS WICHTIG IST:
--
--   ran = true,  'ran'        dieser Aufruf hat WIRKLICH geprueft
--   ran = false, 'throttled'  es war vor weniger als einem Fenster schon
--   ran = false, 'locked'     ein anderer Aufruf prueft gerade
--
-- DER AUFRUFER DARF `locked` NIEMALS ALS EIGENEN ERFOLG LESEN. Ein
-- konkurrierender Lauf kann abbrechen; dann hat NIEMAND geprueft, und
-- `checked_at` ist entsprechend alt. Genau deshalb sind das drei
-- unterscheidbare Antworten und kein `boolean`.
--
-- ===================== DER VERTRAG FUER S2 ===============================
--
-- DIESER SPIEGEL IST KEINE FRISCHEGARANTIE, und `checked_at` ist keine.
-- Das Szenario, das der Betreiber benannt hat:
--
--   1. Der Spiegel sagt: kaufbar.
--   2. Das Angebot wird ausverkauft oder deaktiviert.
--   3. Noch kein Abgleich hat stattgefunden.
--   4. Ein Sammler kommt.
--   5. Der Abgleich ist gesperrt oder scheitert.
--
-- Dann steht im Spiegel „kaufbar", und es ist nicht mehr wahr. Eine Meldung
-- daraus waere falsch. KEIN Zeitstempel kann das verhindern — eine Minute
-- Drosselung heisst nicht, dass der Spiegel eine Minute alt ist, sondern
-- dass er HOECHSTENS jede Minute nachgezogen wird.
--
-- **S2 MUSS DESHALB VOR DEM SCHREIBEN EINER MELDUNG GEGEN
-- `offer_state_live` GEGENPRUEFEN**, in derselben Transaktion, in der sie
-- die Meldung anlegt. Der Spiegel sagt, WAS SICH GEAENDERT HAT; die Sicht
-- sagt, WAS JETZT GILT. Nur wo beide uebereinstimmen, darf gemeldet werden.
--
-- S1 liefert dafuer die drei Voraussetzungen: `offer_state_live` als
-- lesbare Gegenwart, `checked_at` als Alter des Spiegels, und diese drei
-- unterscheidbaren Antworten. Die Pruefung selbst gehoert nach S2.
-- =========================================================================
--
-- ERSTBEFUELLUNG OHNE KUENSTLICHE EREIGNISSE. Ist die Tabelle leer, entsteht
-- jede Zeile BEREITS GEMELDET (`announced_* = Ist-Zustand`). Ein Angebot,
-- das seit Wochen steht, ist keine Neuigkeit. Jede SPAETER entstehende Zeile
-- bekommt `announced_* = null` — die wird S2 zu Recht als Neuigkeit lesen.
-- Woran die Funktion das unterscheidet: daran, ob die Tabelle zu Beginn des
-- Laufs leer war, gelesen UNTER dem Schloss.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_offer_state()
returns table (ran boolean, reason text, rows_checked integer, rows_changed integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_letzte  timestamptz;
  v_erst    boolean;
  v_geprueft integer := 0;
  v_geaendert integer := 0;
begin
  /*
   * 1. DROSSELUNG VOR DEM SCHLOSS — die billigste Abweisung.
   *
   * `max(checked_at)` ist das Alter des Spiegels: ein erfolgreicher Lauf
   * setzt `checked_at` auf JEDER Zeile, also ist das Maximum genau der
   * Zeitpunkt des letzten erfolgreichen Laufs. Kein zusaetzlicher
   * Zeitstempel irgendwo, keine zweite Wahrheit.
   *
   * Leere Tabelle: `max` ist `null`, und dann laeuft die Erstbefuellung.
   */
  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  /*
   * 2. DAS SCHLOSS. `try` und nicht warten: ein zweiter Besucher soll
   *    sofort weiterkommen und nicht an einer Auffrischung haengen, die ihn
   *    nicht interessiert.
   *
   * `xact`: es fällt mit der Transaktion, auch bei einem Abbruch. Ein
   * gescheiterter Lauf laesst also kein Schloss zurueck — er ist beim
   * naechsten geeigneten Aufruf wieder moeglich.
   *
   * Zwei Zahlen statt einer: (146, 1) ist der Namensraum dieser Migration.
   * Eine einzelne Zahl waere ein Wert in einem globalen Raum, in dem auch
   * andere Beratschlagungsschloesser leben.
   */
  if not pg_try_advisory_xact_lock(146, 1) then
    return query select false, 'locked'::text, 0, 0;
    return;
  end if;

  /*
   * 3. DROSSELUNG ERNEUT, JETZT UNTER DEM SCHLOSS.
   *
   * Zwei Aufrufe, die Schritt 1 gleichzeitig passiert haben, wuerden sonst
   * beide laufen — der zweite unmittelbar nach dem ersten. Das ist der
   * klassische Doppelprueffall, und ohne diese Wiederholung waere die
   * Drosselung eine Empfehlung statt einer Grenze.
   */
  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  v_erst := not exists (select 1 from public.offer_state);

  /*
   * 4. WIE VIELE WEICHEN AB — gezaehlt VOR dem Schreiben.
   *
   * Danach waere die Antwort immer null. Gezaehlt wird gegen den Sollstand:
   * jede jetzt kaufbare Figur, plus jede, die eine Zeile hat und nicht mehr
   * kaufbar ist.
   */
  select count(*) into v_geaendert
    from (
      select l.sky_id, true as buyable, l.cheapest_cents
        from public.offer_state_live l
      union all
      select s.sky_id, false, null::integer
        from public.offer_state s
       where not exists (select 1 from public.offer_state_live l
                          where l.sky_id = s.sky_id)
    ) soll
    left join public.offer_state alt on alt.sky_id = soll.sky_id
   where alt.sky_id is null
      or alt.buyable is distinct from soll.buyable
      or alt.cheapest_cents is distinct from soll.cheapest_cents;

  /*
   * 5. DIE KAUFBAREN: anlegen oder nachziehen.
   *
   * `changed_at` wird NUR gesetzt, wenn sich `buyable` oder
   * `cheapest_cents` wirklich aendert — `is distinct from`, damit `null`
   * mitspielt. `checked_at` wird immer gesetzt: das ist der Preis der
   * Frischeauskunft, und er ist bewusst bezahlt (eine Zeile je Figur je
   * Fenster, bei knapp 290 Figuren).
   */
  insert into public.offer_state as s
    (sky_id, buyable, cheapest_cents, changed_at, checked_at,
     announced_buyable, announced_cents, announced_at)
  select
    l.sky_id, true, l.cheapest_cents, now(), now(),
    case when v_erst then true end,
    case when v_erst then l.cheapest_cents end,
    case when v_erst then now() end
  from public.offer_state_live l
  on conflict (sky_id) do update
     set buyable        = true,
         cheapest_cents = excluded.cheapest_cents,
         changed_at     = case
                            when s.buyable is distinct from true
                              or s.cheapest_cents is distinct from excluded.cheapest_cents
                            then now()
                            else s.changed_at
                          end,
         checked_at     = now();

  /*
   * 6. DIE NICHT MEHR KAUFBAREN: zurueckstellen.
   *
   * Eine Zeile verschwindet nie. „Nicht kaufbar" ist ein Zustand, den S2
   * braucht — ohne ihn koennte die naechste Verfuegbarkeit keine Kante
   * sein.
   */
  update public.offer_state s
     set buyable        = false,
         cheapest_cents = null,
         changed_at     = case when s.buyable then now() else s.changed_at end,
         checked_at     = now()
   where not exists (select 1 from public.offer_state_live l
                      where l.sky_id = s.sky_id);

  select count(*) into v_geprueft from public.offer_state;
  return query select true, 'ran'::text, v_geprueft, v_geaendert;
end;
$$;

comment on function public.refresh_offer_state() is
  'Zieht den Angebotsspiegel aus shop_offers() nach (0146). Gedrosselt auf offer_state_window() und durch ein Transaktionsschloss gegen parallele Laeufe gesichert. Gibt drei unterscheidbare Antworten zurueck: ran/throttled/locked — ein Aufrufer darf locked NIEMALS als eigenen Erfolg lesen. Schreibt changed_at nur bei echter Aenderung, checked_at bei jedem erfolgreichen Lauf. Erzeugt KEINE Benachrichtigung. WICHTIG: checked_at ist keine Frischegarantie; S2 muss vor einer Meldung gegen offer_state_live gegenpruefen.';

/*
 * WER SIE AUSFUEHREN DARF: `authenticated`, und sonst niemand.
 *
 * NICHT `anon`, und das ist eine Abweichung vom Konzept. Dort stand, auch
 * ein anonymer Shopbesucher duerfe den Spiegel auffrischen. Gebraucht wird
 * das nicht: die Meldungen gehen an angemeldete Sammler, und deren eigener
 * Seitenaufbau frischt auf. Kommt niemand, braucht niemand eine Meldung.
 * Eine schreibende Funktion fuer `anon` ist eine Flaeche, die ohne Nutzen
 * nicht entstehen soll.
 *
 * KEINE ROLLENPRUEFUNG IM RUMPF. Jedes angemeldete Konto darf auffrischen —
 * die Funktion gibt nichts preis als drei Zahlen ueber den eigenen Lauf,
 * und sie schreibt nur, was `shop_offers()` ohnehin sagt. Eine Pruefung auf
 * `is_collector_account()` waere eine Grenze ohne Zweck.
 *
 * KEINE PERSONENBEZOGENEN DATEN, NIRGENDS. Die Funktion nennt `favorites`
 * nicht, liest es nicht und kennt keine `user_id`.
 */
revoke all on function public.refresh_offer_state() from public, anon;
grant execute on function public.refresh_offer_state() to authenticated;

revoke all on function public.offer_state_window() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Nachbedingungen
--
-- Die Migration prueft sich selbst, wie `0135` bis `0145`: Tabelle, Spalten,
-- Schluessel, Fremdschluessel, die fuenf CHECKs, RLS, keine Richtlinie,
-- keine Rechte, die Sicht, die beiden Funktionen, ihre Attribute, ihre
-- Rechte — und dass KEIN Trigger entstanden ist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer     text := '0146 Befund';
  v_n       integer;
  v_spalten text;
begin
  if to_regclass('public.offer_state') is null then
    raise exception '%: die Tabelle fehlt', v_wer;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
    into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'offer_state';
  if v_spalten <> 'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
                 || 'announced_buyable,announced_cents,announced_at' then
    raise exception '%: die Spalten sind "%"', v_wer, v_spalten;
  end if;

  select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
    into v_spalten
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.offer_state'::regclass and c.contype = 'p';
  if coalesce(v_spalten, '(keiner)') <> 'sky_id' then
    raise exception '%: der Primaerschluessel ist "%"', v_wer,
      coalesce(v_spalten, '(keiner)');
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.offer_state'::regclass
                    and conname = 'offer_state_sky_fk' and confdeltype = 'r') then
    raise exception '%: offer_state_sky_fk ist nicht ON DELETE RESTRICT', v_wer;
  end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.offer_state'::regclass and contype = 'c'
     and conname in ('offer_state_price_consistent', 'offer_state_price_sane',
                     'offer_state_announced_price_sane',
                     'offer_state_announced_consistent',
                     'offer_state_checked_after_changed');
  if v_n <> 5 then
    raise exception '%: nur % von 5 CHECKs stehen', v_wer, v_n;
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.offer_state'::regclass) then
    raise exception '%: RLS ist nicht eingeschaltet', v_wer;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'offer_state';
  if v_n <> 0 then
    raise exception '%: % Richtlinie(n) — es soll keine geben', v_wer, v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'offer_state'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_n <> 0 then
    raise exception '%: % Tabellenrecht(e) fuer eine API-Rolle', v_wer, v_n;
  end if;

  -- Die Sicht, und auch sie ohne Clientrecht.
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: die Sicht offer_state_live fehlt', v_wer;
  end if;
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'offer_state_live'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_n <> 0 then
    raise exception '%: % Recht(e) auf offer_state_live fuer eine API-Rolle',
      v_wer, v_n;
  end if;

  -- Die Funktionen: da, definer bzw. immutable, leerer search_path.
  if to_regprocedure('public.refresh_offer_state()') is null then
    raise exception '%: refresh_offer_state() fehlt', v_wer;
  end if;
  if to_regprocedure('public.offer_state_window()') is null then
    raise exception '%: offer_state_window() fehlt', v_wer;
  end if;

  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refresh_offer_state'
     and p.prosecdef and p.provolatile = 'v';
  if v_n <> 1 then
    raise exception '%: refresh_offer_state ist nicht genau einmal '
      'definer+volatile', v_wer;
  end if;

  /*
   * Ausgepackt, nicht verglichen: PostgreSQL legt `set search_path = ''` als
   * `search_path=""` ab (`migration-integrity.test.ts`).
   */
  for v_spalten in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('refresh_offer_state', 'offer_state_window')
  loop
    select count(*) into v_n
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proconfig, '{}')) c
     where n.nspname = 'public' and p.proname = v_spalten
       and c like 'search\_path=%';
    if v_n <> 1 then
      raise exception '%: % hat % search_path-Festlegungen statt 1',
        v_wer, v_spalten, v_n;
    end if;
  end loop;

  -- Kein offenes EXECUTE.
  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.refresh_offer_state()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_n <> 0 then
    raise exception '%: refresh_offer_state ist fuer PUBLIC oder anon '
      'ausfuehrbar', v_wer;
  end if;

  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.refresh_offer_state()')
     and a.privilege_type = 'EXECUTE'
     and a.grantee::regrole::text = 'authenticated';
  if v_n <> 1 then
    raise exception '%: authenticated darf refresh_offer_state nicht '
      'ausfuehren', v_wer;
  end if;

  /*
   * UND KEIN TRIGGER. Die zentrale Zusage dieser Migration, als Pruefung und
   * nicht als Absicht: nichts haengt an `shop_inventory`, `skylanders` oder
   * `shop_settings`, das `0146` angelegt haette.
   */
  select count(*) into v_n from pg_trigger t
   where t.tgrelid in ('public.shop_inventory'::regclass,
                       'public.skylanders'::regclass,
                       'public.shop_settings'::regclass)
     and not t.tgisinternal
     and t.tgname like '%offer_state%';
  if v_n <> 0 then
    raise exception '%: % Trigger mit offer_state im Namen', v_wer, v_n;
  end if;

  select count(*) into v_n from public.offer_state;
  if v_n <> 0 then
    raise exception '%: die Migration hat % Zeile(n) angelegt — die '
      'Erstbefuellung gehoert in den ersten Aufruf von refresh_offer_state(), '
      'nicht in die Migration', v_wer, v_n;
  end if;

  raise notice '0146 ok: offer_state steht (8 Spalten, PK sky_id, 5 CHECKs, '
    'RLS an, 0 Richtlinien, 0 Clientrechte), offer_state_live steht ohne '
    'Clientrecht, refresh_offer_state() definer+volatile nur fuer '
    'authenticated, offer_state_window() ohne Clientrecht, KEIN Trigger, '
    '0 Zeilen. Keine Benachrichtigung, keine bestehende Tabelle, Funktion, '
    'Richtlinie oder Berechtigung beruehrt.';
end $$;
-- <<< ENDE: supabase/migrations/0146_offer_state.sql

commit;
