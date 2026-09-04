/**
 * The grid.
 *
 * Two columns on the narrowest phones, growing with the viewport. No
 * virtualisation: 600 cards with lazily loaded images measured fine, and
 * adding it before a problem exists would be optimising a guess (ADR-0026).
 */
import type { ReactNode } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import type { CatalogFigure } from "@/lib/catalog/types";

export function FigureGrid({
  figures,
  renderAction,
  highlightSkyId,
}: {
  figures: readonly CatalogFigure[];
  renderAction?: (figure: CatalogFigure) => ReactNode;
  highlightSkyId?: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {figures.map((figure) => (
        <FigureCard
          key={figure.skyId}
          figure={figure}
          action={renderAction?.(figure)}
          highlighted={highlightSkyId === figure.skyId}
        />
      ))}
    </div>
  );
}
