/**
 * „Trigger Happy ist wieder verfügbar!" — die Meldungen auf der Wunschliste
 * (Phase 4 S4, `0149`).
 *
 * WO SIE SITZT. Als `heading`-Teil in `CatalogView`, also INNERHALB des
 * Blocks, den die Weltkulisse hinterlegt — dieselbe Stelle und dieselbe
 * Breitenbegrenzung wie `FavoritesHeading` darüber (dieselbe Begründung:
 * ADR-0038, V3.3). Als Markup in der Seite stünde sie auf eigenem Grund und
 * schnitte ein Rechteck in die Kulisse.
 *
 * WARUM SIE EINE CLIENT-KOMPONENTE IST. Nur wegen des einen Knopfs: „als
 * gesehen markieren" ist eine Serveraktion mit `useTransition`, damit der
 * Knopf während der Arbeit gesperrt ist und etwas sagt. Alles andere ist
 * fertig berechnet und kommt als Prop — insbesondere `stillBuyable`, das auf
 * dem Server aus `hasV1BuyableOffer()` stammt. Hier wird keine zweite
 * Definition von „kaufbar" gebildet.
 *
 * DIE ANZEIGE MARKIERT NICHTS. Es gibt in dieser Datei genau einen Weg zu
 * `markNoticesRead()`, und der hängt an einem `onClick`. Kein `useEffect`,
 * kein Aufruf beim Einblenden, kein Markieren beim Klick auf den Weg zur
 * Figur — wer das Angebot ansieht, hat die Meldung gelesen, aber das zu
 * unterstellen wäre eine Markierung ohne Handlung (Auftrag S4, Punkt 5).
 *
 * GELESENE BLEIBEN STEHEN, nur ruhiger: kein Korallrand, gedämpfte Schrift,
 * kein Knopf. „Gesehen" heißt „ich weiß es", nicht „weg damit" — und eine
 * Karte, die beim Klick verschwindet, nimmt den Weg zum Angebot mit.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Spinner } from "@/components/ui/pending";
import { markNoticesRead } from "@/lib/favorites/notification-actions";
import { formatDate, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** Was eine Karte zeigt. Alles fertig berechnet, nichts davon abgeleitet. */
export type NoticeView = {
  skyId: string;
  /** Der abgeleitete Anzeigename, aus derselben Maschine wie die Karte (ADR-0030). */
  name: string;
  /** Navigation. Niemals Identität (ADR-0011). */
  slug: string;
  /** Aus `imageSrc()`. `null` ist ein echter Zustand und keine Panne (ADR-0009). */
  picture: string | null;
  /** Der GEMELDETE Preis in Cent — der von damals, nicht der von heute. */
  cheapestCents: number;
  createdAt: string;
  /** `true`, sobald der Nutzer sie als gesehen markiert hat. */
  read: boolean;
  /**
   * Ob die Figur JETZT noch ein kaufbares Angebot hat.
   *
   * Vom Server aus `hasV1BuyableOffer()` — derselben Funktion, die die
   * Angebotszeile jeder Karte benutzt. Sagt sie `false`, nennt die Karte das
   * ausdrücklich und verspricht keine Kaufbarkeit, die es nicht mehr gibt.
   */
  stillBuyable: boolean;
};

/** Ein kleines Herz als Marke des Abschnitts — dasselbe wie im leeren Zustand. */
function HeartMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
    >
      <path d="M12 20.5s-7.5-4.6-7.5-10.1a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1C19.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

