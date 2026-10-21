import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Hostnames extras do servidor de desenvolvimento (acesso por outro Mac).
const devOrigins = [
  ...(process.env.DEV_ALLOWED_ORIGINS ?? "").split(","),
  ...[process.env.APP_ORIGIN, process.env.BETTER_AUTH_URL].map((u) => {
    try {
      return u ? new URL(u).hostname : "";
    } catch {
      return "";
    }
  }),
]
  .map((s) => s.trim())
  .filter(Boolean);

// CSP sem nonce: o Next injeta scripts inline de hidratação, então
// 'unsafe-inline' é necessário em script-src. Nada de terceiros é carregado.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Catálogo privado e dinâmico: sem Cache Components nem cache compartilhado
  // (ver docs/decisoes.md). Toda página consulta o banco por requisição.
  cacheComponents: false,
  poweredByHeader: false,
  allowedDevOrigins: [...new Set(devOrigins)],
  serverExternalPackages: ["sharp", "pg", "@prisma/adapter-pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
