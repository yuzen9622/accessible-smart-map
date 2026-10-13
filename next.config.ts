import type { NextConfig } from "next";

const isCapacitorBuild = process.env.CAP_BUILD === "1";

const nextConfig: NextConfig = {
  output: isCapacitorBuild ? "export" : "standalone",
  /* config options here */ trailingSlash: true,

  // Apple fetches the Universal Links file without an extension; serve it as JSON.
  // (Static export builds have no server, so headers only apply to the web host.)
  ...(isCapacitorBuild
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/.well-known/apple-app-site-association",
              headers: [{ key: "Content-Type", value: "application/json" }],
            },
            {
              source: "/:lng(zh-TW|en)/sos/:path*",
              headers: [
                { key: "Referrer-Policy", value: "no-referrer" },
                { key: "X-Robots-Tag", value: "noindex, nofollow" },
              ],
            },
          ];
        },
      }),

  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "places.googleapis.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "maps.gstatic.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "tdx.transportdata.tw",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
