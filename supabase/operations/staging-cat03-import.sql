-- ===========================================================================
-- STAGING — CAT-03: 105 Katalogentwuerfe anlegen
--
-- ERZEUGT von `npm run cat03:import:staging -- --sql`, nicht von Hand.
-- Grundlage: resources/analysis/cat-03-entwuerfe.json
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts einfuegen, ausfuehren.
--
-- *** JEDE ZEILE ENTSTEHT ALS ENTWURF ***
--
-- `catalog_status = 'draft'` und `catalog_visible = false`. Keine dieser
-- Figuren ist nach dem Lauf oeffentlich sichtbar — der oeffentliche Katalog
-- aendert sich NICHT. Sichtbar werden sie erst, wenn der Admin im Formular
-- den Status auf `public` stellt.
--
-- SIE IST IDEMPOTENT. Jede Zeile wird uebersprungen, wenn Name und Serie
-- schon im Katalog stehen; ein zweiter Lauf legt nichts doppelt an und
-- verbraucht auch keine SKY-ID (`nextval` wird erst nach der Pruefung
-- gezogen).
--
-- SIE VERGIBT KEINE SKY-ID IM VORAUS. Die ID kommt aus `sky_id_seq`
-- (ADR-0070), der Slug aus `next_figure_slug()` — dieselben Bausteine, die
-- `admin_create_figure()` benutzt. Nichts wird aus einem Namen abgeleitet.
--
-- WAS SIE NICHT TUT: keinen Preis (`market_price` bleibt NULL, ADR-0010),
-- kein Bild (die Rechte an den externen Bildern sind ungeklaert), keine
-- `character_id` (Kuratierung, ADR-0034), keine bestehende Zeile anfassen,
-- keine Kategorie anlegen, keine Migration.
--
-- HERKUNFT: `source = 'admin'`, weil der CHECK aus `0033` nur `import` und
-- `admin` kennt — und weil `import` dem Katalogimport sagen wuerde, die
-- Zeile gehoere ihm. Die Herkunft `cat01` steht in der internen Notiz
-- (`catalog_editorial.admin_note`), wo interne Angaben hingehoeren
-- (ADR-0039).
-- ===========================================================================

begin;

do $vor$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging.';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception 'ABBRUCH A2: skylanders.catalog_status fehlt — 0152 ist hier '
      'nicht angewendet. Ohne den Status kann kein Entwurf entstehen.';
  end if;
  if to_regprocedure('public.next_figure_slug(text,text,text)') is null then
    raise exception 'ABBRUCH A3: next_figure_slug() fehlt (0041).';
  end if;

  /*
   * A4 — STEHT DIE SEQUENZ WEIT GENUG?
   *
   * sky_id_seq beginnt bei 821 und wird nie zurueckgesetzt. Liegt sie
   * hinter der hoechsten vergebenen SKY-ID, zieht der Lauf eine ID, die
   * schon steht, und verletzt den Primaerschluessel — mitten in der
   * Schleife, nach ein paar erfolgreichen Zeilen. Besser vorher und mit
   * einem Satz, der sagt, was zu tun ist.
   *
   * DER RESERVIERTE BEREICH ZAEHLT NICHT MIT. 9000-9999 ist System- und
   * Testbereich (ADR-0070); auf Staging stehen dort Zeilen (z.B. SKY-9998),
   * und admin_create_figure verweigert alles hinter 8999. Die hoechste
   * RELEVANTE ID ist deshalb die hoechste unterhalb 9000.
   *
   * pg_sequence_last_value ist NULL, solange die Sequenz nie gezogen
   * wurde — dann liefert der naechste Zug den Startwert 821.
   */
  declare
    v_hoechste integer;
    v_naechste bigint;
  begin
    /*
     * DAS MUSTER TUT BEIDES: es waehlt den produktiven Bereich (0000-8999)
     * UND haelt den Cast von jeder Zeile fern, die nicht vierstellig ist.
     * Ein where ...::integer < 9000 haette den Cast zuerst ausgefuehrt und
     * waere an einer abweichenden Kennung mit 22P02 gescheitert — gefunden
     * im Probelauf P61, nicht am Bediener.
     */
    select coalesce(max((substring(sky_id from 5))::integer), 0)
      into v_hoechste
      from public.skylanders
     where sky_id ~ '^SKY-[0-8][0-9]{3}$';

    v_naechste := coalesce(pg_sequence_last_value('public.sky_id_seq'::regclass) + 1, 821);

    if v_naechste <= v_hoechste then
      raise exception 'ABBRUCH A4: sky_id_seq liefert als naechstes %, die hoechste '
        'vergebene SKY-ID unterhalb 9000 ist aber SKY-%. Der Lauf wuerde den '
        'Primaerschluessel verletzen. Sequenz zuerst nachziehen: '
        'select setval(''public.sky_id_seq'', %);',
        v_naechste, lpad(v_hoechste::text, 4, '0'), v_hoechste;
    end if;

    raise notice 'A4 ok: naechste SKY-ID waere SKY-%, hoechste vergebene SKY-% '
      '(reservierter Bereich 9000-9999 nicht mitgezaehlt).',
      lpad(v_naechste::text, 4, '0'), lpad(v_hoechste::text, 4, '0');
  end;
