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
