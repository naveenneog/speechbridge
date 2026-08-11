import { describe, it, expect } from "vitest";
import {
  isLocalRequest,
  isAuthorizedRequest,
  tenantFromPrincipalHeader,
} from "../src/server/localGuard.js";

/** Builds the base64 claims blob Easy Auth injects as X-MS-CLIENT-PRINCIPAL. */
function principalHeader(claims: { typ: string; val: string }[]): string {
  return Buffer.from(JSON.stringify({ auth_typ: "aad", claims })).toString("base64");
}

describe("tenantFromPrincipalHeader", () => {
  const TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";

  it("reads the short 'tid' claim", () => {
    expect(tenantFromPrincipalHeader(principalHeader([{ typ: "tid", val: TENANT }]))).toBe(TENANT);
  });

  it("reads the full schema claim URI, which is what Easy Auth usually sends", () => {
    const header = principalHeader([
      { typ: "http://schemas.microsoft.com/identity/claims/tenantid", val: TENANT },
    ]);
    expect(tenantFromPrincipalHeader(header)).toBe(TENANT);
  });

  it("finds the tenant among unrelated claims", () => {
    const header = principalHeader([
      { typ: "aud", val: "api://x" },
      { typ: "name", val: "Someone" },
      { typ: "tid", val: TENANT },
    ]);
    expect(tenantFromPrincipalHeader(header)).toBe(TENANT);
  });

  it("returns undefined when the header is absent", () => {
    expect(tenantFromPrincipalHeader(undefined)).toBeUndefined();
  });

  it("returns undefined for a header that is not valid base64 JSON", () => {
    expect(tenantFromPrincipalHeader("not-base64-json")).toBeUndefined();
  });

  it("returns undefined when there is no tenant claim", () => {
    expect(tenantFromPrincipalHeader(principalHeader([{ typ: "name", val: "x" }]))).toBeUndefined();
  });

  it("returns undefined for a well-formed header with no claims array", () => {
    const header = Buffer.from(JSON.stringify({ auth_typ: "aad" })).toString("base64");
    expect(tenantFromPrincipalHeader(header)).toBeUndefined();
  });
});

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
    describe("tenant allowlist", () => {
      const HOME = "16b3c013-d300-468d-ac64-7eda0820b6d3";
      const MICROSOFT = "72f988bf-86f1-41af-91ab-2d7cd011db47";

      it("admits a user from an allowed tenant", () => {
        const verdict = isAuthorizedRequest({
          mode: "authenticated",
          port: 443,
          principalId: "user-1",
          tenantId: MICROSOFT,
          allowedTenants: [HOME, MICROSOFT],
        });
        expect(verdict.allowed).toBe(true);
      });

      it("refuses a user from any other organisation", () => {
        // A multi-tenant app registration lets every Entra tenant reach the sign-in page.
        // Without this check, "sign-in required" would mean "anyone with a work account".
        const verdict = isAuthorizedRequest({
          mode: "authenticated",
          port: 443,
          principalId: "user-1",
          tenantId: "11111111-2222-3333-4444-555555555555",
          allowedTenants: [HOME, MICROSOFT],
        });
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toMatch(/organisation|organization/i);
      });

      it("refuses a signed-in user whose tenant cannot be determined", () => {
        // Fail closed: an unreadable claim must never be treated as permission.
        const verdict = isAuthorizedRequest({
          mode: "authenticated",
          port: 443,
          principalId: "user-1",
          allowedTenants: [HOME],
        });
        expect(verdict.allowed).toBe(false);
      });

      it("compares tenant ids case-insensitively", () => {
        const verdict = isAuthorizedRequest({
          mode: "authenticated",
          port: 443,
          principalId: "user-1",
          tenantId: MICROSOFT.toUpperCase(),
          allowedTenants: [MICROSOFT],
        });
        expect(verdict.allowed).toBe(true);
      });

      it("does not restrict by tenant when no allowlist is configured", () => {
        // Single-tenant app registrations are already constrained by Entra itself.
        const verdict = isAuthorizedRequest({
          mode: "authenticated",
          port: 443,
          principalId: "user-1",
          tenantId: "anything",
        });
        expect(verdict.allowed).toBe(true);
      });

      it("ignores the tenant allowlist in local mode", () => {
        const verdict = isAuthorizedRequest({
          mode: "local",
          host: "localhost:8790",
          port: 8790,
          allowedTenants: ["some-tenant"],
        });
        expect(verdict.allowed).toBe(true);
      });
    });

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
