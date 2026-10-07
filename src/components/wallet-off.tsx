import Link from "next/link";
import { Empty } from "./ui";

/** Mostrado no lugar das telas de carteira e desafios quando o admin desativou (ou ainda não concluiu a configuração de) a Carteira. */
export function WalletUnavailable() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <Empty title="Carteira indisponível no momento">
        Os depósitos, saques e desafios com créditos estão desativados pela administração. Saques que você já havia solicitado continuam sendo processados normalmente.
        <span className="mt-4 block"><Link href="/torneios" className="text-brand-soft hover:underline">Ver torneios →</Link></span>
      </Empty>
    </div>
  );
}
