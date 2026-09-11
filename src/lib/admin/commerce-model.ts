/**
 * The commerce mode and who may buy while it is sandbox — the pure half.
 *
 * Three answers — `closed`, `sandbox`, `live` — and one additive permission
 * beside them. Not a role system and not a feature-flag framework: one
 * question about one domain, in the table that already holds the commerce
 * configuration (ADR-0060).
 *
 * Separate from `commerce.ts` for the same reason `inventory-model.ts` is
 * separate from `inventory.ts`: the admin panel is a client component, and a
 * module that reaches the server cannot be imported from one.
 *
 * NOTHING HERE AUTHORISES ANYBODY, and that includes the search. An address
 * or a username may be used to FIND an account; what is then granted is
 * granted to a `user_id`, the same rule `shop_admins` has followed since
 * ADR-0032. `admin_set_commerce_tester()` accepts no other kind of argument.
 */
export const COMMERCE_MODES = ["closed", "sandbox", "live"] as const;
export type CommerceMode = (typeof COMMERCE_MODES)[number];

export function isCommerceMode(value: unknown): value is CommerceMode {
  return typeof value === "string" && (COMMERCE_MODES as readonly string[]).includes(value);
}

export type CommerceTester = {
  userId: string;
  username: string | null;
  email: string | null;
  grantedAt: string | null;
  note: string | null;
  /** Shown so nobody assumes the two lists are the same one. They are not. */
  isAdmin: boolean;
};

export type CommerceState = {
  mode: CommerceMode;
  testers: CommerceTester[];
  /** How many orders carry each mode. The record a test cannot erase. */
  ordersByMode: Record<string, number>;
};

/** What a caller gets when the question cannot be answered: the safe answer. */
export const COMMERCE_CLOSED: CommerceState = {
  mode: "closed",
  testers: [],
  ordersByMode: {},
};

type TesterRow = {
  user_id?: unknown;
  username?: unknown;
  email?: unknown;
  granted_at?: unknown;
  note?: unknown;
  is_admin?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Shapes `admin_commerce_state()`. Anything unreadable becomes closed. */
export function readCommerceState(document: unknown): CommerceState {
  if (typeof document !== "object" || document === null) return COMMERCE_CLOSED;
  const raw = document as { mode?: unknown; testers?: unknown; orders_by_mode?: unknown };
  if (!isCommerceMode(raw.mode)) return COMMERCE_CLOSED;

  const testers = Array.isArray(raw.testers)
    ? (raw.testers as TesterRow[]).flatMap((row): CommerceTester[] => {
        const userId = text(row?.user_id);
        if (userId === null) return [];
        return [{
          userId,
          username: text(row?.username),
          email: text(row?.email),
          grantedAt: text(row?.granted_at),
          note: text(row?.note),
          isAdmin: row?.is_admin === true,
        }];
      })
    : [];

  const counts: Record<string, number> = {};
  if (typeof raw.orders_by_mode === "object" && raw.orders_by_mode !== null) {
    for (const [mode, n] of Object.entries(raw.orders_by_mode as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n)) counts[mode] = n;
    }
  }

  return { mode: raw.mode, testers, ordersByMode: counts };
}

export type AccountMatch = {
  userId: string;
  username: string | null;
  email: string | null;
  isTester: boolean;
  isAdmin: boolean;
};

/** Shapes `admin_find_accounts()`. Rows without a user id are dropped. */
export function readAccountMatches(rows: unknown): AccountMatch[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): AccountMatch[] => {
    if (typeof row !== "object" || row === null) return [];
    const raw = row as Record<string, unknown>;
    const userId = text(raw.user_id);
    if (userId === null) return [];
    return [{
      userId,
      username: text(raw.username),
      email: text(raw.email),
      isTester: raw.is_tester === true,
      isAdmin: raw.is_admin === true,
    }];
  });
}

/** The shortest query the database will answer. Shorter returns nothing. */
export const MIN_ACCOUNT_QUERY = 3;
