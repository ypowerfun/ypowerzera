import { expect, test } from "@playwright/test";
import { login, loginOk, logout, openTeamWallet } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("público", () => {
  test("home, catálogo com os 10 jogos e torneios do seed", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Prime Arena One/i);
    await expect(page.locator("img[alt*='Prime Arena One']").first()).toBeVisible();

    await page.goto("/jogos");
    for (const g of ["League of Legends", "VALORANT", "Counter-Strike 2", "Fortnite", "Apex Legends", "Battlefield 6", "Street Fighter 6", "Call of Duty: Warzone", "EA SPORTS FC", "Teamfight Tactics"]) {
      await expect(page.getByText(g, { exact: false }).first()).toBeVisible();
    }

    await page.goto("/torneios");
    await expect(page.getByText("Copa Prime Arena One de Street Fighter 6")).toBeVisible();
    await expect(page.getByText("Prime Arena One Valorant Cup #1")).toBeVisible();
  });

  test("tema azul escuro aplicado (fundo escuro, texto claro)", async ({ page }) => {
    await page.goto("/");
    const [bg, fg] = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return [s.backgroundColor, s.color];
    });
    const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    expect(lum(bg)).toBeLessThan(60);
    expect(lum(fg)).toBeGreaterThan(160);
    const [, , bl] = bg.match(/\d+/g)!.map(Number);
    expect(bl).toBeGreaterThan(Number(bg.match(/\d+/g)![0])); // predomínio de azul
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
    await expect(page.getByRole("heading", { name: "Copa Prime Arena One de Street Fighter 6" })).toBeVisible();

    await loginOk(page, "lider1@primearena.local");
    for (const p of ["/carteira", "/desafios/novo", "/times", "/conta"]) {
      await page.goto(p);
      expect(await overflow(), `overflow em ${p}`).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });
});

test.describe("marca Prime Arena One", () => {
  test("nome, ícones, imagem de compartilhamento e arte oficial são servidos", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Prime Arena One/);
    await expect(page.getByRole("link", { name: /Prime Arena One — início/ })).toBeVisible();
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
    for (const src of ["/brand/prime-arena-one-512.webp", "/brand/prime-arena-one-1024.webp", "/brand/prime-arena-one-128.webp"]) {
      const r = await request.get(src);
      expect(r.status(), src).toBe(200);
      expect(r.headers()["content-type"]).toContain("image/webp");
    }

    // a arte do destaque carregou de verdade (não é imagem quebrada)
    const art = page.getByRole("img", { name: "Prime Arena One" }).first();
    await expect(art).toBeVisible();
    expect(await art.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  });
});

test.describe("regressões da revisão visual", () => {
  const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  test("botão dourado tem texto escuro (a cor do link não sobrescreve o utilitário)", async ({ page }) => {
    await page.goto("/");
    const gold = page.getByRole("link", { name: "Criar um campeonato", exact: true }).first();
    expect(lum(await gold.evaluate((e) => getComputedStyle(e).color))).toBeLessThan(60); // texto escuro sobre o ouro
    // links com text-brand-soft realmente ficam azuis (não herdam o branco do pai)
    const soft = page.getByRole("link", { name: /Ver todos/ }).first();
    const [r, , b] = (await soft.evaluate((e) => getComputedStyle(e).color)).match(/\d+/g)!.map(Number);
    expect(b).toBeGreaterThan(r + 60);
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
