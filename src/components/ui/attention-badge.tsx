/**
 * Die Zahl, die sagt: hier wartet etwas.
 *
 * Eine Marke, zwei Orte — bis hierher stand sie nur in `site-nav.tsx` und
 * hätte für die Kontoseite abgeschrieben werden müssen. Zwei Kopien derselben
 * Marke driften auseinander, und die Zahl am Kopf und die Zahl auf der Kachel
 * sollen dieselbe Sache bleiben.
 *
 * Der vorgelesene Text ist ein Parameter, weil er nicht überall dasselbe
 * bedeutet: „drei Bestellungen brauchen Aufmerksamkeit" ist etwas anderes als
 * „drei ungelesene Nachrichten". Der Standard bleibt, was er war.
 */
import { de } from "@/lib/i18n/de";

/**
 * Welche Art Wartendes das ist.
 *
 * `attention` ist die bisherige Marke und bleibt Rot: eine gekennzeichnete
 * Bestellung ist bezahlt, hat nichts gebucht und kann nicht versandt werden —
 * da ist etwas kaputt, und Rot ist dafuer richtig.
 *
 * `favorite` ist Korall, wie das gefuellte Herz, und sagt etwas ganz anderes:
 * eine vorgemerkte Figur ist wieder zu haben. Das ist eine GUTE Nachricht,
 * und sie in der Farbe eines Zwischenfalls zu zeigen hiesse, dem Nutzer einen
 * Schrecken fuer ein Geschenk zu verkaufen. Deshalb auch leiser: ein
 * hauchfeiner Ring statt eines deutlichen (Auftrag S4: „ein dezenter Badge").
 */
export type BadgeTone = "attention" | "favorite";

const TONES: Record<BadgeTone, string> = {
  attention: "bg-danger/20 text-danger ring-danger/60",
  favorite: "bg-favorite-ink/15 text-favorite-ink ring-favorite-ink/45",
};

export function AttentionBadge({
  count,
  label,
  tone = "attention",
}: {
  count: number;
  label?: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={
        "ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 " +
        "text-[11px] leading-4 font-semibold tabular-nums ring-1 " +
        TONES[tone]
      }
    >
      {/* Über 99 wird die Zahl zur Aussage „viele" — die Marke bleibt rund. */}
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label ?? de.admin.orders.badgeLabel(count)}</span>
    </span>
  );
}
