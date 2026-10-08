import { afterEach, describe, expect, it, vi } from "vitest";
import { sendResendMail } from "@/server/resend-mail";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const msg = { to: "user@example.com", subject: "Confirmação", text: "Confirme sua conta." };
describe("Resend HTTP transport", () => {
  it("sends plain text with a bounded timeout and an idempotency key", async () => {
    const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    await sendResendMail(msg, "private-key", "Prime <mail@example.com>");
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers.Authorization).toBe("Bearer private-key");
    expect(JSON.parse(options.body).to).toEqual([msg.to]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers["Idempotency-Key"]).toBeTruthy();
  });
  it("reuses the same payload and key after a transient failure", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", send);
    const operation = sendResendMail(msg, "private-key", "mail@example.com");
    await vi.runAllTimersAsync();
    await operation;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1].headers["Idempotency-Key"]).toBe(send.mock.calls[1][1].headers["Idempotency-Key"]);
    expect(send.mock.calls[0][1].body).toBe(send.mock.calls[1][1].body);
  });
  it("does not retry authorization failures or expose response bodies", async () => {
    const send = vi.fn().mockResolvedValue(new Response("private-key user@example.com", { status: 401 }));
    vi.stubGlobal("fetch", send);
    await expect(sendResendMail(msg, "private-key", "mail@example.com")).rejects.toThrow("HTTP 401");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
