import { getEnv } from "@/lib/env";
import { chatGPTSignOutPath } from "@/server/chatgpt-auth";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/session";
import { unreadCount } from "@/server/notifications";
import { isWalletOn } from "@/server/settings";
import { ROLE_LABELS } from "@/server/users-admin";
import { Logo } from "./logo";
import { NavLinks, type NavItem } from "./nav-links";
import { ScrollTabs } from "./scroll-tabs";
import { ButtonLink } from "./ui";

export async function Header() {
  const user = await getCurrentUser();
  const [unread, walletOn, orgMemberships] = await Promise.all([
    user ? unreadCount(user.id) : 0,
    isWalletOn(),
    user ? db.orgMember.count({ where: { userId: user.id, role: "STAFF", org: { deletedAt: null } } }) : 0, // jogador só vê Organizar se for equipe de apoio
  ]);
  // Organizar: organizador, admin ou quem é equipe de apoio de alguma organização. Carteira/Desafios: só com a carteira ativa.
  const showOrganizer = !!user && (user.role !== "USER" || orgMemberships > 0);
  const links: NavItem[] = [
    { href: "/torneios", label: "Torneios" },
    { href: "/viradao", label: "Viradão" },
    { href: "/jogos", label: "Jogos" },
    ...(walletOn ? [{ href: "/desafios", label: "Desafios" }] : []),
    ...(user && walletOn ? [{ href: "/carteira", label: "Carteira" }] : []),
    ...(showOrganizer ? [{ href: "/organizar", label: "Organizar" }] : []),
    ...(user?.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  const menu = [
    ["/conta", "Minha conta"],
    ["/times", "Meus times"],
    ...(walletOn ? [["/carteira", "Carteira da equipe"]] : []),
    ["/conta/pedidos", "Meus pedidos"],
    ["/conta/inscricoes", "Minhas inscrições"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 sm:gap-4">
        <Link href="/" aria-label="Prime Arena — início" className="shrink-0 rounded focus-ring">
          <Logo size="md" />
        </Link>
        <nav aria-label="Principal" className="ml-2 hidden items-center gap-1 md:flex">
          <NavLinks links={links} variant="desktop" />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/conta/notificacoes" className="relative rounded-md p-2 text-muted hover:bg-elevated hover:text-ink focus-ring" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.700 21a2 2 0 0 1-3.400 0" />
                </svg>
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-sm font-semibold focus-ring">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-strong text-xs font-extrabold">{user.displayName.slice(0, 1).toUpperCase()}</span>
                  <span className="hidden max-w-44 truncate sm:inline">{user.displayName}</span>
                </summary>
                <div className="absolute right-0 mt-2 w-60 rounded-lg border border-line bg-surface p-1.5 shadow-2xl">
                  <p className="px-3 pb-2 pt-1.5 text-xs text-muted">
                    Entrou como <b className="text-ink">{user.displayName}</b>
                    <span className="mt-1 block"><span className="inline-block bg-brand/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand-soft">{ROLE_LABELS[user.role]}</span></span>
                  </p>
                  {menu.map(([href, label]) => (
                    <Link key={href} href={href} className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-ink">
                      {label}
                    </Link>
                  ))}
                  {getEnv().authProvider === "chatgpt" ? <a href={chatGPTSignOutPath()} target="_top" className="mt-1 block rounded-md px-3 py-2 text-sm text-danger hover:bg-danger/10">Sair</a> : <form action={logoutAction}>
                    <button className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger/10">Sair</button>
                  </form>}
                </div>
              </details>
            </>
          ) : (
            <>
              <ButtonLink href="/entrar" variant="ghost" className="whitespace-nowrap px-3 sm:px-4">
                Entrar
              </ButtonLink>
              <ButtonLink href="/cadastro" className="whitespace-nowrap px-3 sm:px-4">Criar conta</ButtonLink>
            </>
          )}
        </div>
      </div>
      <ScrollTabs label="Principal (mobile)" wrapperClassName="border-t border-line-soft md:hidden" className="px-3 py-1.5">
        <NavLinks links={links} variant="mobile" />
      </ScrollTabs>
      <div aria-hidden className="glow-line opacity-80" />
    </header>
  );
}

export async function Footer() {
  const [walletOn, user] = await Promise.all([isWalletOn(), getCurrentUser()]);
  const showOrganizer = !!user && user.role !== "USER";
  return (
    <footer className="mt-16 bg-surface/70">
      <div aria-hidden className="glow-line" />
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo size="lg" />
          <p className="mt-3 max-w-sm text-sm text-muted">Campeonatos, chaves e resultados de esports em um só lugar — LoL, Valorant, CS2, Fortnite, Apex, Battlefield 6, Warzone, TFT, Street Fighter e EA FC.</p>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-silver">Plataforma</p>
          <ul className="space-y-2 text-muted">
            <li><Link href="/torneios" className="hover:text-ink">Torneios</Link></li>
            <li><Link href="/viradao" className="hover:text-ink">Viradão</Link></li>
            <li><Link href="/jogos" className="hover:text-ink">Jogos e formatos</Link></li>
            {walletOn && <li><Link href="/desafios" className="hover:text-ink">Desafios equipe vs equipe</Link></li>}
            {showOrganizer && <li><Link href="/organizar" className="hover:text-ink">Organizar um campeonato</Link></li>}
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-silver">Sua conta</p>
          <ul className="space-y-2 text-muted">
            <li><Link href={user ? "/conta" : "/entrar"} className="hover:text-ink">{user ? "Minha conta" : "Entrar"}</Link></li>
            <li><Link href={user ? "/times" : "/cadastro"} className="hover:text-ink">{user ? "Meus times" : "Criar conta"}</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-silver">Uso responsável</p>
          <p className="text-muted">Depósitos, saques e desafios valendo créditos são exclusivos para maiores de 18 anos com identidade verificada. Jogue com responsabilidade e nunca aposte valores de que precisa.</p>
        </div>
      </div>
      <div className="border-t border-line-soft py-4 text-center text-xs text-muted">© {new Date().getFullYear()} Prime Arena. Todas as marcas citadas pertencem aos seus respectivos donos.</div>
    </footer>
  );
}
