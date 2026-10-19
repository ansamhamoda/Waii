// Tiny stand-in for the Anthropic API, ONLY for offline smoke tests (npm run smoke).
// It does not understand questions: it echoes, so it proves the plumbing, not the AI.
import http from "node:http";
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const j = JSON.parse(b || "{}");
    const last = j.messages?.at(-1)?.content ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: `[FAKE MODEL] history=${j.messages.length} last="${last}"\n<waii_meta>{"urgency":"see_doctor","sources":["who_bc","nci_bc"]}</waii_meta>` }] }));
  });
}).listen(4010, () => console.log("fake anthropic on 4010"));
