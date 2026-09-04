/**
 * Supabase client for Client Components.
 *
 * Uses the anon key, which is not a secret (ADR-0017). What protects data is
 * Supabase Auth plus row level security, never the obscurity of this key.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
