/**
 * The checkout form (B1).
 *
 * Everything on this screen is either a question for the customer or a number
 * the server produced. It computes no price of its own: the line totals come
 * from `resolveCart` against the server's offers, exactly as /cart already
 * shows them, and the shipping figures come from `shipping_quote()`. The
 * amounts that end up on the order are decided again by `create_order()` from
 * values it reads itself — so what is displayed here can never become what is
 * charged by being tampered with.
 *
 * NO RESERVATION UNTIL SUBMIT
 *
 * Opening this page holds nothing. Prices are re-read, availability re-checked
 * and stock held only when somebody actually submits, in one transaction.
 *
 * NO PAYMENT, AND THE SCREEN SAYS SO
 *
 * The button reads "Bestellung anlegen", not "Zahlungspflichtig bestellen".
 * That wording is the legally required label for the moment a payment
 * obligation arises, and B1 has no payment — using it here would train the
 * wrong expectation and be wrong if anybody ever saw it. It moves to the
 * submit button in B2, where it belongs.
 */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useCart } from "@/components/cart/use-cart";
import { newCheckoutCredentials, type CheckoutCredentials } from "@/lib/commerce/capability";
import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { cartTotal, keyOf, resolveCart } from "@/lib/cart/cart";
import { placeOrder, shippingOptions, type PlacedOrder } from "@/lib/commerce/actions";
import { conditionLabel } from "@/components/shop/shop-action";
import {
  DEFAULT_SHIPPING_METHOD,
  DELIVERY_COUNTRY,
  type ShippingMethod,
  type ShippingOption,
} from "@/lib/commerce/shipping";
import type { DraftAddress, DraftProblem } from "@/lib/commerce/order";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { offerIndex, type Offer } from "@/lib/shop/offer";

const PANEL = "rounded-sky-lg bg-deep/90 p-4 ring-1 ring-gold-line backdrop-blur-sm";
const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface-raised px-3 text-sm ring-1 ring-border-strong " +
  "focus:ring-accent";
const LABEL = "mb-1 block text-xs font-medium text-on-deep-muted";

type Fields = DraftAddress & { email: string };

const EMPTY: Fields = {
  email: "",
  firstName: "",
  lastName: "",
  company: "",
  street: "",
  houseNumber: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  countryCode: DELIVERY_COUNTRY,
  phone: "",
};

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  className = "",
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  className?: string;
  inputMode?: "text" | "numeric" | "email";
}) {
  return (
    <div className={className}>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={FIELD}
      />
    </div>
  );
}

