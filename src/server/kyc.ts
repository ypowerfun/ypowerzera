import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptField, encryptField, hmacHex } from "@/lib/crypto";
import { ageInYears, isValidCpf, onlyDigits } from "@/lib/cpf";
import { audit } from "./audit";
import { notify } from "./notifications";
import { rateLimit } from "./rate-limit";
import { requireActor, requireVerified } from "./permissions";
import type { Actor } from "./types";

export const cpfHash = (cpf: string) => hmacHex(onlyDigits(cpf), "cpf");

const kycSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(5, "Informe o nome completo, como no documento.")
    .max(80)
    .refine((n) => n.split(/\s+/).filter((p) => p.length >= 2).length >= 2, "Informe nome e sobrenome."),
  cpf: z.string().refine(isValidCpf, "CPF inválido."),
  birthDate: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Data de nascimento inválida."),
});

/**
 * Cadastro de identidade (KYC): nome, CPF e nascimento. Maiores de 18 anos apenas.
 * Um CPF só pode estar em UMA conta (barra contas duplicadas). A aprovação é feita por um administrador.
 */
export async function submitKyc(actorIn: Actor | null, input: { fullName: string; cpf: string; birthDate: string | Date }) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const parsed = kycSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const { fullName, cpf, birthDate } = parsed.data;
  const age = ageInYears(birthDate);
  if (age < 18) throw new AppError("É necessário ter 18 anos ou mais para usar a carteira e os desafios.", "FORBIDDEN");
  if (age > 110) throw new AppError("Data de nascimento inválida.");
  await rateLimit(`kyc:${actor.id}`, 5, 86400, "Você enviou os dados muitas vezes hoje. Tente novamente amanhã.");

  const digits = onlyDigits(cpf);
  const hash = cpfHash(digits);
  const clash = await db.kycProfile.findUnique({ where: { cpfHash: hash } });
  if (clash && clash.userId !== actor.id) throw new AppError("Este CPF já está vinculado a outra conta.", "CONFLICT");
  const existing = await db.kycProfile.findUnique({ where: { userId: actor.id } });
  if (existing?.status === "VERIFIED") throw new AppError("Seus dados já foram verificados. Para alterá-los, fale com o suporte.", "CONFLICT");

  const data = { fullName, cpfHash: hash, cpfEnc: encryptField(digits), cpfLast4: digits.slice(-4), birthDate, status: "PENDING" as const, submittedAt: new Date(), reviewedAt: null, reviewedById: null, rejectReason: null };
  const profile = existing
    ? await db.kycProfile.update({ where: { userId: actor.id }, data })
    : await db.kycProfile.create({ data: { userId: actor.id, ...data } });
  await audit(actor.id, "kyc.submit", "User", actor.id, { cpfLast4: profile.cpfLast4 });
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await notify(admins.map((a) => a.id), "kyc.pending", "KYC aguardando análise", `${fullName} enviou os dados para verificação.`, "/admin/kyc");
  return { status: profile.status, fullName: profile.fullName, cpfLast4: profile.cpfLast4 };
}

export async function reviewKyc(actorIn: Actor | null, userId: string, decision: "approve" | "reject", reason?: string) {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores podem revisar o KYC.", "FORBIDDEN");
  if (actor.id === userId) throw new AppError("Você não pode revisar o próprio cadastro.", "FORBIDDEN");
  const p = await db.kycProfile.findUnique({ where: { userId } });
  if (!p) throw new AppError("Cadastro não encontrado.", "NOT_FOUND");
  if (p.status !== "PENDING") throw new AppError("Este cadastro já foi analisado.");
  if (decision === "reject" && (reason ?? "").trim().length < 5) throw new AppError("Informe o motivo da recusa.");
  if (decision === "approve" && ageInYears(p.birthDate) < 18) throw new AppError("Titular menor de idade.");
  await db.kycProfile.update({
    where: { userId },
    data: { status: decision === "approve" ? "VERIFIED" : "REJECTED", reviewedAt: new Date(), reviewedById: actor.id, rejectReason: decision === "reject" ? reason!.trim() : null },
  });
  await audit(actor.id, `kyc.${decision}`, "User", userId, { reason });
  await notify(
    userId,
    "kyc.reviewed",
    decision === "approve" ? "Identidade verificada" : "Verificação recusada",
    decision === "approve" ? "Você já pode sacar e jogar desafios valendo créditos." : `Motivo: ${reason!.trim()}`,
    "/carteira",
  );
}

export async function getKyc(userId: string) {
  const p = await db.kycProfile.findUnique({ where: { userId } });
  return p ? { status: p.status, fullName: p.fullName, cpfLast4: p.cpfLast4, rejectReason: p.rejectReason, reviewedAt: p.reviewedAt } : null;
}

export async function requireKyc(userId: string, level: "submitted" | "verified") {
  const p = await db.kycProfile.findUnique({ where: { userId } });
  if (!p || p.status === "REJECTED") throw new AppError("Antes de continuar, envie seus dados de identidade (CPF) em Carteira → Verificação.", "FORBIDDEN");
  if (level === "verified" && p.status !== "VERIFIED") throw new AppError("Sua identidade ainda está em análise. Você será avisado quando for aprovada.", "FORBIDDEN");
  return p;
}

/** CPF em claro — usado somente para pagar o saque na chave Pix do próprio titular. */
export async function getVerifiedCpf(userId: string): Promise<string> {
  const p = await requireKyc(userId, "verified");
  return decryptField(p.cpfEnc);
}
