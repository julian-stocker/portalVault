/**
 * The shop's two order lists, side by side (ADR-0084).
 *
 * `Bestellungen` is live only — real customers, real money, the seller's
 * actual work. `Testbestellungen` is sandbox only. They were one list with a
 * badge until 0046, which meant a morning of checkout testing sat in the
 * middle of the list used to find work, and counted toward its month totals.
 *
 * A server component with two links: the current list is in the URL, so it
 * survives a reload and the back button.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";

export function OrderTabs({ current }: { current: "live" | "test" }) {
  const copy = de.business.testOrders;
  const tab = (active: boolean) =>
    active
      ? "font-semibold underline underline-offset-4"
      : "text-muted hover:text-foreground";

  return (
    <nav className="mt-3 flex gap-4 text-sm" aria-label={de.admin.orders.title}>
      <Link href="/business/orders" className={tab(current === "live")}>
        {copy.liveTab}
      </Link>
      <Link href="/business/orders/test" className={tab(current === "test")}>
        {copy.tab}
      </Link>
    </nav>
  );
}
