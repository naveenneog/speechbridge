import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/server/config.js";

describe("server configuration", () => {
  it("reads the endpoint, region and port from the environment", () => {
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
      PORT: "9000",
    });
    expect(config).toEqual({
      endpoint: "https://x.cognitiveservices.azure.com",
      region: "eastus2",
      port: 9000,
      host: "127.0.0.1",
      accessMode: "local",
    });
  });

  it("defaults the port when it is not set", () => {
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
    });
    expect(config.port).toBe(8790);
  });

  it("names the missing variable so the fix is obvious", () => {
    expect(() => loadConfig({ SPEECH_REGION: "eastus2" })).toThrowError(/SPEECH_ENDPOINT/);
    expect(() =>
      loadConfig({ SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com" }),
    ).toThrowError(/SPEECH_REGION/);
  });

  it("treats a blank variable as missing", () => {
    expect(() => loadConfig({ SPEECH_ENDPOINT: "   ", SPEECH_REGION: "eastus2" })).toThrowError(
      /SPEECH_ENDPOINT/,
    );
  });

  it("rejects a regional endpoint, which cannot do Entra auth", () => {
    // ADR-0002: the STS exchange returns 400 on *.api.cognitive.microsoft.com.
    // Failing at startup is far kinder than a 400 at the first click.
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://eastus2.api.cognitive.microsoft.com",
        SPEECH_REGION: "eastus2",
      }),
    ).toThrowError(/custom subdomain/i);
  });

  it("refuses to send the Entra token over plain http", () => {
    // The Entra token is the broad credential this whole design exists to protect;
    // a single-character config slip must not put it on the wire in cleartext.
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "http://x.cognitiveservices.azure.com",
        SPEECH_REGION: "eastus2",
      }),
    ).toThrowError(/https/i);
  });

  it("refuses an endpoint that is not an Azure Cognitive Services host", () => {
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://attacker.example",
        SPEECH_REGION: "eastus2",
      }),
    ).toThrowError(/cognitiveservices\.azure\.com/i);
  });

  it("refuses a hostname that merely contains the Azure suffix", () => {
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://cognitiveservices.azure.com.attacker.example",
        SPEECH_REGION: "eastus2",
      }),
    ).toThrowError(/cognitiveservices\.azure\.com/i);
  });

  it("refuses an unparseable endpoint", () => {
    expect(() =>
      loadConfig({ SPEECH_ENDPOINT: "not a url", SPEECH_REGION: "eastus2" }),
    ).toThrowError(/SPEECH_ENDPOINT/);
  });

  it("binds to loopback by default so the LAN cannot mint tokens", () => {
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.accessMode).toBe("local");
  });

  it("switches to authenticated mode when told to", () => {
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
      ACCESS_MODE: "authenticated",
    });
    expect(config.accessMode).toBe("authenticated");
  });

  it("binds all interfaces automatically when running in App Service", () => {
    // App Service terminates TLS and forwards to the container, so loopback-only would
    // make the site unreachable. WEBSITE_SITE_NAME is only set by the platform.
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
      WEBSITE_SITE_NAME: "app-speechbridge",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.accessMode).toBe("authenticated");
  });

  it("refuses an unrecognised access mode rather than failing open", () => {
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
        SPEECH_REGION: "eastus2",
        ACCESS_MODE: "everyone",
      }),
    ).toThrowError(/ACCESS_MODE/);
  });

  it("allows a wider bind only when explicitly asked for", () => {
    const config = loadConfig({
      SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
      SPEECH_REGION: "eastus2",
      HOST: "0.0.0.0",
    });
    expect(config.host).toBe("0.0.0.0");
  });

  it("rejects a non-numeric port rather than silently listening on NaN", () => {
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
        SPEECH_REGION: "eastus2",
        PORT: "not-a-port",
      }),
    ).toThrowError(/PORT/);
  });

  it("rejects a port outside the valid range", () => {
    expect(() =>
      loadConfig({
        SPEECH_ENDPOINT: "https://x.cognitiveservices.azure.com",
        SPEECH_REGION: "eastus2",
        PORT: "70000",
      }),
    ).toThrowError(/PORT/);
  });
});
