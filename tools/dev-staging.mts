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
 * AND UNTIL 2026-10-25 THAT SENTENCE WAS HALF TRUE.
 *
 * This file passed no key of its own — but `next dev` loads `.env.local`
 * ITSELF, and that file carries the PRODUCTION service-role key. So the web
 * process did receive it, by the back door, every single time. No code read
 * it (`grep SERVICE_ROLE src/` finds nothing outside tests), so nothing
 * happened; the point is that nothing had to.
 *
 * Two measures, both in the child environment this file builds:
 *
 *   1. `SUPABASE_SERVICE_ROLE_KEY` is overwritten with a SENTINEL — not
 *      emptied. An empty value risks being treated as "unset" by the env
 *      loader, and `.env.local` would win again. A non-empty, obviously
 *      invalid value is definitely set, can authenticate nowhere, and says
 *      in any error message where it came from.
 *   2. Every value the child inherits is scanned for the PRODUCTION project
 *      reference. Finds one, no server starts. That is the part which
 *      covers the clients this file does not know about: whatever a future
 *      server-side Supabase client reads, it cannot read production out of
 *      this environment.
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
  projectRef,
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

/**
 * Der Platzhalter, der an die Stelle eines Production-Geheimnisses tritt.
 *
 * Nicht leer: ein leerer Wert gilt manchen Ladern als „nicht gesetzt", und
 * dann gewinnt `.env.local` wieder. Dieser Wert ist gesetzt, authentifiziert
 * nirgends und nennt in jeder Fehlermeldung seinen Grund.
 */
const ENTZOGEN = "disabled-by-dev-staging";

/** Namen, die der Webprozess unter keinen Umständen echt bekommen soll. */
const NIEMALS_WEITERGEBEN = ["SUPABASE_SERVICE_ROLE_KEY"] as const;

const kindUmgebung: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
};
for (const name of NIEMALS_WEITERGEBEN) kindUmgebung[name] = ENTZOGEN;

/*
 * DIE ZWEITE SPERRE, und sie gilt für alles, was dieses Skript nicht kennt.
 *
 * Geprüft wird die Umgebung, die der Server WIRKLICH bekommt — nicht die
 * Datei, aus der sie stammt, und nicht die Liste oben. Trägt irgendein Wert
 * noch die Production-Projektkennung, startet nichts. Ein serverseitiger
 * Client, den es heute nicht gibt, kann daraus kein Production lesen.
 */
const produktionsKennung = projectRef(referenceFromDisk().production.NEXT_PUBLIC_SUPABASE_URL);
if (produktionsKennung) {
  const belastet = Object.entries(kindUmgebung)
    .filter(([, wert]) => typeof wert === "string" && wert.includes(produktionsKennung))
    .map(([name]) => name);
  if (belastet.length > 0) {
    console.error("");
    console.error("  PRODUCTION GUARD — refusing to start.");
    console.error("");
    console.error(`  Diese Variablen tragen die Production-Kennung ${produktionsKennung}:`);
    for (const name of belastet) console.error(`    ${name}`);
    console.error("");
    console.error("  Der Webprozess bekommt sie nicht. Namen oben in");
    console.error("  NIEMALS_WEITERGEBEN aufnehmen oder aus der Umgebung entfernen.");
    console.error("");
    console.error("  No server was started.");
    console.error("");
    process.exit(1);
  }
}

console.log(`service-role key: withheld (${ENTZOGEN})`);
console.log("");

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  env: kindUmgebung,
});

child.on("exit", (code) => process.exit(code ?? 0));
