import { describe, expect, it } from "vitest";
import { clampPage, safeHttpUrl } from "@/lib/url";
import { listPublicTournaments } from "@/server/queries";
import { createTournamentSchema } from "@/server/tournaments";

describe("links de usuário só em http(s)", () => {
  it.each(["https://twitch.tv/canal", "http://exemplo.com/x?y=1", "HTTPS://Discord.gg/abc"])("aceita %s", (u) => expect(safeHttpUrl(u)).not.toBeNull());
  it.each(["javascript:alert(1)", "JaVaScRiPt:fetch('/conta')", "data:text/html,<script>1</script>", "vbscript:x", "ftp://x.com/a", "//evil.com", "não é link", "", null, undefined])(
    "recusa %j",
    (u) => expect(safeHttpUrl(u as string)).toBeNull(),
  );

  it("o cadastro do campeonato recusa javascript:/data: em transmissão e Discord (antes só a edição recusava)", () => {
    const { streamUrl, discordUrl } = createTournamentSchema.shape;
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
      expect(streamUrl.safeParse(bad).success).toBe(false);
      expect(discordUrl.safeParse(bad).success).toBe(false);
    }
    expect(streamUrl.safeParse("https://twitch.tv/canal").success).toBe(true);
    expect(discordUrl.safeParse("").success).toBe(true);
    expect(streamUrl.safeParse(undefined).success).toBe(true);
  });
});

describe("número de página vindo da URL", () => {
  it.each([
    [1, 1], [2, 2], [1.1, 1], [0, 1], [-5, 1], [Number.POSITIVE_INFINITY, 1], [Number.NaN, 1], ["abc", 1], [undefined, 1], [1e999, 1], [99999999, 10000],
  ])("clampPage(%j) = %j", (input, out) => expect(clampPage(input)).toBe(out));

  it("a lista pública não quebra com ?pagina=1.1, Infinity ou valor enorme", async () => {
    for (const page of [1.1, Number.POSITIVE_INFINITY, Number.NaN, 1e12, -3]) {
      const r = await listPublicTournaments({ page });
      expect(Number.isInteger(r.page)).toBe(true);
    }
  });
});
