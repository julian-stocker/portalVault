/**
 * Starts `next dev` against the STAGING Supabase project.
 *
 *   npm run dev:staging       localhost only
 *   npm run dev:staging:lan   reachable from the private network
 *
 * TWO ENVIRONMENTS, AND THIS IS THE SECOND ONE (ADR-0149)
 *
 * SkyIsles has exactly two: production on Vercel from `main` against the
 * production Supabase project, and development/staging HERE — a local
 * `next dev` on the operator's Mac, from `development/skyisles-v2`, against
 * the staging Supabase project. There is deliberately no Vercel staging
 * project and no preview-deployment infrastructure, so this file is the
 * whole of the second environment and the LAN mode is how a phone reaches
 * it.
 *
 * WHAT THE LAN MODE REALLY CHANGES, because the obvious answer is wrong.
 * In this Next version `next dev` ALREADY defaults to hostname `0.0.0.0`,
 * so binding was never the obstacle: a plain `dev:staging` was reachable
 * from the network all along, by accident. Two things follow —
 *
 *   1. `dev:staging` now binds `127.0.0.1` EXPLICITLY. Local means local,
 *      stated rather than inherited, and the staging-credentialed dev server
 *      stops being on the network unless somebody asks for it.
 *   2. The real obstacle is that Next BLOCKS cross-origin requests to
 *      dev-only assets (`/_next/*`, HMR) from any origin the server was not
 *      started with. A phone opening `http://192.168.x.y:3000` would get a
 *      page whose dev assets are refused. `allowedDevOrigins` is the
 *      documented answer, and this file supplies it through
 *      `SKYISLES_DEV_ORIGINS` so that no address is hard-coded in
 *      `next.config.ts` and nothing about production changes.
 *
 * NO TUNNEL AND NO INTERNET EXPOSURE. The LAN mode binds a private
 * interface and prints the private address. It opens no port on a router,
 * starts no tunnel and registers no public host.
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
import { hostname, networkInterfaces } from "node:os";

import {
  checkStagingTarget,
  projectRef,
  readEnvFile,
  referenceFromDisk,
  STAGING_ENV_FILE,
} from "./lib/staging-guard.mts";

/**
 * Which of the two modes was asked for.
 *
 * A flag on ONE script rather than a second file: both modes must read the
 * same env file and pass the same guard, and two files is how that stops
 * being true. `npm run dev:staging:lan` is `… -- --lan`.
 */
const lan = process.argv.includes("--lan");

/**
 * The machine's Bonjour name, exactly once.
 *
 * `os.hostname()` on macOS already answers `MacBook-Pro.local`, so appending
 * `.local` produced `MacBook-Pro.local.local` — which resolves nowhere. Found
 * by running the command rather than by reading it.
 */
function bonjourName(): string {
  const name = hostname();
  return name.endsWith(".local") ? name : `${name}.local`;
}

/** What kind of network an address belongs to, as far as it can be told. */
type NetKind = "hotspot" | "lan";

type LocalAddress = { iface: string; address: string; kind: NetKind };

/**
 * Every private IPv4 address this machine answers on, newest situation first.
 *
 * COMPUTED AT EVERY START, NEVER STORED. The operator works at home and on
 * the road, so the address changes between sessions — a home address written
 * into a file or a config would be wrong half the time, and silently.
 *
 * Only the three RFC 1918 ranges count. A public address would mean the
 * machine is directly on the internet, and this command must not advertise
 * that as a test address; a link-local 169.254 one means DHCP never
 * answered, so a phone could not reach it either.
 *
 * THE HOTSPOT IS RECOGNISABLE, and that is worth saying out loud rather than
 * leaving the operator to guess from a number. An iPhone Personal Hotspot
 * always hands out `172.20.10.0/28` — the iPhone itself is `.1` and clients
 * get `.2` to `.14`. That is a fixed Apple range, so an address in it means
 * "you are tethered to your phone", with the consequences the output below
 * spells out.
 */
function privateAddresses(): LocalAddress[] {
  const found: LocalAddress[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const [a, b, c] = addr.address.split(".").map(Number);
      const isPrivate =
        a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      if (!isPrivate) continue;
      const hotspot = a === 172 && b === 20 && c === 10;
      found.push({ iface, address: addr.address, kind: hotspot ? "hotspot" : "lan" });
    }
  }
  /* A hotspot address first: if both exist, the phone's own network is the
     one the phone can reach. */
  return found.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "hotspot" ? -1 : 1));
}

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

const adressen = lan ? privateAddresses() : [];

