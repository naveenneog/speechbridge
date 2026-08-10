import express, { type Express, type Request, type Response } from "express";
import { LANGUAGES } from "../shared/languages.js";
import { isAuthorizedRequest, type AccessMode } from "./localGuard.js";
import type { TokenBroker } from "./tokenBroker.js";

export interface AppOptions {
  readonly broker: TokenBroker;
  /** Directory of built client assets. Omitted in tests and in dev, where Vite serves the client. */
  readonly clientDir?: string;
  /** Port the server is reachable on, used to validate the Host header in local mode. */
  readonly port?: number;
  /** Extra origins allowed to call the API — the Vite dev server in development. */
  readonly allowedOrigins?: readonly string[];
  /** How callers are authorised. Defaults to `local`. */
  readonly accessMode?: AccessMode;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  const accessMode: AccessMode = options.accessMode ?? "local";

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", accessMode });
  });

  app.get("/api/languages", (_req: Request, res: Response) => {
    res.json({ languages: LANGUAGES });
  });

  app.get("/api/speech-token", async (req: Request, res: Response) => {
    // Locally: loopback binding plus a Host check, because DNS rebinding can make an
    // attacker's page same-origin with us. Deployed: an Entra identity from Easy Auth.
    if (options.port !== undefined) {
      const verdict = isAuthorizedRequest({
        mode: accessMode,
        host: req.headers.host,
        origin: req.headers.origin,
        principalId: req.headers["x-ms-client-principal-id"] as string | undefined,
        port: options.port,
        ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
      });
      if (!verdict.allowed) {
        res.status(403).json({ error: verdict.reason });
        return;
      }
    }

    try {
      const token = await options.broker.getToken();
      // The token is a credential with a short life; no cache may retain it.
      res.setHeader("Cache-Control", "no-store");
      res.json(token);
    } catch (error) {
      // Logged in full for the operator, returned as a generic message to the client:
      // the underlying error can name the resource, the role and the principal.
      console.error("[speech-token] exchange failed:", error);
      res.status(503).json({
        error: "Speech service is unavailable. Check the server logs and Azure credentials.",
      });
    }
  });

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  if (options.clientDir) {
    app.use(express.static(options.clientDir));
  }

  return app;
}
