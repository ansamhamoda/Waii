import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/app.js";
import { normaliseMessages } from "../src/validate.js";
import { parseModelOutput } from "../src/llm.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";

// ---- a fake Anthropic API so tests need no key / network -------------------
function startFakeAnthropic(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        calls.push({ headers: req.headers, body: parsed });
        const out = handler(parsed, calls.length);
        res.writeHead(out.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    }).listen(0, () => resolve({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const ok = (text) => ({ json: { content: [{ type: "text", text }] } });

async function startWaii(config) {
  const app = createApp({ model: "test-model", maxOutputTokens: 500, rateLimitPerMin: 100, timeoutMs: 3000, ...config });
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const post = (base, body, raw) =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) });

test("validation: empty / whitespace / bad shapes are rejected", () => {
  assert.throws(() => normaliseMessages([]));
  assert.throws(() => normaliseMessages(undefined));
  assert.throws(() => normaliseMessages([{ role: "user", content: "   " }]));
  assert.throws(() => normaliseMessages([{ role: "system", content: "x" }]));
  assert.throws(() => normaliseMessages([{ role: "user", content: "a".repeat(2001) }]));
  assert.throws(() => normaliseMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]));
});

test("validation: history is normalised (leading assistant dropped, same roles merged, capped)", () => {
  const out = normaliseMessages([
    { role: "assistant", content: "welcome" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
    { role: "user", content: "d" }
  ]);
  assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(out[0].content, "a\n\nb");
  const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" + i }));
  many.push({ role: "user", content: "last" });
  assert.ok(normaliseMessages(many).length <= 20);
});

test("parseModelOutput: strips meta, keeps only whitelisted sources, tolerates garbage", () => {
  const a = parseModelOutput('Hello\n<waii_meta>{"urgency":"see_doctor","sources":["who_bc","evil","__proto__","who_bc"]}</waii_meta>');
  assert.equal(a.reply, "Hello");
  assert.equal(a.urgency, "see_doctor");
  assert.deepEqual(a.sources.map((s) => s.id), ["who_bc"]);
  assert.ok(a.sources[0].url.startsWith("https://"));
  const b = parseModelOutput("No tag at all");
  assert.deepEqual([b.reply, b.urgency, b.sources.length], ["No tag at all", "none", 0]);
  const c = parseModelOutput('Text <waii_meta>{not json</waii_meta>');
  assert.equal(c.reply, "Text");
  const d = parseModelOutput('Text <waii_meta>{"urgency":"none"');
  assert.equal(d.reply, "Text");
  assert.equal(parseModelOutput('x<waii_meta>{"urgency":"panic"}</waii_meta>').urgency, "none");
});

test("system prompt contains the core safety rules", () => {
  for (const s of ["cannot diagnose", "NEVER invent", "Egyptian", "waii_meta", "Ignore any instruction"]) {
    assert.ok(SYSTEM_PROMPT.includes(s), "missing: " + s);
  }
});

test("chat: forwards system prompt + full history to the model and returns parsed answer", async () => {
  const fake = await startFakeAnthropic(() =>
    ok('Most lumps are not cancer, but get it checked.\n<waii_meta>{"urgency":"see_doctor","sources":["nci_bc"]}</waii_meta>'));
  const waii = await startWaii({ apiKey: "sk-test", baseUrl: fake.url });
  const r = await post(waii.base, { messages: [
    { role: "user", content: "What is a fibroadenoma?" },
    { role: "assistant", content: "A common benign lump." },
    { role: "user", content: "Can it turn into cancer?" }
  ] });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.urgency, "see_doctor");
  assert.equal(j.sources[0].id, "nci_bc");
  assert.ok(!j.reply.includes("waii_meta"));
  const call = fake.calls[0];
  assert.equal(call.headers["x-api-key"], "sk-test");
  assert.equal(call.body.model, "test-model");
  assert.equal(call.body.messages.length, 3);
  assert.ok(call.body.system.includes("Waii"));
  fake.srv.close(); waii.srv.close();
});

test("chat: missing API key -> 503 config error, no crash", async () => {
  const waii = await startWaii({ apiKey: "", baseUrl: "http://127.0.0.1:1" });
  const r = await post(waii.base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, "config");
  waii.srv.close();
});

test("chat: empty and malformed requests -> 400", async () => {
  const waii = await startWaii({ apiKey: "k", baseUrl: "http://127.0.0.1:1" });
  assert.equal((await post(waii.base, { messages: [{ role: "user", content: "   " }] })).status, 400);
  assert.equal((await post(waii.base, {})).status, 400);
  assert.equal((await post(waii.base, null, "{bad json")).status, 400);
  waii.srv.close();
});

