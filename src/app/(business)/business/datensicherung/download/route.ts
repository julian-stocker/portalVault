/**
 * Die Datensicherung als Datei (V1).
 *
 * EINE QUELLE. Das ganze Dokument kommt aus `seller_business_backup()`
 * (0104) — ein Statement, eine MVCC-Momentaufnahme, 25 Bereiche. Diese
 * Route fragt keine Tabelle selbst, transformiert nichts und erfindet
 * keinen Bereich. Sie ergänzt genau die zwei Metadaten, die eine Datenbank
 * nicht liefern kann, und reicht den Rest unverändert durch.
 *
 * MIT DER SITZUNG DES BENUTZERS, NICHT MIT SERVICE ROLE. `createClient()`
 * baut den Server-Client aus dem Cookie des Angemeldeten; die Datenbank
 * entscheidet über `can_operate_active_seller()`, wer Daten bekommt. Dieses
 * Deployment hält ohnehin keinen Service-Role-Schlüssel — `docs/DEPLOYMENT.md`
 * nennt das eine Regel, und sie bleibt es.
 *
 * `null` IST KEIN LEERES BACKUP. Genau so antwortet die Funktion einem
 * Konto ohne Betriebsrolle. Eine Datei mit `{"data":{}}` auszuliefern wäre
 * die schlimmste Antwort von allen: sie sähe aus wie eine Sicherung, in der
 * nichts drinsteht. Hier wird sie zu 404.
 *
 * WARUM 404 UND NICHT 403. Wie überall in diesem Projekt: unbekannt und
 * nicht-deins antworten gleich (ADR-0039). Ein 403 verriete, dass es hier
 * etwas zu holen gibt.
 *
 * NICHTS WIRD PROTOKOLLIERT. Kein Dokument, kein Ausschnitt, keine
 * Zeilenzahl, keine Kennung. Der Inhalt ist Lagerbestand, Einkaufspreise
 * und Käuferadressen; ein Serverlog ist kein Ort dafür. Auch die
 * Fehlerantworten tragen keine Geschäftsdaten.
 *
 * KEINE DATEI AUF DEM SERVER. Das Dokument entsteht im Speicher und geht
 * direkt in die Antwort. Nichts wird zwischengespeichert, nichts abgelegt.
 */
import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  backupFileName, projectRefFromUrl, withRouteMetadata, type BackupDocument,
} from "@/lib/backup/document";

/* Eine Sicherung ist immer die von jetzt. Nichts daran darf zwischengelagert
   werden — weder von Next noch von einem Zwischenspeicher unterwegs. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  /*
   * Erstes Schloss, in der Anwendung: erspart einer Kundschaft die Runde und
   * hält die Antwort hier eindeutig. Das entscheidende Schloss sitzt in der
   * Datenbank — ein direkter RPC-Aufruf geht an dieser Zeile vorbei, nicht
   * am Wächter.
   */
  if (!(await canOperateSeller())) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_business_backup");

  // Kein Grund und kein Detail nach außen: ein Fehlertext aus der Datenbank
  // kann einen Tabellennamen tragen.
  if (error) return failed();

  // `null` heißt: der Wächter hat abgelehnt. Niemals als leeres Backup lesen.
  if (data === null || typeof data !== "object" || Array.isArray(data)) return notFound();

  const document = withRouteMetadata(
    data as BackupDocument,
    projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
  );

  const body = JSON.stringify(document);
  const name = backupFileName(new Date());

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      /* Geschäftsdaten und Käuferadressen gehören in keinen gemeinsamen
         Zwischenspeicher — dieselbe Regel wie bei der Rechnung als PDF. */
      "Cache-Control": "private, no-store",
      /* Der Browser soll den Typ nehmen, den wir nennen, und nicht raten. */
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Unbekannt und nicht-deins antworten gleich. */
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** Ein Fehler ohne Inhalt: die Oberfläche sagt den Satz, nicht der Server. */
function failed(): Response {
  return new Response("Backup failed", { status: 500 });
}
