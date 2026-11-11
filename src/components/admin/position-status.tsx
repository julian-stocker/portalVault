/**
 * The shop status of a position, shown the same way on the card and in the
 * table (Lagerverwaltung V2, AP3).
 *
 * The answer comes from `positionStatus()` — this file only draws it:
 *
 *   PositionStatusBadge  the short label, with the attention word for a
 *                        position somebody has to act on
 *   PositionStatusNote   the sentence that says why, where there is one worth
 *                        a line: a release that does not reach the shop, a
 *                        sold-out listing, a release still to be decided
 *
 * Accessories and OVP rows are explained by their own blocks on the card
 * (the sale section, the historical banner), so the note leaves them out
 * rather than saying the same thing twice.
 */
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { positionStatus, positionStatusCopy, type Attention } from "@/lib/admin/position-status";
import { de } from "@/lib/i18n/de";

const copy = de.inventory.status;

/* Danger only for a release that promises what the shop does not show; a
   decision is marked, not alarmed; everything else is quiet. */
const TONE: Record<Attention, string> = {
  none: "bg-surface text-muted ring-border/70",
  decision: "bg-surface text-foreground ring-border-strong",
  fix: "bg-danger/10 text-danger ring-danger/40",
};

export function PositionStatusBadge({ position }: { position: InventoryPosition }) {
  const status = positionStatus(position);
  const { label, hint } = positionStatusCopy(position);
  const offered = status.kind === "offered";
  return (
    <span
      title={hint}
      className={
        "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 "
        + (offered ? "bg-status-ground text-status-ink ring-status-line" : TONE[status.attention])
      }
    >
      {label}
      {status.attention === "fix" ? <span className="sr-only">{` — ${copy.attentionFix}`}</span> : null}
      {status.attention === "decision" ? (
        <span className="sr-only">{` — ${copy.attentionDecision}`}</span>
      ) : null}
    </span>
  );
}

/** The kinds whose sentence earns a line of its own. */
const NOTE_KINDS = new Set(["listed_no_price", "listed_hidden", "listed_sold_out", "release_open"]);

export function PositionStatusNote({ position }: { position: InventoryPosition }) {
  const status = positionStatus(position);
  if (!NOTE_KINDS.has(status.kind)) return null;
  const { hint } = positionStatusCopy(position);
  return (
    <p className="text-[11px] leading-tight text-muted">
      {status.attention === "fix" ? (
        <span className="font-medium text-danger">{copy.attentionFix}: </span>
      ) : status.attention === "decision" ? (
        <span className="font-medium text-foreground">{copy.attentionDecision}: </span>
      ) : null}
      {hint}
    </p>
  );
}