if (lan && adressen.length === 0) {
  console.error("");
  console.error("  No private network address found.");
  console.error("");
  console.error("  dev:staging:lan needs an address in 10.x, 172.16-31.x or");
  console.error("  192.168.x — this machine has none, so no other device could");
  console.error("  reach it. Check the Wi-Fi connection.");
  console.error("");
  console.error("  No server was started.");
  console.error("");
  process.exit(1);
}

/**
 * The origins Next may serve dev assets to.
 *
 * Next blocks cross-origin requests to `/_next/*` and the HMR socket from
 * any origin the server was not started with, which is exactly what a phone
 * on the Wi-Fi is. Every private address plus the machine's own `.local`
 * name — the two ways another device addresses this Mac — and nothing else:
 * not a wildcard, not a public host.
 *
 * Read by `next.config.ts`, which adds it to `allowedDevOrigins` only when
 * the variable is present. It is never set in production, so that config is
 * an empty option there and production behaviour is untouched.
 */
const devOrigins = lan
  ? [...adressen.map((a) => a.address), hostname(), bonjourName()]
  : [];

const kindUmgebung: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
};
if (devOrigins.length > 0) kindUmgebung.SKYISLES_DEV_ORIGINS = devOrigins.join(",");
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

/*
 * THE HOST, STATED RATHER THAN INHERITED. `next dev` defaults to `0.0.0.0`
 * in this version, so the non-LAN mode has to say `127.0.0.1` out loud or it
 * is on the network by accident.
 */
const host = lan ? "0.0.0.0" : "127.0.0.1";
const port = process.env.PORT ?? "3000";

if (lan) {
  const primary = adressen[0];
  const onHotspot = primary.kind === "hotspot";

  console.log("");
  console.log("  LAN MODE — reachable from the network this Mac is on.");
  console.log("");
  for (const { iface, address, kind } of adressen) {
    const label = kind === "hotspot" ? "iPhone hotspot" : "local network";
    console.log(`    http://${address}:${port}   (${iface}, ${label})`);
  }
  console.log(`    http://${bonjourName()}:${port}   (Bonjour, if it resolves)`);
  console.log("");
  console.log("  STAGING credentials, never production. Bound to a private");
  console.log("  interface: no tunnel, no public host, no forwarded port — and");
  console.log("  anyone on this network can open it.");
  console.log("");

  if (onHotspot) {
    console.log("  YOU ARE ON YOUR IPHONE'S HOTSPOT (172.20.10.0/28).");
    console.log("");
    console.log("  Opening this address ON that iPhone may or may not work: the");
    console.log("  phone is the router, and iOS does not promise that a client");
    console.log("  can be reached back from it. If Safari just spins:");
    console.log("");
    console.log("    1. Pull down in Safari to force a reload, and make sure the");
    console.log("       iPhone shows the hotspot as ACTIVE (blue bar / chain icon).");
    console.log(`    2. Try http://${bonjourName()}:${port} instead.`);
    console.log("    3. Turn Wi-Fi off and on on the iPhone, then re-join.");
    console.log("    4. If it still fails, it is iOS and not this server — join a");
    console.log("       normal Wi-Fi and run this command again.");
    console.log("");
  }

  console.log("  TO TEST FROM THE IPHONE:");
  console.log("");
  console.log(`    1. Same network as this Mac, then open http://${primary.address}:${port}`);
  console.log("    2. The catalogue should render. If the page is blank or");
  console.log("       unstyled, the dev assets were refused — restart this");
  console.log("       command, because the allowed origins are computed at start");
  console.log("       and this Mac's address changes when you change networks.");
  console.log("    3. If nothing loads at all, check from this Mac first:");
  console.log(`         curl -I http://${primary.address}:${port}/`);
  console.log("       An answer here and silence on the phone is a network block,");
  console.log("       not a server fault.");
  console.log("");
  console.log("  Sign-in works. Email confirmation and password reset do NOT:");
  console.log("  the app builds those links from the address in the browser, and");
  console.log(`  http://${primary.address}:${port} is not in the staging project's`);
  console.log("  redirect allow-list. Use an already confirmed account, or do");
  console.log("  those two flows on localhost.");
  console.log("");
} else {
  console.log(`localhost only — http://127.0.0.1:${port}`);
  console.log("For a phone on your Wi-Fi: npm run dev:staging:lan");
  console.log("");
}

const child = spawn("npx", ["next", "dev", "--hostname", host], {
  stdio: "inherit",
  env: kindUmgebung,
});

child.on("exit", (code) => process.exit(code ?? 0));

/*
 * SIGNALS ARE FORWARDED, and the reason is something this command did to
 * itself during development: killing the parent left `next dev` and its
 * `next-server` behind, still listening on 3000 — a server holding STAGING
 * credentials that nobody could see any more. In a terminal Ctrl-C reaches
 * the whole process group and the orphan never appears, which is exactly why
 * it stayed invisible until the command was driven from a script.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
