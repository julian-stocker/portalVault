/**
 * Ein Bestellstrang: was Menschen geschrieben haben und was passiert ist, in
 * einer Spalte.
 *
 * ALS UNTERHALTUNG GEZEICHNET, NICHT ALS PROTOKOLL. Die erste Fassung war
 * eine Liste mit Trennstrichen — inhaltlich richtig, aber sie las sich wie
 * ein Ereignisjournal, und niemand schreibt gern in ein Journal. Jetzt: eigene
 * Beiträge rechts, die Gegenseite links, Blasen bis 72 % der Breite, und der
 * Absender steht klein an der Blase statt in einer eigenen Spalte.
 *
 * SYSTEM UND MENSCH SEHEN VERSCHIEDEN AUS, WEIL SIE ES SIND. Eine Nachricht
 * ist eine Blase mit Seite; eine Systemmeldung eine schmale, mittige Zeile
 * ohne Absender und ohne Rahmen.
 *
 * ES SIND NUR NOCH ZWEI. Versand und Erstattung — die zwei Ereignisse, die
 * eine Frage beantworten, die sonst jemand stellen müsste. Der Kanal ist ein
 * Gespräch, keine Bestellhistorie; die steht unverändert im Ereignisjournal
 * und auf dem Bestellschirm. Damit fällt auch das gruppierte Update-Widget
 * weg: es löste ein Problem, das die kürzere Liste gar nicht erst erzeugt.
 *
 * SPRECHERWECHSEL IST ABSTAND. Zwei Beiträge derselben Seite rücken eng
 * zusammen und nur der letzte trägt die Fußzeile; wechselt die Seite, kommt
 * Luft dazwischen. Das ersetzt die Trennstriche — eine Unterhaltung gruppiert
 * sich von selbst, wenn man sie lässt.
 *
 * KEIN MARKUP, NIRGENDS. Menschlicher Text wird als Text gerendert — React
 * maskiert, und die HTML-Einfügung kommt in dieser Datei nicht vor. Der Text
 * eines Systemeintrags entsteht ohnehin aus einem Typ und zwei Zahlen.
 *
 * GELESEN WIRD BEIM ÖFFNEN, EINMAL. Der Wasserstand rückt vor, sobald der
 * Strang auf dem Bildschirm steht; die Markierung „Neu" bleibt für diesen
 * Aufruf trotzdem stehen, weil man sehen soll, was neu war.
 *
 * AN DER LOGIK ÄNDERT SICH NICHTS: dieselben RPCs, derselbe Lesestand,
 * dieselbe Grenze bei 2000 Zeichen.
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { markConversationRead, sendOrderMessage } from "@/lib/messages/actions";
import {
  MESSAGE_MAX, messageIsSendable, systemEventText,
  type Conversation, type ConversationItem,
} from "@/lib/messages/conversation";
import { de } from "@/lib/i18n/de";

const copy = de.messages;

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString(de.locale);
}

/** Kurz an der Blase, lang im Tooltip: „14:32" liest sich, das Datum steht daneben. */
function shortTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString(de.locale, { hour: "2-digit", minute: "2-digit" });
}

/** Die Marke an einem Eintrag, der seit dem letzten Öffnen dazugekommen ist. */
function NewMark() {
  return (
    <span className="rounded-full bg-own-subtle px-1.5 text-[10px] leading-4 font-medium text-own-ink ring-1 ring-own-line">
      {copy.newSince}
    </span>
  );
}

/**
 * Eine Systemmeldung: mittig, klein, ohne Absender und ohne Rahmen.
 *
 * Sie begleitet das Gespräch, sie führt es nicht — also kein Kasten, keine
 * Blase, keine Linie quer über den Chat. Nur Text und eine Uhrzeit, in
 * `text-muted`, zwischen zwei Beiträgen.
 */
function SystemLine({ item, gap }: { item: ConversationItem; gap: string }) {
  const text = systemEventText(item);
  /* Was nicht in den Kanal gehört, bekommt keinen erfundenen Satz. */
  if (text === null) return null;
  return (
    <li className={`flex justify-center ${gap}`}>
      <span
        className="inline-flex max-w-[90%] flex-wrap items-center justify-center gap-x-2 text-[11px] leading-4 text-muted"
        title={when(item.at)}
      >
        <span>{text}</span>
        <time dateTime={item.at} className="tabular-nums opacity-80">{shortTime(item.at)}</time>
        {item.unread ? <NewMark /> : null}
      </span>
    </li>
  );
}

/**
 * Eine Nachricht.
 *
 * `mine` entscheidet die Seite, `tail` ob die Fußzeile mitkommt: bei mehreren
 * Beiträgen hintereinander trägt sie nur der letzte, sonst stünde dreimal
 * derselbe Name untereinander.
 */
