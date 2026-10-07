/**
 * Endereço do cliente usado nos limites de tentativas. IPv6 é agrupado pelo prefixo /64 (o tamanho que uma casa/empresa
 * recebe): sem isso, quem tem um bloco IPv6 troca de "IP" a cada pedido e foge de todos os limites por IP.
 */
export function normalizeClientIp(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip.slice(0, 45);

  let groups: string[];
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const fill = 8 - left.length - right.length;
    if (fill < 1) return ip.slice(0, 45);
    groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip.slice(0, 45);
  return `${groups.slice(0, 4).map((g) => Number.parseInt(g, 16).toString(16)).join(":")}::/64`;
}
