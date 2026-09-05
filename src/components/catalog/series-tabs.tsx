/**
 * Series switch.
 *
 * Full titles, and no "Alle" (ADR-0038). The catalog is 561 figures across
 * six games; an all-series default is a wall nobody scrolls, and abbreviating
 * the games to "SA · G · SF · TT · SC · I" asked visitors to learn a code
 * table before they could browse. A game is always chosen, and it is named.
 *
 * The bar scrolls sideways below `sm:`, which is where six full titles stop
 * fitting. That is the deliberate exception to "no horizontal scrolling".
 *
 * No series colours. Element colour is a character metadatum (ADR-0034);
 * series is navigation. Two hue systems on one screen would collide.
 */
"use client";

import { FilterBar } from "@/components/ui/filter-bar";
import type { SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

export function SeriesTabs({
  series,
  active,
  onSelect,
}: {
  series: readonly SeriesOption[];
  active: string;
  onSelect: (code: string) => void;
}) {
  return (
    <FilterBar
      label={de.catalog.seriesNav}
      active={active}
      onSelect={onSelect}
      options={series.map((option) => ({ value: option.code, label: option.label }))}
    />
  );
}
