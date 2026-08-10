/**
 * Server configuration, validated at startup.
 *
 * Nothing here is a secret — there are no keys in this system (ADR-0002). These are
 * identifiers, and getting one wrong should fail immediately with a message that says
 * what to fix, rather than surfacing as an opaque HTTP error on the first click.
 */

export interface ServerConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly port: number;
  /** Interface to bind. Loopback by default — see the comment in `loadConfig`. */
  readonly host: string;
  /** How callers of the credential endpoint are authorised. */
  readonly accessMode: AccessMode;
}

const DEFAULT_PORT = 8790;

/**
 * Loopback, deliberately. `/api/speech-token` mints an Azure credential and has no user
 * authentication, so binding the wildcard address would let anyone on the same network
 * mint Speech tokens against this subscription. Widening it must be a conscious act.
 */
const DEFAULT_HOST = "127.0.0.1";

import type { AccessMode } from "./localGuard.js";

const ALLOWED_ENDPOINT_SUFFIX = ".cognitiveservices.azure.com";

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in (no API key is needed).`,
    );
  }
  return value;
}

function validateEndpoint(endpoint: string): string {
  if (/\.api\.cognitive\.microsoft\.com/i.test(endpoint)) {
    throw new Error(
      `SPEECH_ENDPOINT must be the resource's custom subdomain ` +
        `(https://<name>.cognitiveservices.azure.com), not a regional endpoint. ` +
        `Microsoft Entra authentication is not supported on regional endpoints — see docs/adr/0002.`,
    );
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`SPEECH_ENDPOINT is not a valid URL: "${endpoint}".`);
  }

  // The Entra token is POSTed to this host. Sending it anywhere unexpected, or in
  // cleartext, would defeat the entire point of ADR-0003.
  if (url.protocol !== "https:") {
    throw new Error(`SPEECH_ENDPOINT must use https, got "${url.protocol}".`);
  }
  if (!url.hostname.toLowerCase().endsWith(ALLOWED_ENDPOINT_SUFFIX)) {
    throw new Error(
      `SPEECH_ENDPOINT must be an Azure host ending in ${ALLOWED_ENDPOINT_SUFFIX}, ` +
        `got "${url.hostname}".`,
    );
  }

  return endpoint;
}

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const endpoint = validateEndpoint(required(env, "SPEECH_ENDPOINT").replace(/\/+$/, ""));
  const region = required(env, "SPEECH_REGION");

  // Set only by the hosting platform. Either means something is in front of us terminating
  // TLS and forwarding, so binding loopback-only would make the app unreachable.
  const inAzureHost = Boolean(
    env["WEBSITE_SITE_NAME"]?.trim() || env["CONTAINER_APP_NAME"]?.trim(),
  );

  const rawMode = env["ACCESS_MODE"]?.trim();
  let accessMode: AccessMode = inAzureHost ? "authenticated" : "local";
  if (rawMode) {
    if (rawMode !== "local" && rawMode !== "authenticated") {
      throw new Error(`ACCESS_MODE must be "local" or "authenticated", got "${rawMode}".`);
    }
    accessMode = rawMode;
  }

  // The bind follows the access mode: authenticated means a platform is authenticating
  // callers in front of us, and that platform has to be able to reach us.
  const host = env["HOST"]?.trim() || (accessMode === "authenticated" ? "0.0.0.0" : DEFAULT_HOST);

  const rawPort = env["PORT"]?.trim();
  let port = DEFAULT_PORT;
  if (rawPort) {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}".`);
    }
  }

  return { endpoint, region, port, host, accessMode };
}

