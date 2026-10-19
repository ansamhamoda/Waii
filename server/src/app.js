import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { normaliseMessages, ValidationError } from "./validate.js";
import { askModel, LlmError } from "./llm.js";
import { SOURCES } from "./sources.js";
import { loadConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRIENDLY = {
  config: [503, "config", "Waii is not configured yet: the server has no API key."],
  model: [502, "model", "The AI model name in your .env file is not available. Change GEMINI_MODEL (or ANTHROPIC_MODEL) to a model your key can use."],
  auth: [502, "auth", "The AI service rejected the API key in your .env file. Check that it was copied correctly."],
  rate_limit: [503, "busy", "The AI service is busy or the free daily limit is used up. Please wait a minute and try again."],
  timeout: [504, "timeout", "The answer took too long. Please try again."],
  upstream: [502, "upstream", "Waii could not reach the AI service. Please try again."],
  empty: [502, "upstream", "Waii could not produce an answer. Please try again."]
};

export function createApp(config, { fetchImpl = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Render/Netlify/etc: use the real visitor IP for rate limiting
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null
      }
    }
  }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, aiConfigured: Boolean(config.apiKey), provider: config.provider, model: config.model });
  });

  app.get("/api/sources", (_req, res) => {
    res.json(Object.entries(SOURCES).map(([id, s]) => ({ id, org: s.org, title: s.title, url: s.url })));
  });

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "rate_limited", message: "Too many messages. Please wait a minute and try again." } }
  });

  app.post("/api/chat", limiter, async (req, res) => {
    try {
      const messages = normaliseMessages(req.body?.messages);
      const result = await askModel(messages, config, fetchImpl);
      res.json(result);
    } catch (e) {
      if (e instanceof ValidationError) {
        return res.status(400).json({ error: { code: e.code, message: e.message } });
      }
      if (e instanceof LlmError) {
        console.error(`[waii] LLM error: ${e.kind}${e.status ? " " + e.status : ""}`); // no user content logged
        const [status, code, message] = FRIENDLY[e.kind] || FRIENDLY.upstream;
        return res.status(status).json({ error: { code, message } });
      }
      console.error("[waii] unexpected error:", e?.message);
      res.status(500).json({ error: { code: "internal", message: "Something went wrong." } });
    }
  });

  // Serve the built frontend in production (npm start)
  const dist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // JSON parse errors etc.
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: { code: "bad_request", message: "Invalid request." } });
  });
  const vercelApp = createApp(loadConfig());

export default vercelApp;
  return app;
}
