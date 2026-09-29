/**
 * Sofortiges Feedback für Aktionen, die dauern.
 *
 * DAS PROBLEM. Zwischen „geklickt" und „etwas passiert" lagen an mehreren
 * Stellen mehrere hundert Millisekunden bis Sekunden, in denen sich auf dem
 * Bildschirm nichts bewegte: der Weg in die Kasse, das Anlegen der
 * Bestellung, die Übergabe an Stripe, jede Anmeldung, jedes Geschäftsformular
 * mit Server Action. Wer nichts sieht, drückt noch einmal.
 *
 * EIN ORT, NICHT ZWANZIG. Vorher trug jede Stelle ihre eigene Variante —
 * meist nur ein getauschter Text, einmal ein nacktes „…". Hier stehen drei
 * Bausteine, die überall dasselbe bedeuten:
 *
 *   Spinner       das kleine Rad. Erbt `currentColor`, kennt keine Farbe.
 *   PendingButton ein Knopf, der während der Arbeit gesperrt ist, das Rad
 *                 zeigt und sagt, was gerade geschieht.
 *   PendingLink   ein Link, der erst dann etwas zeigt, wenn die Navigation
 *                 tatsächlich wartet — bei einer sofortigen passiert nichts.
 *   BusyOverlay   die ganze Seite, gedimmt und leicht unscharf, für den einen
 *                 Moment, in dem der Browser diese Seite verlässt.
 *
 * WARUM KEIN SYSTEMDIALOG. Das Overlay ist bewusst SkyIsles: dieselbe
 * Verdunkelung und derselbe 3-px-Blur wie beim Modal, dieselbe Fläche,
 * dieselben Radien. Der Hintergrund bleibt lesbar — es ist ein Zustand der
 * Seite, kein neuer Ort.
 *
 * BARRIEREFREIHEIT. Der sichtbare Text in einem gesperrten Knopf wird beim
 * Wechsel nicht vorgelesen, also trägt jeder Baustein zusätzlich eine
 * Live-Region, die von Anfang an im Dokument steht und nur ihren Inhalt
 * ändert — eine, die erst mit dem Text entsteht, meldet sich unzuverlässig.
 * Das Overlay bekommt keinen Fokus und fängt keinen: es ist ein Hinweis,
 * kein Dialog, und die Seite verschwindet gleich ohnehin.
 *
 * `prefers-reduced-motion`: das Rad steht dann still. Es bleibt sichtbar —
 * die Aussage steckt im Text und im gesperrten Knopf, nicht in der Drehung.
 */
"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

import { de } from "@/lib/i18n/de";

/**
 * Das Rad. Rein dekorativ — was geschieht, sagt der Text daneben.
 *
 * Ein Ring aus `currentColor` mit einer offenen Seite, damit die Drehung
 * überhaupt sichtbar ist. Keine eigene Farbe, keine eigene Größe außer der
 * Voreinstellung: so passt es in einen Amber-Knopf genauso wie in einen
 * neutralen.
 */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="spinner"
      className={
        `inline-block shrink-0 rounded-full border-2 border-current border-r-transparent ` +
        `motion-safe:animate-spin ${className}`
      }
    />
  );
}

/**
 * Die Live-Region, die den Zustand meldet.
 *
 * Immer im Dokument, auch im Ruhezustand leer. Genau deshalb funktioniert
 * sie: eine Region, die gleichzeitig mit ihrem Text entsteht, wird von
 * Screenreadern oft überhört.
 */
function PendingStatus({ label }: { label: string | null }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {label ?? ""}
    </span>
  );
}

type ButtonProps = ComponentProps<"button">;

/**
 * Ein Knopf, der seine Arbeit zeigt.
 *
 * `children` ist die Beschriftung im Ruhezustand, `pendingLabel` die während
 * der Arbeit. Fehlt sie, bleibt die Beschriftung stehen und nur das Rad kommt
 * dazu — besser als ein Knopf, der plötzlich etwas anderes heißt.
 *
 * Gesperrt wird immer: ein zweiter Druck auf „Zahlungspflichtig bestellen"
 * ist genau das, was dieses Bauteil verhindern soll. `aria-busy` sagt
 * zusätzlich, warum der Knopf nicht reagiert.
 */
export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps & { pending: boolean; pendingLabel?: string }) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={className}
    >
      {pending ? <Spinner /> : null}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
      <PendingStatus label={pending ? (pendingLabel ?? de.pending.working) : null} />
    </button>
  );
}

/**
 * Ein Link, der nur dann etwas zeigt, wenn es etwas zu zeigen gibt.
 *
 * `useLinkStatus` ist genau so lange `pending`, wie die Navigation
 * tatsächlich wartet. Eine vorgeladene Route wechselt sofort, und dann
 * erscheint hier nie etwas — kein Aufblitzen, kein Overlay für einen
 * Seitenwechsel, den niemand als Warten erlebt.
 *
 * Der Haken muss INNERHALB des `<Link>` aufgerufen werden, deshalb das
 * kleine Kind-Bauteil.
 */
export function PendingLink({
  href,
  pendingLabel,
  children,
  className,
  style,
  prefetch,
}: {
  href: string;
  pendingLabel?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} className={className} style={style} prefetch={prefetch}>
      <LinkPending pendingLabel={pendingLabel}>{children}</LinkPending>
    </Link>
  );
}

function LinkPending({
  pendingLabel,
  children,
}: {
  pendingLabel?: string;
  children: ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending ? <Spinner className="size-4 mr-2" /> : null}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
      <PendingStatus label={pending ? (pendingLabel ?? de.pending.loading) : null} />
    </>
  );
}

/**
 * Die ganze Seite wartet.
 *
 * Nur für den einen Fall, für den ein Knopf zu klein ist: der Browser
 * verlässt diese Seite gleich und geht zu Stripe. Bis dahin soll niemand
 * weiterklicken, und niemand soll glauben, der Druck sei ins Leere gegangen.
 *
 * Kein `role="dialog"`, kein `aria-modal`, kein Fokusfang: es gibt nichts zu
 * bedienen. Die Fläche schluckt Klicks — das ist ihr eigentlicher Zweck neben
 * dem Hinweis.
 */
export function BusyOverlay({
  show,
  label,
  hint,
}: {
  show: boolean;
  label: string;
  hint?: string;
}) {
  if (!show) return null;

  return (
    <div
      data-testid="busy-overlay"
      role="status"
      aria-live="polite"
      className={
        "fixed inset-0 z-50 flex items-center justify-center p-5 " +
        /* Dieselbe Verdunkelung und derselbe Blur wie beim Modal, nur etwas
           heller: der Hintergrund soll erkennbar bleiben, weil er gleich
           wieder da ist, falls die Übergabe scheitert. */
        "bg-[oklch(10%_0.03_280_/_0.62)] backdrop-blur-[3px] " +
        "motion-safe:animate-[fade-in_120ms_ease-out]"
      }
    >
      <div
        className={
          "flex max-w-xs flex-col items-center gap-3 rounded-sky-lg bg-surface px-6 py-5 " +
          "text-center shadow-card ring-1 ring-border-strong"
        }
      >
        <Spinner className="size-6" />
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
