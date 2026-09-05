import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages are native or resolve binaries at runtime; bundling them
  // breaks their file lookups (and webpack tries to parse the installers'
  // non-JSON tsconfig files).
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "sharp",
    "pg",
    "kysely",
    "bcryptjs",
  ],

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "SAMEORIGIN" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          {
            // Media and images are served from our own origin only; no inline
            // scripts beyond what Next.js requires for hydration.
            key: "content-security-policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"),
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
