import { describe, it, expect, vi } from "vitest";
import { createTokenBroker, SPEECH_TOKEN_TTL_MS } from "../src/server/tokenBroker.js";

/** Builds a broker whose clock, credential and transport are all injected, so tests are deterministic. */
function makeBroker(
  overrides: {
    entra?: () => Promise<string>;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const clock = { value: 1_000_000 };
  const fetchImpl =
    overrides.fetchImpl ??
    (vi.fn(async () => new Response("sts-token-1", { status: 200 })) as unknown as typeof fetch);
  const broker = createTokenBroker({
    endpoint: "https://example.cognitiveservices.azure.com",
    region: "eastus2",
    getEntraToken: overrides.entra ?? (async () => "entra-token"),
    fetchImpl,
    now: overrides.now ?? (() => clock.value),
  });
  return { broker, fetchImpl, clock };
}

describe("token broker", () => {
  it("mints a Speech token and reports the region and expiry", async () => {
    const { broker } = makeBroker();
    const result = await broker.getToken();
    expect(result.token).toBe("sts-token-1");
    expect(result.region).toBe("eastus2");
    expect(result.expiresAt).toBe(1_000_000 + SPEECH_TOKEN_TTL_MS);
  });

  it("calls the STS issueToken endpoint on the custom subdomain with a bearer credential", async () => {
    const { broker, fetchImpl } = makeBroker();
    await broker.getToken();
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.cognitiveservices.azure.com/sts/v1.0/issueToken");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer entra-token");
  });

  it("strips a trailing slash from the endpoint rather than producing a double slash", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("t", { status: 200 }),
    ) as unknown as typeof fetch;
    const broker = createTokenBroker({
      endpoint: "https://example.cognitiveservices.azure.com/",
      region: "eastus2",
      getEntraToken: async () => "e",
      fetchImpl,
      now: () => 0,
    });
    await broker.getToken();
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls[0]?.[0]).toBe(
      "https://example.cognitiveservices.azure.com/sts/v1.0/issueToken",
    );
  });

  it("serves a cached token without contacting Azure again", async () => {
    const { broker, fetchImpl } = makeBroker();
    const first = await broker.getToken();
    const second = await broker.getToken();
    expect(second.token).toBe(first.token);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the token passes 80% of its lifetime", async () => {
    const clock = { value: 0 };
    let issued = 0;
    const fetchImpl = vi.fn(async () => {
      issued += 1;
      return new Response(`token-${issued}`, { status: 200 });
    }) as unknown as typeof fetch;
    const broker = createTokenBroker({
      endpoint: "https://example.cognitiveservices.azure.com",
      region: "eastus2",
      getEntraToken: async () => "e",
      fetchImpl,
      now: () => clock.value,
    });

    expect((await broker.getToken()).token).toBe("token-1");

    // Just before the refresh threshold: still cached.
    clock.value = SPEECH_TOKEN_TTL_MS * 0.8 - 1;
    expect((await broker.getToken()).token).toBe("token-1");

    // At the threshold: refreshed, so a caller never receives a nearly-dead token.
    clock.value = SPEECH_TOKEN_TTL_MS * 0.8;
    expect((await broker.getToken()).token).toBe("token-2");
  });

  it("coalesces concurrent callers into a single exchange", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return new Response("shared-token", { status: 200 });
    }) as unknown as typeof fetch;
    const broker = createTokenBroker({
      endpoint: "https://example.cognitiveservices.azure.com",
      region: "eastus2",
      getEntraToken: async () => "e",
      fetchImpl,
      now: () => 0,
    });

    const results = await Promise.all([broker.getToken(), broker.getToken(), broker.getToken()]);
    expect(results.map((r) => r.token)).toEqual(["shared-token", "shared-token", "shared-token"]);
    expect(maxConcurrent).toBe(1);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("reports the status when the exchange is rejected", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
    ) as unknown as typeof fetch;
    const { broker } = makeBroker({ fetchImpl });
    await expect(broker.getToken()).rejects.toThrow(/401/);
  });

  it("never leaks the Entra token in an error message", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 403 }),
    ) as unknown as typeof fetch;
    const { broker } = makeBroker({
      fetchImpl,
      entra: async () => "super-secret-entra-token",
    });

    const error = await broker.getToken().then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("403");
    expect(error?.message).not.toContain("super-secret-entra-token");
  });

  it("rejects an empty token body instead of caching a useless value", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("   ", { status: 200 }),
    ) as unknown as typeof fetch;
    const { broker } = makeBroker({ fetchImpl });
    await expect(broker.getToken()).rejects.toThrow(/empty/i);
  });

  it("does not cache a failure — a later call retries", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? new Response("boom", { status: 500 })
        : new Response("recovered", { status: 200 });
    }) as unknown as typeof fetch;
    const { broker } = makeBroker({ fetchImpl });

    await expect(broker.getToken()).rejects.toThrow(/500/);
    expect((await broker.getToken()).token).toBe("recovered");
  });

  it("surfaces a credential failure rather than hanging", async () => {
    const { broker } = makeBroker({
      entra: async () => {
        throw new Error("no credential available");
      },
    });
    await expect(broker.getToken()).rejects.toThrow(/no credential available/);
  });

  it("recovers after a credential failure once the credential works", async () => {
    let attempts = 0;
    const { broker } = makeBroker({
      entra: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return "entra-token";
      },
    });
    await expect(broker.getToken()).rejects.toThrow(/transient/);
    expect((await broker.getToken()).token).toBe("sts-token-1");
  });
});
