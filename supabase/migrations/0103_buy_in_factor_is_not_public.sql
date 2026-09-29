-- ===========================================================================
-- 0103 — Der eigene Ankaufsfaktor ist kein öffentlicher Wert
--
-- DER BEFUND
--
-- `orderbook_global_factor()` (0059) rechnet Ausgaben ÷ bekannter Marktwert
-- über alle Einkäufe. Das ist die Kennzahl, zu welchem Anteil am Marktwert
-- dieser Betrieb einkauft — eine Geschäftszahl, keine Produktangabe.
--
-- Sie steht seit 0059 jedem angemeldeten Konto offen. In derselben Migration
-- steht erst der richtige Entzug
--
--     0059:512   revoke all … from public, anon, authenticated
--
-- und achthundert Zeilen später, im Rechteblock am Ende, der Satz, der ihn
-- wieder aufhebt:
--
--     0059:1370  revoke all … from public, anon
--     0059:1371  grant execute … to authenticated
--
-- Der Rechteblock dort vergibt für neunzehn `seller_*`-Funktionen dasselbe
-- Paar, und diese Funktion ist mitgelaufen — nur trägt sie, anders als jene
-- neunzehn, KEINEN Rollenwächter im Rumpf. Ein eingeloggter Kunde kann sie
-- also direkt per RPC aufrufen und bekommt die Zahl.
--
-- WAS HIER GEÄNDERT WIRD, UND WAS AUSDRÜCKLICH NICHT
--
-- Geändert werden RECHTE. Die Formel, ihr Rumpf, ihre Signatur und ihr
-- Verhalten bleiben Zeichen für Zeichen, wie 0059 sie hinterlassen hat —
-- diese Migration fasst `orderbook_global_factor()` nicht an, sie nimmt ihr
-- nur ein Recht, das sie nie haben sollte. Keine Daten werden gelesen,
-- geschrieben, gelöscht oder umgerechnet. Kein Einkauf, kein Verkauf, kein
-- Lager, kein `buy_in_factor_snapshot`.
--
-- WARUM KEIN WÄCHTER IM RUMPF
--
-- Das wäre der naheliegende Weg und der falsche. Die Funktion wird auch aus
-- `orders_register_sale()` gerufen — dem Trigger, der beim Bezahlen einer
-- Bestellung den Orderbuch-Verkauf anlegt. Der läuft aus dem Stripe-Webhook
-- als Service Role, ohne `auth.uid()`; ein Wächter auf
-- `can_operate_active_seller()` würde dort NULL liefern und den
-- Buy-in-Schnappschuss stillschweigend leeren. `security definer` wechselt
-- die ROLLE, nicht die JWT-Ansprüche — die Prüfung liefe also mit dem
-- Kontext des Käufers. Und der Kommentar über 0078 hält fest, was ein
-- Fehlgriff in genau diesem Pfad kostet: zwei bestätigte Zahlungen sind
-- daran schon einmal zurückgerollt.
--
-- WARUM DER ENTZUG DIE INNEREN AUFRUFER NICHT TRIFFT
--
-- Alle drei sind `security definer` und laufen damit als ihr Eigentümer:
--
--     orders_register_sale()      0059:1196, 0078   Trigger beim Bezahlen
--     seller_book_sale_item()     0073:57           mit Seller-Wächter
--     (dieselbe, Fassung 0059)    0059:873
--
-- Ein `revoke` gegen `authenticated` ändert für sie nichts. Es trifft genau
-- einen Aufrufer: den direkten RPC-Aufruf von außen. Genau den, um den es
-- geht.
--
-- DER WEG FÜR DEN BETRIEB
--
-- `seller_buy_in_factor()` ist die Tür, die bleibt: derselbe Wert, aber mit
-- dem Wächter, den die neunzehn Geschwister im selben Rechteblock alle
-- haben. Sie RUFT `orderbook_global_factor()` auf, statt die Formel zu
-- wiederholen — zwei Wahrheiten über dieselbe Kennzahl wären schlimmer als
-- die Lücke, die hier geschlossen wird.
--
-- Für einen Nichtberechtigten antwortet sie NULL, nicht mit einem Fehler.
-- Dasselbe Muster wie `seller_attention_total()` in 0099: „nicht deins" und
-- „nichts vorhanden" sehen gleich aus, und ein Fehler wäre selbst eine
-- Auskunft — er verriete, dass es etwas zu holen gäbe.
--
-- RÜCKBAU. `grant execute on function public.orderbook_global_factor() to
-- authenticated;` stellt den alten Zustand her; die neue Funktion fallen
-- lassen. Es wurde nichts migriert und nichts überschrieben.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Das Recht, das nie vergeben werden sollte
--
-- Kein `create or replace` darüber: die Funktion bleibt unverändert, und ein
-- Neuanlegen würde die ACL zurücksetzen und damit genau den Fehler
-- wiederholen, den 0100 uns beigebracht hat (ein REVOKE hängt an der
-- Signatur, nicht am Namen).
-- ---------------------------------------------------------------------------
revoke all on function public.orderbook_global_factor() from public, anon, authenticated;

comment on function public.orderbook_global_factor() is
  'The current all-time Einkauf factor: SUM(Ausgaben) / SUM(bekannter Marktwert) across every purchase (0059). Internal since 0103: no client role holds EXECUTE. The trigger and the seller functions that use it are security definer and reach it as their owner; a business needs seller_buy_in_factor().';


-- ---------------------------------------------------------------------------
-- 2. Die Tür für den Betrieb
--
-- Ein Wächter und ein Aufruf, sonst nichts. Kein zweiter Rechenweg.
-- ---------------------------------------------------------------------------
create or replace function public.seller_buy_in_factor()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_operate_active_seller()
              then public.orderbook_global_factor() end;
$$;

comment on function public.seller_buy_in_factor() is
  'The operation''s own all-time buy-in factor, for the business itself (0103). The same number orderbook_global_factor() has computed since 0059 — this only puts the seller gate in front of it, because at what fraction of market value a business buys is a trade secret and that function is called from a payment trigger and cannot carry the gate itself. NULL for anybody else, exactly as for a business with no purchases yet: refused and empty must look the same.';

revoke all on function public.seller_buy_in_factor() from public, anon;
grant execute on function public.seller_buy_in_factor() to authenticated;
