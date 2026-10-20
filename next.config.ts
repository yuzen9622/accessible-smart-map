import type { NextConfig } from "next";

const isCapacitorBuild = process.env.CAP_BUILD === "1";
const isDevelopment = process.env.NODE_ENV === "development";
const indoorPreviewPort = process.env.INDOOR_PREVIEW_PORT;
const localBackendPort = process.env.LOCAL_BACKEND_PORT;
const validPort = (value: string | undefined) =>
  /^\d{4,5}$/.test(value ?? "") && Number(value) <= 65535;
const localHosts = [
  { type: "host" as const, value: "(localhost|127\\.0\\.0\\.1|\\[::1\\])" },
];

const nextConfig: NextConfig = {
  output: isCapacitorBuild ? "export" : "standalone",
  /* config options here */ trailingSlash: true,

  // Survey files stay outside Next's assets and output tracing. Only the
  // explicitly launched loopback preview server can serve them in development.
  ...(isDevelopment &&
  (validPort(indoorPreviewPort) || validPort(localBackendPort))
    ? {
        async rewrites() {
          return [
            ...(validPort(indoorPreviewPort)
              ? [
                  {
                    source: "/api/local-indoor/:path*",
                    has: localHosts,
                    destination: `http://127.0.0.1:${indoorPreviewPort}/:path*`,
                  },
                ]
              : []),
            // Same-origin development access to the real Docker backend.
            // No mocks, CORS policy changes, or proxy in production builds.
            ...(validPort(localBackendPort)
              ? [
                  {
                    source: "/api/local-backend/:path*",
                    has: localHosts,
                    destination: `http://127.0.0.1:${localBackendPort}/:path*`,
                  },
                ]
              : []),
          ];
        },
        devIndicators: false,
      }
    : {}),

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
