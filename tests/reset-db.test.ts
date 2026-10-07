import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * `npm run reset` (scripts/reset-db.mjs): volta o banco local ao estado de fábrica, só com as contas padrão da seed.
 * Roda o script de verdade contra um banco temporário (nunca o dev.db nem o banco dos testes).
 */
const root = path.resolve(__dirname, "..");
const name = `reset-test-${process.pid}-${Date.now().toString(36)}`;
const url = `file:./${name}.db?connection_limit=1&socket_timeout=30`;
const dbFile = path.join(root, "prisma", `${name}.db`);
const backups = path.join(root, "prisma", "backups");

const DEFAULT_EMAILS = [
  "admin@primearena.local",
  "organizador@primearena.local",
  "kyc.pendente@primearena.local",
  ...[1, 2, 3, 4].map((i) => `lider${i}@primearena.local`),
  ...[1, 2, 3, 4, 5, 6].map((i) => `jogador${i}@primearena.local`),
].sort();

function reset(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("node", ["scripts/reset-db.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], // sem terminal: não dá para confirmar interativamente
    env: { ...process.env, DATABASE_URL: url, ...env },
    timeout: 240_000,
  });
}

async function emails() {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    return (await db.user.findMany({ select: { email: true } })).map((u) => u.email).sort();
  } finally {
    await db.$disconnect();
  }
}

afterAll(() => {
  for (const s of ["", "-journal", "-wal", "-shm"]) rmSync(dbFile + s, { force: true });
  if (existsSync(backups)) for (const f of readdirSync(backups)) if (f.startsWith(name)) rmSync(path.join(backups, f), { force: true });
});

describe("npm run reset", () => {
  it("recusa o que não é banco SQLite local, produção e confirmação sem terminal", () => {
    const external = reset(["--yes", "--force"], { DATABASE_URL: "postgresql://u:p@localhost:5432/prod" });
    expect(external.status).toBe(1);
    expect(external.stderr).toMatch(/SQLite local/);

    const prod = reset(["--yes", "--force"], { NODE_ENV: "production" });
    expect(prod.status).toBe(1);
    expect(prod.stderr).toMatch(/production/);

    const noTty = reset(["--force"]); // sem --yes e sem terminal
    expect(noTty.status).toBe(1);
    expect(noTty.stderr).toMatch(/--yes/);
    expect(existsSync(dbFile)).toBe(false); // nada foi criado nem apagado
  });

  it("apaga tudo o que foi criado depois e deixa só as contas padrão, guardando uma cópia antes", async () => {
    const first = reset(["--yes", "--force", "--no-backup"]); // banco ainda não existe: cria do zero
    expect(first.status, first.stderr + first.stdout).toBe(0);
    expect(await emails()).toEqual(DEFAULT_EMAILS);

    // alguém se cadastra, outro vira "admin"... e depois queremos voltar ao padrão
    const db = new PrismaClient({ datasources: { db: { url } } });
    const original = (await db.user.findUniqueOrThrow({ where: { email: "admin@primearena.local" } })).passwordHash;
    await db.user.create({ data: { email: "intruso@teste.dev", username: "intruso", displayName: "Intruso", passwordHash: "x" } });
    await db.user.update({ where: { email: "admin@primearena.local" }, data: { passwordHash: "senha-trocada" } });
    await db.user.update({ where: { email: "jogador5@primearena.local" }, data: { role: "ORGANIZER" } });
    await db.$disconnect();
    expect(await emails()).toContain("intruso@teste.dev");

    const second = reset(["--yes", "--force"]);
    expect(second.status, second.stderr + second.stdout).toBe(0);
    expect(second.stdout).toMatch(/Cópia de segurança: prisma[\\/]backups[\\/]/);
    expect(await emails()).toEqual(DEFAULT_EMAILS); // o intruso sumiu; só as padrão

    const after = new PrismaClient({ datasources: { db: { url } } });
    try {
      const admin = await after.user.findUniqueOrThrow({ where: { email: "admin@primearena.local" } });
      expect(admin.passwordHash).not.toBe("senha-trocada"); // a senha volta ao padrão (o hash tem sal, então só confirmo que mudou)
      expect(original).toBeTruthy();
      expect((await after.user.findUniqueOrThrow({ where: { email: "jogador5@primearena.local" } })).role).toBe("USER"); // cargo volta
      expect(await after.session.count()).toBe(0); // ninguém continua logado
    } finally {
      await after.$disconnect();
    }
    expect(readdirSync(backups).some((f) => f.startsWith(name))).toBe(true);
  }, 300_000);
});
