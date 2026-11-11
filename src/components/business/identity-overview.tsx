/**
 * The read-only parts of "Identität & Dokumente" (ADR-0184, AP3): the
 * findings, the platform identity and "Wo erscheint welcher Name?".
 *
 * Server components, no state and no writes. The editable parts are the two
 * existing forms (`SellerSettings`, `ShopProfilePanel`); this file only shows
 * what the identity model computed.
 */
import Link from "next/link";

import type { Finding, Identity, UsageRow } from "@/lib/identity/model";
import { de } from "@/lib/i18n/de";

const copy = de.business.identity;
const BOX = "rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70";

const LEVEL_STYLE: Record<Finding["level"], string> = {
  missing: "bg-danger/10 text-danger ring-danger/40",
  conflict: "bg-danger/10 text-danger ring-danger/40",
  notice: "bg-surface text-muted ring-border/70",
};

export function IdentityFindings({ findings }: { findings: readonly Finding[] }) {
  return (
    <section aria-labelledby="identity-findings" className={BOX}>
      <h2 id="identity-findings" className="font-medium">{copy.findingsHeading}</h2>
      {findings.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{copy.findingsNone}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {findings.map((finding) => (
            <li key={finding.code} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 text-[11px] font-medium ring-1 ${LEVEL_STYLE[finding.level]}`}
              >
                {copy.levels[finding.level]}
              </span>
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlatformIdentity({ identity, canEdit }: { identity: Identity; canEdit: boolean }) {
  const { platform } = identity;
  return (
    <section id="plattform" aria-labelledby="identity-platform" className={BOX}>
      <h2 id="identity-platform" className="font-medium">{copy.platform.heading}</h2>
      <p className="mt-1 text-sm text-muted">{copy.platform.hint}</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{copy.platform.name}</dt>
          <dd className="mt-0.5 font-medium">{platform.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.platform.support}</dt>
          <dd className="mt-0.5">
            {!platform.supportReadable
              ? <span className="text-muted">{copy.platform.supportHidden}</span>
              : platform.supportEmail ?? <span className="text-muted">{copy.platform.supportMissing}</span>}
          </dd>
          {canEdit ? (
            <Link href="/admin" className="mt-1 inline-block text-xs underline underline-offset-2">
              {copy.platform.supportEdit}
            </Link>
          ) : null}
        </div>
      </dl>
    </section>
  );
}

export function NameUsage({ rows }: { rows: readonly UsageRow[] }) {
  const u = copy.usage;
  return (
    <section id="verwendung" aria-labelledby="identity-usage" className={BOX}>
      <h2 id="identity-usage" className="font-medium">{u.heading}</h2>
      <p className="mt-1 text-sm text-muted">{u.hint}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">{u.area}</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">{u.shows}</th>
              <th scope="col" className="py-1.5 font-medium">{u.source}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.area} className="border-t border-border/40 align-top">
                <th scope="row" className="py-2 pr-3 font-normal">{row.area}</th>
                <td className="py-2 pr-3">
                  {row.shows ?? (
                    <span className="text-muted">{row.kind === "secret" ? u.notReadable : u.empty}</span>
                  )}
                </td>
                <td className="py-2 text-xs text-muted">
                  <span className="mr-1.5 rounded-full px-1.5 ring-1 ring-border/70">{u.kinds[row.kind]}</span>
                  {row.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
