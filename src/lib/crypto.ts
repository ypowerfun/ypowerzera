import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { getEnv } from "./env";
import { AppError } from "./errors";

// O scrypt é caro de propósito (~0,3 s e dezenas de MB). Sem limite, uma rajada de logins/cadastros ocupa todas as threads do
// Node e trava o site inteiro para todo mundo. Poucos hashes ao mesmo tempo + fila curta; o resto recebe "tente em instantes".
const MAX_HASHING = process.env.NODE_ENV === "test" || process.env.VITEST ? 8 : 2;
const MAX_HASH_QUEUE = 48;
let hashing = 0;
const hashQueue: Array<() => void> = [];

async function acquireHashSlot(): Promise<void> {
  if (hashing < MAX_HASHING) {
    hashing++;
    return;
  }
  if (hashQueue.length >= MAX_HASH_QUEUE) throw new AppError("O servidor está ocupado agora. Tente novamente em alguns instantes.", "RATE_LIMIT");
  await new Promise<void>((resolve) => hashQueue.push(resolve)); // a vaga é repassada por releaseHashSlot (hashing não muda)
}

function releaseHashSlot(): void {
  const next = hashQueue.shift();
  if (next) next();
  else hashing--;
}

async function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  await acquireHashSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
    });
  } finally {
    releaseHashSlot();
  }
}

// OWASP: scrypt com N=2^15, r=8, p=3. Em testes usamos custo baixo para acelerar a suíte.
function params() {
  const test = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  return test ? { N: 2 ** 12, r: 8, p: 1 } : { N: 2 ** 15, r: 8, p: 3 };
}

const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = params();
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  try {
    const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (e) {
    if (e instanceof AppError) throw e; // "servidor ocupado" não pode virar "senha errada"
    return false;
  }
}

/** Hash "descartável" usado para igualar o tempo de resposta quando o usuário não existe. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}


// ───────────────────────── Proteção de dados sensíveis (CPF) ─────────────────────────

function masterSecret(): Buffer {
  const env = getEnv();
  const explicit = env.dataEncryptionKey;
  if (explicit) {
    const raw = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, "hex") : Buffer.from(explicit, "base64");
    if (raw.length >= 32) return raw.subarray(0, 32);
    throw new Error("DATA_ENCRYPTION_KEY deve ter 32 bytes (64 hex ou base64).");
  }
  if (env.isProd) throw new Error("DATA_ENCRYPTION_KEY é obrigatório em produção.");
  return Buffer.from(env.appSecret || "dev-only-insecure-secret", "utf8");
}

function derive(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterSecret(), Buffer.alloc(0), `prime-arena:${purpose}`, 32));
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<cifra> (base64url). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("field-encryption"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptField(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Campo cifrado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", derive("field-encryption"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC com chave derivada por finalidade. Determinístico: serve para comparar/deduplicar sem guardar o valor. */
export function hmacHex(value: string, purpose: string): string {
  return createHmac("sha256", derive(`hmac:${purpose}`)).update(value).digest("hex");
}

/** Segredo de assinatura do webhook do provedor Pix simulado (derivado, nunca fixo no código). */
export function mockWebhookSecret(): string {
  return derive("mock-pix-webhook").toString("hex");
}
