import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer, Header } from "@/components/header";
import { ensureBootChecks } from "@/server/boot-guard";

export const metadata: Metadata = {
  // Sem isso as imagens de compartilhamento (WhatsApp, Discord) apontam para http://localhost:3000 em produção.
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Prime Arena — campeonatos de esports", template: "%s · Prime Arena" },
  description: "Crie e dispute campeonatos de LoL, Valorant, CS2, Fortnite, Apex, Battlefield 6, Warzone, TFT, Street Fighter e EA FC, com chaves automáticas, carteira por equipe e desafios.",
  applicationName: "Prime Arena",
};

export const viewport: Viewport = { themeColor: "#0b0c10", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureBootChecks(); // só age no ChatGPT Sites (PA_RUNTIME=sites)
  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen flex-col antialiased">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-strong focus:px-4 focus:py-2">
          Pular para o conteúdo
        </a>
        <Header />
        <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
