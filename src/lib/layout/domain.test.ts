import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { safeOrigin, safeRedirect } from "@/lib/auth/redirect";

/**
 * The application does not know what it is called.
 *
 * That is the property that made moving from `portal-vault-lovat.vercel.app`
 * to `skyisles.app` a documentation change and nothing else: every absolute
 * URL the app produces is built from the origin of the request being served,
 * or from an origin the browser reported and `safeOrigin` validated. Nothing
 * is hard-coded, so the same build is correct on the canonical domain, on a
 * preview deployment and on localhost.
 *
 * These tests exist to keep it that way. Pasting a production URL into a
 * component is an easy thing to do and a hard thing to notice — until
 * confirmation mails start pointing at the wrong host.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(path) && !path.includes(".test.")) found.push(path);
  }
  return found;
}

/** Code with comment lines removed: prose may name the domain, code may not. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const FILES = sourceFiles("src");

describe("no host is hard-coded into the application", () => {
  it("finds source files to check", () => {
    // A guard on the guard: an empty list would pass everything below.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("names no production domain in shipped code", () => {
    for (const path of FILES) {
      expect(code(path), `${path} names a site domain`).not.toMatch(
        /skyisles\.(app|de|com)|portal-vault-lovat|vercel\.app/,
      );
    }
  });

  /**
   * One file may name an absolute URL, and it is not about this site.
   *
   * `tracking.ts` builds a link into a carrier's own tracking page (ADR-0062).
   * That is an external destination, not SkyIsles' identity — the failure this
   * whole describe block exists to prevent is a redirect or a canonical that
   * points at the wrong SkyIsles host, and a carrier URL cannot cause it.
   *
   * Listed here by name so a second such file has to be a decision.
   */
  const EXTERNAL_DESTINATIONS = ["src/lib/commerce/tracking.ts"];

  it("contains no absolute http(s) URL at all", () => {
    // The Supabase URL arrives as an environment variable, never as a literal.
    for (const path of FILES) {
      if (EXTERNAL_DESTINATIONS.includes(path)) continue;
      const absolute = code(path).match(/https?:\/\/[^\s"'`)]+/g) ?? [];
      expect(absolute, `${path} contains ${absolute.join(", ")}`).toEqual([]);
    }
  });

  it("and the one exception names only carriers, over https", () => {
    for (const path of EXTERNAL_DESTINATIONS) {
      const absolute = code(path).match(/https?:\/\/[^\s"'`$)]+/g) ?? [];
      expect(absolute.length, path).toBeGreaterThan(0);
      for (const url of absolute) {
        // No plaintext, and nothing that could be a SkyIsles host: the first
        // test in this block already forbids the names, this forbids the
        // shape of the mistake as well.
        expect(url, url).toMatch(/^https:\/\//);
        expect(new URL(url).hostname, url).toMatch(/^(www\.)?(myhermes\.de|dhl\.de)$/);
      }
    }
  });

  it("has no site-URL environment variable to get wrong", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).not.toMatch(/SITE_URL|CANONICAL|VERCEL_URL/);
    for (const path of FILES) {
      expect(code(path)).not.toMatch(/NEXT_PUBLIC_SITE_URL|VERCEL_URL/);
    }
  });
});

describe("redirects are built from the request, not from a constant", () => {
  it("sends people back to the host that served them", () => {
    const callback = code("src/app/auth/callback/route.ts");
    expect(callback).toContain("request.nextUrl");
    expect(callback).toContain("origin");

    const signout = code("src/app/auth/signout/route.ts");
    expect(signout).toContain("request.nextUrl.origin");
  });

  it("builds mail links from an origin the browser reported and we checked", () => {
    const actions = code("src/lib/auth/actions.ts");
    expect(actions).toContain("safeOrigin(");
    expect(actions).toContain("emailRedirectTo");
    // Omitted rather than guessed when there is none: Supabase then falls back
    // to its own Site URL, which is also where the allowlist lives.
    expect(actions).toContain("origin ?");
  });
});

describe("the domain change did not loosen redirect safety", () => {
  it("still refuses an offsite next", () => {
    for (const hostile of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "javascript:alert(1)",
      "/x:y",
    ]) {
      expect(safeRedirect(hostile)).toBe("/");
    }
  });

  it("still accepts an ordinary in-app path", () => {
    expect(safeRedirect("/collection")).toBe("/collection");
    expect(safeRedirect("/skylanders/bash-spyros-adventure")).toBe("/skylanders/bash-spyros-adventure");
  });

  it("accepts any plain http(s) origin, because it cannot know its own", () => {
    // The allowlist that decides which of these may receive a mail link lives
    // in Supabase, not here. This function's job is to reject what is not an
    // origin at all.
    expect(safeOrigin("https://skyisles.app")).toBe("https://skyisles.app");
    expect(safeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeOrigin("https://user:pass@skyisles.app")).toBeNull();
    expect(safeOrigin("ftp://skyisles.app")).toBeNull();
    expect(safeOrigin("not-a-url")).toBeNull();
  });
});

describe("the canonical domain is written down exactly once", () => {
  const deployment = readFileSync("docs/DEPLOYMENT.md", "utf8");

  it("names skyisles.app as the public address", () => {
    expect(deployment).toContain("https://skyisles.app");
    expect(deployment).toContain("Site URL | `https://skyisles.app`");
  });

  it("no longer offers the old Vercel host as the canonical one", () => {
    expect(deployment).not.toContain("Site URL | `https://portal-vault-lovat");
    expect(deployment).not.toContain("Redirect URLs | `https://portal-vault-lovat");
  });

  it("still keeps localhost in the redirect allowlist", () => {
    // Removing it would break local development silently.
    expect(deployment).toContain("http://localhost:3000/**");
  });
});
