import { describe, it, expect } from "vitest";
import { isLocalRequest, isAuthorizedRequest } from "../src/server/localGuard.js";

const PORT = 8790;
const DEV_ORIGINS = ["http://localhost:5173"];

describe("local request guard", () => {
  it("accepts localhost on the configured port", () => {
    expect(isLocalRequest({ host: `localhost:${PORT}`, port: PORT })).toBe(true);
  });

  it("accepts the IPv4 loopback address", () => {
    expect(isLocalRequest({ host: `127.0.0.1:${PORT}`, port: PORT })).toBe(true);
  });

  it("accepts the IPv6 loopback address", () => {
    expect(isLocalRequest({ host: `[::1]:${PORT}`, port: PORT })).toBe(true);
  });

  it("rejects a hostname an attacker controls", () => {
    // DNS rebinding: attacker.example resolves to 127.0.0.1, so the browser treats the
    // response as same-origin with the attacker and can read the minted token.
    expect(isLocalRequest({ host: `attacker.example:${PORT}`, port: PORT })).toBe(false);
  });

  it("rejects a hostname that merely ends in localhost", () => {
    expect(isLocalRequest({ host: `evil-localhost:${PORT}`, port: PORT })).toBe(false);
    expect(isLocalRequest({ host: `notlocalhost:${PORT}`, port: PORT })).toBe(false);
  });

  it("rejects a hostname that merely starts with localhost", () => {
    expect(isLocalRequest({ host: `localhost.evil.com:${PORT}`, port: PORT })).toBe(false);
  });

  it("rejects a request for a different port", () => {
    expect(isLocalRequest({ host: "localhost:9999", port: PORT })).toBe(false);
  });

  it("rejects a missing Host header", () => {
    expect(isLocalRequest({ port: PORT })).toBe(false);
  });

  it("rejects an empty Host header", () => {
    expect(isLocalRequest({ host: "", port: PORT })).toBe(false);
  });

  it("accepts a loopback host with no port when the port is the default", () => {
    expect(isLocalRequest({ host: "localhost", port: 80 })).toBe(true);
  });

  it("accepts a request with no Origin, as a same-origin navigation has none", () => {
    expect(isLocalRequest({ host: `localhost:${PORT}`, port: PORT })).toBe(true);
  });

  it("accepts an Origin that is the loopback app itself", () => {
    expect(
      isLocalRequest({
        host: `localhost:${PORT}`,
        origin: `http://localhost:${PORT}`,
        port: PORT,
      }),
    ).toBe(true);
  });

  it("accepts the Vite dev-server origin", () => {
    expect(
      isLocalRequest({
        host: `localhost:${PORT}`,
        origin: "http://localhost:5173",
        port: PORT,
        allowedOrigins: DEV_ORIGINS,
      }),
    ).toBe(true);
  });

  it("rejects a cross-site Origin even when the Host looks local", () => {
    expect(
      isLocalRequest({
        host: `localhost:${PORT}`,
        origin: "https://evil.example",
        port: PORT,
      }),
    ).toBe(false);
  });

  it("rejects a null Origin, which an opaque or sandboxed context sends", () => {
    expect(
      isLocalRequest({ host: `localhost:${PORT}`, origin: "null", port: PORT }),
    ).toBe(false);
  });

  it("is case-insensitive about the hostname", () => {
    expect(isLocalRequest({ host: `LocalHost:${PORT}`, port: PORT })).toBe(true);
  });
});

describe("credential access guard", () => {
  describe("local mode", () => {
    it("allows a genuine loopback request", () => {
      const verdict = isAuthorizedRequest({ mode: "local", host: `localhost:${PORT}`, port: PORT });
      expect(verdict.allowed).toBe(true);
    });

    it("refuses a request from another host", () => {
      const verdict = isAuthorizedRequest({
        mode: "local",
        host: `attacker.example:${PORT}`,
        port: PORT,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/this machine/i);
    });
  });

  describe("authenticated mode", () => {
    it("allows a request carrying an Entra principal from the platform", () => {
      // App Service / Container Apps Easy Auth validates the token and injects this
      // header, stripping any client-supplied copy at the front door.
      const verdict = isAuthorizedRequest({
        mode: "authenticated",
        host: "speechbridge.azurewebsites.net",
        port: 443,
        principalId: "8f3c-...-a91",
      });
      expect(verdict.allowed).toBe(true);
    });

    it("refuses a request with no authenticated principal", () => {
      // Catches Easy Auth being misconfigured to allow anonymous access — otherwise the
      // credential endpoint would be open to the internet.
      const verdict = isAuthorizedRequest({
        mode: "authenticated",
        host: "speechbridge.azurewebsites.net",
        port: 443,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/sign in|authenticat/i);
    });

    it("refuses an empty principal header", () => {
      const verdict = isAuthorizedRequest({
        mode: "authenticated",
        host: "speechbridge.azurewebsites.net",
        port: 443,
        principalId: "   ",
      });
      expect(verdict.allowed).toBe(false);
    });

    it("does not require a loopback host when deployed", () => {
      const verdict = isAuthorizedRequest({
        mode: "authenticated",
        host: "anything.azurewebsites.net",
        port: 443,
        principalId: "user-1",
      });
      expect(verdict.allowed).toBe(true);
    });

    it("ignores a principal header in local mode, where it could be forged", () => {
      // Nothing strips this header locally, so it must never grant access there.
      const verdict = isAuthorizedRequest({
        mode: "local",
        host: "attacker.example:8790",
        port: 8790,
        principalId: "forged",
      });
      expect(verdict.allowed).toBe(false);
    });
  });
});
