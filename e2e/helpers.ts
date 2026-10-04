import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Prime#Arena2026";

export async function login(page: Page, who: string, password = PASSWORD) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail ou usuário").fill(who);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

export async function loginOk(page: Page, who: string) {
  await login(page, who);
  await expect(page).not.toHaveURL(/\/entrar/);
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/** Ignora diferenças de espaço (nbsp) na formatação de moeda. */
export const money = (v: string) => new RegExp(v.replace(/ /g, "\\s").replace(/\./g, "\\.").replace(/R\$/g, "R\\$"));

/** Abre a carteira de uma equipe pela lista (a 1ª visita compila a rota no modo dev, então o prazo é generoso). */
export async function openTeamWallet(page: Page, teamName: string) {
  await page.goto("/carteira");
  await page.getByRole("link", { name: new RegExp(teamName) }).first().click();
  await page.waitForURL(/\/carteira\/[^/]+$/, { timeout: 90_000 });
  await expect(page.getByText("Saldo disponível")).toBeVisible({ timeout: 30_000 });
}
