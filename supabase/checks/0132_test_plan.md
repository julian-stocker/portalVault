# Testplan `0132` — was die lesenden Prüfdateien nicht zeigen können

`0132_preflight.sql` und `0132_postflight.sql` prüfen den **Zustand**: welche
Bedingung im Funktionsrumpf steht, welche Rechte gelten, ob die Bestandszahlen
gleich geblieben sind. Dieser Plan prüft die **Vorgänge** — und jeder Schritt
hier verlangt einen Schreibvorgang.

**Warum nicht im SQL-Editor.** Jede dieser Funktionen beginnt mit
`can_operate_active_seller()`. Im SQL-Editor ist `auth.uid()` NULL, es gibt
also keinen Bediener, und jeder Aufruf endete mit „seller operator role
required" — das prüfte die Rollenregel, nicht die Sache. Die Fälle laufen
deshalb über die Oberfläche, wie die Schreibfälle zu `0128` auch.

**Wie.** Lokal gegen Staging: `npm run dev:staging`, anmelden als Betrieb. Die
neue Oberfläche muss dafür **nicht** deployt sein. **Nur Staging.**

> **Stand 2026-10-18: noch nicht durchführbar.** `0132` wurde versehentlich auf
> Production angewendet und ist auf Staging **nicht** vorhanden — ohne sie lehnt
> `seller_remove_purchase_item` jede Zeile eines importierten Einkaufs ab, und
> die Fälle H1–H3 prüfen genau das Gegenteil. Reihenfolge und Freigaben:
> `supabase/checks/0132_staging_plan.md`. **Auf Production dürfen diese Fälle
> nicht laufen** — H4 und H5 legen Positionen an und buchen sie ein.


## Vorbedingung

`0132_preflight.sql` gelaufen (`9999 = 0`, Prüfung 402 = `true`: der Riegel
fehlt noch) · `0132` angewendet · `0132_postflight.sql` gelaufen
(`9999 = 0`, Prüfung 402 = `true`: der Riegel ist da).

Vorher notieren, aus dem Preflight: **201–205** (Arbeitsmappe), **301–304**
(Bestand, Belege), **404–406** (Zahlung).

---

## H1 — ein historischer Einkauf lässt sich öffnen und bearbeiten

Einen Einkauf mit Herkunft `excel_order_2026` im Orderbuch öffnen, (i)-Fenster.

**Erwartet:** der Knopf **Bearbeiten** ist da. Im Bearbeitungsmodus stehen
Datum, Plattform, Verkäufer, Zahlungsart, Referenz und Notiz als Felder.

## H2 — Verkäufer- und Absenderanschrift nachtragen

Im Absenderabschnitt Name, Straße, PLZ, Ort, Land eintragen. Speichern.

**Erwartet:** gespeichert, Fenster im Lesemodus, Werte stehen da. **Keine**
Lagerbewegung, **keine** Änderung an Positionen, **kein** Beleg.
Gegenprobe: `select count(*) from public.inventory_movements` vor und nach —
gleiche Zahl.

## H3 — Inserat und Vereinbarung ergänzen

Titel, URL (mit `https://`), Details und Vereinbarung eintragen. Speichern.

**Erwartet:** gespeichert. Eine URL ohne `https://` wird **vor** dem Senden
abgelehnt, mit Satz.

## H4 — fehlende Figur hinzufügen

Im Bearbeitungsmodus über die Figurensuche eine Figur wählen, speichern.

**Erwartet:** die Zeile erscheint als reguläre Position des Einkaufs, Zustand
**nicht** `reconciled_legacy`, **nicht** eingebucht, ohne Lagerbewegung. Die
bezahlte Summe ist unverändert.

## H5 — die neue Figur einbuchen, genau einmal

Bei der neuen Zeile „Einbuchen".

**Erwartet:** Zustand `booked`, eine Lagerbewegung `+1`, Bestand der Figur
um **genau eins** höher. Ein zweiter Klick legt **keine** zweite Bewegung an
(`seller_book_purchase_item` gibt die bestehende zurück).
Gegenprobe: `select count(*) from public.inventory_movements` — genau **+1**
gegenüber H4.

## H6 — die nachgetragene Figur wieder entfernen

Eine **zweite** Figur hinzufügen, speichern, und sie **ohne** Einbuchen wieder
entfernen.

