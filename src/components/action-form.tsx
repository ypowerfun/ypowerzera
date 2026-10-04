"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/action-helpers";
import { Alert, buttonClass } from "./ui";

export function SubmitButton({ children, variant = "primary", className = "", pendingText = "Aguarde..." }: { children: ReactNode; variant?: Parameters<typeof buttonClass>[0]; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, className)}>
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * Formulário ligado a uma Server Action com retorno `{ error?, success? }`.
 * Mostra a mensagem acima do botão e evita duplo clique durante o envio.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
  submit,
  submitVariant = "primary",
  submitClassName = "w-full",
  confirm,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  submit?: ReactNode;
  submitVariant?: Parameters<typeof buttonClass>[0];
  submitClassName?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={confirm ? (e) => !window.confirm(confirm) && e.preventDefault() : undefined}
    >
      {children}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="ok">{state.success}</Alert>}
      {submit && <SubmitButton variant={submitVariant} className={submitClassName}>{submit}</SubmitButton>}
    </form>
  );
}
