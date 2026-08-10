/**
 * Server entry point: loads configuration, wires the Entra credential to the token broker,
 * and starts listening. Wiring only — the behaviour lives in config.ts, tokenBroker.ts and app.ts.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { loadConfig } from "./config.js";
import { createTokenBroker } from "./tokenBroker.js";
import { createApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig(process.env);

const credential = new DefaultAzureCredential();
const broker = createTokenBroker({
  endpoint: config.endpoint,
  region: config.region,
  getEntraToken: async () => {
    const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
    if (!token) {
      throw new Error("No Microsoft Entra token available. Run `az login`.");
    }
    return token.token;
  },
});

const clientDir = resolve(here, "../../dist/client");
const app = createApp(existsSync(clientDir) ? { broker, clientDir } : { broker });

const server = app.listen(config.port, () => {
  console.log(`SpeechBridge token broker listening on http://localhost:${config.port}`);
  console.log(`  resource : ${config.endpoint}`);
  console.log(`  region   : ${config.region}`);
  console.log(`  auth     : Microsoft Entra ID (no keys — see docs/adr/0002)`);
});

// Without this, a port clash exits silently and the only symptom is a confusing 404
// from whatever else already owns the port.
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${config.port} is already in use by another process. ` +
        `Set PORT in .env to a free port and restart.`,
    );
  } else {
    console.error("Server failed to start:", error);
  }
  process.exit(1);
});
