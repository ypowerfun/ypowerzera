const TZ = "America/Sao_Paulo";

export function formatDateTime(d: Date | string | null | undefined, tz = TZ): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined, tz = TZ): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: tz }).format(new Date(d));
}

/** Converte "2026-10-31T20:00" (campo datetime-local, horário de Brasília) em Date UTC. */
export function parseLocalDateTime(value: string | null | undefined, offsetHours = -3): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  return new Date(Date.UTC(y, mo - 1, d, h - offsetHours, mi));
}

/** Date UTC → valor para <input type="datetime-local"> no horário de Brasília. */
export function toLocalInput(d: Date | null | undefined, offsetHours = -3): string {
  if (!d) return "";
  const t = new Date(new Date(d).getTime() + offsetHours * 3600_000);
  return t.toISOString().slice(0, 16);
}
