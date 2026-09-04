/**
 * One figure.
 *
 * Shared by the catalog and the collection so both stay in step. The action
 * arrives as a prop rather than being wired in here — that is what would let
 * a different action sit beside it later, without any of it existing today.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { FigureImage } from "@/components/catalog/figure-image";
import type { CatalogFigure } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function FigureCard({
  figure,
  action,
  highlighted = false,
}: {
  figure: CatalogFigure;
  action?: ReactNode;
  highlighted?: boolean;
}) {
  return (
    <article
      className={
        "flex flex-col gap-2 rounded-lg border p-2 " +
        (highlighted ? "border-foreground" : "border-border")
      }
    >
      {/* The whole card leads to the detail page; the action sits outside the
          link so a tap on it cannot navigate away by accident. */}
      <Link href={`/skylanders/${figure.slug}`} className="flex flex-col gap-2">
        <FigureImage file={figure.imageFile} name={figure.name} />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{figure.seriesLabel}</span>
          <span className="text-sm leading-snug font-medium">{figure.name}</span>
          <span className={figure.marketPrice === null ? "text-sm text-muted" : "text-sm"}>
            {figure.marketPrice === null ? de.catalog.noPrice : formatPrice(figure.marketPrice)}
          </span>
          {figure.isActive ? null : (
            <span className="text-xs text-muted">{de.catalog.inactive}</span>
          )}
        </div>
      </Link>
      {action}
    </article>
  );
}
