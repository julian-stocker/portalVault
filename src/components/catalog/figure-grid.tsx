/**
 * The grid.
 *
 * Two columns on the narrowest phones, growing with the viewport. No
 * virtualisation: 600 cards with lazily loaded images measured fine, and
 * adding it before a problem exists would be optimising a guess (ADR-0026).
 *
 * Five columns is the ceiling. A sixth was measured and dropped: the
 * container is capped at max-w-6xl, so a 2xl step would only shrink each
 * card from 214 px to 177 px without using any extra width.
 */
import type { ReactNode } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import type { CatalogFigure } from "@/lib/catalog/types";

export function FigureGrid({
  figures,
  renderAction,
  highlightSkyId,
  collectedSkyIds,
}: {
  figures: readonly CatalogFigure[];
  renderAction?: (figure: CatalogFigure) => ReactNode;
  highlightSkyId?: string | null;
  /** Real collection state, passed through to the card. Nothing is derived. */
  collectedSkyIds?: ReadonlySet<string>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {figures.map((figure) => (
        <FigureCard
          key={figure.skyId}
          figure={figure}
          action={renderAction?.(figure)}
          highlighted={highlightSkyId === figure.skyId}
          collected={collectedSkyIds?.has(figure.skyId) ?? false}
        />
      ))}
    </div>
  );
}
