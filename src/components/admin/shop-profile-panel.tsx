/**
 * Everything that belongs to the seller, in one place (ADR-0075).
 *
 * The five groups are the five questions an operator actually has — who am I
 * legally, where do customers write, what tax applies, where do I ship, and
 * what happens on a return — rather than the order the columns happen to sit
 * in. `ShopSettings` (the pricing percentage) stays its own panel; this one
 * holds the facts that will later print in an Impressum, on an invoice and in
 * a withdrawal instruction.
 *
 * NOTHING HERE IS PUBLISHED YET. Legal V1 renders these values; this screen
 * only records them. That is why every field may stay empty and why no field
 * carries a plausible-looking default — an empty Impressum field is obviously
 * unfinished, a placeholder one is a false statement about a real person.
 *
 * THE PLATFORM'S SUPPORT ADDRESS IS NOT HERE. It was, briefly, labelled as the
 * platform's — on the reasoning that showing the two side by side taught the
 * difference. That was backwards: a Business operator has no business editing
 * a SkyIsles setting, and correct placement is what teaches the boundary
 * (ADR-0077). It lives in the platform settings panel, behind the platform's
 * own guard.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { setSellerDetails, setShippingCountry, setShopPolicies } from "@/lib/admin/actions";
import {
  complaintsContact,
  withdrawalContact,
  type ShopSettings as Settings,
} from "@/lib/admin/shop-profile-model";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring";
const LABEL = "mb-1 block text-xs font-medium text-muted";
const GROUP = "rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70";

/** One text field. Empty is a real, saved state — never a missing one. */
function Text({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** The five groups, so a page can render the ones it owns (ADR-0080). */
export type ShopProfileGroup = "seller" | "contact" | "tax" | "shipping" | "withdrawal";

export function ShopProfilePanel({
  settings,
  groups,
  heading,
  hint,
}: {
  settings: Settings;
  /**
   * Which groups this page is responsible for.
   *
   * The panel used to render all five on one screen. Since the shop became a
   * management area with sub-pages, each group belongs to the page whose
   * subject it is — the seller's legal data under Geschäftsdaten, the carriers
   * under Versand — and rendering it anywhere else would be the same field in
   * two places (ADR-0080).
   */
  groups: readonly ShopProfileGroup[];
  heading: string;
  hint: string;
}) {
  const shows = (group: ShopProfileGroup) => groups.includes(group);
  const copy = de.admin.shopProfile;
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [identity, setIdentity] = useState(settings.identity);
  const [contacts, setContacts] = useState(settings.contacts);
  const [policies, setPolicies] = useState(settings.policies);

  const field = (value: string | null) => value ?? "";

  function save(group: string, run: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await run();
      if (result.ok) setSaved(group);
      else setError(result.message ?? copy.saveFailed);
    });
  }

  const savedNote = (group: string) =>
    saved === group ? <p className="text-sm text-success">{copy.saved}</p> : null;

  return (
    <section className="mt-8 flex flex-col gap-4" aria-label={heading}>
      <div>
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------------------- Verkäufer */}
      {shows("seller") ? (
      <div className={GROUP}>
        <h3 className="text-base font-semibold">{copy.sellerHeading}</h3>
        <p className="mt-1 mb-4 text-sm text-muted">{copy.sellerHint}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Text id="s-legal" label={copy.legalName} value={field(identity.legalName)}
            hint={copy.legalNameHint}
            onChange={(v) => setIdentity({ ...identity, legalName: v })} />
          <Text id="s-trading" label={copy.tradingName} value={field(identity.tradingName)}
            hint={copy.tradingNameHint}
            onChange={(v) => setIdentity({ ...identity, tradingName: v })} />
          <Text id="s-form" label={copy.legalForm} value={field(identity.legalForm)}
            onChange={(v) => setIdentity({ ...identity, legalForm: v })} />
          <Text id="s-country" label={copy.countryCode} value={field(identity.countryCode)}
            onChange={(v) => setIdentity({ ...identity, countryCode: v })} />
          <Text id="s-street" label={copy.street} value={field(identity.street)}
            onChange={(v) => setIdentity({ ...identity, street: v })} />
          <Text id="s-postal" label={copy.postalCode} value={field(identity.postalCode)}
            onChange={(v) => setIdentity({ ...identity, postalCode: v })} />
          <Text id="s-city" label={copy.city} value={field(identity.city)}
            onChange={(v) => setIdentity({ ...identity, city: v })} />
          <Text id="s-phone" label={copy.phone} value={field(identity.phone)}
            hint={copy.phoneHint}
            onChange={(v) => setIdentity({ ...identity, phone: v })} />
          <Text id="s-direct" label={copy.directContact} value={field(identity.directContact)}
            hint={copy.directContactHint}
            onChange={(v) => setIdentity({ ...identity, directContact: v })} />
          <Text id="s-court" label={copy.registerCourt} value={field(identity.registerCourt)}
            onChange={(v) => setIdentity({ ...identity, registerCourt: v })} />
          <Text id="s-regno" label={copy.registerNumber} value={field(identity.registerNumber)}
            onChange={(v) => setIdentity({ ...identity, registerNumber: v })} />
          <Text id="s-vat" label={copy.vatId} value={field(identity.vatId)}
            onChange={(v) => setIdentity({ ...identity, vatId: v })} />
          <Text id="s-wid" label={copy.wId} value={field(identity.wId)} hint={copy.wIdHint}
            onChange={(v) => setIdentity({ ...identity, wId: v })} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            onClick={() =>
              save("seller", () =>
                setSellerDetails({
                  legalName: field(identity.legalName),
                  tradingName: field(identity.tradingName),
                  legalForm: field(identity.legalForm),
                  street: field(identity.street),
                  postalCode: field(identity.postalCode),
                  city: field(identity.city),
                  countryCode: field(identity.countryCode),
                  phone: field(identity.phone),
                  directContact: field(identity.directContact),
                  registerCourt: field(identity.registerCourt),
                  registerNumber: field(identity.registerNumber),
                  vatId: field(identity.vatId),
                  wId: field(identity.wId),
                }),
              )
            }
          >
            {pending ? copy.saving : copy.save}
          </button>
          {savedNote("seller")}
        </div>
      </div>
      ) : null}

      {/* --------------------------------------------------------- Kontakt */}
      {shows("contact") ? (
      <div className={GROUP}>
        <h3 className="text-base font-semibold">{copy.contactHeading}</h3>
        <p className="mt-1 mb-4 text-sm text-muted">{copy.contactHint}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Text id="c-seller" label={copy.sellerContact} value={field(contacts.contactEmail)}
            hint={copy.sellerContactHint}
            onChange={(v) => setContacts({ ...contacts, contactEmail: v })} />
          <Text id="c-withdraw" label={copy.withdrawalContact}
            value={field(contacts.withdrawalContactEmail)}
            hint={`${copy.fallbackHint} ${withdrawalContact(contacts) ?? copy.noneYet}`}
            onChange={(v) => setContacts({ ...contacts, withdrawalContactEmail: v })} />
          <Text id="c-complaints" label={copy.complaintsContact}
            value={field(contacts.complaintsContactEmail)}
            hint={`${copy.fallbackHint} ${complaintsContact(contacts) ?? copy.noneYet}`}
            onChange={(v) => setContacts({ ...contacts, complaintsContactEmail: v })} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            onClick={() =>
              save("contact", () =>
                setShopPolicies({
                  contactEmail: field(contacts.contactEmail),
                  withdrawalContactEmail: field(contacts.withdrawalContactEmail),
                  complaintsContactEmail: field(contacts.complaintsContactEmail),
                }),
              )
            }
          >
            {pending ? copy.saving : copy.save}
          </button>
          {savedNote("contact")}
        </div>
      </div>
      ) : null}

      {/* --------------------------------------------------------- Steuern */}
      {shows("tax") ? (
      <div className={GROUP}>
        <h3 className="text-base font-semibold">{copy.taxHeading}</h3>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={policies.smallBusiness19}
            onChange={(e) => setPolicies({ ...policies, smallBusiness19: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-trade-solid" />
          <span>
            {copy.smallBusiness}
            <span className="mt-1 block text-xs text-muted">{copy.smallBusinessHint}</span>
          </span>
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            onClick={() => save("tax", () => setShopPolicies({ smallBusiness19: policies.smallBusiness19 }))}
          >
            {pending ? copy.saving : copy.save}
          </button>
          {savedNote("tax")}
        </div>
      </div>
      ) : null}

      {/* --------------------------------------------------------- Versand */}
      {shows("shipping") ? (
      <div className={GROUP}>
        <h3 className="text-base font-semibold">{copy.shippingHeading}</h3>
        <p className="mt-1 mb-4 text-sm text-muted">{copy.shippingHint}</p>

        <ul className="flex flex-col gap-2">
          {settings.countries.map((country) => (
            <li key={country.countryCode} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {country.label}{" "}
                <span className="text-muted tabular-nums">{country.countryCode}</span>
              </span>
              <button type="button" disabled={pending}
                className="text-sm underline underline-offset-4 disabled:opacity-60"
                onClick={() =>
                  save("shipping", () =>
                    setShippingCountry(country.countryCode, country.label, !country.isEnabled),
                  )
                }
              >
                {country.isEnabled ? copy.countryEnabled : copy.countryDisabled}
              </button>
            </li>
          ))}
        </ul>

        {/* The carriers, read-only here: a price change is a shop decision with
            its own consequences, and this screen is about responsibility. */}
        <ul className="mt-4 flex flex-col gap-1 text-sm text-muted">
          {settings.methods.map((method) => (
            <li key={method.code} className="tabular-nums">
              {method.name} · {method.basePrice.toFixed(2)} €
            </li>
          ))}
        </ul>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="ship-threshold">
              {copy.threshold}
            </label>
            <input id="ship-threshold" type="number" min={0} step="0.01"
              value={policies.freeShippingThreshold}
              onChange={(e) =>
                setPolicies({ ...policies, freeShippingThreshold: Number(e.target.value) })
              }
              className={FIELD} />
          </div>
          <Text id="ship-dispatch" label={copy.dispatch} value={field(policies.dispatchStatement)}
            hint={copy.dispatchHint}
            onChange={(v) => setPolicies({ ...policies, dispatchStatement: v })} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            onClick={() =>
              save("shipping", () =>
                setShopPolicies({
                  freeShippingThreshold: policies.freeShippingThreshold,
                  dispatchStatement: field(policies.dispatchStatement),
                }),
              )
            }
          >
            {pending ? copy.saving : copy.save}
          </button>
          {savedNote("shipping")}
        </div>
      </div>
      ) : null}

      {/* --------------------------------- Widerruf & Reklamationen */}
      {shows("withdrawal") ? (
      <div className={GROUP}>
        <h3 className="text-base font-semibold">{copy.withdrawalHeading}</h3>
        <p className="mt-1 mb-4 text-sm text-muted">{copy.withdrawalHint}</p>

        <fieldset>
          <legend className={LABEL}>{copy.returnPostage}</legend>
          {(["customer", "seller"] as const).map((who) => (
            <label key={who} className="flex items-center gap-3 py-1 text-sm">
              <input type="radio" name="return-postage" checked={policies.returnPostageBorneBy === who}
                onChange={() => setPolicies({ ...policies, returnPostageBorneBy: who })}
                className="h-4 w-4 accent-trade-solid" />
              <span>{who === "customer" ? copy.postageCustomer : copy.postageSeller}</span>
            </label>
          ))}
        </fieldset>

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={policies.disputeParticipation}
            onChange={(e) =>
              setPolicies({
                ...policies,
                disputeParticipation: e.target.checked,
                // The body is only meaningful while participating, and the
                // CHECK enforces the same pairing in the database.
                disputeBody: e.target.checked ? policies.disputeBody : null,
              })
            }
            className="mt-0.5 h-4 w-4 accent-trade-solid" />
          <span>
            {copy.dispute}
            <span className="mt-1 block text-xs text-muted">{copy.disputeHint}</span>
          </span>
        </label>

        {policies.disputeParticipation ? (
          <div className="mt-3">
            <Text id="dispute-body" label={copy.disputeBody} value={field(policies.disputeBody)}
              onChange={(v) => setPolicies({ ...policies, disputeBody: v })} />
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending}
            className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            onClick={() =>
              save("withdrawal", () =>
                setShopPolicies({
                  returnPostageBorneBy: policies.returnPostageBorneBy,
                  disputeParticipation: policies.disputeParticipation,
                  disputeBody: field(policies.disputeBody),
                }),
              )
            }
          >
            {pending ? copy.saving : copy.save}
          </button>
          {savedNote("withdrawal")}
        </div>
      </div>
      ) : null}
    </section>
  );
}
