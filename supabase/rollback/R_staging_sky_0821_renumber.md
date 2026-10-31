# Rücknahme der Umnummerierung von `Gold Fire Kraken`

Zu `supabase/operations/staging-sky-0821-renumber.sql`. **Es gibt dafür keine
SQL-Datei, und das ist kein Versäumnis.**

## Vor dem `commit`

Nichts zu tun. Die Datei ist eine Transaktion; bricht ein Wächter oder eine
Nachbedingung ab, ist keine Zeile entstanden und keine gelöscht.

**Mit einer Ausnahme:** die gezogene SKY-ID. Sequenzen sind nicht
transaktional — `nextval` in Schritt 2 wird von einem `rollback` nicht
zurückgenommen. Nach einem Abbruch ist diese Nummer verbraucht, und der zweite
Lauf bekommt die nächste. Das ist richtig so (ADR-0001: eine SKY-ID wird nie
wiederverwendet) und der Grund, warum die Lauf- und die Prüfdatei nirgends
`SKY-0928` als Bedingung nennen.

## Nach dem `commit`

Dann ist eine Rücknahme **dieselbe Übung in der anderen Richtung** und kein
Rückbau:

1. Die neue Figur anlegen zu lassen hieß, eine Nummer zu ziehen. Sie wieder
   auf `SKY-0821` zu bringen, ist unmöglich — `skylanders_sky_id_immutable`
   (0001) weist jedes `update` auf `sky_id` ab, auch für die Service-Rolle.
2. Also: `admin_create_figure` erneut, **und es kommt eine dritte Nummer
   heraus**, nicht `SKY-0821`. Die alte Nummer ist auf Staging verbraucht; ihre
   Journalzeilen (`created`, `card_type`, `deleted`) stehen noch und sind
   genau der Beweis dafür.
3. `admin_delete_figure` auf die Nummer aus dem ersten Lauf.

Eine Rücknahme kostet also **eine weitere SKY-ID** und bringt `SKY-0821` nicht
zurück. Wer das nicht will, prüft vorher — dafür sind
`supabase/checks/sky_0821_renumber_preflight.sql` und die Wächter A1–A5 da.

## Was eine Rücknahme nicht berührt

* **Production.** Dort behält `SKY-0821` `Winterfest Lob-Star`; der Lauf fasst
  Production nicht an.
* **Storage.** `Gold Fire Kraken` hat kein Bild und keinen Override.
* **Das Journal.** Es wird nie zurückgenommen. Jeder Schritt bleibt lesbar.
* **Die Bereichssperre.** Sie liegt an der Sequenz und ist von der
  Umnummerierung unabhängig. Ihre Rücknahme ist
  `R_staging_sky_id_band.sql` — die aber **abbricht**, sobald im Band schon
  eine Nummer vergeben ist, also nach einer erfolgreichen Umnummerierung.
