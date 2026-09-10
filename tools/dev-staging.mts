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
 * If the URL in `.env.staging` turns out to be the same one as in
 * `.env.local`, this refuses to start. A staging file that has been pointed
 * at production by accident is exactly the mistake worth failing on.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/** `KEY=value` lines, ignoring comments and blanks. Quotes are stripped. */
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const staging = readEnvFile(".env.staging");
const production = readEnvFile(".env.local");

const url = staging.NEXT_PUBLIC_SUPABASE_URL;
const anon = staging.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error(".env.staging must define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const same = (a: string | undefined, b: string) => (a ?? "").replace(/\/+$/, "") === b.replace(/\/+$/, "");
if (same(production.NEXT_PUBLIC_SUPABASE_URL, url)) {
  console.error("Refusing to start: .env.staging names the same project as .env.local.");
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
