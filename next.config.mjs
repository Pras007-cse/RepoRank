/** @type {import('next').NextConfig} */

// A reasonably strict CSP for a server-rendered app that talks only to
// GitHub's avatar CDN for images and to our own origin for everything else.
// 'unsafe-inline' is kept for styles only because Next/Tailwind inject a
// handful of inline <style> tags for critical CSS; scripts have no
// unsafe-inline/unsafe-eval so injected <script> payloads (reflected or
// stored XSS) won't execute even if they slip past output encoding.
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://avatars.githubusercontent.com data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: ContentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Only meaningful over HTTPS (which is required in production anyway);
  // browsers ignore it over plain HTTP so it's safe to always send.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  // Don't advertise the framework/version to would-be attackers.
  poweredByHeader: false,

  // Lint errors (including security-relevant rules like
  // react/no-danger and eslint-plugin-security findings) must fail CI
  // builds rather than be silently swallowed.
  eslint: {
    ignoreDuringBuilds: false,
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },

  async headers() {
    return [
      {
        // Applies to every route, including API routes.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
