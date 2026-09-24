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

export function AttentionBadge({ count, label }: { count: number; label?: string }) {
  return (
    <span
      className={
        "ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 " +
        "bg-danger/20 text-[11px] leading-4 font-semibold text-danger tabular-nums " +
        "ring-1 ring-danger/60"
      }
    >
      {/* Über 99 wird die Zahl zur Aussage „viele" — die Marke bleibt rund. */}
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label ?? de.admin.orders.badgeLabel(count)}</span>
    </span>
  );
}
