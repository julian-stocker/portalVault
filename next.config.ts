import type { NextConfig } from "next";

/**
 * Origins the DEV server may serve its own assets to (ADR-0149).
 *
 * Next blocks cross-origin requests to `/_next/*` and the HMR socket from any
 * origin the dev server was not started with. That is exactly what a phone on
 * the same Wi-Fi is, so without this the page loads and its dev assets are
 * refused.
 *
 * SUPPLIED BY `tools/dev-staging.mts`, NOT WRITTEN DOWN HERE. The operator
 * works at home and tethered to an iPhone, so the address changes between
 * sessions; a value in this file would be wrong half the time and silently.
 * The LAN command computes the machine's current private addresses at start
 * and passes them in `SKYISLES_DEV_ORIGINS`.
 *
 * PRODUCTION IS UNTOUCHED, twice over: `allowedDevOrigins` only has an effect
 * in `next dev`, and the variable is never set anywhere but that one command,
 * so the option is absent from every build Vercel makes.
 */
const devOrigins = (process.env.SKYISLES_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),

  async headers() {
    return [
      {
        /*
         * Image file names are the SHA-256 of their content, so a given URL
         * can never point at different bytes. Caching them forever is safe
         * and saves re-fetching 10 MB of figures on every visit (ADR-0009).
         */
        source: "/images/skylanders/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