export function CheckoutView({
  offers,
  email,
}: {
  offers: Readonly<Record<string, readonly Offer[]>>;
  email: string;
}) {
  const { cart, ready, clear } = useCart();
  const [fields, setFields] = useState<Fields>({ ...EMPTY, email });
  const [method, setMethod] = useState<ShippingMethod>(DEFAULT_SHIPPING_METHOD);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [pending, setPending] = useState(false);
  // Checked and set before the first await, so two taps in one frame cannot
  // both get past it — the same guard `useAddToCart` uses.
  const busy = useRef(false);

  /*
   * One request id and one payment capability for this whole checkout
   * attempt, generated in the browser and kept stable across retries.
   *
   * Stable is the point. A fresh request id on a retry would create a second
   * order and hold a second lot of stock; a fresh capability would fail to
   * prove ownership of the first. Held in a ref rather than state so a
   * re-render cannot mint new ones.
   *
   * They live in memory only. A reload loses them, and the order that was
   * already placed simply expires with its reservation — acceptable while
   * there is no payment step. Surviving a reload is part of the guest order
   * access that comes with the confirmation mail, not of this phase.
   */
  const credentials = useRef<CheckoutCredentials | null>(null);
  if (credentials.current === null) credentials.current = newCheckoutCredentials();

  const entries = resolveCart(cart, offerIndex(offers));
  const purchasable = entries.filter((entry) => entry.purchasable);
  const subtotal = cartTotal(entries);

  // The shipping prices come from the server, for this basket. One call: the
  // basket does not change while the page is open.
  useEffect(() => {
    if (placed) return;
    let live = true;
    void shippingOptions(subtotal).then((quoted) => {
      if (live) setOptions(quoted);
    });
    return () => {
      live = false;
    };
  }, [subtotal, placed]);

  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setProblems([]);

    try {
      const { email: contact, ...address } = fields;
      const result = await placeOrder(
        {
          email: contact,
          address,
          shippingMethod: method,
          items: purchasable.map((entry) => ({
            skyId: entry.line.skyId,
            condition: entry.line.condition,
            quantity: entry.line.quantity,
          })),
        },
        credentials.current!,
      );

      if (result.ok) {
        // The order and its reservation are real now, so the basket has done
        // its job. Keeping it would invite the same stock to be reserved
        // twice by the same person.
        setPlaced(result.order);
        clear();
        return;
      }

      if (result.reason === "invalid") setProblems(result.problems);
      setError(
        result.reason === "invalid"
          ? de.checkout.errorInvalid
          : result.reason === "unavailable"
            ? de.checkout.errorUnavailable
            : result.reason === "too_many_checkouts"
              ? de.checkout.errorThrottled
              : de.checkout.errorFailed,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  // ------------------------------------------------------------- after order
  if (placed) {
    return (
      <div className={`${PANEL} flex flex-col gap-4`}>
        <h2 className="text-lg font-semibold">{de.checkout.successTitle}</h2>
        <p className="text-sm text-on-deep-muted">{de.checkout.successHint}</p>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-on-deep-muted">{de.checkout.successNumber}</dt>
            <dd className="font-semibold tabular-nums">{placed.orderNumber}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-on-deep-muted">{de.checkout.shipping}</dt>
            <dd className="tabular-nums">
              {options.find((o) => o.code === method)?.name ?? method}
              {" · "}
              {placed.shippingAmount === 0
                ? de.checkout.shippingFree
                : formatPrice(placed.shippingAmount)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-gold-line pt-2">
            <dt className="font-medium">{de.checkout.total}</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatPrice(placed.totalAmount)}</dd>
          </div>
        </dl>

        <p className="text-xs text-on-deep-muted">
          {fields.firstName} {fields.lastName}, {fields.street} {fields.houseNumber},{" "}
          {fields.postalCode} {fields.city}
        </p>

        <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
          {de.checkout.successToCatalog}
        </Link>
      </div>
    );
  }

  // ------------------------------------------------------------- empty cart
  if (!ready || purchasable.length === 0) {
    return (
      <div className={`${PANEL} flex flex-col items-center gap-3 py-10 text-center`}>
        <p className="font-medium">{de.checkout.emptyTitle}</p>
        <p className="text-sm text-on-deep-muted">{de.checkout.emptyHint}</p>
        <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
          {de.cart.toCatalog}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* ------------------------------------------------------------ contact */}
      <section className={PANEL}>
        <h2 className="mb-3 text-sm font-semibold">{de.checkout.contactHeading}</h2>
        <Field
          id="email"
          label={de.checkout.email}
          value={fields.email}
          onChange={set("email")}
          autoComplete="email"
          inputMode="email"
        />
        <p className="mt-1 text-[11px] text-on-deep-muted">{de.checkout.emailHint}</p>
      </section>

      {/* ------------------------------------------------------------ address */}
      <section className={PANEL}>
        <h2 className="mb-3 text-sm font-semibold">{de.checkout.addressHeading}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="firstName" label={de.checkout.firstName} value={fields.firstName} onChange={set("firstName")} autoComplete="given-name" />
          <Field id="lastName" label={de.checkout.lastName} value={fields.lastName} onChange={set("lastName")} autoComplete="family-name" />
          <Field id="company" label={de.checkout.company} value={fields.company ?? ""} onChange={set("company")} autoComplete="organization" className="col-span-2" />
          <Field id="street" label={de.checkout.street} value={fields.street} onChange={set("street")} autoComplete="address-line1" />
          <Field id="houseNumber" label={de.checkout.houseNumber} value={fields.houseNumber} onChange={set("houseNumber")} />
          <Field id="addressLine2" label={de.checkout.addressLine2} value={fields.addressLine2 ?? ""} onChange={set("addressLine2")} autoComplete="address-line2" className="col-span-2" />
          <Field id="postalCode" label={de.checkout.postalCode} value={fields.postalCode} onChange={set("postalCode")} autoComplete="postal-code" inputMode="numeric" />
          <Field id="city" label={de.checkout.city} value={fields.city} onChange={set("city")} autoComplete="address-level2" />
        </div>

        {/* Not a field: V1 delivers to Germany, and the database refuses
            anything else. A select with one option would only pretend. */}
        <div className="mt-3">
          <span className={LABEL}>{de.checkout.country}</span>
          <p className="text-sm">{de.checkout.countryFixed}</p>
          <p className="mt-1 text-[11px] text-on-deep-muted">{de.checkout.countryHint}</p>
        </div>
      </section>

      {/* ----------------------------------------------------------- shipping */}
      <section className={PANEL}>
        <h2 className="mb-3 text-sm font-semibold">{de.checkout.shippingHeading}</h2>
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <label
              key={option.code}
              className={
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-sky-md px-3 py-2 " +
                "ring-1 transition-colors " +
                (method === option.code ? "bg-accent-subtle ring-accent" : "ring-border-strong")
              }
            >
              <input
                type="radio"
                name="shipping"
                value={option.code}
                checked={method === option.code}
                onChange={() => setMethod(option.code)}
                className="h-4 w-4 accent-accent"
              />
              <span className="flex-1 text-sm font-medium">{option.name}</span>
              <span className="text-sm tabular-nums">
                {option.amount === 0 ? de.checkout.shippingFree : formatPrice(option.amount)}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ summary */}
      <section className={PANEL}>
        <h2 className="mb-3 text-sm font-semibold">{de.checkout.summaryHeading}</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {purchasable.map((entry) => (
            <li key={keyOf(entry.line)} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {entry.line.quantity}× {entry.line.name}
                <span className="text-on-deep-muted"> · {conditionLabel(entry.line.condition)}</span>
              </span>
              <span className="tabular-nums">{formatPrice(entry.total ?? 0)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 flex flex-col gap-1.5 border-t border-gold-line pt-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-on-deep-muted">{de.checkout.itemsSubtotal}</dt>
            <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-on-deep-muted">{de.checkout.shipping}</dt>
            <dd className="tabular-nums">
              {(() => {
                const chosen = options.find((o) => o.code === method);
                if (!chosen) return "—";
                return chosen.amount === 0
                  ? de.checkout.shippingFree
                  : formatPrice(chosen.amount);
              })()}
            </dd>
          </div>
          {/* No net line, no VAT line: under the small-business scheme no VAT
              is levied, and showing a 0 % rate would state something false. */}
          <div className="flex items-baseline justify-between gap-4 border-t border-gold-line pt-2">
            <dt className="font-medium">{de.checkout.total}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatPrice(subtotal + (options.find((o) => o.code === method)?.amount ?? 0))}
            </dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------------------------------------- submit */}
      <div className="flex flex-col gap-3">
        <p className="text-xs text-on-deep-muted">{de.checkout.paymentFollows}</p>

        {error ? (
          <div role="alert" className="rounded-sky-md bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/40">
            <p>{error}</p>
            {problems.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {problems.map((problem) => (
                  <li key={problem}>{de.checkout.problem[problem]}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <button type="submit" disabled={pending} className={`${ACTION_PRIMARY} disabled:opacity-70`}>
          {pending ? de.checkout.submitting : de.checkout.submit}
        </button>
      </div>
    </form>
  );
}
