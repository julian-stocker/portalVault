-- ===========================================================================
-- 0107 — Das Auth-Inventar der Plattformsicherung
--
-- WOFÜR. `system_platform_export()` (0105) liefert 53 Bereiche aus `public`.
-- An sehr vielen davon hängt eine `user_id`: `profiles`, `collection_items`,
-- `orders`, `customer_contacts`, `platform_admins`, `seller_operators`,
-- `testers`. Nach einem Totalverlust wären das UUIDs ohne Menschen dahinter —
-- niemand könnte sagen, wem eine Sammlung oder eine Bestellung gehört. Diese
-- Funktion liefert genau die Brücke: welche Konten existierten, und unter
-- welcher E-Mail-Adresse. Die Zuordnung nach einem Wiederaufbau läuft über
-- diese Adresse, nicht über die UUID.
--
-- ES IST KEIN AUTH-BACKUP, UND DAS DARF NIRGENDS ANDERS DARGESTELLT WERDEN.
-- Aus dieser Datei lässt sich kein Konto wiederherstellen und keine Anmeldung
-- nachbilden. Sie trägt KEIN Passwort, KEIN Token, KEIN MFA-Geheimnis und
-- keine Anbieteridentität. Wer sich nach einem Wiederaufbau anmelden will,
-- setzt sein Passwort neu — genau so, wie es sein soll.
--
-- DIE SIEBEN FELDER, UND WARUM ES GENAU DIESE SIND
--
--   id                  der Fremdschlüssel, an dem alles in `public` hängt
--   email               die Brücke zum Menschen; ohne sie ist die UUID leer
--   created_at          seit wann das Konto besteht
--   last_sign_in_at     ob es noch benutzt wird — unterscheidet ein aktives
--                       Konto von einer Karteileiche
--   email_confirmed_at  ob die Adresse je bestätigt wurde. Ohne das wäre nach
--                       einem Wiederaufbau unklar, welche Adresse belastbar
--                       ist
--   provider            wie sich das Konto anmeldet (`email`, später evtl.
--                       OAuth). ABGELEITET, siehe unten
--   banned_until        eine Sperre ist eine Entscheidung, die ein
--                       Wiederaufbau nicht verlieren darf
--
-- Der Vertrag steht NICHT hier, sondern in
-- `src/lib/backup/platform-manifest.ts` — `AUTH_INVENTORY_FIELDS`,
-- `AUTH_FORBIDDEN_FIELDS`, `AUTH_INVENTORY_DISCLAIMER`.
-- `auth-inventory-sql.test.ts` hält beide Seiten gegeneinander und schlägt an,
-- sobald sie auseinanderlaufen.
--
-- `provider` WIRD ABGELEITET, `raw_app_meta_data` WIRD NICHT AUSGEGEBEN
--
-- Die Anmeldeart steht in `auth.users.raw_app_meta_data`, einem JSON-Objekt.
-- Dieses Objekt kann Anbietergeheimnisse tragen und steht deshalb in
-- `AUTH_FORBIDDEN_FIELDS`. Exportiert wird ausschließlich der EINE
-- herausgezogene Textwert:
--
--   'provider', u.raw_app_meta_data ->> 'provider'
--
-- `->>` liefert `text`, nie das Objekt. Das ist der einzige Ort im File, an
-- dem die Spalte überhaupt vorkommt, und der Test prüft genau das: jede
-- Erwähnung von `raw_app_meta_data` muss unmittelbar von `->> 'provider'`
-- gefolgt sein. Ein `to_jsonb(u)`, ein `u.*` oder ein zweiter Zugriff auf das
-- Objekt macht ihn rot.
--
-- KEINE AUSWAHL, KEIN FILTER. Jede Zeile von `auth.users` kommt mit. Ein
-- Inventar, das still Konten weglässt, ist die Sorte Lücke, gegen die der
-- ganze Export gebaut ist.
--
--   BEKANNTE GRENZE, AUSDRÜCKLICH GENANNT: Supabase kennt ein
--   `auth.users.deleted_at` für weich gelöschte Konten. Die sieben Felder
--   können das nicht ausdrücken, ein solches Konto sieht hier also aus wie
--   jedes andere. Das Projekt löscht heute keine Konten weich — kein Code
--   liest oder schreibt `deleted_at`. Sollte sich das ändern, ist die ehrliche
--   Antwort ein zusätzliches Feld und ein erhöhtes `format_version`, NICHT ein
--   stiller `where`-Filter hier.
--
-- WER FRAGEN DARF. `is_platform_admin()` als erste Bedingung, genau eine.
-- Für alle anderen `null` — nicht ein Fehler: „nicht deins" und „nichts
-- vorhanden" sollen gleich aussehen, dieselbe Wahl wie bei
-- `system_platform_export()` und `seller_business_backup()`.
--
-- KEIN SERVICE-ROLE-WEG. `revoke execute … from service_role` steht unten,
-- und zwar aus demselben Grund wie in `0106`: Supabase' Default-Privileges
-- vergeben EXECUTE auf neue Funktionen in `public` an `service_role`, obwohl
-- keine Migration es täte. Der Export läuft in der Sitzung des
-- Plattformadmins; ein Service-Role-Schlüssel hat in diesem Weg nichts zu
-- suchen und ist in der Next-App ohnehin nicht vorhanden
-- (`docs/DEPLOYMENT.md:61`).
--
-- WARUM EINE DB-FUNKTION UND KEINE EDGE FUNCTION. Diese Grenze —
-- `security definer`, `is_platform_admin()`, leerer `search_path`, nur
-- `authenticated` — ist mit `0103`, `0104`, `0105` und `0106` viermal
-- validiert. Eine Edge Function würde den Service-Role-Schlüssel in den
-- Exportweg holen und eine zweite Deployment-Einheit erzeugen, für einen
-- einzigen `select`. Kein Geheimnis kommt an einen Ort, an dem heute keines
-- ist.
--
-- `stable` UND EIN EINZIGER `select`. Dieselbe Regel wie bei `0105`: ein
-- Statement, eine MVCC-Momentaufnahme. Das Inventar und das
-- Datenbankdokument sind allerdings ZWEI Aufrufe und damit zwei Momente —
-- das ist hier vertretbar, weil `auth.users` und die Fremdschlüssel in
-- `public` sich nur beim Anlegen oder Löschen eines Kontos ändern, und weil
-- ein zusätzliches Konto im Inventar ohne Zeilen in `public` harmlos ist. Die
-- umgekehrte Richtung — eine Zeile in `public` ohne Konto im Inventar — fällt
-- beim Lesen sofort auf, weil die UUID dann nirgends auflösbar ist.
--
-- RÜCKBAU.
--   drop function if exists public.system_auth_inventory();
-- Es wird nichts migriert, nichts überschrieben, keine Tabelle angefasst und
-- keine Zeile geändert.
-- ===========================================================================


