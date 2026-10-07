import { expect, test } from "@playwright/test";
import { login, loginOk, logout, openTeamWallet } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("público", () => {
  test("home, catálogo com os 10 jogos e torneios do seed", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Prime Arena/i);
    await expect(page.locator("img[alt*='Prime Arena']").first()).toBeVisible();

    await page.goto("/jogos");
    for (const g of ["League of Legends", "VALORANT", "Counter-Strike 2", "Fortnite", "Apex Legends", "Battlefield 6", "Street Fighter", "Call of Duty: Warzone", "EA SPORTS FC", "Teamfight Tactics"]) {
      await expect(page.getByText(g, { exact: false }).first()).toBeVisible();
    }

    await page.goto("/torneios");
    await expect(page.getByText("Copa Prime Arena de Street Fighter")).toBeVisible();
    await expect(page.getByText("Prime Arena Valorant Cup #1")).toBeVisible();
  });

  test("tema grafite com vermelho aplicado (fundo escuro, texto claro, botão principal vermelho)", async ({ page }) => {
    await page.goto("/");
    const [bg, fg] = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return [s.backgroundColor, s.color];
    });
    const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    expect(lum(bg)).toBeLessThan(60);
    expect(lum(fg)).toBeGreaterThan(160);
    const primary = page.getByRole("link", { name: /Escolher um jogo/ }).first();
    expect(await primary.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("225, 29, 42"); // vermelho da marca (#e11d2a)
  });

  test("páginas protegidas exigem login e admin exige papel de admin", async ({ page }) => {
    for (const p of ["/carteira", "/desafios/novo", "/organizar", "/admin", "/conta"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/entrar/);
    }
    await loginOk(page, "jogador1@primearena.local");
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/); // usuário comum é mandado para a home
    await expect(page.getByText("Fila de trabalho de segurança")).toHaveCount(0);
    for (const p of ["/admin/kyc", "/admin/saques", "/admin/carteiras"]) {
      await page.goto(p);
      await expect(page).not.toHaveURL(/\/admin/);
    }
    await logout(page);
  });

  test("login: senha errada mostra erro genérico", async ({ page }) => {
    await login(page, "lider1@primearena.local", "SenhaErrada#1");
    await expect(page.getByText(/inválid|incorret/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });
});

