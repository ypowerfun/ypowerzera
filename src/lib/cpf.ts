export function onlyDigits(v: string): string {
  return v.replace(/\D/g, "");
}

/** Valida CPF pelos dígitos verificadores (rejeita sequências repetidas). */
export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function formatCpf(input: string): string {
  const c = onlyDigits(input);
  return c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : input;
}

export function maskCpf(input: string): string {
  const c = onlyDigits(input);
  return c.length === 11 ? `***.***.***-${c.slice(9)}` : "***";
}

/** Gera um CPF válido (usado em testes e na simulação do provedor). */
export function generateCpf(seed: number): string {
  const base = String(100000000 + (seed % 899999999)).padStart(9, "0").split("").map(Number);
  const dv = (digits: number[]) => {
    const len = digits.length;
    const sum = digits.reduce((s, d, i) => s + d * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  const cpf = [...base, d1, d2].join("");
  return /^(\d)\1{10}$/.test(cpf) ? generateCpf(seed + 1) : cpf;
}

export function ageInYears(birth: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}
