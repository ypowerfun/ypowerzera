import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// PA_TARGET=sites monta o site para o ChatGPT Sites (Cloudflare Workers + D1): npm run build:sites. Veja docs/SITES.md.
const sites = process.env.PA_TARGET === "sites";

// Linha de base de CSP. O Next injeta scripts inline de hidratação, então `script-src` mantém 'unsafe-inline'
// (um CSP com nonce exigiria renderização 100% dinâmica); o ganho está nas demais diretivas:
// sem plugins, sem <base> externo, sem iframe de terceiros e formulários só para o próprio site (ou Stripe).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No Sites troca-se o banco (Prisma + SQLite → D1 com o motor de transações), o cliente Prisma (versão sem motor nativo,
  // compilada em WebAssembly) e o nodemailer (a hospedagem não abre conexões SMTP; o e-mail sai por API HTTP).
  ...(sites
    ? {
        turbopack: {
          resolveAlias: {
            "@prisma/client": "./src/generated/prisma-d1/client.ts",
            "@/lib/db": "./src/lib/db.d1.ts",
            nodemailer: "./src/lib/stubs/nodemailer.ts",
          },
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
