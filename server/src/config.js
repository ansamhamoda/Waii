import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Always load the .env from the PROJECT ROOT (waii/.env), no matter which folder
// the server is started from. A server/.env, if present, is also accepted.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config({ path: path.resolve(here, "../.env") });

const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "");

export function loadConfig(env = process.env) {
  const anthropicKey = clean(env.ANTHROPIC_API_KEY);
  const geminiKey = clean(env.GEMINI_API_KEY);
  // AI_PROVIDER=gemini | anthropic. If unset: use whichever key is present (Gemini first).
  let provider = clean(env.AI_PROVIDER).toLowerCase();
  if (provider !== "gemini" && provider !== "anthropic") provider = geminiKey ? "gemini" : "anthropic";
  const isGemini = provider === "gemini";
  return {
    provider,
    apiKey: isGemini ? geminiKey : anthropicKey,
    model: isGemini ? (env.GEMINI_MODEL || "gemini-3.5-flash-lite") : (env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
    baseUrl: (isGemini
      ? env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
      : env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),
    port: Number(env.PORT) || 3001,
    // Gemini "thinking" models count thinking tokens too, so give them more room.
    maxOutputTokens: Number(env.MAX_OUTPUT_TOKENS) || (isGemini ? 4096 : 1200),
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN) || 20,
    timeoutMs: Number(env.REQUEST_TIMEOUT_MS) || 60000
  };
}
