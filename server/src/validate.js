export const LIMITS = { maxMessages: 20, maxChars: 2000 };

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Validate and normalise the chat history sent by the browser.
 *  Returns messages that strictly alternate user/assistant, starting and ending with "user". */
export function normaliseMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError("empty", "Please write a message.");
  }
  const cleaned = [];
  for (const m of input.slice(-LIMITS.maxMessages)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      throw new ValidationError("invalid", "Invalid message format.");
    }
    const content = m.content.replace(/\u0000/g, "").trim();
    if (!content) continue;
    if (content.length > LIMITS.maxChars) {
      throw new ValidationError("too_long", `Messages are limited to ${LIMITS.maxChars} characters.`);
    }
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + content; // merge same-role neighbours
    else cleaned.push({ role: m.role, content });
  }
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== "user") {
    throw new ValidationError("empty", "Please write a message.");
  }
  return cleaned;
}