function MessageBubble({ item, mine, tail, gap }: {
  item: ConversationItem; mine: boolean; tail: boolean; gap: string;
}) {
  const who = mine
    ? copy.youLabel
    : item.authorKind === "seller" ? copy.sellerLabel : copy.customerLabel;
  return (
    <li className={`flex flex-col ${mine ? "items-end" : "items-start"} ${gap}`}>
      <div
        className={
          "max-w-[85%] px-3 py-2 text-sm sm:max-w-[72%] " +
          (mine
            ? "rounded-sky-md rounded-br-sm bg-surface-raised text-foreground ring-1 ring-border-strong"
            : "rounded-sky-md rounded-bl-sm bg-surface text-foreground ring-1 ring-border/70")
        }
        title={when(item.at)}
      >
        {/* Als Text, nie als Markup. */}
        <p className="whitespace-pre-wrap break-words">{item.body}</p>
      </div>
      {/*
        DIESELBE REIHENFOLGE AUF BEIDEN SEITEN: Absender, Trennpunkt, Uhrzeit.
        Die rechte Spalte war in der Leserichtung gedreht und las sich
        dadurch „15:13 Du" — dieselbe Zeile, zwei Grammatiken. Rechtsbündig
        wird die Fußzeile jetzt über die Ausrichtung der Spalte, nicht über
        eine umgedrehte Leserichtung.
      */}
      {tail ? (
        <p className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] leading-4 text-muted">
          <span>{who}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.at} className="tabular-nums">{shortTime(item.at)}</time>
          {item.unread ? <NewMark /> : null}
        </p>
      ) : null}
    </li>
  );
}

export function ConversationThread({ conversation }: { conversation: Conversation }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const marked = useRef(false);

  /*
   * Einmal je Aufruf. `markConversationRead` ist idempotent und monoton, aber
   * ein zweiter Aufruf wäre trotzdem eine Anfrage ohne Wirkung.
   */
  useEffect(() => {
    if (marked.current || conversation.unread === 0) return;
    marked.current = true;
    void markConversationRead(conversation.orderNumber);
  }, [conversation.orderNumber, conversation.unread]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!messageIsSendable(body)) {
      setError(body.trim() === "" ? copy.errors.empty : copy.errors.tooLong);
      return;
    }
    setPending(true);
    try {
      const result = await sendOrderMessage({
        orderNumber: conversation.orderNumber, body,
      });
      if (result.ok) setBody("");
      else setError(result.message);
    } finally {
      setPending(false);
    }
  }

  /* Der Zähler erscheint erst, wenn es eng wird — vorher ist er Möblierung. */
  const left = MESSAGE_MAX - body.trim().length;
  const tight = left <= 200;
  const items = conversation.items;

  return (
    <section className="mt-4 rounded-sky-md bg-surface/80 p-3 ring-1 ring-border/70 sm:p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
        {copy.threadHeading}
      </h2>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {items.map((item, index) => {
            const previous = items[index - 1];
            const next = items[index + 1];
            /*
             * ABSTAND ERZÄHLT DIE GLIEDERUNG, UND ZWAR FÜR BEIDE SORTEN.
             *
             * Nichts über dem ersten Eintrag. Zwei Systemmeldungen
             * hintereinander rücken eng zusammen — sie gehören zum selben
             * Vorgang und sollen nicht wie zwei Gesprächsbeiträge wirken.
             * Zwischen einem Systemblock und einer Nachricht steht die volle
             * Luft, ebenso beim Sprecherwechsel; zwei Beiträge derselben
             * Seite rücken wieder zusammen.
             */
            const sameKindAsPrevious = previous !== undefined
              && previous.kind === item.kind
              && (item.kind === "event" || previous.authorKind === item.authorKind);
            const gap = previous === undefined ? "" : sameKindAsPrevious ? "mt-0.5" : "mt-3";

            if (item.kind === "event") {
              return <SystemLine key={`e${item.id}`} item={item} gap={gap} />;
            }
            const mine = item.authorKind === conversation.role;
            /* Die Fußzeile trägt nur der letzte Beitrag einer Folge — sonst
               stünde dreimal derselbe Name untereinander. */
            const tail = next === undefined
              || next.kind !== "message"
              || next.authorKind !== item.authorKind;
            return (
              <MessageBubble key={`m${item.id}`} item={item} mine={mine} tail={tail} gap={gap} />
            );
          })}
        </ul>
      )}

      {conversation.writable ? (
        <form onSubmit={submit} className="mt-3 border-t border-border/40 pt-3">
          {/*
            Der Composer eines Messengers: Eingabe und Senden in einer Zeile.
            Das Feld wächst mit dem Text (`field-sizing`), der Knopf bleibt
            kompakt daneben statt über die ganze Breite zu laufen.
          */}
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{copy.placeholder}</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={copy.placeholder}
                rows={1}
                maxLength={MESSAGE_MAX}
                className="max-h-40 min-h-11 w-full resize-none rounded-sky-md bg-surface px-3 py-2.5 text-sm leading-5 ring-1 ring-border/70 focus-ring [field-sizing:content]"
              />
            </label>
            <button
              type="submit"
              disabled={pending || body.trim() === ""}
              className="min-h-11 shrink-0 rounded-sky-md bg-surface-raised px-4 text-sm font-medium ring-1 ring-border-strong transition-colors hover:bg-border/40 focus-ring disabled:opacity-50"
            >
              {pending ? copy.sending : copy.send}
            </button>
          </div>

          {tight ? (
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted">
              {copy.remaining(left)}
            </p>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>
          )}
        </form>
      ) : null}
    </section>
  );
}
