import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
