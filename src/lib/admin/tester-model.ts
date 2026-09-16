/**
 * Tester accounts and what each of them may test — the pure half (ADR-0071).
 *
 * WHAT A TESTER PERMISSION IS
 *
 * An additive fact about one account, and nothing more. It grants exactly the
 * feature it names: never another permission, never `shop_admins`. Two testers
 * may carry different ones, and an administrator carries none unless somebody
 * put them on the list.
 *
 * THE DATABASE OWNS THE VOCABULARY
 *
 * `tester_features` is the registry, and `admin_tester_state()` ships it
 * alongside the testers. So the admin area renders whatever the database says
 * exists — a fourth test feature appears there without a line of UI changing,
 * and there is no second copy of the list to forget to update.
 *
 * The two keys below are typed for the places that legitimately name one — the
 * commerce compatibility path, and later the telemetry mount. They are not the
 * list the UI renders from.
 *
 * Separate from the server module for the same reason `commerce-model.ts` is:
 * the admin panel is a client component and cannot import anything that
 * reaches the server.
 */

/**
 * The keys this codebase names in code, as opposed to renders from the
 * registry. Adding a feature does NOT require adding it here — only a feature
 * some TypeScript has to reason about belongs in this union.
 */
export const KNOWN_TESTER_FEATURES = ["commerce", "performance_tracking"] as const;
export type KnownTesterFeature = (typeof KNOWN_TESTER_FEATURES)[number];

export function isKnownTesterFeature(value: unknown): value is KnownTesterFeature {
  return typeof value === "string" && (KNOWN_TESTER_FEATURES as readonly string[]).includes(value);
}

/** One entry of the registry, as the database defines it. */
export type TesterFeature = {
  key: string;
  label: string;
  description: string;
  position: number;
};

export type TesterAccount = {
  userId: string;
  username: string | null;
  email: string | null;
  createdAt: string | null;
  note: string | null;
  /** Shown so nobody assumes the two lists are the same one. They are not. */
  isAdmin: boolean;
  /** Feature keys, as granted. Unknown keys are kept: the registry decides. */
  permissions: string[];
};

export type TesterState = {
  features: TesterFeature[];
  testers: TesterAccount[];
};

/** What a caller gets when the question cannot be answered. */
export const NO_TESTERS: TesterState = { features: [], testers: [] };

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Shapes `admin_tester_state()`. Anything unreadable becomes the empty state.
 *
 * A row without a user id is dropped rather than rendered as a tester nobody
 * can act on — the same rule `readCommerceState()` follows.
 */
export function readTesterState(document: unknown): TesterState {
  if (typeof document !== "object" || document === null) return NO_TESTERS;
  const raw = document as { features?: unknown; testers?: unknown };

  const features: TesterFeature[] = (Array.isArray(raw.features) ? raw.features : []).flatMap(
    (entry): TesterFeature[] => {
      const row = entry as Record<string, unknown>;
      const key = text(row?.key);
      const label = text(row?.label);
      if (key === null || label === null) return [];
      return [
        {
          key,
          label,
          description: text(row?.description) ?? "",
          position: typeof row?.position === "number" ? row.position : 0,
        },
      ];
    },
  );

  const testers: TesterAccount[] = (Array.isArray(raw.testers) ? raw.testers : []).flatMap(
    (entry): TesterAccount[] => {
      const row = entry as Record<string, unknown>;
      const userId = text(row?.user_id);
      if (userId === null) return [];
      return [
        {
          userId,
          username: text(row?.username),
          email: text(row?.email),
          createdAt: text(row?.created_at),
          note: text(row?.note),
          isAdmin: row?.is_admin === true,
          permissions: stringsOf(row?.permissions),
        },
      ];
    },
  );

  return {
    features: [...features].sort((a, b) => a.position - b.position),
    testers,
  };
}

/** Whether this tester holds a feature. The UI's only question per checkbox. */
export function holds(tester: TesterAccount, feature: string): boolean {
  return tester.permissions.includes(feature);
}
