-- Tabelas do motor de transações do D1 (src/lib/d1-engine.ts). NÃO fazem parte do esquema do Prisma.
-- _Lease: trava global de escrita (uma linha). _Journal: diário de "desfazer" das transações em andamento.
CREATE TABLE IF NOT EXISTS "_Lease" (
    "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
    "owner" TEXT,
    "expiresAt" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO "_Lease" ("id", "owner", "expiresAt") VALUES (1, NULL, 0);

CREATE TABLE IF NOT EXISTS "_Journal" (
    "txId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "undo" TEXT NOT NULL,
    PRIMARY KEY ("txId", "seq")
);

-- Quarentena: diário que não conseguiu ser desfeito depois de várias tentativas (veja d1-engine.ts). Deve ficar vazia.
CREATE TABLE IF NOT EXISTS "_JournalDead" (
    "txId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "undo" TEXT NOT NULL,
    "deadAt" INTEGER NOT NULL
);
