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
const app = createApp({
  broker,
  port: config.port,
  accessMode: config.accessMode,
  allowedTenants: config.allowedTenants,
  // Vite serves the client on its own origin in development.
  allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
  ...(existsSync(clientDir) ? { clientDir } : {}),
});

const server = app.listen(config.port, config.host, () => {
  console.log(`SpeechBridge listening on http://${config.host}:${config.port}`);
  console.log(`  resource : ${config.endpoint}`);
  console.log(`  region   : ${config.region}`);
  console.log(`  auth     : Microsoft Entra ID (no keys — see docs/adr/0002)`);
  console.log(`  access   : ${config.accessMode}`);
  console.log(
    `  tenants  : ${config.allowedTenants.length > 0 ? config.allowedTenants.join(", ") : "any (no restriction)"}`,
  );
  if (config.host !== "127.0.0.1" && config.accessMode === "local") {
    console.warn(
      `  WARNING  : bound to ${config.host} in local access mode, so anything that can ` +
        `reach this port can mint Speech tokens against your subscription. Unset HOST, ` +
        `or set ACCESS_MODE=authenticated behind Microsoft Entra authentication.`,
    );
  }
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
