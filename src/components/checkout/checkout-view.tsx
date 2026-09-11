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
import {
  fieldProblems,
  firstMarkedField,
  summaryProblems,
  type FieldProblem,
} from "@/lib/commerce/field-errors";
import { cartTotal, keyOf, resolveCart } from "@/lib/cart/cart";
import { placeOrder, shippingOptions, type PlacedOrder } from "@/lib/commerce/actions";
import {
  forgetOpenOrder,
  forgetPaymentToken,
  recallOpenOrder,
  rememberOpenOrder,
  rememberPaymentToken,
} from "@/lib/commerce/capability";
import { readOpenOrderState, type OpenOrderView } from "@/lib/commerce/open-order-client";
import { watchPageShow } from "@/lib/commerce/checkout-lifecycle";
import { startPayment, type PaymentStartFailure } from "@/lib/commerce/start-payment";
import { conditionLabel } from "@/components/shop/shop-action";
import {
  DEFAULT_SHIPPING_METHOD,
  DELIVERY_COUNTRY,
  type ShippingMethod,
  type ShippingOption,
} from "@/lib/commerce/shipping";
import type { DraftAddress, DraftProblem } from "@/lib/commerce/order";
import { formatPrice } from "@/lib/format";
import { saveContact } from "@/lib/account/actions";
import type { SavedContact } from "@/lib/account/contact-model";
import { currentPrincipal } from "@/lib/auth/principal";
import { de } from "@/lib/i18n/de";
import { offerIndex, type Offer } from "@/lib/shop/offer";

const PANEL = "rounded-sky-lg bg-deep/90 p-4 ring-1 ring-gold-line backdrop-blur-sm";
const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface-raised px-3 text-sm ring-1 ring-border-strong " +
  "focus:ring-accent";
/** The same box, marked. A ring rather than a tint: the ground stays readable. */
const FIELD_INVALID =
  "min-h-11 w-full rounded-sky-md bg-surface-raised px-3 text-sm ring-2 ring-danger " +
  "focus:ring-danger";
const LABEL = "mb-1 block text-xs font-medium text-on-deep-muted";

/** What a marked field says, per reason. */
const FIELD_MESSAGE: Record<FieldProblem, string> = {
  required: de.checkout.fieldError.required,
  email: de.checkout.fieldError.email,
};

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

/**
 * One input, and whether it is being pointed at.
 *
 * `de.checkout.errorInvalid` has always said "Bitte prüfe die **markierten**
 * Angaben" while nothing was ever marked — the customer got a sentence and
 * nine identical boxes. The mark is four things together, because any one of
 * them alone leaves somebody out: a ring (seen), a message under the field
 * (read), `aria-invalid` plus `aria-describedby` (announced), and the focus
 * jump the form does after a failed submit (found).
 *
 * Deliberately no `required` attribute. Native validation would gate the
 * submit before `validateDraft()` — the one validator that decides — ever ran,
 * and would replace these sentences with a browser bubble in the browser's own
 * wording.
 */
function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  className = "",
  inputMode,
  problem,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  className?: string;
  inputMode?: "text" | "numeric" | "email";
  /** Why this field is marked, or undefined when it is not. */
  problem?: FieldProblem;
}) {
  const errorId = `${id}-error`;
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
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        className={problem ? FIELD_INVALID : FIELD}
      />
      {problem ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {FIELD_MESSAGE[problem]}
        </p>
      ) : null}
    </div>
  );
}

/** The Edge Function's failure reasons, in the customer's words. */
function messageFor(reason: PaymentStartFailure): string {
  switch (reason) {
    case "not_payable":
      return de.checkout.payment.errorNotPayable;
    case "not_yours":
      return de.checkout.payment.errorNotYours;
    case "unavailable":
      return de.checkout.payment.errorUnavailable;
    case "network":
      return de.checkout.payment.errorNetwork;
    default:
      return de.checkout.payment.errorProvider;
  }
}

