import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { LegalUnavailable } from "@/components/legal/legal-unavailable";
import { WithdrawalForm } from "@/components/legal/withdrawal-form";
import { AGB_HEAD } from "@/lib/legal/agb";
import { isLegalSlug, legalTextAt } from "@/lib/legal/active";
import { DATENSCHUTZ_HEAD } from "@/lib/legal/datenschutz";
import type { LegalSlug } from "@/lib/legal/documents";
import { IMPRESSUM_HEAD } from "@/lib/legal/impressum";
import { fetchLegalVersions } from "@/lib/legal/versions";
import { WIDERRUF_HEAD } from "@/lib/legal/widerruf";
import { de } from "@/lib/i18n/de";

type Params = Promise<{ slug: string; version: string }>;

const TITLE: Record<LegalSlug, string> = {
  impressum: IMPRESSUM_HEAD.title,
  agb: AGB_HEAD.title,
  widerruf: WIDERRUF_HEAD.title,
  datenschutz: DATENSCHUTZ_HEAD.title,
};

/**
 * One version of a legal text under a stable address (ADR-0184, AP5):
 * `/rechtstexte/<slug>/<version>`.
 *
 * EXACTLY THE VERSION ASKED FOR. Built (`LEGAL_VERSIONS`, from the seller row)
 * or archived (frozen, nothing from today's row) — never another one in its
 * place; a version this code does not carry is a 404. The checkout links here
 * with the version it shows and sends, so the text a customer opens is the
 * text the order is compared against.
 *
 * WHETHER IT IS IN FORCE is the database's answer (`legal_versions_public()`).
 * The version in force carries no banner; an archived one says it is no longer
 * current; a built one that is not yet switched on says it is not the current
 * one. Without that answer the page is not shown — a banner that guessed would
 * be a statement about validity without a basis.
 *
 * Neither claims a date of publication or validity — only the version id the
 * orders carry.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, version } = await params;
  if (!isLegalSlug(slug)) return {};
  const text = await legalTextAt(slug, version);
  if (!text) return {};
  const title = text.status === "ok" ? text.document.title : TITLE[slug];
  // `/agb` is the address to find; this one is for whoever follows a link to it.
  return { title: `${title} (Fassung ${version})`, robots: { index: false } };
}

export default async function LegalVersionPage({ params }: { params: Params }) {
  const { slug, version } = await params;
  if (!isLegalSlug(slug)) notFound();
  const text = await legalTextAt(slug, version);
  if (!text) notFound();
  if (text.status !== "ok") return <LegalUnavailable title={TITLE[slug]} cause={text.cause} />;

  const active = await fetchLegalVersions();
  if (active.status !== "ok") return <LegalUnavailable title={TITLE[slug]} cause="versions" />;

  const copy = de.legal.archive;
  const inForce = active.versions[slug] === version;
  const banner = inForce ? null : text.built ? copy.notCurrent(version) : copy.banner(version);

  return (
    <>
      {banner ? (
        <div className="mx-auto w-full max-w-2xl px-4 pt-8 md:pt-12">
          <p role="note" className="rounded-sky-lg bg-surface/80 px-5 py-4 text-sm ring-2 ring-border-strong">
            {banner}{" "}
            <Link href={`/${slug}`} className="underline underline-offset-4">{copy.current}</Link>
          </p>
        </div>
      ) : null}
      <LegalDocumentView document={text.document} />
      {text.form ? <WithdrawalForm form={text.form} /> : null}
    </>
  );
}
