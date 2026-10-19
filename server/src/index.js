import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp(config);
app.listen(config.port, () => {
  console.log(`\nWaii server running on http://localhost:${config.port}`);
  console.log(`AI provider: ${config.provider} | model: ${config.model}`);
  if (!config.apiKey) {
    console.warn("\n⚠  No API key found for provider '${config.provider}'. Copy .env.example to .env and add GEMINI_API_KEY (or ANTHROPIC_API_KEY).\n   The app will open, but the chatbot cannot answer until a key is set.\n");
  }
});