**Erwartet:** entfernt. (Das ist der Fall, den `0132` Teil 1 öffnet — vorher
lehnte der Server mit „legacy workbook" ab.)

## H7 — eine ursprüngliche Excel-Position bleibt geschützt

Bei einer importierten Zeile (`reconciled_legacy`) den Papierkorb suchen.

**Erwartet:** **kein** Papierkorb, stattdessen der Hinweis „Aus der
Arbeitsmappe — änderbar, aber nicht entfernbar". Und serverseitig: gäbe es
einen Weg, ihn doch aufzurufen, lehnt der Server mit „Diese Position stammt
aus der Excel-Historie und wird nicht gelöscht." ab.

## H8 — ihre Figur darf trotzdem korrigiert werden

Bei derselben importierten Zeile „Zuordnung ändern" / Figurenwechsel.

**Erwartet:** funktioniert. Das ist der Zweck von `0054` und bleibt.

## H9 — eine importierte Position wird nicht erneut eingebucht

Bei einer `reconciled_legacy`-Zeile „Einbuchen" suchen.

**Erwartet:** **nicht angeboten**. Serverseitig: „Historische Einkäufe sind
bereits im Bestand berücksichtigt und werden nicht erneut eingebucht."

## H10 — die bezahlte Summe ist unveränderlich

Im Bearbeitungsmodus die **Aufteilung** so ändern, dass sie eine **andere**
Summe ergibt (z. B. Figurenpreis um 1,00 € erhöhen). Speichern.

**Erwartet:** schon beim Tippen erscheint „Die Aufteilung ergibt X, bezahlt
wurden Y…", und das Speichern wird **nicht** ausgeführt. Die Oberfläche
schickt die Summe bei einem importierten Einkauf gar nicht mit.

**Und serverseitig — das ist die verbindliche Prüfung.** Im SQL-Editor, in
einer Klammer, die zurückrollt:

```sql
begin;
  do $$
  declare v_id bigint;
  begin
    select p.id into v_id from public.purchases p
     where p.source <> 'manual' order by p.id limit 1;
    begin
      update public.purchases set total_cost = total_cost + 1 where id = v_id;
      raise notice 'HINWEIS: ein DIREKTES update als postgres geht — die Sperre '
        'liegt in seller_update_purchase, nicht als CHECK auf der Tabelle';
    exception when others then
      raise notice 'direktes update abgelehnt: %', sqlerrm;
    end;
  end $$;
rollback;
```

**Erwartet:** der Hinweis. Die Sperre sitzt in der **Funktion**, die die
Oberfläche benutzt — nicht als Tabellenzwang. Ein Betreiber mit
`postgres`-Rechten im SQL-Editor kann die Summe weiterhin ändern; das ist
Absicht (sonst wäre eine Korrektur eines echten Erfassungsfehlers unmöglich)
und steht so in ADR-0126.

## H11 — die Aufteilung lässt sich ergänzen, ohne die Summe zu ändern

Bei einem importierten Einkauf **ohne** Aufteilung: Figurenpreis, Versand und
Käuferschutz so eintragen, dass sie **genau** die bezahlte Summe ergeben.
Speichern.

**Erwartet:** gespeichert. `total_cost` unverändert, die drei Teile gesetzt.
Gegenprobe: Prüfung 404 des Postflights bleibt 0, Prüfung 406 (Summe aller
`total_cost`) ist **unverändert**.

## H12 — die Belegausstellung bleibt zu

Im (i)-Fenster den Belegabschnitt ansehen.

**Erwartet:** **kein** Ausstellknopf, stattdessen „Eigenbelege sind noch nicht
freigegeben…". Danach `receipt_lock_check.sql` — `9999 = 0`.

---

## Nach dem Durchlauf

`0132_postflight.sql` erneut, und die Zahlen gegen die Notizen von vorher:

| | erwartet |
|---|---|
| 201 / 203 | weiterhin **0** |
| 202 | Messung ohne Sollwert: die Zustände der importierten Zeilen. `ordered=109` ist der von `0067` gewollte Stand und keine Abweichung |
| 204 | **unverändert** (H4/H6 hängen an importierten Einkäufen, H6 nimmt zurück, was H4 anlegte — bleibt eine Zeile aus H4/H5 stehen, ist 204 um genau die höher) |
| 301 / 302 | Lagerzeilen und Bewegungen um **genau die Buchung aus H5** höher |
| 303 | **0** — die Lagerbilanz stimmt in der Richtung: keine Position hat einen negativen Eröffnungsbestand |
| 307 | **unverändert** gegenüber dem Preflight — H5 bucht über `apply_inventory_movement`, und das schreibt Menge und Journalzeile zusammen; der Eröffnungsbestand aus dem Cutover vom 2026-09-21 bewegt sich dabei nicht |
| 304 | **unverändert** — kein Beleg entstanden |
| 404 | **0** |
| 406 | **unverändert** — keine bezahlte Summe hat sich bewegt |

Die Testzeilen aus H4/H5 dürfen auf Staging stehen bleiben; sie sind
reguläre Positionen. Wer aufräumen will, nimmt die Buchung zurück und
entfernt die Zeile (H6).
