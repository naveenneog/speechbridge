import { describe, it, expect, vi } from "vitest";
import { createSpeechTokenClient } from "../src/client/speechToken.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("speech token client", () => {
  it("fetches a token from the broker", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ token: "t1", region: "eastus2", expiresAt: 60_000 }),
    ) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    const credential = await client.get();
    expect(credential).toEqual({ token: "t1", region: "eastus2", expiresAt: 60_000 });
  });

  it("reuses a token that is still comfortably valid", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ token: "t1", region: "eastus2", expiresAt: 600_000 }),
    ) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    await client.get();
    await client.get();
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("fetches again once the token is close to expiry", async () => {
    let issued = 0;
    const clock = { value: 0 };
    const fetchImpl = vi.fn(async () => {
      issued += 1;
      return jsonResponse({ token: `t${issued}`, region: "eastus2", expiresAt: clock.value + 60_000 });
    }) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => clock.value });

    expect((await client.get()).token).toBe("t1");
    // 30s of headroom left — still fine.
    clock.value = 30_000;
    expect((await client.get()).token).toBe("t1");
    // Under the 20s safety margin — refresh rather than risk a mid-utterance expiry.
    clock.value = 45_000;
    expect((await client.get()).token).toBe("t2");
  });

  it("coalesces concurrent callers into one request", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return jsonResponse({ token: "shared", region: "eastus2", expiresAt: 600_000 });
    }) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    const all = await Promise.all([client.get(), client.get(), client.get()]);
    expect(all.every((c) => c.token === "shared")).toBe(true);
    expect(peak).toBe(1);
  });

  it("raises a readable error when the broker is unavailable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "Speech service is unavailable." }, 503),
    ) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    await expect(client.get()).rejects.toThrow(/unavailable/i);
  });

  it("raises a readable error when the response is not a token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ nonsense: true }),
    ) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    await expect(client.get()).rejects.toThrow(/token/i);
  });

  it("retries after a failure rather than caching it", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ error: "nope" }, 503)
        : jsonResponse({ token: "ok", region: "eastus2", expiresAt: 600_000 });
    }) as unknown as typeof fetch;
    const client = createSpeechTokenClient({ fetchImpl, now: () => 0 });
    await expect(client.get()).rejects.toThrow();
    expect((await client.get()).token).toBe("ok");
  });
});