create or replace function public.system_auth_inventory()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                 u.id,
        'email',              u.email::text,
        'created_at',         u.created_at,
        'last_sign_in_at',    u.last_sign_in_at,
        'email_confirmed_at', u.email_confirmed_at,
        'provider',           u.raw_app_meta_data ->> 'provider',
        'banned_until',       u.banned_until
      ) order by u.id)
        from auth.users u
    ), '[]'::jsonb)
  end;
$$;

comment on function public.system_auth_inventory() is
  'The account inventory of one platform backup (0107) — the archive file auth-users.json. Seven fields per account: id, email, created_at, last_sign_in_at, email_confirmed_at, provider and banned_until. It exists so that after a total loss the user_id foreign keys all over the public schema still resolve to a person; reconnecting happens by email address, never by UUID. It is deliberately NOT an auth backup and must never be presented as one: no password, no token, no MFA secret, no provider identity, and no way to restore or impersonate an account. provider is DERIVED as raw_app_meta_data ->> ''provider'' — the object itself is a forbidden field and never leaves the database. Every row is included; no filter, because an inventory that quietly omits accounts is the kind of gap this export exists to prevent. The contract lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by auth-inventory-sql.test.ts.';

revoke all     on function public.system_auth_inventory() from public, anon;
revoke execute on function public.system_auth_inventory() from service_role;
grant  execute on function public.system_auth_inventory() to authenticated;
