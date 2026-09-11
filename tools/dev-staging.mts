/**
 * Starts `next dev` against the STAGING Supabase project.
 *
 *   npm run dev:staging
 *
 * WHY THIS EXISTS
 *
 * `.env.local` names production and Next.js loads it automatically, so a
 * plain `npm run dev` puts the browser — and therefore any browser login —
 * on production. Commerce work must never happen there (docs/DEPLOYMENT.md).
 * Next's own load order is `process.env` first, so setting the two public
 * variables here wins over `.env.local` without touching that file.
 *
 * WHAT IT DELIBERATELY DOES NOT PASS ON
 *
 * `SUPABASE_SERVICE_ROLE_KEY`. `.env.staging` carries it for the `verify:*`
 * scripts, but the web application has no business holding it — that is the
 * whole point of putting the privileged work in an Edge Function (ADR-0051).
 * Only `NEXT_PUBLIC_*` names are forwarded, and the anon key among them is
 * not a secret (ADR-0017).
 *
 * THE INTERLOCK
 *
 * This file used to carry its own copy of the check. It now calls the shared
 * one in `lib/staging-guard.mts` — the same guard the importers and the
 * writing verifiers use, so there is one rule about what "staging" means
 * rather than one per tool.
 *
 * The check runs against the values this process is about to hand to the dev
 * server, not against the file it read them from: what matters is where the
 * browser ends up.
 */
import { spawn } from "node:child_process";

import {
  checkStagingTarget,
  readEnvFile,
  referenceFromDisk,
  STAGING_ENV_FILE,
} from "./lib/staging-guard.mts";

const staging = readEnvFile(STAGING_ENV_FILE);

const url = staging.NEXT_PUBLIC_SUPABASE_URL;
const anon = staging.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error(
    `${STAGING_ENV_FILE} must define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.`,
  );
  process.exit(1);
}

/*
 * No service-role key in the target: this process never has one to give the
 * dev server, so the guard's key check has nothing to compare and the URL
 * check is what decides. That is the correct shape here — the risk this
 * command carries is a browser session on the wrong project, not a privileged
 * write.
 */
const verdict = checkStagingTarget({ url, serviceRoleKey: undefined }, referenceFromDisk());
if (!verdict.ok) {
  console.error("");
  console.error("  PRODUCTION GUARD — refusing to start.");
  console.error("");
  console.error(`  dev:staging is a staging-only command, and ${verdict.message}`);
  console.error("");
  console.error("  No server was started.");
  console.error("");
  process.exit(1);
}

console.log(`next dev against ${new URL(url).host}`);
console.log("service-role key: not passed to the web process");
console.log("");

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
