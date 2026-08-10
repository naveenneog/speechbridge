import express, { type Express, type Request, type Response } from "express";
import { LANGUAGES } from "../shared/languages.js";
import type { TokenBroker } from "./tokenBroker.js";

export interface AppOptions {
  readonly broker: TokenBroker;
  /** Directory of built client assets. Omitted in tests and in dev, where Vite serves the client. */
  readonly clientDir?: string;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/api/languages", (_req: Request, res: Response) => {
    res.json({ languages: LANGUAGES });
  });

  app.get("/api/speech-token", async (_req: Request, res: Response) => {
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