test.describe("carteira e desafios", () => {
  let challengeUrl = "";

  test("líder vê a carteira da própria equipe, com a aposta bloqueada", async ({ page }) => {
    await loginOk(page, "lider1@primearena.local");
    await openTeamWallet(page, "Trovão Azul");
    await expect(page.getByText(/450,00/).first()).toBeVisible(); // 500 depositados − 50 bloqueados
    await expect(page.getByText(/50,00/).first()).toBeVisible();
    await page.screenshot({ path: "test-results/carteira.png", fullPage: true });
  });

  test("depósito: Pix copia-e-cola, pagamento simulado e crédito pelo webhook assinado", async ({ page }) => {
    await loginOk(page, "lider1@primearena.local");
    await openTeamWallet(page, "Trovão Azul");
    await page.getByLabel("Valor em créditos").first().fill("20");
    await page.getByRole("button", { name: "Gerar Pix" }).click();
    const pix = page.getByLabel("Pix copia e cola");
    await expect(pix).toBeVisible();
    expect(await pix.inputValue()).not.toBe("");

    // simulador do provedor (somente dev): paga com o CPF do titular
    await page.goto("/dev/pix");
    await expect(page.getByText(/simulador/i).first()).toBeVisible();
  });

  test("outra equipe aceita o desafio aberto e a aposta é bloqueada", async ({ page }) => {
    await loginOk(page, "lider4@primearena.local");
    await page.goto("/desafios");
    await page.getByRole("link", { name: /Trovão Azul/ }).first().click();
    await page.waitForURL(/\/desafios\/(?!novo)[^/?]+$/, { timeout: 90_000 });
    challengeUrl = page.url();
    await expect(page.getByText("Vencedor recebe")).toBeVisible();
    await expect(page.getByText(/90,00/).first()).toBeVisible(); // pote 100 − taxa de 10%

    // passo 1: escolher a equipe; passo 2: escalar e confirmar
    await page.getByLabel("Sua equipe").selectOption({ label: /Sombra Prime/ as unknown as string }).catch(async () => {
      await page.getByLabel("Sua equipe").selectOption({ index: 1 });
    });
    await page.getByRole("button", { name: "Escolher" }).click();
    await page.getByRole("button", { name: /Aceitar e bloquear/ }).click();
    await expect(page.getByText("Sombra Prime").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Aceitar e bloquear/ })).toHaveCount(0);
    await page.screenshot({ path: "test-results/desafio-aceito.png", fullPage: true });
  });

  test("líder não pode aceitar o próprio desafio nem sacar saldo não jogado", async ({ page }) => {
    await loginOk(page, "lider1@primearena.local");
    await page.goto(challengeUrl);
    await expect(page.getByRole("button", { name: /Aceitar e bloquear/ })).toHaveCount(0);

    await openTeamWallet(page, "Trovão Azul");
    // depósito sem giro fica retido: o formulário de saque fica desabilitado
    const credits = page.getByLabel(/Valor em créditos \(sacável/);
    await expect(credits).toBeDisabled();
    await expect(page.getByText(/Nada sacável agora/)).toBeVisible();

    // ataque: reabilita os campos pelo DOM e envia mesmo assim — quem recusa é o SERVIDOR
    await page.evaluate(() => {
      for (const id of ["wd-credits", "wd-pass"]) {
        const el = document.getElementById(id) as HTMLInputElement;
        el.disabled = false;
        el.removeAttribute("min");
        el.removeAttribute("max");
      }
    });
    await credits.fill("100");
    await page.getByLabel("Confirme sua senha").fill("Prime#Arena2026");
    await page.getByRole("button", { name: "Solicitar saque" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Saldo sacável: R$ 0,00" })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/450,00/).first()).toBeVisible(); // saldo intacto
    await expect(page.getByText("Nenhum saque ainda")).toBeVisible(); // nenhum saque foi criado
  });

  test("quem não é líder não acessa a carteira de outra equipe", async ({ page }) => {
    await loginOk(page, "jogador1@primearena.local");
    await page.goto("/carteira");
    await expect(page.getByText("Trovão Azul")).toHaveCount(0);
  });
});

test.describe("administração", () => {
  test("fila do admin, arbitragem, KYC e conciliação", async ({ page }) => {
    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin");
    await expect(page.getByText("Fila de trabalho de segurança")).toBeVisible();
    await page.screenshot({ path: "test-results/admin.png", fullPage: true });

    // KYC pendente
    await page.goto("/admin/kyc");
    await expect(page.getByText("Maria Pendente de Souza")).toBeVisible();
    await expect(page.getByText(/•••\.•••\.•••/)).toBeVisible(); // CPF nunca aparece por inteiro
    await page.getByRole("button", { name: "Aprovar" }).click();
    await expect(page.getByText("Cadastro analisado.")).toBeVisible();

    // depósito retido por CPF de terceiro
    await page.goto("/admin/depositos");
    await expect(page.getByText(/CPF/).first()).toBeVisible();

    // disputa: árbitro decide
    await page.goto("/admin/desafios");
    await expect(page.getByText("Lobos do Norte × Sombra Prime")).toBeVisible();
    await page.getByLabel("Decisão").selectOption({ index: 0 });
    await page.getByPlaceholder(/Fundamento/).fill("Vídeo comprova a vitória do criador; queda foi do adversário.");
    await page.getByRole("button", { name: "Decidir" }).click();
    await expect(page.getByText("Disputa decidida.")).toBeVisible();

    // conciliação do razão deve fechar depois de tudo isso
    await page.goto("/admin/carteiras");
    await page.getByRole("button", { name: "Conciliar" }).click();
    await expect(page.getByText(/Conciliação OK/)).toBeVisible();
  });
});

test.describe("cabeçalhos de segurança", () => {
  test("CSP e demais cabeçalhos presentes e a app continua funcional sob a CSP", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
    const res = await page.goto("/entrar");
    const h = res!.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
    await login(page, "lider2@primearena.local", "Prime#Arena2026"); // formulário + server action sob CSP
    await expect(page).not.toHaveURL(/\/entrar/);
    expect(errors).toEqual([]);
  });
});

