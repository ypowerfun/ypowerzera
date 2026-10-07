import Link from "next/link";
import { gameLogoProps } from "@/games/logos";
import type { CSSProperties } from "react";

type WallGame = { id: string; slug: string; name: string };

/**
 * Parede de logos dos jogos para o banner da home: três colunas inclinadas que sobem e descem devagar. É DECORATIVA para
 * teclado e leitores de tela (escondida e fora da ordem de tabulação): alvos que se movem e saem da janela recortada não
 * servem de foco. O caminho acessível é o botão "Escolher um jogo" e a lista "Jogos suportados" logo abaixo. Para quem usa
 * o mouse, cada logo leva à página do jogo e mostra o nome ao passar o cursor.
 * Só CSS (sem JavaScript no navegador): pausa ao passar o mouse e fica parada, em ordem, com "reduzir movimento".
 */
export function GameWall({ games }: { games: WallGame[] }) {
  const cols: WallGame[][] = [[], [], []];
  games.forEach((g, i) => cols[i % 3].push(g));
  const speeds = ["46s", "58s", "52s"];
  return (
    <div aria-hidden="true" className="wall relative h-72 overflow-hidden sm:h-80 lg:h-auto lg:min-h-[27rem] [mask-image:linear-gradient(to_bottom,transparent,#000_14%,#000_86%,transparent)] lg:[mask-image:linear-gradient(to_right,transparent,#000_22%)]">
      <div className="wall-inner absolute -top-44 left-1/2 flex w-[28rem] -translate-x-1/2 origin-top rotate-[13deg] gap-3.5 sm:w-[32rem] lg:left-[60%] lg:-top-56 lg:w-[40rem]">
        {cols.map((list, ci) => (
          <div key={ci} className={`wall-col ${ci === 1 ? "wall-rev mt-14" : ""}`} style={{ "--wall-dur": speeds[ci] } as CSSProperties}>
            {[0, 1, 2].map((copy) => (
              <div key={copy} className={`wall-set ${copy > 0 ? "wall-dup" : ""}`}>
                {list.map((g) => {
                  const logo = gameLogoProps(g.id);
                  return (
                    <Link
                      key={g.id}
                      href={`/jogos/${g.slug}`}
                      tabIndex={-1}
                      className="group relative block aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-elevated shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)] transition duration-300 hover:z-10 hover:scale-[1.07] hover:border-brand/70 hover:shadow-glow"
                    >
                      {logo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo.src} srcSet={logo.srcSet} sizes="(min-width: 1024px) 205px, 140px" width={256} height={256} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      )}
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-1.5 pt-6 text-center text-[11px] font-black uppercase tracking-wider text-white opacity-0 transition group-hover:opacity-100">
                        {g.name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
