import { afterEach, describe, expect, it } from "vitest";
import { makeOrg, makeUser, uid } from "./factories";
import { getProvider, paymentsAvailable } from "@/server/payments";
import { createTournament, publishTournament } from "@/server/tournaments";

const saved = process.env.PAYMENTS_PROVIDER;
afterEach(() => {
  if (saved === undefined) delete process.env.PAYMENTS_PROVIDER;
  else process.env.PAYMENTS_PROVIDER = saved;
});

const future = () => new Date(Date.now() + 72 * 3600_000);

describe("PAYMENTS_PROVIDER=none (site só com campeonatos gratuitos)", () => {
  it("não há provedor de pagamento e o checkout fica indisponível", () => {
    process.env.PAYMENTS_PROVIDER = "none";
    expect(paymentsAvailable()).toBe(false);
    expect(() => getProvider()).toThrow(/campeonatos são gratuitos/);
  });

  it("campeonato gratuito publica normalmente; com taxa de inscrição não publica", async () => {
    process.env.PAYMENTS_PROVIDER = "none";
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const base = { orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", startsAt: future(), maxParticipants: 16 };
    const free = await createTournament(owner, { ...base, name: `Gratuito ${uid()}` });
    await publishTournament(owner, free.id);
    const paid = await createTournament(owner, { ...base, name: `Pago ${uid()}`, entryFeeCents: 5_000 });
    await expect(publishTournament(owner, paid.id)).rejects.toThrow(/Pagamentos indisponíveis/);
  });
});
