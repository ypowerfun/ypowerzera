import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getChatGPTUser } from "@/server/chatgpt-auth";
import { getCurrentUser } from "@/server/session";
import { createViradaoHandlers, type ViradaoDatabase, type ViradaoBucket } from "@/server/viradao-service";

type Bindings = { DB: ViradaoDatabase; BUCKET: ViradaoBucket };
function bindings(): Bindings { return getCloudflareContext().env as unknown as Bindings; }
export const handlers = createViradaoHandlers({
  database() { const db = bindings().DB; if (!db) throw new Error("Database unavailable"); return db; },
  bucket() { const bucket = bindings().BUCKET; if (!bucket) throw new Error("Storage unavailable"); return bucket; },
  async identity() {
    const [identity, user] = await Promise.all([getChatGPTUser(), getCurrentUser()]);
    // Use the same role checks as the new application. Contact email never grants admin.
    return { signedIn: !!identity, admin: user?.role === "ADMIN" };
  },
});
