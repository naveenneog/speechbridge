/**
 * Decides whether a request genuinely came from this machine's own browser tab.
 *
 * `/api/speech-token` mints an Azure credential and has no user authentication — it is a
 * local demo. That makes two things load-bearing:
 *
 *  1. The server binds to loopback, so the LAN cannot reach it at all.
 *  2. This guard, because loopback binding alone is not enough. In a DNS-rebinding attack a
 *     hostname the attacker controls resolves to 127.0.0.1; the browser then considers
 *     `http://attacker.example:8790` same-origin with the attacker's page, so the absence of
 *     CORS headers does not stop them reading the minted token. Checking the Host header
 *     closes that, because the browser sends the attacker's hostname, not ours.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface LocalRequest {
  readonly host?: string | undefined;
  readonly origin?: string | undefined;
  readonly port: number;
  readonly allowedOrigins?: readonly string[];
}

/** Splits "host:port" without tripping over an IPv6 literal such as "[::1]:8790". */
function splitHost(host: string): { hostname: string; port: string | undefined } {
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close === -1) return { hostname: host, port: undefined };
    const hostname = host.slice(0, close + 1);
    const rest = host.slice(close + 1);
    return { hostname, port: rest.startsWith(":") ? rest.slice(1) : undefined };
  }
  const colon = host.lastIndexOf(":");
  return colon === -1
    ? { hostname: host, port: undefined }
    : { hostname: host.slice(0, colon), port: host.slice(colon + 1) };
}

export function isLocalRequest(request: LocalRequest): boolean {
  if (!request.host) return false;

  const { hostname, port } = splitHost(request.host.trim().toLowerCase());
  if (!LOOPBACK_HOSTNAMES.has(hostname)) return false;

  const requestPort = port ?? "80";
  if (requestPort !== String(request.port)) return false;

  // A same-origin navigation sends no Origin at all; anything else must be one of ours.
  if (request.origin !== undefined) {
    const allowed = new Set<string>([
      `http://localhost:${request.port}`,
      `http://127.0.0.1:${request.port}`,
      ...(request.allowedOrigins ?? []),
    ]);
    if (!allowed.has(request.origin)) return false;
  }

  return true;
}