end
$vor$;

do $import$
declare
  v_vorher       bigint;
  v_nachher      bigint;
  r              record;
  v_sky          text;
  v_slug         text;
  v_next         bigint;
  v_angelegt     integer := 0;
  v_uebersprungen integer := 0;
begin
  -- DIE ZEILENZAHL VORHER. Zusammen mit der Zahl danach beweist sie, dass
  -- GENAU die angelegten Zeilen dazugekommen sind und keine verschwunden ist.
  select count(*) into v_vorher from public.skylanders;

  for r in
    select * from (values
      ('Empire of Ice', 'SA', 12, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D20 der externen Checkliste (Magic Items and Level Pieces). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image44.png (png 300x300, sha256 66cebdb7f61e2356) — NICHT uebernommen.'),
      ('Pirate Seas', 'SA', 12, 'figure', 'standard', 'CAT-01 Kandidat, Quelle H20 der externen Checkliste (Magic Items and Level Pieces). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image38.png (png 300x300, sha256 c478a8fcef4098d1) — NICHT uebernommen.'),
      ('Chrome Spyro', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B34 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image40.png (png 300x300, sha256 931e64a8600d5b5f) — NICHT uebernommen.'),
      ('Crystal Clear Cynder', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle C34 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image35.png (png 300x300, sha256 e0acc0580afc4253) — NICHT uebernommen.'),
      ('Crystal Clear Stealth Elf', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle D34 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image43.png (png 300x300, sha256 f23a27f9a007c83a) — NICHT uebernommen.'),
      ('Flocked Stump Smash', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle G34 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image69.png (png 300x300, sha256 b04e994c5f26a01a) — NICHT uebernommen.'),
      ('Glow-in-the-Dark Warnado', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle H34 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image55.png (png 300x300, sha256 1de1f5b65a71f876) — NICHT uebernommen.'),
      ('Glow-in-the-Dark Wrecking Ball', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle A37 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image51.png (png 300x300, sha256 3c5d5b255ac30a7d) — NICHT uebernommen.'),
      ('Glow-in-the-Dark Zap', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle B37 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image98.png (png 300x300, sha256 005c90f10b2c5560) — NICHT uebernommen.'),
      ('Gold Chop Chop', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C37 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image46.png (png 300x300, sha256 07159142b6ed2290) — NICHT uebernommen.'),
      ('Gold Drill Sergeant', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D37 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image71.png (png 300x300, sha256 e31713a77a5d9a7e) — NICHT uebernommen.'),
      ('Metallic Purple Cynder', 'SA', 10, 'figure', 'chase', 'CAT-01 Kandidat, Quelle G37 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image48.png (png 300x300, sha256 861f57cef4af805e) — NICHT uebernommen.'),
      ('Red Camo', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A40 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image53.png (png 300x300, sha256 84e9a7edf860e51c) — NICHT uebernommen.'),
      ('Silver Boomer', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C40 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image66.png (png 300x300, sha256 ffcfa72ef86baac1) — NICHT uebernommen.'),
      ('Silver Dino-Rang', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D40 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image115.png (png 300x300, sha256 16742566db2e5582) — NICHT uebernommen.'),
      ('Silver Eruptor', 'SA', 10, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E40 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image56.png (png 206x205, sha256 a8e8bc57331dda0d) — NICHT uebernommen.'),
      ('Legendary LightCore Chill', 'G', 15, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E71 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image122.png (png 300x300, sha256 1186bda25ba6f030) — NICHT uebernommen.'),
      ('Royal Double Trouble', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E74 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image166.png (png 300x300, sha256 8da05d8a68bd45a2) — NICHT uebernommen.'),
      ('E3 Hot Dog', 'G', 15, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B81 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image157.png (png 300x300, sha256 673fdcbfef287b2b) — NICHT uebernommen.'),
      ('Employee Edition LightCore Prism Break', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C81 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image138.png (png 300x300, sha256 2f65d1a390043a07) — NICHT uebernommen.'),
      ('Metallic Blue Chop Chop', 'G', 16, 'figure', 'chase', 'CAT-01 Kandidat, Quelle A84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image145.png (png 300x300, sha256 16863e8ff2b84692) — NICHT uebernommen.'),
      ('Metallic Green Shroomboom', 'G', 15, 'figure', 'chase', 'CAT-01 Kandidat, Quelle C84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image146.png (png 300x300, sha256 24d2b0fe3a254341) — NICHT uebernommen.'),
      ('Metallic Purple Eye-Brawl', 'G', 14, 'figure', 'chase', 'CAT-01 Kandidat, Quelle D84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image167.png (png 300x300, sha256 1b860dc29212de10) — NICHT uebernommen.'),
      ('Metallic Purple Lightning Rod', 'G', 16, 'figure', 'chase', 'CAT-01 Kandidat, Quelle E84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image164.png (png 300x300, sha256 c8bbfc0f7076e5aa) — NICHT uebernommen.'),
      ('Metallic Purple Wrecking Ball', 'G', 16, 'figure', 'chase', 'CAT-01 Kandidat, Quelle F84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image160.png (png 300x300, sha256 93674f5679937a65) — NICHT uebernommen.'),
      ('Sparkle Hot Head', 'G', 14, 'figure', 'standard', 'CAT-01 Kandidat, Quelle H84 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image140.png (png 300x300, sha256 efa3360ded107377) — NICHT uebernommen.'),
      ('Sparkle Sonic Boom', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image159.png (png 300x300, sha256 5a4f0d4b4126a113) — NICHT uebernommen.'),
      ('Sparkle Sprocket', 'G', 15, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image165.png (png 300x300, sha256 7036196e0ee8e0a4) — NICHT uebernommen.'),
      ('Stone Whirlwind', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image154.png (png 300x300, sha256 8abf7338c2dc91d1) — NICHT uebernommen.'),
      ('Stone Zook', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image193.png (png 300x300, sha256 9215ee845dabb971) — NICHT uebernommen.'),
      ('White Flocked Eruptor', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image172.png (png 300x300, sha256 cc3d54d70aaaa9e7) — NICHT uebernommen.'),
      ('White Flocked LightCore Prism Break', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image171.png (png 300x300, sha256 9cacfa1a1bbbfa1a) — NICHT uebernommen.'),
      ('White Flocked Stump Smash', 'G', 16, 'figure', 'standard', 'CAT-01 Kandidat, Quelle G87 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image179.png (png 300x300, sha256 d2281761b55fec92) — NICHT uebernommen.'),
      ('Smolderdash LightCore', 'SF', 21, 'figure', 'special', 'CAT-01 Kandidat, Quelle E113 der externen Checkliste (LightCore Skylanders). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image205.png (png 300x300, sha256 2856b4f9f35d8991) — NICHT uebernommen.'),
      ('UFO Hat', 'SF', 23, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A120 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image231.png (png 300x300, sha256 c44742647161f2df) — NICHT uebernommen.'),
      ('Dark Stealth Elf', 'SF', 22, 'figure', 'dark', 'CAT-01 Kandidat, Quelle D124 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image230.png (png 300x300, sha256 8e5604e978c1ee8d) — NICHT uebernommen.'),
      ('Enchanted LightCore Star Strike', 'SF', 21, 'figure', 'standard', 'CAT-01 Kandidat, Quelle G124 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image250.png (png 300x300, sha256 637d5674f980ef32) — NICHT uebernommen.'),
      ('Legendary LightCore Grim Creeper', 'SF', 21, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D127 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image315.png (png 300x300, sha256 801c56546f299f48) — NICHT uebernommen.'),
      ('Volcanic Eruptor', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C130 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image243.png (png 300x300, sha256 63f57b473c87d350) — NICHT uebernommen.'),
      ('Bronze & Silver Trap Shadow', 'SF', 20, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image261.png (png 300x300, sha256 468b2d7b8e9b2403) — NICHT uebernommen.'),
      ('Flocked Springtime Trigger Happy', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image239.png (png 300x300, sha256 76f593c72d4f3840) — NICHT uebernommen.'),
      ('Frito-Lay Hot Dog (Green)', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image240.png (png 300x300, sha256 d6e5b77415076226) — NICHT uebernommen.'),
      ('Frito-Lay Hot Dog (Purple)', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image234.png (png 300x300, sha256 87f74480152c6945) — NICHT uebernommen.'),
      ('Frito-Lay Hot Dog (Red)', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image277.png (png 300x300, sha256 f5780f32af9fe390) — NICHT uebernommen.'),
      ('Gold & Bronze Doom Stone', 'SF', 20, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image264.png (png 300x300, sha256 8f9560ed87f85e1e) — NICHT uebernommen.'),
      ('Gold Wash Buckler', 'SF', 20, 'figure', 'standard', 'CAT-01 Kandidat, Quelle H134 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image256.png (png 300x300, sha256 7bb83957dd491df9) — NICHT uebernommen.'),
      ('Green Chop Chop', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A137 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image262.png (png 300x300, sha256 211b88062eae5228) — NICHT uebernommen.'),
      ('Green Rip Tide', 'SF', 21, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B137 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image266.png (png 300x300, sha256 267354663239f51e) — NICHT uebernommen.'),
      ('Heavy Metal Sprocket', 'SF', 22, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D137 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image268.png (png 300x300, sha256 1039755eb635fb3c) — NICHT uebernommen.'),
      ('Metallic Red Dune Bug', 'SF', 21, 'figure', 'chase', 'CAT-01 Kandidat, Quelle E137 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image253.png (png 300x300, sha256 d3cd450b8e680a5b) — NICHT uebernommen.'),
      ('Silver & Gold Stink Bomb', 'SF', 20, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F137 der externen Checkliste (Chase Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image325.png (png 300x300, sha256 0c3b801f76ecdbeb) — NICHT uebernommen.'),
      ('Eggsellent Weeruptor', 'T', 28, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D180 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image363.png (png 300x300, sha256 b04efd65fbd84134) — NICHT uebernommen.'),
      ('Gnarly Barkley', 'T', 28, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E180 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image338.png (png 300x300, sha256 d9f65e8692d8cbc7) — NICHT uebernommen.'),
      ('Power Punch Pet Vac', 'T', 28, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F183 der externen Checkliste (In-Game Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image339.png (png 300x300, sha256 f411f80666a7e344) — NICHT uebernommen.'),
      ('Kaos Trap', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F197 der externen Checkliste (Traptanium Crystal Traps). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image368.png (png 300x300, sha256 7d4e024185643a87) — NICHT uebernommen.'),
      ('Light Owl (Heavenly Hawk)', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E200 der externen Checkliste (Traptanium Crystal Traps). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image371.png (png 300x300, sha256 180a654a9244f3f2) — NICHT uebernommen.'),
      ('Easter Bunny Earth Trap', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A213 der externen Checkliste (Traptanium Crystal Trap Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image405.png (png 300x300, sha256 271861b89fd66d7d) — NICHT uebernommen.'),
      ('Legendary Undead Orb Trap', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B213 der externen Checkliste (Traptanium Crystal Trap Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image417.png (png 300x300, sha256 0eec994277ec1b6e) — NICHT uebernommen.'),
      ('Legendary Undead Skull Trap', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C213 der externen Checkliste (Traptanium Crystal Trap Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image397.png (png 300x300, sha256 74bc18bd0e9779d4) — NICHT uebernommen.'),
      ('Legendary Water Jughead Trap', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D213 der externen Checkliste (Traptanium Crystal Trap Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image443.png (png 300x300, sha256 9bba5302652f5bd6) — NICHT uebernommen.'),
      ('Ultimate Kaos Trap (Dark Edition Variant)', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E213 der externen Checkliste (Traptanium Crystal Trap Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image395.png (png 300x300, sha256 4957865c765b0e5b) — NICHT uebernommen.'),
      ('Outlaw Brawl and Chain', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image400.png (png 300x300, sha256 d615007879056bfc) — NICHT uebernommen.'),
      ('Rebel Lob Goblin', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image406.png (png 300x300, sha256 c9d47da0e7a54cf8) — NICHT uebernommen.'),
      ('Red Hot Tussle Sprout', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image419.png (png 300x300, sha256 9772cb0cbfc5d988) — NICHT uebernommen.'),
      ('Riot Shield Shredder', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image421.png (png 300x300, sha256 29eac77f08e5153e) — NICHT uebernommen.'),
      ('Steamed Broccoli Guy', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image413.png (png 300x300, sha256 e98fddde407565db) — NICHT uebernommen.'),
      ('Steampunk Shrednaught', 'T', 30, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F217 der externen Checkliste (Trappable Villain Variants). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image408.png (png 300x300, sha256 1cd0bc9c18df3f86) — NICHT uebernommen.'),
      ('Thrillipede', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C228 der externen Checkliste (SuperCharger Skylanders). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image426.png (png 500x500, sha256 b02210116c729468) — NICHT uebernommen.'),
      ('Dark Turbo Charge Donkey Kong', 'SC', 32, 'figure', 'dark', 'CAT-01 Kandidat, Quelle E232 der externen Checkliste (In-Game Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image453.png (png 300x300, sha256 c89b3b818d94ac2a) — NICHT uebernommen.'),
      ('Eggcited Thrillipede', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle F232 der externen Checkliste (In-Game Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image437.png (png 500x500, sha256 8fe6c41fff1a2ab5) — NICHT uebernommen.'),
      ('Power Blue Trigger Happy', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E235 der externen Checkliste (In-Game Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image433.png (png 500x500, sha256 d380d1a45400edac) — NICHT uebernommen.'),
      ('Bronze Bone Bash Roller Brawl', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A239 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image442.png (png 500x500, sha256 cf45e5e2e26a67d7) — NICHT uebernommen.'),
      ('Patina High Volt', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B239 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image472.png (png 500x500, sha256 4ca87c9f1a454c18) — NICHT uebernommen.'),
      ('Patina Lava Lance Eruptor', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C239 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image474.jpg (jpg 500x500, sha256 860c2ef0cae1eb04) — NICHT uebernommen.'),
      ('Snow-Brite Stormblade (Employee Edition)', 'SC', 32, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D239 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image455.png (png 409x409, sha256 31a04a86162660c7) — NICHT uebernommen.'),
      ('Event Exclusive Hot Streak', 'SC', 34, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E253 der externen Checkliste (In-Game Variant Vehicles). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image516.png (png 300x300, sha256 ab2944d82261911d) — NICHT uebernommen.'),
      ('Mobile Hot Streak', 'SC', 34, 'figure', 'standard', 'CAT-01 Kandidat, Quelle H253 der externen Checkliste (In-Game Variant Vehicles). Kein Bild uebernommen; externe Bildrechte ungeklaert.'),
      ('Bronze Tomb Buggy', 'SC', 34, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A260 der externen Checkliste (Chase Variant Vehicles). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image478.png (png 480x480, sha256 b437dd56e35edb9f) — NICHT uebernommen.'),
      ('Patina Burn-Cycle', 'SC', 34, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B260 der externen Checkliste (Chase Variant Vehicles). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image475.png (png 500x350, sha256 312c7634d0b4eaca) — NICHT uebernommen.'),
      ('Patina Shield Striker', 'SC', 34, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C260 der externen Checkliste (Chase Variant Vehicles). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image501.png (png 361x361, sha256 233b21b8b489ed71) — NICHT uebernommen.'),
      ('Heartbreaker Buckshot', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E279 der externen Checkliste (In-Game Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image513.jpg (jpg 200x200, sha256 6089f8944282c574) — NICHT uebernommen.'),
      ('Dec-Ember (Employee Edition)', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B283 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image542.png (png 500x500, sha256 c6a0418d4ff80627) — NICHT uebernommen.'),
      ('Happy Birthday Ben Starcast', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C283 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image529.jpg (jpg 200x200, sha256 d851f5004d061289) — NICHT uebernommen.'),
      ('Orange Chain Reaction', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D283 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image530.png (png 500x500, sha256 5a418f5fc7d367a1) — NICHT uebernommen.'),
      ('Pink Barbella', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E283 der externen Checkliste (Chase Variant). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image514.png (png 500x500, sha256 233723fc18fe4d8d) — NICHT uebernommen.'),
      ('Rock Candy Pain-Yatta', 'I', 36, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A298 der externen Checkliste (Chase Variant Villain Sensei). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image549.png (png 500x500, sha256 0487f48ed2d48693) — NICHT uebernommen.'),
      ('Air Acorn', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A302 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image526.jpg (jpg 200x200, sha256 cf90eacbe7b9ef2c) — NICHT uebernommen.'),
      ('Air Lantern', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C302 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image538.png (png 500x500, sha256 2f5dea8dbb4220e9) — NICHT uebernommen.'),
      ('Earth Rune', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A305 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image559.jpg (jpg 200x200, sha256 757e901c3d8d211e) — NICHT uebernommen.'),
      ('Fire Acorn', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B305 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image543.png (png 500x500, sha256 707bc7663509a501) — NICHT uebernommen.'),
      ('Fire Angel', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C305 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image554.jpg (jpg 200x200, sha256 2dc0ce04315bd066) — NICHT uebernommen.'),
      ('Light Angel', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A308 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image563.jpg (jpg 200x200, sha256 6c6c7504b837dcb4) — NICHT uebernommen.'),
      ('Magic Lantern', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E308 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image553.png (png 500x500, sha256 1cd4b65cb0d7664e) — NICHT uebernommen.'),
      ('Tech Pyramid', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle H308 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image556.jpg (jpg 200x200, sha256 d2e47177b64d09b4) — NICHT uebernommen.'),
      ('Undead Lantern', 'I', 38, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D311 der externen Checkliste (Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image571.png (png 500x500, sha256 bd8062b984c6b7f2) — NICHT uebernommen.'),
      ('Legendary Life Acorn', 'I', 38, 'figure', 'legendary', 'CAT-01 Kandidat, Quelle A315 der externen Checkliste (Variant Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image600.png (png 500x500, sha256 b9d28b911ba027a7) — NICHT uebernommen.'),
      ('Legendary Light Fanged', 'I', 38, 'figure', 'legendary', 'CAT-01 Kandidat, Quelle B315 der externen Checkliste (Variant Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image567.png (png 500x500, sha256 97a1d93f26f3550c) — NICHT uebernommen.'),
      ('Legendary Magic Lantern', 'I', 38, 'figure', 'legendary', 'CAT-01 Kandidat, Quelle C315 der externen Checkliste (Variant Creation Crystals). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image603.png (png 500x500, sha256 0c6f4c307532c4a7) — NICHT uebernommen.'),
      ('Blue Chest (Cursed Tiki Temple)', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert.'),
      ('Blue Chest (Lost Imaginite Mines)', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle B319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert.'),
      ('Bronze Mystery Chest', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle C319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image565.png (png 500x500, sha256 a11ed721b29ea805) — NICHT uebernommen.'),
      ('CYOS 3D Printed Figure', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle D319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image584.jpg (jpg 200x200, sha256 73a5ad2f56c7fd67) — NICHT uebernommen.'),
      ('CYOS Card', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle E319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image587.jpg (jpg 200x200, sha256 97873745f44f7b1d) — NICHT uebernommen.'),
      ('Gold Mystery Chest', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle G319 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image594.png (png 500x500, sha256 853e6044d2c638c3) — NICHT uebernommen.'),
      ('Silver Mystery Chest', 'I', 37, 'figure', 'standard', 'CAT-01 Kandidat, Quelle A322 der externen Checkliste (Magic Items). Kein Bild uebernommen; externe Bildrechte ungeklaert. Zugeordnetes Bild: xl/media/image581.png (png 500x500, sha256 7f190d6bdbaaba2a) — NICHT uebernommen.')
    ) as t(name, series_code, category_id, item_type, card_type, note)
  loop
    -- DUBLETTENPRUEFUNG, fachlich und nicht ueber die ID: Name und Serie
    -- zusammen. Die SKY-ID-Sequenz verhindert ID-Kollisionen, aber keine
    -- fachlichen Dubletten — das sind zwei getrennte Risiken.
    if exists (select 1 from public.skylanders s
                where lower(btrim(s.name)) = lower(btrim(r.name))
                  and s.series_code = r.series_code) then
      v_uebersprungen := v_uebersprungen + 1;
      continue;
    end if;

    -- ERST JETZT eine ID ziehen. Eine uebersprungene Zeile verbraucht keine.
    v_next := nextval('public.sky_id_seq');
    if v_next > 8999 then
      raise exception 'ABBRUCH: SKY-ID-Bereich erschoepft (% liegt hinter '
        'SKY-8999; 9000-9999 ist reserviert, ADR-0070)', v_next;
    end if;
    v_sky  := 'SKY-' || lpad(v_next::text, 4, '0');
    v_slug := public.next_figure_slug(r.name, r.series_code, v_sky);

    insert into public.skylanders
      (sky_id, name, slug, series_code, category_id, item_type, card_type,
       catalog_visible, catalog_status, source, is_active)
    values
      (v_sky, r.name, v_slug, r.series_code, r.category_id, r.item_type, r.card_type,
       false, 'draft', 'admin', true);

    -- Die interne Notiz traegt die Herkunft. Sie liegt NICHT auf
    -- `skylanders` — die Tabelle ist weltlesbar (ADR-0039).
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
      values (v_sky, r.note, now())
      on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                         updated_at = now();

    -- Und dieselbe Journalzeile, die `admin_create_figure()` schreibt.
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', v_sky, 'created', null, r.name, null);

    v_angelegt := v_angelegt + 1;
  end loop;

  select count(*) into v_nachher from public.skylanders;
  if v_nachher - v_vorher <> v_angelegt then
    raise exception 'ABBRUCH: der Katalog wuchs um % Zeilen, angelegt wurden aber % — '
      'es ist etwas anderes passiert als dieser Lauf', v_nachher - v_vorher, v_angelegt;
  end if;

  raise notice 'CAT-03: % Entwurf/Entwuerfe angelegt, % uebersprungen (standen schon). '
    'Katalog % -> % Zeilen.', v_angelegt, v_uebersprungen, v_vorher, v_nachher;
end
$import$;

do $nach$
declare
  v_entwurf  bigint;
  v_sichtbar bigint;
begin
  select count(*) into v_entwurf  from public.skylanders where catalog_status = 'draft';
  select count(*) into v_sichtbar from public.skylanders
   where catalog_status = 'draft' and catalog_visible;
  if v_sichtbar <> 0 then
    raise exception 'NACHBEDINGUNG: % Entwurf/Entwuerfe sind sichtbar — das darf '
      'nicht sein', v_sichtbar;
  end if;
  raise notice 'CAT-03 Nachkontrolle: % Entwurf/Entwuerfe im Katalog, keiner sichtbar.',
    v_entwurf;
end
$nach$;

commit;