export function CheckoutView({
  offers,
  email,
  contact,
  saveDefaultAllowed,
  resumeOrderNumber,
}: {
  offers: Readonly<Record<string, readonly Offer[]>>;
  email: string;
  /**
   * From `?order=…` — where the payment page sends somebody who cancelled.
   *
   * It is a hint and not an authorisation: it only asks this browser whether
   * it is the one that placed that order. If the stored open order does not
   * match, nothing is offered and nothing is revealed.
   */
  /**
   * What this account has saved, or null for a guest and for an account that
   * has saved nothing. A **prefill**, never authority: whatever is in the
   * form when it is submitted is what `create_order()` snapshots (ADR-0061).
   */
  contact?: SavedContact | null;
  /** Whether "save as my default" may be offered. False for a guest. */
  saveDefaultAllowed?: boolean;
  resumeOrderNumber?: string;
}) {
  const { cart, ready, clear } = useCart();
  /*
   * Saved details win over the bare session address, and an explicitly saved
   * contact address wins over the one somebody signed up with — that is what
   * saving it was for.
   */
  const [fields, setFields] = useState<Fields>(() => ({
    ...EMPTY,
    ...(contact ?? {}),
    email: contact?.email?.trim() || email,
    countryCode: DELIVERY_COUNTRY,
  }));
  /** Offered only to an account, and only once the form has something in it. */
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [method, setMethod] = useState<ShippingMethod>(DEFAULT_SHIPPING_METHOD);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  /** Set once per failed submit, so the cursor moves exactly once. */
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [pending, setPending] = useState(false);
  /** True from the moment create-payment is called until the browser leaves. */
  const [redirecting, setRedirecting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  /** False until the `?order=` hint has been matched against this tab. */
  const [resumeChecked, setResumeChecked] = useState(false);
  /**
   * What the database says about the open order, or null.
   *
   * The panel is not rendered without it. Storage can only ever be a hint: it
   * said which order this tab was paying for, and the observed bug was that it
   * kept saying so after somebody else signed in. `order_payment_state()`
   * returns no row to a caller it has not authorised, so asking is what makes
   * the panel impossible to show to the wrong account (ADR-0061).
   */
  const [openState, setOpenState] = useState<OpenOrderView | null>(null);
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
   * The capability is additionally written to `sessionStorage` once the order
   * exists, keyed by its order number (ADR-0056). Without that a guest who
   * comes back from the payment page could not be shown their own order — the
   * whole trip leaves this origin and the ref does not survive it. A reload
   * before the order exists still loses both, and loses nothing: no order was
   * placed.
   */
  const credentials = useRef<CheckoutCredentials | null>(null);
  if (credentials.current === null) credentials.current = newCheckoutCredentials();

  /*
   * Coming back from the payment page.
   *
   * `window.location.assign()` leaves this document in the back/forward cache,
   * and Back restores it verbatim — React state included. `redirecting` was
   * true when the tab left, so the button would come back disabled and reading
   * "Weiterleitung zur Zahlung" for an order that exists and is still holding
   * stock. A bfcache restore runs no effect and initialises no state;
   * `pageshow` is the only place this can be noticed.
   *
   * Only the transient lock is cleared. The order, its id and the capability
   * stay exactly where they are.
   */
  useEffect(
    () =>
      watchPageShow(window, () => {
        busy.current = false;
        setRedirecting(false);
      }),
    [],
  );

  /*
   * Coming back from a cancelled payment.
   *
   * The basket was emptied when the order was placed, so without this the
   * customer would land on "your basket is empty" while an order of theirs is
   * holding stock. The order number from the URL is matched against what this
   * tab remembers; a number from somewhere else matches nothing and is simply
   * ignored.
   */
  useEffect(() => {
    if (placed || resumeChecked) return;
    let cancelled = false;

    // Deferred by a task: `sessionStorage` must not be read during render, and
    // setting state synchronously inside an effect makes React cascade.
    const timer = setTimeout(() => {
      void (async () => {
        const principal = currentPrincipal();
        const open = recallOpenOrder(principal, resumeOrderNumber || undefined);
        if (!open) {
          if (!cancelled) setResumeChecked(true);
          return;
        }

        // Ask before showing. A hint that the database will not confirm is a
        // hint about somebody else's order, and it is dropped rather than
        // rendered.
        const state = await readOpenOrderState(principal, open.orderNumber);
        if (cancelled) return;

        if (state === null) {
          forgetOpenOrder(principal);
          forgetPaymentToken(principal, open.orderNumber);
          setResumeChecked(true);
          return;
        }

        setOpenState(state);
        setPlaced({
          orderId: open.orderId,
          orderNumber: open.orderNumber,
          // A reload keeps the order, not its figures. The total comes back
          // from the database above when it has one; inventing one would be
          // worse than showing none.
          itemsSubtotal: Number.NaN,
          shippingAmount: Number.NaN,
          totalAmount: state.totalAmount ?? Number.NaN,
        });
        setResumeChecked(true);
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resumeOrderNumber, placed, resumeChecked]);

  const entries = resolveCart(cart, offerIndex(offers));
  const purchasable = entries.filter((entry) => entry.purchasable);
  const subtotal = cartTotal(entries);

  /*
   * Which fields are marked, recomputed on every keystroke.
   *
   * That is what makes a mark clearable: `fieldProblems()` re-tests the values
   * currently on screen, so filling a blank field removes its ring the moment
   * the first character lands, without another round trip. The problems list
   * is what the server objected to; the values decide which of those problems
   * still applies to which box.
   */
  const marked = fieldProblems(problems, fields);
  /** What no field can point at, and therefore still belongs above the button. */
  const remainingProblems = summaryProblems(problems);

  /*
   * Move the cursor to the first thing that can be fixed.
   *
   * Keyed on a counter rather than on `marked`, which is a fresh Map on every
   * render: reacting to that would fight the customer for the caret while they
   * type. One failed submit, one jump.
   */
  useEffect(() => {
    if (focusRequest === 0) return;
    const field = firstMarkedField(marked);
    if (!field) return;
    const input = document.getElementById(field);
    if (input instanceof HTMLInputElement) {
      input.focus();
      // `center` rather than the default: on a phone the software keyboard
      // takes the lower half of the viewport, and a field scrolled to the top
      // edge of it is a field nobody can see.
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // Deliberately keyed on the request alone — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

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
      const { email: contactEmail, ...address } = fields;
      const result = await placeOrder(
        {
          email: contactEmail,
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

        /*
         * Saving the default is deliberately AFTER the order exists and is
         * not awaited: it is a convenience, and a failure to remember an
         * address must never cost somebody the order they just placed. The
         * order carries its own snapshot either way (ADR-0061).
         */
        if (saveAsDefault && saveDefaultAllowed) {
          void saveContact({ email: contactEmail, ...address }).catch(() => {
            /* Nothing to tell the customer: their order went through. */
          });
        }

        // Written before the payment call, not after: if anything below fails,
        // the order still exists and holds stock, and the customer must still
        // be able to prove it is theirs (ADR-0056).
        rememberPaymentToken(currentPrincipal(), result.order.orderNumber, credentials.current!.paymentToken);
        rememberOpenOrder(currentPrincipal(), {
          orderId: result.order.orderId,
          orderNumber: result.order.orderNumber,
        });

        await toPayment(result.order);
        return;
      }

      if (result.reason === "invalid") {
        setProblems(result.problems);
        setFocusRequest((n) => n + 1);
      }
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

  /**
   * Hand the order to the payment provider.
   *
   * The browser names an order and nothing else. No amount, no currency, no
   * line item: `create-payment` reads all of that from the order under its own
   * lock, so there is nothing here for a tampered client to influence.
   *
   * On failure the order is NOT abandoned. It exists, it holds stock for
   * twenty minutes, and the same `orderId` can be handed over again — the
   * database returns the open attempt and Stripe replays the same session, so
   * a retry cannot produce a second payable checkout.
   */
  async function toPayment(order: PlacedOrder) {
    setRedirecting(true);
    setPaymentError(null);

    const outcome = await startPayment(order.orderId, order.orderNumber);
    if (outcome.ok) {
      // A full navigation, not a router push: the destination is Stripe.
      window.location.assign(outcome.url);
      return;
    }

    setRedirecting(false);
    setPaymentError(messageFor(outcome.reason));
  }

  /** Start the payment again for an order that already exists. */
  async function retryPayment() {
    if (busy.current || !placed) return;
    busy.current = true;
    try {
      await toPayment(placed);
    } finally {
      busy.current = false;
    }
  }

  /*
   * ------------------------------------------------------- after order
   *
   * Reaching this panel means the order exists and the customer is NOT at the
   * payment page: either the redirect is still being prepared, or starting it
   * failed. It is deliberately not a success message any more — nothing has
   * been paid, and B1's wording would now be untrue.
   */
  if (placed) {
    /*
     * An order that was just placed in this session has, by definition, had
     * no payment attempt yet — so `start`. One recovered from storage brings
     * the database's answer with it.
     */
    const cta = openState?.cta ?? "start";

    return (
      <div className={`${PANEL} flex flex-col gap-4`}>
        <h2 className="text-lg font-semibold">
          {de.checkout.payment.openOrder(placed.orderNumber)}
        </h2>
        <p className="text-sm text-on-deep-muted">
          {redirecting
            ? de.checkout.redirecting
            : cta === "none"
              ? de.checkout.payment.settledHint
              : cta === "retry"
                ? de.checkout.payment.retryHint
                : de.checkout.payment.resumeHint}
        </p>

        {paymentError ? (
          // `--danger`, not raw `red-300` (F9). The product has one colour for
          // a failure and it is a token.
          <p role="alert" className="text-sm text-danger">
            {paymentError}
          </p>
        ) : null}

        {/* After a full reload the amounts are gone — only the order number and
            its id survive in sessionStorage, and neither is money. Showing a
            figure we no longer hold would be inventing one; the canonical
            total is on the status page. */}
        {Number.isFinite(placed.totalAmount) ? (
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
              <dd className="text-xl font-semibold tabular-nums">
                {formatPrice(placed.totalAmount)}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {/* The wording, and whether there is a button at all, come from what
              actually happened to this order — not from the fact that one
              exists. A customer who has never started a payment is not
              retrying anything, and a paid order must never be offered a
              second one (ADR-0061). A freshly placed order has made no
              attempt yet, which is exactly `start`. */}
          {cta === "none" ? null : (
            <button
              type="button"
              onClick={() => void retryPayment()}
              disabled={redirecting}
              className={`${ACTION_NEUTRAL} w-auto disabled:opacity-40`}
            >
              {redirecting
                ? de.checkout.redirecting
                : cta === "retry"
                  ? de.checkout.payment.retry
                  : de.checkout.payment.start}
            </button>
          )}
          <Link href="/" className="text-sm underline underline-offset-4">
            {de.checkout.result.toCatalog}
          </Link>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- empty cart
  //
  // An empty basket is ambiguous for exactly one task: it may mean "nothing to
  // buy", or it may mean "an order was placed and is waiting to be paid". So
  // the answer waits until `sessionStorage` has been asked. A basket with
  // something in it is not ambiguous and renders immediately.
  if (!resumeChecked && purchasable.length === 0) return null;

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
          problem={marked.get("email")}
        />
        <p className="mt-1 text-[11px] text-on-deep-muted">{de.checkout.emailHint}</p>
      </section>

      {/* ------------------------------------------------------------ address */}
      <section className={PANEL}>
        <h2 className="mb-3 text-sm font-semibold">{de.checkout.addressHeading}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="firstName" label={de.checkout.firstName} value={fields.firstName} onChange={set("firstName")} autoComplete="given-name" problem={marked.get("firstName")} />
          <Field id="lastName" label={de.checkout.lastName} value={fields.lastName} onChange={set("lastName")} autoComplete="family-name" problem={marked.get("lastName")} />
          <Field id="company" label={de.checkout.company} value={fields.company ?? ""} onChange={set("company")} autoComplete="organization" className="col-span-2" />
          <Field id="street" label={de.checkout.street} value={fields.street} onChange={set("street")} autoComplete="address-line1" problem={marked.get("street")} />
          <Field id="houseNumber" label={de.checkout.houseNumber} value={fields.houseNumber} onChange={set("houseNumber")} problem={marked.get("houseNumber")} />
          <Field id="addressLine2" label={de.checkout.addressLine2} value={fields.addressLine2 ?? ""} onChange={set("addressLine2")} autoComplete="address-line2" className="col-span-2" />
          <Field id="postalCode" label={de.checkout.postalCode} value={fields.postalCode} onChange={set("postalCode")} autoComplete="postal-code" inputMode="numeric" problem={marked.get("postalCode")} />
          <Field id="city" label={de.checkout.city} value={fields.city} onChange={set("city")} autoComplete="address-level2" problem={marked.get("city")} />
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

      {/* ------------------------------------------- keep these for next time
          Offered only to an account: a guest has nowhere to save it to, and a
          checkbox that quietly does nothing is worse than no checkbox. Off by
          default — keeping somebody's postal address is their decision, not a
          thing that happens to them (ADR-0061). */}
      {saveDefaultAllowed ? (
        <section className={PANEL}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(event) => setSaveAsDefault(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="font-medium">{de.checkout.saveDefault}</span>
              <span className="mt-0.5 block text-on-deep-muted">
                {de.checkout.saveDefaultHint}
              </span>
            </span>
          </label>
        </section>
      ) : null}

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

      {/* ---------------------------------------------------------- trust */}
      <TrustBlock
        method={options.find((option) => option.code === method) ?? null}
      />

      {/* ------------------------------------------------------------- submit */}
      <div className="flex flex-col gap-3">
        <p className="text-xs text-on-deep-muted">{de.checkout.paymentFollows}</p>

        {error ? (
          <div role="alert" className="rounded-sky-md bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/40">
            <p>{error}</p>
            {/* Only what is not already marked at its own field: repeating
                "fill in the required fields" under six boxes that each say
                "Bitte ausfüllen" is the same instruction three times over. */}
            {remainingProblems.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {remainingProblems.map((problem) => (
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

/**
 * Who is selling, how it ships, and who takes the money (F2).
 *
 * The last screen before a stranger hands over money used to carry no fact
 * about the seller at all — no identity, no shipping statement, no named
 * payment provider — and then sent them to a Stripe page that does not look
 * like SkyIsles.
 *
 * EVERY LINE IS CHECKABLE, AND THE MISSING ONES SAY SO.
 *
 * No delivery time: none is defined, and an invented one would be the first
 * promise SkyIsles breaks. No contact address: none is decided, and an
 * invented one is a support channel that goes nowhere. And no Widerruf/AGB
 * row: an earlier version said the texts "werden vor der öffentlichen Beta
 * ergänzt", which is a developer's note standing in a real customer's
 * checkout. A shop that narrates its own building site reads as less finished
 * than one that says nothing. The links belong here once the texts exist.
 *
 * The shipping figure comes from the option the customer has selected, which
 * came from `shipping_quote()` — this component computes no money.
 */
function TrustBlock({ method }: { method: ShippingOption | null }) {
  const copy = de.checkout.trust;
  return (
    <section className={`${PANEL} flex flex-col gap-3`} aria-label={copy.heading}>
      <h2 className="text-sm font-semibold">{copy.heading}</h2>

      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-on-deep-muted">{copy.sellerLabel}</dt>
          <dd className="mt-0.5 leading-relaxed">{copy.seller}</dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-on-deep-muted">{copy.shippingLabel}</dt>
          <dd className="mt-0.5 leading-relaxed">
            {method ? (
              <span className="tabular-nums">
                {copy.shippingValue(
                  method.name,
                  method.amount === 0 ? de.checkout.shippingFree : formatPrice(method.amount),
                )}
              </span>
            ) : (
              de.checkout.countryFixed
            )}
            <span className="mt-0.5 block text-xs text-on-deep-muted">{copy.shippingNote}</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-on-deep-muted">{copy.paymentLabel}</dt>
          {/* Stripe by name. The customer is about to leave this origin for a
              page that carries somebody else's branding, and being told a
              second beforehand is the whole difference. */}
          <dd className="mt-0.5 leading-relaxed">
            <span className="font-medium">{copy.paymentValue}</span>
            <span className="mt-0.5 block text-xs text-on-deep-muted">{copy.paymentNote}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
