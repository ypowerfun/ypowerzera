import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

export function sitesDatabase(): D1Database | null {
  if (process.env.NEXT_PUBLIC_SITES_RUNTIME !== "1") return null;
  const env = getCloudflareContext().env as unknown as { DB?: D1Database };
  if (!env.DB) throw new Error("O banco do Sites não está disponível.");
  return env.DB;
}
