/**
 * "Im Shop" / "Nicht im Shop" — the shop release of one position (ADR-0048).
 *
 * Shared by the mobile card and the desktop table, so both write the same
 * way: `setListing` → `set_shop_listing()`, with the price override and note
 * the position already has. Only `isListed` changes. The confirmation before
 * a release is `ReleaseToggle`'s.
 *
 * "Im Shop" means released, never "in stock": the two are separate questions
 * and both states of each are real.
 */
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ReleaseToggle } from "@/components/admin/release-toggle";
import { setListing } from "@/lib/admin/actions";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { de } from "@/lib/i18n/de";

export function ListingSwitch({
  position,
  onFailed,
}: {
  position: InventoryPosition;
  onFailed: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(next: boolean) {
    onFailed(null);
    startTransition(async () => {
      const result = await setListing({
        skyId: position.skyId,
        condition: position.condition,
        salePrice: position.salePrice,
        isListed: next,
        note: position.note,
      });
      if (!result.ok) {
        onFailed(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <ReleaseToggle
      on={position.isListed}
      onLabel={de.inventory.listed}
      offLabel={de.inventory.notListed}
      name={position.figure?.displayName ?? position.skyId}
      pending={pending}
      onChange={save}
    />
  );
}
