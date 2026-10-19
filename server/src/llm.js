import { SYSTEM_PROMPT } from "./prompt.js";
import { resolveSources } from "./sources.js";

export class LlmError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind; // "config" | "auth" | "rate_limit" | "timeout" | "upstream" | "empty"
    this.status = status;
  }
}

const URGENCY = new Set(["none", "see_doctor", "urgent"]);

/** Split the model output into visible text + metadata. Tolerant of a missing/garbled tag. */
export function parseModelOutput(raw) {
  let text = String(raw ?? "");
  let meta = {};
  const re = /<waii_meta>([\s\S]*?)<\/waii_meta>/i;
  const m = text.match(re);
  if (m) {
    try { meta = JSON.parse(m[1].trim()); } catch { meta = {}; }
  }
  // remove complete tags and any dangling/unclosed tag
  text = text.replace(/<waii_meta>[\s\S]*?<\/waii_meta>/gi, "").replace(/<waii_meta>[\s\S]*$/i, "").trim();
  const urgency = URGENCY.has(meta.urgency) ? meta.urgency : "none";
  return { reply: text, urgency, sources: resolveSources(meta.sources) };
}

function buildRequest(messages, config) {
  if (config.provider === "gemini") {
    const thresholds = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
      .map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })); // medical education mentions body parts
    return {
      url: `${config.baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: config.maxOutputTokens, temperature: 0.4 },
        safetySettings: thresholds
      }
    };
  }
  return {
    url: `${config.baseUrl}/v1/messages`,
    headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
    body: { model: config.model, max_tokens: config.maxOutputTokens, system: SYSTEM_PROMPT, messages }
  };
}

function extractText(data, provider) {
  if (provider === "gemini") {
    const parts = data?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("\n") : "";
  }
  return Array.isArray(data?.content) ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
}

export async function askModel(messages, config, fetchImpl = fetch) {
  if (!config.apiKey) {
    throw new LlmError("config", "The server has no API key configured.");
  }
  const req = buildRequest(messages, config);
  let res;
  try {
    res = await fetchImpl(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new LlmError("timeout", "The AI service took too long to answer.");
    }
    throw new LlmError("upstream", "Could not reach the AI service.");
  }
  if (!res.ok) {
    // Upstream bodies are only inspected here to classify the error; they are never sent to the browser.
    let detail = "";
    try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key|API_KEY_INVALID/i.test(detail))) {
      throw new LlmError("auth", "The AI service rejected the API key.", res.status);
    }
    if (res.status === 429) throw new LlmError("rate_limit", "The AI service is busy or the free quota is used up.", res.status);
    if (res.status === 404) throw new LlmError("model", "The AI model name is not available.", res.status);
    throw new LlmError("upstream", `AI service error (HTTP ${res.status}).`, res.status);
  }
  let data;
  try { data = await res.json(); } catch { throw new LlmError("upstream", "Unreadable response from AI service."); }
  const parsed = parseModelOutput(extractText(data, config.provider));
  if (!parsed.reply) throw new LlmError("empty", "The AI service returned an empty answer.");
  return parsed;
}
