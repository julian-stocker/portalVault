/**
 * What a position is, in one line: picture, name, SKY-ID, series, condition.
 *
 * Shared by the mobile card and the desktop table so the two can never name a
 * position differently. The picture is a fixed square and never a flex child
 * that can be squeezed; the name is the only part that gives.
 *
 * A position without a catalog row is named by its SKY-ID — nothing else is
 * known about it, and no name is invented. An OVP row keeps its label: the
 * past is named, not rewritten (0108).
 */
import { AdminThumb } from "@/components/admin/admin-thumb";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

export function PositionTitle({ position }: { position: InventoryPosition }) {
  const figure = position.figure;
  const conditionLabel =
    position.condition === "loose" ? copy.conditionLoose : copy.conditionBoxed;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <AdminThumb
        src={figure ? imageSrc(figure) : null}
        name={figure?.displayName ?? position.skyId}
      />
      <span className="min-w-0 flex-1 truncate text-xs leading-tight">
        <span className="text-sm font-medium">{figure?.displayName ?? position.skyId}</span>
        <span className="text-muted">
          {" · "}
          <span className="font-mono">{position.skyId}</span>
          {figure ? ` · ${figure.seriesLabel}` : ""}
          {` · ${conditionLabel}`}
        </span>
      </span>
    </span>
  );
}
