/**
 * „Neu" an einem Listeneintrag — dieselbe Marke für beide Rollen (0099).
 *
 * Eine eigene Datei aus demselben Grund wie `AttentionBadge`: Käufer- und
 * Betriebsliste sollen nicht zweimal dasselbe abschreiben und dann
 * auseinanderlaufen.
 *
 * SIE SAGT NICHTS ÜBER DEN STATUS. „Neu" heißt ausschließlich: seit deinem
 * letzten Blick ist an dieser Bestellung etwas passiert. Ob sie bezahlt,
 * offen oder versendet ist, steht daneben und wird von dieser Marke nicht
 * berührt — sie verschwindet beim Öffnen, der Status bleibt.
 */
import { de } from "@/lib/i18n/de";

export function NewChip({ count }: {
  /** Wie viele ungesehene Ereignisse. Unter 1 wird nichts gezeichnet. */
  count: number;
}) {
  if (count < 1) return null;
  return (
    <span
      className="ml-2 rounded-sky-sm bg-own-subtle px-1.5 py-0.5 align-middle text-[0.65rem] font-medium tracking-wide text-own-ink ring-1 ring-own-line"
      /* Die Zahl gehört in den vorgelesenen Satz: eine Marke allein ist für
         jemanden, der sie nicht sieht, gar nichts. */
      aria-label={de.attention.newLabel(count)}
    >
      {de.attention.new}
    </span>
  );
}