test.describe("responsividade", () => {
  test("sem rolagem horizontal em celular (390px), deslogado e logado", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "pt-BR" });
    const page = await ctx.newPage();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const p of ["/", "/jogos", "/jogos/valorant", "/torneios", "/entrar", "/cadastro", "/desafios"]) {
      await page.goto(p);
      expect(await overflow(), `overflow em ${p}`).toBeLessThanOrEqual(0);
    }
    // o nome do campeonato aparece inteiro no cartão (não truncado ao lado do selo)
    await page.goto("/torneios");
    await expect(page.getByRole("heading", { name: "Copa Prime Arena de Street Fighter" })).toBeVisible();

    await loginOk(page, "lider1@primearena.local");
    for (const p of ["/carteira", "/desafios/novo", "/times", "/conta"]) {
      await page.goto(p);
      expect(await overflow(), `overflow em ${p}`).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });
});

test.describe("marca Prime Arena", () => {
  test("nome, ícones, imagem de compartilhamento e arte oficial são servidos", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Prime Arena/);
    await expect(page.getByRole("link", { name: /Prime Arena — início/ })).toBeVisible();
    await expect(page.getByText("PRiME ARENA MANAGER")).toHaveCount(0); // nome antigo não aparece mais

    // favicon e ícone de celular vêm da logo (arquivos icon.png / apple-icon.png do Next)
    const icons = await page.locator("link[rel='icon'], link[rel='apple-touch-icon']").evaluateAll((els) => els.map((e) => (e as HTMLLinkElement).href));
    expect(icons.length).toBeGreaterThan(0);
    for (const href of icons) {
      const r = await request.get(href);
      expect(r.status(), href).toBe(200);
      expect(r.headers()["content-type"]).toContain("image/");
    }

    // imagem de compartilhamento (Open Graph) e a arte oficial da logo
    const og = await page.locator("meta[property='og:image']").getAttribute("content");
    expect(og).toBeTruthy();
    expect((await request.get(og!)).status()).toBe(200);
    for (const src of ["/brand/prime-arena-logo-160.webp", "/brand/prime-arena-logo-320.webp", "/brand/prime-arena-logo-640.webp", "/brand/prime-arena-logo-1248.webp", "/games/lol-128.webp", "/games/sf6-256.webp", "/games/cs2-512.webp"]) {
      const r = await request.get(src);
      expect(r.status(), src).toBe(200);
      expect(r.headers()["content-type"]).toContain("image/webp");
    }

    // a logo do cabeçalho carregou de verdade (não é imagem quebrada)
    const art = page.getByRole("img", { name: "Prime Arena" }).first();
    await expect(art).toBeVisible();
    expect(await art.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  });
});

test.describe("regressões da revisão visual", () => {
  const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  test("botão claro tem texto escuro (a cor do link não sobrescreve o utilitário)", async ({ page }) => {
    await page.goto("/");
    const light = page.getByRole("link", { name: "Ver torneios", exact: true }).first();
    expect(lum(await light.evaluate((e) => getComputedStyle(e).color))).toBeLessThan(60); // texto escuro sobre o botão prateado
    // links com text-brand-soft realmente ficam vermelhos (não herdam o branco do pai)
    const soft = page.getByRole("link", { name: /Ver todos/ }).first();
    const [r, , b] = (await soft.evaluate((e) => getComputedStyle(e).color)).match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(b + 60);
  });

  test("404 usa o tema escuro, com cabeçalho e caminhos de volta", async ({ page }) => {
    const res = await page.goto("/pagina-que-nao-existe");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    expect(lum(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))).toBeLessThan(60);
    await expect(page.getByRole("link", { name: "Voltar ao início" })).toBeVisible();
  });

  test("/jogos/cs2 leva ao endereço oficial do jogo", async ({ page }) => {
    await page.goto("/jogos/cs2");
    await expect(page).toHaveURL(/\/jogos\/counter-strike-2$/);
    await expect(page.getByRole("heading", { name: "Counter-Strike 2", level: 1 })).toBeVisible();
  });

  test("barra do admin marca a página atual", async ({ page }) => {
    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin/kyc");
    const nav = page.getByRole("navigation", { name: "Administração" });
    await expect(nav.locator("[aria-current='page']")).toHaveText("KYC");
    await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
  });
});