/** Eine Karte. Bild, eine Zeile Meldung, eine Zeile Beiwerk, ein Weg. */
function NoticeCard({
  notice,
  onMarkRead,
  busy,
}: {
  notice: NoticeView;
  onMarkRead: (skyId: string) => void;
  busy: boolean;
}) {
  const { read } = notice;

  return (
    <li
      className={
        "flex items-start gap-3 rounded-sky-md px-3 py-3 backdrop-blur-sm sm:gap-4 sm:px-4 "
        + (read
          /* Gesehen: derselbe Stein, nur stiller. Kein Rand, der ruft. */
          ? "bg-deep/50 ring-1 ring-border-strong/40"
          /* Neu: Korall, wie das gefüllte Herz — die Farbe dieser Funktion. */
          : "bg-deep/75 ring-1 ring-favorite-ink/45")
      }
    >
      {/*
        * DAS BILD, 56 px und quadratisch.
        *
        * Die Groesse steht am UMSCHLAG, nicht am `<img>`: so ist der Platz
        * reserviert, auch bevor das Bild da ist oder wenn es fehlt, und die
        * Zeile springt beim Laden nicht. `object-contain`, weil eine Figur
        * freigestellt ist und ein Beschnitt ihr den Kopf nimmt. `alt=""`,
        * weil der Name gleich daneben steht — eine Vorlesesoftware soll ihn
        * nicht zweimal sagen.
        */}
      <div
        className={
          "relative h-14 w-14 shrink-0 overflow-hidden rounded-sky-sm "
          + "bg-deep/60 ring-1 ring-border-strong/40"
        }
      >
        {notice.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={notice.picture}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-contain p-1 ${read ? "opacity-70" : ""}`}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={
            "text-sm leading-snug font-semibold text-balance "
            + (read ? "text-on-deep-muted" : "text-on-deep")
          }
        >
          {de.favorites.noticeHeadline(notice.name)}
        </p>

        {/*
          * EINE ZEILE BEIWERK, und sie wird knapp gehalten: Datum, der
          * gemeldete Preis, und — nur wenn nötig — der Hinweis, dass das
          * Angebot weg ist. `flex-wrap`, damit auf 360 px umgebrochen und
          * nicht abgeschnitten wird.
          */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-on-deep-muted">
          <span>{de.favorites.noticeWhen(formatDate(notice.createdAt))}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {de.favorites.noticePriceThen(formatPrice(notice.cheapestCents / 100))}
          </span>
          {notice.stillBuyable ? null : (
            <>
              <span aria-hidden="true">·</span>
              {/* Kein Rot: vergriffen ist kein Fehler, sondern der Lauf der
                  Dinge. Es steht nur da, damit die Karte nichts verspricht. */}
              <span className="font-medium text-on-deep">{de.favorites.noticeGone}</span>
            </>
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {/*
            * EIN WEG, UND ER FÜHRT IMMER AUF DIE FIGURENSEITE. Dort steht das
            * aktuelle Angebot, wenn es eines gibt, und sonst der Marktpreis —
            * also in beiden Fällen die Wahrheit von jetzt. Nur die
            * Beschriftung unterscheidet, was zu erwarten ist.
            */}
          <Link
            href={`/skylanders/${notice.slug}`}
            /*
             * NICHT VORGELADEN, wie jeder Weg auf eine Figurenseite in
             * diesem Projekt: es sind bis zu 24 Karten, und 24 vorgeladene
             * Detailseiten waeren 24 Anfragen fuer hoechstens einen Klick.
             */
            prefetch={false}
            /*
             * NICHT `ACTION_LINK`: der traegt `text-on-card-*`, und das sind
             * die Farben einer KARTENFLAECHE. Diese Karte liegt auf der
             * Weltkulisse, also dieselben `on-deep`-Farben wie der Knopf
             * daneben — sonst stehen zwei Handlungen in einer Zeile und
             * sehen aus wie zwei verschiedene Dinge.
             */
            className={
              "inline-flex min-h-10 items-center gap-1 -mx-1 px-1 text-xs font-semibold "
              + "focus-ring text-favorite-ink underline underline-offset-2 "
              + "hover:text-on-deep"
            }
            aria-label={`${notice.name} — ${
              notice.stillBuyable ? de.favorites.noticeToOffer : de.favorites.noticeToFigure
            }`}
          >
            {notice.stillBuyable ? de.favorites.noticeToOffer : de.favorites.noticeToFigure}
          </Link>

          {read ? (
            <span className="inline-flex items-center gap-1 text-xs text-on-deep-muted">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
              {de.favorites.noticeRead}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onMarkRead(notice.skyId)}
              disabled={busy}
              aria-busy={busy || undefined}
              aria-label={de.favorites.noticeMarkReadLabel(notice.name)}
              className={
                "inline-flex min-h-10 items-center gap-1 -mx-1 px-1 text-xs font-medium "
                + "focus-ring text-on-deep-muted underline underline-offset-2 "
                + "hover:text-on-deep disabled:opacity-60"
              }
            >
              {busy ? <Spinner /> : null}
              {de.favorites.noticeMarkRead}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function AvailabilityNotices({ notices }: { notices: readonly NoticeView[] }) {
  const [pending, startTransition] = useTransition();
  /** Welche Karte gerade arbeitet — `null` heißt „alle" am Kopf. */
  const [working, setWorking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /* Nichts zu melden heißt: kein Abschnitt. Keine leere Überschrift, keine
     Kachel mit einer Null — dieselbe Regel wie beim leeren Kennzahlenblock. */
  if (notices.length === 0) return null;

  const unread = notices.filter((n) => !n.read).length;

  function mark(skyIds: readonly string[] | undefined, marke: string | null) {
    setFailed(false);
    setWorking(marke);
    startTransition(async () => {
      /*
       * `finally`, UND ZWAR WEGEN DES EINEN FALLS, DER NICHT ZURUECKKOMMT.
       * `markNoticesRead()` gibt bei einem Fehler `{ ok: false }` zurueck
       * statt zu werfen — aber eine abgerissene Verbindung laesst den Aufruf
       * selbst scheitern. Ohne `finally` blieben dann der Knopf gesperrt und
       * das Rad am Drehen, und der Nutzer saehe eine Seite, die arbeitet und
       * nichts tut.
       */
      try {
        const r = await markNoticesRead(skyIds);
        if (!r.ok) setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        setWorking(null);
      }
    });
  }

  return (
    <section
      aria-label={de.favorites.noticesTitle}
      className="mt-5 rounded-sky-lg bg-deep/60 p-3 ring-1 ring-border-strong/60 backdrop-blur-sm sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-on-deep sm:text-base">
          <HeartMark className="h-4 w-4 shrink-0 text-favorite-ink" />
          {de.favorites.noticesTitle}
        </h2>

        {/* „Alle als gesehen" nur, wenn es ungelesene gibt — sonst wäre es
            ein Knopf, der nichts tut. */}
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => mark(undefined, null)}
            disabled={pending}
            aria-busy={pending && working === null ? true : undefined}
            className={
              "inline-flex min-h-10 items-center gap-1 -mx-1 px-1 text-xs font-medium "
              + "focus-ring text-on-deep-muted underline underline-offset-2 "
              + "hover:text-on-deep disabled:opacity-60"
            }
          >
            {pending && working === null ? <Spinner /> : null}
            {pending && working === null
              ? de.favorites.noticesMarkingRead
              : de.favorites.noticesMarkAllRead}
          </button>
        ) : null}
      </div>

      <p className="mt-0.5 text-xs text-on-deep-muted">
        {de.favorites.noticesSubline(unread)}
      </p>

      {failed ? (
        <p role="status" className="mt-2 text-xs font-medium text-danger">
          {de.favorites.noticeMarkFailed}
        </p>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2">
        {notices.map((n) => (
          <NoticeCard
            key={`${n.skyId}-${n.createdAt}`}
            notice={n}
            onMarkRead={(skyId) => mark([skyId], skyId)}
            busy={pending && (working === n.skyId || working === null)}
          />
        ))}
      </ul>
    </section>
  );
}
