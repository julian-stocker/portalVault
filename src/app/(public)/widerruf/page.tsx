import type { Metadata } from "next";
import Link from "next/link";

import { ActiveLegalPage, activeLegalMetadata } from "@/components/legal/active-legal-page";
import { de } from "@/lib/i18n/de";
import { WIDERRUF_HEAD, WITHDRAWAL_PATH } from "@/lib/legal/widerruf";

export function generateMetadata(): Promise<Metadata> {
  return activeLegalMetadata("widerruf", WIDERRUF_HEAD.title);
}

/**
 * Widerrufsbelehrung und Muster-Widerrufsformular (ADR-0086).
 *
 * The page carries the statutory instruction, the statutory model form, and a
 * prominent way into the electronic withdrawal function required by § 356a
 * BGB — the three things a consumer needs in one place.
 *
 * The link to the function is near the top as well as in the footer, because
 * "gut sichtbar und leicht zugänglich" is a requirement of the statute and not
 * a layout preference.
 *
 * The version is the one `legal_versions_public()` names as current, with
 * the model form of the same version (ADR-0184, AP5). Without that answer,
 * or without usable seller data for the built text, the Belehrung is not
 * shown — but the way into the online function stays, because the right to
 * withdraw does not depend on this page rendering.
 */
export default function WiderrufPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-4 pt-8 md:pt-12">
        <Link
          href={WITHDRAWAL_PATH}
          className="block rounded-sky-lg bg-surface/80 px-5 py-4 ring-2 ring-border-strong hover:ring-border-strong"
        >
          <span className="block font-semibold">{de.withdrawal.entryTitle}</span>
          <span className="mt-1 block text-sm text-muted">{de.withdrawal.entryHint}</span>
        </Link>
      </div>
      <ActiveLegalPage slug="widerruf" title={WIDERRUF_HEAD.title} />
    </>
  );
}
