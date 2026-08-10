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
}

const DEFAULT_PORT = 8790;

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in (no API key is needed).`,
    );
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const endpoint = required(env, "SPEECH_ENDPOINT").replace(/\/+$/, "");
  const region = required(env, "SPEECH_REGION");

  if (/\.api\.cognitive\.microsoft\.com/i.test(endpoint)) {
    throw new Error(
      `SPEECH_ENDPOINT must be the resource's custom subdomain ` +
        `(https://<name>.cognitiveservices.azure.com), not a regional endpoint. ` +
        `Microsoft Entra authentication is not supported on regional endpoints — see docs/adr/0002.`,
    );
  }

  const rawPort = env["PORT"]?.trim();
  let port = DEFAULT_PORT;
  if (rawPort) {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}".`);
    }
  }

  return { endpoint, region, port };
}
