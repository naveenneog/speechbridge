/**
 * Browser-side cache for the short-lived Speech credential.
 *
 * The server mints tokens that live ten minutes (ADR-0003). This keeps one in hand and
 * refreshes it before it can expire mid-utterance — a token dying between "user starts
 * speaking" and "translation returns" would drop the turn.
 */

export interface SpeechCredential {
  readonly token: string;
  readonly region: string;
  readonly expiresAt: number;
}

/** Refresh with this much life left, so a token cannot die during a turn in progress. */
const SAFETY_MARGIN_MS = 20_000;

export interface SpeechTokenClientOptions {
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface SpeechTokenClient {
  get(): Promise<SpeechCredential>;
}

function isCredential(value: unknown): value is SpeechCredential {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["token"] === "string" &&
    candidate["token"].length > 0 &&
    typeof candidate["region"] === "string" &&
    typeof candidate["expiresAt"] === "number"
  );
}

export function createSpeechTokenClient(
  options: SpeechTokenClientOptions = {},
): SpeechTokenClient {
  const endpoint = options.endpoint ?? "/api/speech-token";
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  let cached: SpeechCredential | undefined;
  let inFlight: Promise<SpeechCredential> | undefined;

  async function fetchCredential(): Promise<SpeechCredential> {
    const response = await fetchImpl(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const detail = await response
        .json()
        .then((body: unknown) =>
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "",
        )
        .catch(() => "");
      throw new Error(
        detail || `Could not get a Speech credential (HTTP ${response.status}).`,
      );
    }

    const body: unknown = await response.json();
    if (!isCredential(body)) {
      throw new Error("The broker returned a response that is not a Speech token.");
    }
    return body;
  }

  return {
    async get(): Promise<SpeechCredential> {
      if (cached && cached.expiresAt - now() > SAFETY_MARGIN_MS) return cached;
      if (inFlight) return inFlight;

      inFlight = fetchCredential()
        .then((credential) => {
          cached = credential;
          return credential;
        })
        .finally(() => {
          inFlight = undefined;
        });

      return inFlight;
    },
  };
}
