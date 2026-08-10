import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/server/app.js";
import type { TokenBroker } from "../src/server/tokenBroker.js";

function stubBroker(overrides: Partial<TokenBroker> = {}): TokenBroker {
  return {
    getToken: async () => ({ token: "sts-abc", region: "eastus2", expiresAt: 1234 }),
    ...overrides,
  };
}

/** Starts the app on an ephemeral port and returns a fetch bound to it. */
async function serve(broker: TokenBroker) {
  const app = createApp({ broker });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("token endpoint", () => {
  it("returns the token, region and expiry as JSON", async () => {
    const s = await serve(stubBroker());
    try {
      const res = await fetch(s.url("/api/speech-token"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ token: "sts-abc", region: "eastus2", expiresAt: 1234 });
    } finally {
      await s.close();
    }
  });

  it("tells caches never to store the token", async () => {
    const s = await serve(stubBroker());
    try {
      const res = await fetch(s.url("/api/speech-token"));
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
    } finally {
      await s.close();
    }
  });

  it("returns 503 with a safe message when the exchange fails", async () => {
    const s = await serve(
      stubBroker({
        getToken: async () => {
          throw new Error("Speech token exchange failed with HTTP 403. secret-entra-value");
        },
      }),
    );
    try {
      const res = await fetch(s.url("/api/speech-token"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      // The client is told what to do, not what went wrong internally.
      expect(body.error).toMatch(/unavailable/i);
      expect(JSON.stringify(body)).not.toContain("secret-entra-value");
    } finally {
      await s.close();
    }
  });

  it("does not leak a stack trace to the client", async () => {
    const s = await serve(
      stubBroker({
        getToken: async () => {
          throw new Error("boom");
        },
      }),
    );
    try {
      const res = await fetch(s.url("/api/speech-token"));
      const text = await res.text();
      expect(text).not.toMatch(/at .*tokenBroker/);
      expect(text).not.toContain("boom");
    } finally {
      await s.close();
    }
  });

  it("serves the language catalog so the client and server cannot disagree", async () => {
    const s = await serve(stubBroker());
    try {
      const res = await fetch(s.url("/api/languages"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { languages: { code: string }[] };
      expect(body.languages.some((l) => l.code === "hi")).toBe(true);
    } finally {
      await s.close();
    }
  });

  it("answers a health check without touching Azure", async () => {
    const getToken = vi.fn();
    const s = await serve(stubBroker({ getToken }));
    try {
      const res = await fetch(s.url("/api/health"));
      expect(res.status).toBe(200);
      expect(getToken).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("returns 404 as JSON for an unknown API route", async () => {
    const s = await serve(stubBroker());
    try {
      const res = await fetch(s.url("/api/nope"));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
    } finally {
      await s.close();
    }
  });
});
