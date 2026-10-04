import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/server/session";
import { unreadCount } from "@/server/notifications";
import { Logo } from "./logo";
import { ButtonLink } from "./ui";

const NAV = [
  { href: "/torneios", label: "Torneios" },
  { href: "/jogos", label: "Jogos" },
  { href: "/desafios", label: "Desafios" },
];

export async function Header() {
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(user.id) : 0;
  const links = [...NAV, ...(user ? [{ href: "/carteira", label: "Carteira" }, { href: "/organizar", label: "Organizar" }] : [])];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" aria-label="PRiME ARENA MANAGER — início" className="shrink-0 focus-ring rounded">
          <Logo className="h-10 w-auto" />
        </Link>
        <nav aria-label="Principal" className="ml-2 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-ring">
              {l.label}
            </Link>
          ))}
          {user?.role === "ADMIN" && (
            <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10 focus-ring">
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/conta/notificacoes" className="relative rounded-lg p-2 text-muted hover:bg-elevated hover:text-ink focus-ring" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.700 21a2 2 0 0 1-3.400 0" />
                </svg>
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold text-bg">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-semibold focus-ring">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-strong text-xs font-extrabold">{user.displayName.slice(0, 1).toUpperCase()}</span>
                  <span className="hidden max-w-32 truncate sm:inline">{user.displayName}</span>
                </summary>
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                  {[
                    ["/conta", "Minha conta"],
                    ["/times", "Meus times"],
                    ["/carteira", "Carteira da equipe"],
                    ["/conta/pedidos", "Meus pedidos"],
                    ["/conta/inscricoes", "Minhas inscrições"],
                  ].map(([href, label]) => (
                    <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-ink">
                      {label}
                    </Link>
                  ))}
                  <form action={logoutAction}>
                    <button className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/10">Sair</button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <ButtonLink href="/entrar" variant="ghost">
                Entrar
              </ButtonLink>
              <ButtonLink href="/cadastro">Criar conta</ButtonLink>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Principal (mobile)" className="flex gap-1 overflow-x-auto border-t border-line-soft px-3 py-1.5 md:hidden">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-elevated hover:text-ink">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-surface/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Logo className="h-10 w-auto" />
          <p className="mt-3 max-w-sm text-sm text-muted">Campeonatos, chaves e desafios de esports em um só lugar — LoL, Valorant, CS2, Fortnite, Apex, Battlefield 6, Warzone, TFT, Street Fighter e EA FC.</p>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Plataforma</p>
          <ul className="space-y-1.5 text-muted">
            <li><Link href="/torneios" className="hover:text-ink">Torneios</Link></li>
            <li><Link href="/jogos" className="hover:text-ink">Jogos e formatos</Link></li>
            <li><Link href="/desafios" className="hover:text-ink">Desafios equipe vs equipe</Link></li>
            <li><Link href="/organizar" className="hover:text-ink">Organizar um campeonato</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Uso responsável</p>
          <p className="text-muted">Depósitos, saques e desafios valendo créditos são exclusivos para maiores de 18 anos com identidade verificada. Jogue com responsabilidade e nunca aposte valores de que precisa.</p>
        </div>
      </div>
      <div className="border-t border-line-soft py-4 text-center text-xs text-muted">© {new Date().getFullYear()} PRiME ARENA MANAGER. Todas as marcas citadas pertencem aos seus respectivos donos.</div>
    </footer>
  );
}