test.describe("cargos, time excluído e chave da carteira", () => {
  test("admin promove jogador a organizador e volta para jogador; jogador não organiza", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    // jogador comum: área do organizador restrita e sem formulário de criação
    await loginOk(page, "jogador5@primearena.local");
    await page.goto("/organizar");
    await expect(page.getByText("Seu cargo é Jogador")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar organização" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Organizar" })).toHaveCount(0);
    await logout(page);

    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin/usuarios?q=jogador5");
    const row = page.getByRole("row").filter({ hasText: "jogador5" });
    await expect(row.getByText("Jogador", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Tornar organizador" }).click();
    await expect(page.getByText("Cargo atualizado.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "jogador5" }).getByText("Organizador", { exact: true })).toBeVisible();
    await logout(page);

    await loginOk(page, "jogador5@primearena.local");
    await page.goto("/organizar");
    await expect(page.getByRole("button", { name: "Criar organização" })).toBeVisible();
    await logout(page);

    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin/usuarios?q=jogador5");
    await page.getByRole("row").filter({ hasText: "jogador5" }).getByRole("button", { name: "Voltar para jogador" }).click();
    await expect(page.getByText("Cargo atualizado.")).toBeVisible();
    // o admin não tem botão de mudança de cargo na própria linha nem na de outros admins
    await page.goto("/admin/usuarios?q=admin%40primearena");
    await expect(page.getByRole("row").filter({ hasText: "admin@primearena.local" }).getByRole("button")).toHaveCount(0);
    await logout(page);
  });

  test("admin vê todas as organizações no painel do organizador", async ({ page }) => {
    await loginOk(page, "admin@primearena.local");
    await page.goto("/organizar");
    await expect(page.getByRole("heading", { name: "Todas as organizações" })).toBeVisible();
    await expect(page.getByText("Prime Arena Oficial").first()).toBeVisible();
    await expect(page.getByText("Admin da plataforma").first()).toBeVisible();
    await logout(page);
  });

  test("time excluído: saldo bloqueado, pedido de revisão, liberação pelo admin e saque", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    await loginOk(page, "lider2@primearena.local");
    await page.goto("/times");
    await page.getByRole("link", { name: /Fênix Digital/ }).first().click();
    await page.waitForURL(/\/times\/[^/]+$/, { timeout: 90_000 });
    const teamUrl = page.url();
    await expect(page.getByText(/ficará bloqueado/)).toBeVisible();
    await page.getByRole("button", { name: "Excluir time" }).click();
    await expect(page.getByText(/O saldo ficou BLOQUEADO/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Fênix Digital/ })).toHaveCount(0); // sumiu da lista de times

    // a equipe excluída não movimenta mais o saldo; a Carteira mostra o bloqueio e o pedido de revisão
    await page.goto("/carteira");
    await expect(page.getByRole("heading", { name: "Equipes excluídas com saldo" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Equipes excluídas com saldo" }).locator("span", { hasText: /^bloqueado$/ })).toBeVisible();
    await page.getByLabel(/Explique o pedido/).fill("O time foi desfeito e quero sacar o saldo para a minha conta.");
    await page.getByRole("button", { name: "Pedir revisão do saldo" }).click();
    await expect(page.getByText(/Pedido enviado/)).toBeVisible();
    await expect(page.getByText(/Pedido de revisão enviado em/)).toBeVisible();
    await logout(page);

    // o admin analisa e libera
    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin/saldos");
    const card = page.locator("div").filter({ has: page.getByText("Fênix Digital") }).filter({ has: page.getByRole("button", { name: "Liberar saldo para saque" }) }).last();
    await card.getByLabel("Justificativa da liberação").fill("Histórico conferido: depósitos e prêmios do próprio time.");
    await card.getByRole("button", { name: "Liberar saldo para saque" }).click();
    await expect(page.getByText("Saldo liberado para saque pelo ex-líder.")).toBeVisible();
    await logout(page);

    // o ex-líder agora vê o saldo liberado e pode ir ao saque (sem a opção de depositar)
    await loginOk(page, "lider2@primearena.local");
    await page.goto("/carteira");
    await expect(page.getByText("liberado para saque").first()).toBeVisible();
    await page.getByRole("link", { name: "Sacar o saldo" }).click();
    await page.waitForURL(/\/carteira\/[^/]+$/, { timeout: 90_000 });
    await expect(page.getByText("Saldo liberado.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Depositar via Pix" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sacar por Pix" })).toBeVisible();
    // o time excluído continua visível para o elenco, com o aviso
    await page.goto(teamUrl);
    await expect(page.getByText(/Este time foi excluído/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Excluir time" })).toHaveCount(0);
    await logout(page);

    // quem nunca foi do elenco não vê o time excluído
    await loginOk(page, "jogador6@primearena.local");
    expect((await page.goto(teamUrl))?.status()).toBe(404);
    await logout(page);
  });

  test("chave da carteira: desativar esconde a aba e bloqueia as telas; religar restaura", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const nav = page.getByRole("navigation", { name: "Principal" });
    await loginOk(page, "admin@primearena.local");
    await page.goto("/admin/configuracoes");
    try {
      await expect(page.getByText("Ativa para os usuários")).toBeVisible();
      await page.getByRole("button", { name: "Desativar a carteira" }).click();
      await expect(page.getByText(/Carteira desativada/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Ativar a carteira" })).toBeVisible();

      await page.goto("/");
      await expect(nav.getByRole("link", { name: "Carteira" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Desafios" })).toHaveCount(0);
      for (const path of ["/carteira", "/desafios", "/desafios/novo"]) {
        await page.goto(path);
        await expect(page.getByText("Carteira indisponível no momento")).toBeVisible();
      }
    } finally {
      await page.goto("/admin/configuracoes");
      const on = page.getByRole("button", { name: "Ativar a carteira" });
      if (await on.isVisible()) await on.click();
      await expect(page.getByText(/Carteira ativada/)).toBeVisible();
    }
    await page.goto("/");
    await expect(nav.getByRole("link", { name: "Carteira" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Desafios" })).toBeVisible();
    await logout(page);
  });

  test("navegação parcial (RSC) sem login não entrega dados do admin: a guarda está em cada página, não só no layout", async ({ request }) => {
    // o cliente do Next manda o estado da árvore e o servidor PULA os layouts que ele diz já ter; sem guarda na página, vazava
    const tree = JSON.stringify(["", { children: ["admin", { children: ["__PAGE__", {}] }] }]);
    for (const path of ["/admin", "/admin/carteiras", "/admin/kyc", "/admin/saques", "/admin/depositos", "/admin/desafios", "/admin/usuarios", "/admin/saldos", "/admin/equipes", "/admin/configuracoes"]) {
      const res = await request.get(path, { headers: { RSC: "1", "Next-Router-State-Tree": tree } });
      const body = await res.text();
      for (const secret of ["Trovão Azul", "Lobos do Norte", "Sombra Prime", "Fênix Digital", "Maria Pendente", "primearena.local"]) {
        expect(body, `${path} vazou "${secret}"`).not.toContain(secret);
      }
    }
  });
});

test.describe("banner da home, logos dos jogos e organização", () => {
  test("banner: 'Qual jogo você joga?' com a parede de logos; sem o 'R$ 1 = 1 crédito'; cada logo leva ao jogo", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("section[aria-labelledby='hero-title']");
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText(/Qual jogo\s*você joga\?/i);
    await expect(hero.getByText("Troféus e R$")).toBeVisible();
    await expect(hero.getByText(/1 crédito/)).toHaveCount(0);
    await expect(hero.getByText("CRIE. DISPUTE")).toHaveCount(0);
    await expect(hero.getByRole("link", { name: /Escolher um jogo/ })).toHaveAttribute("href", "/jogos");

    // 10 logos clicáveis (as cópias do laço contínuo ficam escondidas dos leitores de tela)
    const tiles = page.locator(".wall").getByRole("link");
    await expect(tiles).toHaveCount(10);
    const broken = await page.locator(".wall img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
    expect(broken).toBe(0);
    // cada logo aponta para a página do seu jogo (a parede anima, então confiro o endereço em vez de clicar num alvo em movimento)
    const hrefs = await tiles.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")));
    expect([...hrefs].sort()).toEqual(
      ["apex-legends", "battlefield-6", "call-of-duty-warzone", "counter-strike-2", "ea-sports-fc", "fortnite", "league-of-legends", "street-fighter", "teamfight-tactics", "valorant"].map((s) => `/jogos/${s}`).sort(),
    );
    await page.goto("/jogos/street-fighter");
    await expect(page.getByRole("heading", { name: "Street Fighter", level: 1 })).toBeVisible();
  });

  test("com 'reduzir movimento' a parede fica parada e sem cópias repetidas", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await page.locator(".wall-col").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    expect(await page.locator(".wall-dup").first().evaluate((e) => getComputedStyle(e).display)).toBe("none");
  });

  test("catálogo: logo ao lado de cada jogo, sem CS:GO, 'Street Fighter' (e os endereços antigos continuam valendo)", async ({ page }) => {
    await page.goto("/jogos");
    await expect(page.locator("main img[src*='/games/']")).toHaveCount(10);
    await expect(page.getByText("CS:GO")).toHaveCount(0);
    await expect(page.getByText("Street Fighter 6")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Street Fighter", exact: true })).toBeVisible();
    await page.goto("/jogos/street-fighter-6");
    await expect(page).toHaveURL(/\/jogos\/street-fighter$/);
    await page.goto("/jogos/counter-strike-go");
    await expect(page).toHaveURL(/\/jogos\/counter-strike-2$/);
  });

  test("torneios: filtro por jogo com a logo de cada um", async ({ page }) => {
    await page.goto("/torneios");
    const filter = page.getByRole("navigation", { name: "Filtrar por jogo" });
    await expect(filter.locator("img[src*='/games/']")).toHaveCount(10);
    await filter.getByRole("link", { name: "VALORANT" }).click();
    await expect(page).toHaveURL(/jogo=valorant/);
    await expect(page.getByText("Prime Arena Valorant Cup #1")).toBeVisible();
    await expect(page.getByText("Copa Prime Arena de Street Fighter")).toHaveCount(0);
    await expect(filter.getByRole("link", { name: "VALORANT" })).toHaveAttribute("aria-current", "page");
  });

  test("organização: criar, editar/renomear e excluir; com campeonato aberto não exclui", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    await loginOk(page, "organizador@primearena.local");
    await page.goto("/organizar");
    await page.locator("details", { hasText: "Criar outra organização" }).locator("summary").click();
    const create = page.locator("details", { hasText: "Criar outra organização" });
    await create.getByLabel("Nome").fill("Liga E2E Temporária");
    await create.getByRole("button", { name: "Criar organização" }).click();
    await page.waitForURL(/\/organizar\/novo/);
    await page.goto("/organizar");

    const card = () => page.locator("div").filter({ has: page.getByRole("heading", { name: /Liga E2E/ }) }).filter({ has: page.getByText("Editar organização") }).last();
    await expect(page.getByRole("heading", { name: "Liga E2E Temporária" })).toBeVisible();
    await card().getByText("Editar organização").click();
    await card().getByLabel("Nome", { exact: true }).fill("Liga E2E Renomeada");
    await card().getByLabel(/Descrição/).fill("Organização criada pelo teste.");
    await card().getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Organização atualizada.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Liga E2E Renomeada" })).toBeVisible();
    await expect(page.locator("p", { hasText: "Organização criada pelo teste." })).toBeVisible();

    // nome errado não exclui
    await card().getByText("Excluir organização…").click();
    await card().getByLabel(/Para confirmar, digite o nome/).fill("Outro nome");
    await card().getByRole("button", { name: "Excluir organização" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "nome exato" })).toBeVisible();
    // nome certo exclui e volta ao painel com a confirmação
    await card().getByLabel(/Para confirmar, digite o nome/).fill("Liga E2E Renomeada");
    await card().getByRole("button", { name: "Excluir organização" }).click();
    await expect(page.getByText("Organização excluída.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Liga E2E Renomeada" })).toHaveCount(0);

    // a organização do seed tem campeonatos abertos: o servidor recusa mesmo com o nome certo
    const official = page.locator("div").filter({ has: page.getByRole("heading", { name: "Prime Arena Oficial" }) }).filter({ has: page.getByText("Excluir organização…") }).last();
    await official.getByText("Excluir organização…").click();
    await official.getByLabel(/Para confirmar, digite o nome/).fill("Prime Arena Oficial");
    await official.getByRole("button", { name: "Excluir organização" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /aberto\(s\) ou em andamento/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prime Arena Oficial" })).toBeVisible();
    await logout(page);
  });

  test("jogador comum e equipe de apoio não veem editar/excluir organização", async ({ page }) => {
    await loginOk(page, "jogador1@primearena.local");
    await page.goto("/organizar");
    await expect(page.getByText("Editar organização")).toHaveCount(0);
    await expect(page.getByText("Excluir organização…")).toHaveCount(0);
    await logout(page);
  });
});

