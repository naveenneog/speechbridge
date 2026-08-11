/**
 * Mints short-lived, Speech-scoped tokens for the browser.
 *
 * Why this exists (ADR-0003): the browser needs a credential to open its audio WebSocket
 * straight to Azure, but it must not hold a Microsoft Entra access token — that token is
 * accepted by every Cognitive Services resource the signed-in principal can reach. So the
 * server keeps the Entra credential and hands out an STS token instead: scoped to Speech,
 * on one resource, dead in ten minutes.
 *
 * The exchange only works on the resource's custom-subdomain host. The regional
 * (*.api.cognitive.microsoft.com) host rejects a bearer credential with 400.
 */

/** Azure issues Speech STS tokens with a ten-minute life. */
export const SPEECH_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Refresh once 80% of the life has passed, so a caller never gets a nearly-dead token. */
const REFRESH_RATIO = 0.8;

export interface SpeechToken {
  /** The Speech-scoped STS token. Safe(ish) to send to the browser; expires quickly. */
  readonly token: string;
  /** The region whose audio endpoints this token is valid for. */
  readonly region: string;
  /** Epoch milliseconds at which the token stops being valid. */
  readonly expiresAt: number;
}

export interface TokenBrokerOptions {
  /** The resource's custom-subdomain endpoint, e.g. https://name.cognitiveservices.azure.com */
  readonly endpoint: string;
  readonly region: string;
  /** Supplies a Microsoft Entra access token. Injected so tests never touch a real credential. */
  readonly getEntraToken: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  /** Injected clock — tests must not depend on the wall clock. */
  readonly now?: () => number;
  /** Injected so retry backoff does not make tests slow. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Where to report diagnostic detail. Never reaches the client. */
  readonly log?: (message: string) => void;
}

export interface TokenBroker {
  getToken(): Promise<SpeechToken>;
}

/**
 * A fresh deployment assigns the role and starts the app moments later, but Azure's
 * data plane can take minutes to honour it. Failing on the first 401 makes a correct
 * deployment look broken, so authorization failures are retried before giving up.
 */
const AUTHORIZATION_RETRIES = 3;
const RETRY_BACKOFF_MS = 5_000;
const RETRYABLE_STATUSES = new Set([401, 403]);

export function createTokenBroker(options: TokenBrokerOptions): TokenBroker {
  const { endpoint, region, getEntraToken } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? ((message: string) => console.error(message));
  const issueTokenUrl = `${endpoint.replace(/\/+$/, "")}/sts/v1.0/issueToken`;

  let cached: SpeechToken | undefined;
  // Concurrent callers share one exchange; without this, a page opening three recognizers
  // at once would trigger three identical round trips.
  let inFlight: Promise<SpeechToken> | undefined;

  function isUsable(token: SpeechToken | undefined): token is SpeechToken {
    if (!token) return false;
    const age = SPEECH_TOKEN_TTL_MS - (token.expiresAt - now());
    return age < SPEECH_TOKEN_TTL_MS * REFRESH_RATIO;
  }

  async function attempt(): Promise<Response> {
    const entraToken = await getEntraToken();
    return fetchImpl(issueTokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${entraToken}`,
        "Content-Length": "0",
      },
    });
  }

  async function exchange(): Promise<SpeechToken> {
    let response = await attempt();

    for (let retry = 0; retry < AUTHORIZATION_RETRIES && RETRYABLE_STATUSES.has(response.status); retry++) {
      // Read the body for the operator only — it names the actual reason, which the
      // client must never see but whoever deployed this badly needs.
      const detail = await response
        .clone()
        .text()
        .catch(() => "");
      log(
        `[speech-token] HTTP ${response.status} from ${issueTokenUrl}` +
          `${detail ? ` — ${detail.slice(0, 400)}` : ""} ` +
          `(attempt ${retry + 1} of ${AUTHORIZATION_RETRIES + 1}; role assignments can take ` +
          `several minutes to take effect on a new deployment)`,
      );
      await delay(RETRY_BACKOFF_MS);
      response = await attempt();
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (detail) {
        log(`[speech-token] HTTP ${response.status} from ${issueTokenUrl} — ${detail.slice(0, 400)}`);
      }
      // Reports only the status: the request carried a credential, and error strings
      // end up in logs and sometimes in front of users.
      const propagationHint = RETRYABLE_STATUSES.has(response.status)
        ? ` On a new deployment this is usually role propagation — it can take several ` +
          `minutes for "Cognitive Services User" to take effect. If it persists, ` +
          `confirm the assignment exists for the app's managed identity.`
        : "";
      throw new Error(
        `Speech token exchange failed with HTTP ${response.status}.${propagationHint}`,
      );
    }

    const token = (await response.text()).trim();
    if (token.length === 0) {
      throw new Error("Speech token exchange returned an empty token.");
    }

    return { token, region, expiresAt: now() + SPEECH_TOKEN_TTL_MS };
  }

  return {
    async getToken(): Promise<SpeechToken> {
      if (isUsable(cached)) return cached;
      if (inFlight) return inFlight;

      inFlight = exchange()
        .then((token) => {
          cached = token;
          return token;
        })
        .finally(() => {
          // Cleared on failure too, so a transient error is retried rather than cached.
          inFlight = undefined;
        });

      return inFlight;
    },
  };
}