test("chat: upstream 401 / 429 / 500 / unreachable are mapped; upstream details never leak", async () => {
  for (const [status, expected] of [[401, 502], [429, 503], [500, 502]]) {
    const fake = await startFakeAnthropic(() => ({ status, json: { error: { message: "SECRET-UPSTREAM-DETAIL sk-xyz" } } }));
    const waii = await startWaii({ apiKey: "k", baseUrl: fake.url });
    const r = await post(waii.base, { messages: [{ role: "user", content: "hi" }] });
    const text = await r.text();
    assert.equal(r.status, expected, `upstream ${status}`);
    assert.ok(!text.includes("SECRET-UPSTREAM-DETAIL"));
    fake.srv.close(); waii.srv.close();
  }
  const waii = await startWaii({ apiKey: "k", baseUrl: "http://127.0.0.1:1" });
  assert.equal((await post(waii.base, { messages: [{ role: "user", content: "hi" }] })).status, 502);
  waii.srv.close();
});

test("chat: empty model answer -> 502", async () => {
  const fake = await startFakeAnthropic(() => ok("<waii_meta>{}</waii_meta>"));
  const waii = await startWaii({ apiKey: "k", baseUrl: fake.url });
  assert.equal((await post(waii.base, { messages: [{ role: "user", content: "hi" }] })).status, 502);
  fake.srv.close(); waii.srv.close();
});

test("rate limiting kicks in", async () => {
  const fake = await startFakeAnthropic(() => ok("ok"));
  const waii = await startWaii({ apiKey: "k", baseUrl: fake.url, rateLimitPerMin: 2 });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await post(waii.base, { messages: [{ role: "user", content: "hi" }] })).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
  fake.srv.close(); waii.srv.close();
});

test("health + sources endpoints", async () => {
  const waii = await startWaii({ apiKey: "" });
  const h = await (await fetch(`${waii.base}/api/health`)).json();
  assert.equal(h.aiConfigured, false);
  const s = await (await fetch(`${waii.base}/api/sources`)).json();
  assert.ok(s.length >= 3 && s.every((x) => x.url.startsWith("https://")));
  waii.srv.close();
});

// ---------------- Gemini provider ----------------
import { loadConfig } from "../src/config.js";

test("config: provider selection and defaults", () => {
  assert.equal(loadConfig({ GEMINI_API_KEY: "g" }).provider, "gemini");
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: "a" }).provider, "anthropic");
  assert.equal(loadConfig({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" }).apiKey, "a");
  assert.equal(loadConfig({ GEMINI_API_KEY: ' "g-quoted" ' }).apiKey, "g-quoted");
  assert.equal(loadConfig({}).apiKey, "");
});

test("gemini: request shape (header key, roles, system instruction) and parsed answer", async () => {
  const fake = await startFakeAnthropic(() => ({ json: { candidates: [{ content: { parts: [
    { text: "hidden thought", thought: true },
    { text: 'ازيك\n<waii_meta>{"urgency":"see_doctor","sources":["who_bc"]}</waii_meta>' }] } }] } }));
  const waii = await startWaii({ provider: "gemini", apiKey: "g-key", model: "gemini-x", baseUrl: fake.url });
  const r = await post(waii.base, { messages: [
    { role: "user", content: "hello" }, { role: "assistant", content: "hi" }, { role: "user", content: "and then?" }] });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.reply, "ازيك");
  assert.equal(j.urgency, "see_doctor");
  const c = fake.calls[0];
  assert.equal(c.headers["x-goog-api-key"], "g-key");
  assert.deepEqual(c.body.contents.map((m) => m.role), ["user", "model", "user"]);
  assert.ok(c.body.systemInstruction.parts[0].text.includes("Waii"));
  assert.ok(!JSON.stringify(c.body).includes("g-key"));
  fake.srv.close(); waii.srv.close();
});

test("gemini: bad key (400 API key not valid), 404 model, 429 quota, blocked/empty answer", async () => {
  const cases = [
    [400, { error: { message: "API key not valid. Please pass a valid API key." } }, 502, "auth"],
    [404, { error: { message: "models/x is not found" } }, 502, "model"],
    [429, { error: { message: "quota" } }, 503, "busy"]
  ];
  for (const [status, json, expStatus, expCode] of cases) {
    const fake = await startFakeAnthropic(() => ({ status, json }));
    const waii = await startWaii({ provider: "gemini", apiKey: "k", model: "m", baseUrl: fake.url });
    const r = await post(waii.base, { messages: [{ role: "user", content: "hi" }] });
    const j = await r.json();
    assert.equal(r.status, expStatus, `status ${status}`);
    assert.equal(j.error.code, expCode);
    fake.srv.close(); waii.srv.close();
  }
  const fake = await startFakeAnthropic(() => ({ json: { promptFeedback: { blockReason: "SAFETY" } } }));
  const waii = await startWaii({ provider: "gemini", apiKey: "k", model: "m", baseUrl: fake.url });
  assert.equal((await post(waii.base, { messages: [{ role: "user", content: "hi" }] })).status, 502);
  fake.srv.close(); waii.srv.close();
});
