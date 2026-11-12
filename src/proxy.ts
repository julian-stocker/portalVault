import type { NextRequest } from "next/server";

import { de } from "@/lib/i18n/de";
import { blockedMessage, currentDeploymentEnv, deploymentVerdict } from "@/lib/ops/deployment-target";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next 16 renamed the middleware convention to "proxy". Same execution model,
 * new file name — building on the deprecated one would only have to be
 * migrated later.
 *
 * FIRST: a Vercel preview that is not wired to Staging answers 503 to every
 * matched request, before a session is read or any Supabase call is made
 * (ADR-0185). Production and local development pass straight through. The
 * same check also sits in every server-side Supabase client
 * (`supabasePublicConfig()`), because a proxy matcher is not a security
 * boundary on its own — Server Functions follow the route they are used on.
 */
export async function proxy(request: NextRequest) {
  const verdict = deploymentVerdict(currentDeploymentEnv());
  if (!verdict.allowed) {
    console.error(blockedMessage(verdict));
    return new Response(de.deployment.previewBlocked, {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets. Running on image
     * requests would refresh the session hundreds of times per catalog page.
     */
    "/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
