"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, safeNext, str, strRaw, type FormState } from "@/lib/action-helpers";
import { changePassword, login, logout, registerUser, requestPasswordReset, resendVerification, resetPassword, updateProfile, verifyEmail } from "@/server/auth";
import { clearSessionCookie, clientMeta, currentToken, requireUser, setSessionCookie } from "@/server/session";

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const meta = await clientMeta();
  const password = strRaw(fd, "password");
  if (password !== strRaw(fd, "password2")) return { error: "As senhas não conferem." };
  if (fd.get("terms") !== "on") return { error: "Você precisa aceitar os Termos de Uso." };
  const res = await guard(async () => {
    await registerUser({ email: str(fd, "email"), username: str(fd, "username"), displayName: str(fd, "displayName"), password }, meta);
    return login({ identifier: str(fd, "email"), password }, meta);
  });
  if (!res.ok) return { error: res.error };
  await setSessionCookie(res.value.token, res.value.expiresAt);
  redirect("/conta?boas-vindas=1");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const meta = await clientMeta();
  const res = await guard(() => login({ identifier: str(fd, "identifier"), password: strRaw(fd, "password") }, meta));
  if (!res.ok) return { error: res.error };
  await setSessionCookie(res.value.token, res.value.expiresAt);
  redirect(safeNext(str(fd, "next")));
}

export async function logoutAction() {
  await logout(await currentToken());
  await clearSessionCookie();
  redirect("/");
}

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const meta = await clientMeta();
  const res = await guard(() => requestPasswordReset(str(fd, "email"), meta));
  if (!res.ok) return { error: res.error };
  return { success: "Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha." };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const password = strRaw(fd, "password");
  if (password !== strRaw(fd, "password2")) return { error: "As senhas não conferem." };
  const res = await guard(() => resetPassword(str(fd, "token"), password));
  if (!res.ok) return { error: res.error };
  redirect("/entrar?senha-redefinida=1");
}

export async function verifyEmailAction(token: string): Promise<{ ok: boolean; error?: string }> {
  const res = await guard(() => verifyEmail(token));
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function resendVerificationAction(_: FormState): Promise<FormState> {
  const user = await requireUser("/conta");
  const res = await guard(() => resendVerification(user.id));
  if (!res.ok) return { error: res.error };
  return { success: "Enviamos um novo link de confirmação para o seu e-mail." };
}

export async function updateProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/conta");
  const res = await guard(() => updateProfile(user.id, { displayName: str(fd, "displayName"), country: str(fd, "country") || null, bio: str(fd, "bio") || null }));
  if (!res.ok) return { error: res.error };
  revalidatePath("/conta");
  return { success: "Perfil atualizado." };
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/conta");
  const next = strRaw(fd, "next");
  if (next !== strRaw(fd, "next2")) return { error: "As senhas novas não conferem." };
  const keep = await currentToken();
  const res = await guard(() => changePassword(user.id, strRaw(fd, "current"), next, keep));
  if (!res.ok) return { error: res.error };
  return { success: "Senha alterada. Por segurança, saques ficam bloqueados por 24 horas e as outras sessões foram encerradas." };
}
