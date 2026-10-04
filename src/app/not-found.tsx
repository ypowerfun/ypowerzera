import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <p className="display text-gold-metal text-7xl sm:text-8xl" aria-hidden>404</p>
      <h1 className="mt-4 text-2xl font-extrabold sm:text-3xl">Página não encontrada</h1>
      <p className="mt-2 text-muted">O endereço que você tentou abrir não existe ou foi movido.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/torneios">Ver torneios</ButtonLink>
        <ButtonLink href="/" variant="secondary">Voltar ao início</ButtonLink>
      </div>
    </div>
  );
}
