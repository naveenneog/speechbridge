import { describe, it, expect } from "vitest";
import { isLocalRequest } from "../src/server/localGuard.js";

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
