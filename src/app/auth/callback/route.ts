/**
 * Exchanges the code from a confirmation or reset link for a session.
 *
 * Both the signup confirmation and the password reset land here. Where the
 * visitor goes afterwards depends on whether they already picked a username.
 */
import { NextResponse, type NextRequest } from "next/server";

import { destinationAfterSignIn, safeRedirect } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/auth-error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Expired, already used, or tampered with. All the same to the visitor.
    return NextResponse.redirect(`${origin}/auth-error`);
  }

  // A reset link carries its own destination and must not be diverted into
  // onboarding — the visitor still has to set a password.
  if (next) {
    return NextResponse.redirect(`${origin}${safeRedirect(next, "/reset-password")}`);
  }

  const { data } = await supabase.auth.getUser();
  let hasUsername = false;
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.user.id)
      .maybeSingle();
    hasUsername = Boolean(profile?.username);
  }

  return NextResponse.redirect(`${origin}${destinationAfterSignIn(hasUsername, null)}`);
}
