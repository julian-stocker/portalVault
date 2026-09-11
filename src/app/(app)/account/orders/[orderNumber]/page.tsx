import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AccountHeader } from "@/components/account/account-header";
import { fetchMyOrder } from "@/lib/account/orders";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/lib/auth/redirect";
import { formatDate, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.account.orders.title };

type Detail = {
  order: Record<string, unknown>;
  address: Record<string, string | null> | null;
  lines: { sky_id: string; condition: string; name: string; quantity: number; line_total: string | number }[];
};

/**
 * One of the customer's own orders.
 *
 * `my_order()` matches on `user_id`, so somebody else's order number returns
 * null and this page is a 404 — an unknown order and one that is not yours
 * answer the same, exactly as `order_payment_state()` has since 0017.
 *
 * The address shown is the **snapshot** from `order_addresses`, never what
 * the account has saved today. Editing a saved default does not rewrite what
 * was agreed, and the page says so out loud.
 */
export default async function MyOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const profile = await currentProfile();
  if (!profile) redirect(SIGN_IN_PATH);
  if (!profile.username) redirect(ONBOARDING_PATH);

  const { orderNumber } = await params;
  const document = (await fetchMyOrder(orderNumber)) as Detail | null;
  if (!document?.order) notFound();

  const order = document.order as Record<string, string | number | boolean | null>;
  const copy = de.account.orders;
  const address = document.address;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-8 pb-10 md:pt-12">
      <AccountHeader title={String(order.order_number)} />

      {order.commerce_mode === "sandbox" ? (
        <p className="rounded-sky-md bg-accent/15 px-3 py-2 text-sm ring-1 ring-accent/40">
          {copy.testBadge} — {de.admin.commerce.sandboxOrderHint}
        </p>
      ) : null}

      <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted">{copy.placedAt}</dt>
        <dd>{formatDate(String(order.placed_at))}</dd>
        <dt className="text-muted">{copy.shippingMethod}</dt>
        <dd>{String(order.shipping_method ?? "–")}</dd>
        {order.tracking_number ? (
          <>
            <dt className="text-muted">{copy.tracking}</dt>
            <dd className="tabular-nums">{String(order.tracking_number)}</dd>
          </>
        ) : null}
        <dt className="text-muted">{copy.total}</dt>
        <dd className="font-semibold tabular-nums">{formatPrice(Number(order.total_amount))}</dd>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {copy.articles(document.lines.length)}
        </h2>
        <ul className="flex flex-col gap-2">
          {document.lines.map((line) => (
            <li
              key={`${line.sky_id}/${line.condition}`}
              className="flex items-baseline justify-between gap-4 rounded-sky-md bg-surface/80 px-4 py-3 text-sm ring-1 ring-border/70"
            >
              <span>
                {line.quantity} × {line.name}
                <span className="ml-2 text-muted">
                  {line.condition === "boxed" ? "OVP" : "Lose"}
                </span>
              </span>
              <span className="tabular-nums">{formatPrice(Number(line.line_total))}</span>
            </li>
          ))}
        </ul>
      </section>

      {address ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
            {copy.shippingAddress}
          </h2>
          <address className="text-sm not-italic">
            {[
              [address.first_name, address.last_name].filter(Boolean).join(" "),
              address.company,
              [address.street, address.house_number].filter(Boolean).join(" "),
              address.address_line_2,
              [address.postal_code, address.city].filter(Boolean).join(" "),
            ]
              .filter((part) => typeof part === "string" && part !== "")
              .map((part) => (
                <span key={String(part)} className="block">
                  {part}
                </span>
              ))}
          </address>
          {/* The one sentence that keeps the two tables apart in a reader's
              head: this is history, not a setting. */}
          <p className="text-xs text-muted">{copy.snapshotNote}</p>
        </section>
      ) : null}
    </main>
  );
}
